/** Browser tokens must originate from this account's current service response. */
import { createHash } from 'node:crypto';
import { GatewayError } from '@onethu/gateway/policy';

const MAX_JSON = 256 * 1024;
const MAX_ORIGINS = 256;
const MAX_TOKENS = 128;
const TTL = 12 * 60 * 60 * 1000;
const JWT = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
const TOKEN_KEY = /(?:^|[_-])(?:token|jwt|credential|accesskey|apikey)(?:$|[_-])|^(?:accessToken|authToken|idToken|refreshToken|apiKey)$/i;
const TOKEN_HEADER = /^(?:authorization|token|jwt|access-token|auth-token|id-token|api-key|x-token|x-access-token|x-auth-token|x-api-key|x-authorization)$/i;
const CSRF_HEADER = /^(?:x-)?(?:csrf|xsrf)(?:-token)?$/i;
const opaque = (value: string) => value.length >= 16 && value.length <= 8192 && /^[A-Za-z0-9._~+\/-]+=*$/.test(value);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function credential(name: string, value: string): string | undefined {
  if (CSRF_HEADER.test(name) || name.toLowerCase().startsWith('proxy-')) return undefined;
  if (/^(?:x-)?authorization$/i.test(name)) return /^(?:Bearer|Token) ([^\s]+)$/i.exec(value)?.[1] ?? '';
  return TOKEN_HEADER.test(name) || JWT.test(value) ? value : undefined;
}

/** This ledger contains hashes only, and resets on epoch
 * changes. An old browser's localStorage token therefore cannot silently select
 * another account while requests also carry the authority's current cookies. */
export function createCampusServiceTokenLedger(epoch: () => number, now = Date.now, changed = () => {}) {
  let generation = epoch();
  const origins = new Map<string, Map<string, number>>();
  function current() {
    const next = epoch();
    if (next !== generation) { origins.clear(); generation = next; }
    return next;
  }
  function remember(origin: string, values: Set<string>, expected: number) {
    if (current() !== expected || !values.size) return;
    let tokens = origins.get(origin);
    if (!tokens) {
      if (origins.size >= MAX_ORIGINS) return;
      origins.set(origin, tokens = new Map());
    }
    const expires = now() + TTL;
    for (const value of values) {
      const hash = digest(value);
      tokens.delete(hash); tokens.set(hash, expires);
      if (tokens.size > MAX_TOKENS) tokens.delete(tokens.keys().next().value!);
    }
    changed();
  }
  function permits(origin: string, name: string, value: string) {
    current();
    const token = credential(name, value);
    if (token === undefined || !opaque(token)) return false;
    const tokens = origins.get(origin), hash = digest(token);
    const expiry = tokens?.get(hash);
    if (expiry === undefined) return false;
    if (expiry <= now()) { tokens!.delete(hash); return false; }
    return true;
  }
  function validateHeaders(origin: string, headers: Headers) {
    current();
    for (const [name, value] of headers) {
      if (credential(name, value) !== undefined && !permits(origin, name, value)) {
        throw new GatewayError('GATEWAY_SERVICE_TOKEN_REQUIRED', 401);
      }
    }
  }
  function observeResponse(origin: string, response: Response, check: () => void) {
    const expected = current();
    if (!response.body || !response.ok || response.status === 206 || response.headers.has('content-range') ||
        !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) return response;
    const chunks: Uint8Array[] = [];
    let size = 0;
    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        check();
        size += chunk.byteLength;
        if (size <= MAX_JSON) chunks.push(chunk.slice()); else chunks.length = 0;
        controller.enqueue(chunk);
      },
      flush() {
        check();
        if (current() !== expected || size > MAX_JSON) return;
        try {
          const json: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const values = new Set<string>();
          let visited = 0;
          const visit = (value: unknown, key = '', depth = 0) => {
            if (++visited > 4096 || depth > 12 || values.size >= MAX_TOKENS) return;
            if (typeof value === 'string') {
              if (opaque(value) && (TOKEN_KEY.test(key) || JWT.test(value))) values.add(value);
            } else if (value && typeof value === 'object') {
              for (const [childKey, child] of Object.entries(value)) visit(child, childKey, depth + 1);
            }
          };
          visit(json);
          remember(origin, values, expected);
        } catch { /* Invalid or oversized JSON remains byte-identical for its caller. */ }
      },
    });
    return new Response(response.body.pipeThrough(transform), {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
  }
  function snapshot(){current();return [...origins].map(([origin,tokens])=>({origin,tokens:[...tokens].filter(([,expiry])=>expiry>now()).map(([hash,expiry])=>({hash,expiry}))}));}
  function restore(input:unknown,allowed:(origin:string)=>boolean){
    current();if(!Array.isArray(input)||input.length>MAX_ORIGINS)return;
    for(const item of input){
      if(!item||typeof item.origin!=='string'||!allowed(item.origin)||!Array.isArray(item.tokens)||item.tokens.length>MAX_TOKENS)continue;
      const tokens=new Map<string,number>();
      for(const value of item.tokens)if(value&&/^[a-f0-9]{64}$/.test(value.hash)&&Number.isSafeInteger(value.expiry)&&value.expiry>now()&&value.expiry<=now()+TTL)tokens.set(value.hash,value.expiry);
      if(tokens.size)origins.set(item.origin,tokens);
    }
  }
  return { permits, validateHeaders, observeResponse, snapshot, restore };
}

import { GatewayError, isCampusCalendarRead } from '@onethu/gateway/policy';

const LIMIT = 16 * 1024;
const DAV = 'DAV:';
const CALDAV = 'urn:ietf:params:xml:ns:caldav';
const CARDDAV = 'urn:ietf:params:xml:ns:carddav';
const APPLE = 'http://apple.com/ns/ical/';
const SERVER = 'http://calendarserver.org/ns/';
const NAMESPACES = new Set([DAV, CALDAV, CARDDAV, APPLE, SERVER]);
function reject(status = 403): never { throw new GatewayError('GATEWAY_CALENDAR_REQUEST_REJECTED', status); }
type Element = { name: string; namespace: string; attributes: Map<string, string>; children: Element[] };

/** A deliberately small XML grammar for the observed empty-property queries.
 * No text, entity expansion, DTD, processing instruction, or arbitrary href is
 * meaningful here. Validate structure strictly instead of repairing bad XML. */
function parseQuery(source: string): Element {
  source = source.replace(/^<\?xml version=(["'])1\.0\1(?: encoding=(["'])utf-8\2)?\?>/i, '');
  if (/[&\x00-\x08\x0b\x0c\x0e-\x1f]|<!|<\?/.test(source)) reject();
  const stack: { element: Element; qualified: string; namespaces: Map<string, string> }[] = [];
  let root: Element | undefined;
  let offset = 0;
  let count = 0;
  const name = '[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?';
  const open = new RegExp(`^(${name})([\\s\\S]*)$`);
  const attribute = new RegExp(`^[\\t\\n\\r ]+(${name})[\\t\\n\\r ]*=[\\t\\n\\r ]*(["'])([^<>"']*)\\2`);
  while (offset < source.length) {
    const start = source.indexOf('<', offset);
    if (start < 0) { if (!/^[\t\n\r ]*$/.test(source.slice(offset))) reject(); break; }
    if (!/^[\t\n\r ]*$/.test(source.slice(offset, start))) reject();
    const end = source.indexOf('>', start);
    if (end < 0 || ++count > 128) reject();
    let tag = source.slice(start + 1, end);
    offset = end + 1;
    if (tag.startsWith('/')) {
      if (!stack.length || !new RegExp(`^/(${name})[\\t\\n\\r ]*$`).test(tag) || tag.slice(1).trim() !== stack.at(-1)!.qualified) reject();
      stack.pop();
      continue;
    }
    const empty = tag.endsWith('/');
    if (empty) tag = tag.slice(0, -1);
    const match = open.exec(tag);
    if (!match || stack.length >= 8) reject();
    const qualified = match[1]!;
    let rest = match[2]!;
    const raw = new Map<string, string>();
    while (rest && !/^[\t\n\r ]*$/.test(rest)) {
      const item = attribute.exec(rest);
      if (!item || raw.has(item[1]!) || raw.size >= 12) reject();
      raw.set(item[1]!, item[3]!);
      rest = rest.slice(item[0].length);
    }
    const namespaces = new Map(stack.at(-1)?.namespaces);
    const attributes = new Map<string, string>();
    for (const [key, value] of raw) {
      if (key === 'xmlns' || key.startsWith('xmlns:')) {
        const prefix = key === 'xmlns' ? '' : key.slice(6);
        if (['xml', 'xmlns'].includes(prefix) || !NAMESPACES.has(value)) reject();
        namespaces.set(prefix, value);
      } else {
        if (!['name', 'namespace'].includes(key)) reject();
        attributes.set(key, value);
      }
    }
    const parts = qualified.split(':');
    const namespace = namespaces.get(parts.length === 2 ? parts[0]! : '');
    if (!namespace) reject();
    const element: Element = { name: parts.at(-1)!, namespace, attributes, children: [] };
    if (stack.length) stack.at(-1)!.element.children.push(element);
    else { if (root) reject(); root = element; }
    if (!empty) stack.push({ element, qualified, namespaces });
  }
  if (!root || stack.length) reject();
  return root;
}

function validateQuery(root: Element, method: string) {
  const named = (node: Element, name: string) => node.namespace === DAV && node.name === name && node.attributes.size === 0;
  if (method === 'PROPFIND') {
    if (!named(root, 'propfind') || root.children.length !== 1 || !named(root.children[0]!, 'prop')) reject();
    const allowed = new Set([
      ...['current-user-privilege-set', 'displayname', 'supportedlock', 'resourcetype', 'supported-report-set', 'sync-token'].map(name => `${DAV}|${name}`),
      `${APPLE}|calendar-color`, `${CALDAV}|supported-calendar-component-set`, `${CARDDAV}|max-image-size`,
    ]);
    const children = root.children[0]!.children;
    if (!children.length || children.length > allowed.size) reject();
    for (const child of children) {
      const key = `${child.namespace}|${child.name}`;
      if (child.attributes.size || child.children.length || !allowed.delete(key)) reject();
    }
    return;
  }
  if (!named(root, 'expand-property') || !root.children.length || root.children.length > 2) reject();
  const top = new Set(['calendar-proxy-read-for', 'calendar-proxy-write-for']);
  const property = (node: Element) => {
    if (node.namespace !== DAV || node.name !== 'property' || node.attributes.size !== 2 ||
        !node.attributes.has('name') || !node.attributes.has('namespace')) reject();
    return `${node.attributes.get('namespace')}|${node.attributes.get('name')}`;
  };
  for (const parent of root.children) {
    property(parent);
    if (parent.attributes.get('namespace') !== SERVER || !top.delete(parent.attributes.get('name')!)) reject();
    const children = new Set([`${SERVER}|email-address-set`, `${DAV}|displayname`, `${CALDAV}|calendar-user-address-set`]);
    if (!parent.children.length || parent.children.length > children.size) reject();
    for (const child of parent.children) if (child.children.length || !children.delete(property(child))) reject();
  }
}

/** Permit only Learn's observed read-only collection queries. Consume a bounded
 * request before any upstream call, retaining its exact original UTF-8 bytes. */
export async function validateCampusCalendarRead(target: URL, method: string, init: RequestInit, check: () => void): Promise<RequestInit> {
  if (!['PROPFIND', 'REPORT'].includes(method)) return init;
  const checkCurrent = () => { if (init.signal?.aborted) throw init.signal.reason; check(); };
  checkCurrent();
  if (!isCampusCalendarRead(target, method) || init.body == null) reject();
  const headers = new Headers(init.headers);
  if (!/^(?:text|application)\/xml(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(headers.get('content-type') ?? '') ||
      headers.has('depth') && !['0', '1'].includes(headers.get('depth')!) || headers.has('content-encoding')) reject();
  const length = headers.get('content-length');
  if (length !== null && (!/^(?:0|[1-9]\d*)$/.test(length) || Number(length) > LIMIT)) reject(413);
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = new Response(init.body).body!.getReader(); } catch { reject(); }
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  init.signal?.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      checkCurrent();
      const part = await reader.read();
      checkCurrent();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) reject();
      size += part.value.byteLength;
      if (size > LIMIT) reject(413);
      chunks.push(part.value.slice());
    }
    if (length !== null && Number(length) !== size) reject();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let source: string;
    try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { reject(); }
    validateQuery(parseQuery(source), method);
    checkCurrent();
    return { ...init, body: bytes };
  } catch (error) { cancel(); throw error; }
  finally { init.signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
}

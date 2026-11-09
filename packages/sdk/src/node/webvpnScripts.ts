/** Remove only the observed WebVPN function-to-source envelope. Never evaluate
 * downloaded code, and never search/replace wrapper-like text inside JS. */
import { GatewayError } from '@onethu/gateway/policy';

// The Latin-1 view must recognize the UTF-8 BOM explicitly: Response.text()
// hides it, but removing/re-encoding it here would change original bytes.
const PREFIX=/^(\xEF\xBB\xBF)?vpn_eval\(\(function\(\)\{\r?\n/;
const SUFFIX=/\r?\n\}[ \t]{0,8}\r?\n\)[ \t]{0,8}\.toString\(\)[ \t]{0,8}\.slice\([ \t]{0,8}12[ \t]{0,8},[ \t]{0,8}-2[ \t]{0,8}\)[ \t]{0,8},[ \t]{0,8}""[ \t]{0,8}\)[ \t]{0,8};[ \t\r\n]{0,64}$/;
const PREFIX_LENGTH='\xEF\xBB\xBFvpn_eval((function(){\r\n'.length,TAIL_LENGTH=512;
const MAX_SCRIPT=8*1024*1024;
const MAX_ENVELOPES=4;
const fail=(code:string):never=>{throw new GatewayError(code,502);};

function unwrap(source:string) {
  let leading='';
  for(let depth=0;PREFIX.test(source);depth++){
    if(depth===MAX_ENVELOPES)return fail('GATEWAY_SCRIPT_WRAPPER_UNSUPPORTED');
    const start=PREFIX.exec(source)!,end=SUFFIX.exec(source);
    if(!end)return fail('GATEWAY_SCRIPT_WRAPPER_UNSUPPORTED');
    leading+=start[1]??'';
    source=source.slice(start[0].length,end.index);
  }
  return leading+source;
}

function javascript() {
  let pending='',leading='',depth=0,detected=false;
  return (part:string,final=false):string[]=>{
    pending+=part;
    while(!detected){
      if(pending.length<PREFIX_LENGTH&&!final)return [];
      const start=PREFIX.exec(pending);
      if(!start){detected=true;break;}
      if(depth===MAX_ENVELOPES)return fail('GATEWAY_SCRIPT_WRAPPER_UNSUPPORTED');
      depth++;leading+=start[1]??'';pending=pending.slice(start[0].length);
    }
    if(!depth){const ready=pending;pending='';return ready?[ready]:[];}
    const output=leading?[leading]:[];leading='';
    if(final){
      for(let index=0;index<depth;index++){
        const end=SUFFIX.exec(pending);if(!end)return fail('GATEWAY_SCRIPT_WRAPPER_UNSUPPORTED');
        pending=pending.slice(0,end.index);
      }
      const ready=pending;pending='';return ready?[...output,ready]:output;
    }
    const end=Math.max(0,pending.length-TAIL_LENGTH*depth);
    if(!end)return output;
    const ready=pending.slice(0,end);pending=pending.slice(end);return [...output,ready];
  };
}

/** Some campus endpoints label JavaScript as text/html. Only the exact observed
 * byte-zero envelope selects JavaScript; ordinary HTML keeps its tokenizer. */
function htmlOrJavaScript(){
  let prefix='',transform:ReturnType<typeof javascript>|undefined;
  return (part:string,final=false):string[]=>{
    if(transform)return transform(part,final);
    prefix+=part;if(prefix.length<PREFIX_LENGTH&&!final)return [];
    transform=PREFIX.test(prefix)?javascript():htmlScripts();
    const ready=transform(prefix,final);prefix='';return ready;
  };
}

function tagEnd(source:string,start=0) {
  let quote='';
  for(let index=start;index<source.length;index++){
    const char=source[index]!;
    if(quote){if(char===quote)quote='';}
    else if(char==='"'||char==="'")quote=char;
    else if(char==='>')return index+1;
  }
  return -1;
}

function inlineJavaScript(tag:string) {
  const attributes=new Map<string,string>();
  for(const match of tag.slice(7,-1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g))attributes.set(match[1]!.toLowerCase(),match[2]??match[3]??match[4]??'');
  if(attributes.has('src'))return false;
  const type=(attributes.get('type')??'').trim().toLowerCase();
  return type===''||type==='module'||/^(?:text|application)\/(?:x-)?(?:java|ecma)script(?:\s*;|$)/.test(type);
}

const vpnConfigurationTypes:Record<string,string>={
  __vpn_hostname_data:'string',
  __vpn_protocol_data:'string',
  __vpn_protocol_host:'string',
  __vpn_app_hostname_data:'string',
  __vpn_app_protocol_data:'string',
  __vpn_app_port_data:'string',
  __vpn_js_file:'string',
  __vpn_worker_mode:'number',
  __vpn_fast_mode:'number',
  __vpn_host_crypt:'boolean',
  __vpn_host_crypt_key:'string',
  __vpn_host_crypt_iv:'string',
  __vpn_hsts:'boolean',
  __vpn_hsts_sub_domains:'boolean',
};

/** The removed WebVPN runtime owns this exact standalone configuration block.
 * Parse only its observed literal declarations; application code stays intact. */
function standaloneWebvpnConfiguration(source:string) {
  if(source.length>8192)return false;
  const declaration=/[ \t\r\n]*var[ \t\r\n]+(__vpn_[a-z_]+)[ \t\r\n]*=[ \t\r\n]*("[^"\\\x00-\x1f]*"|true|false|0|[1-9][0-9]*)[ \t\r\n]*;[ \t\r\n]*/y;
  const values=new Map<string,string|number|boolean>();
  while(declaration.lastIndex<source.length){
    const match=declaration.exec(source);
    if(!match)return false;
    const name=match[1]!,value=JSON.parse(match[2]!) as string|number|boolean;
    if(!Object.hasOwn(vpnConfigurationTypes,name)||values.has(name)||typeof value!==vpnConfigurationTypes[name])return false;
    values.set(name,value);
  }
  return values.size===14
    &&values.get('__vpn_hostname_data')==='webvpn.tsinghua.edu.cn'
    &&values.get('__vpn_protocol_data')==='https'
    &&values.get('__vpn_protocol_host')==='https://webvpn.tsinghua.edu.cn'
    &&/^\/wengine-vpn\/js\/main\.js(?:\?ver=[A-Za-z0-9._-]+)?$/.test(String(values.get('__vpn_js_file')));
}

/** WebVPN also wraps inline event handlers. Match the complete observed
 * envelope only within a parsed attribute; quoted application text is inert. */
function eventAttributes(tag:string) {
  const start=/^<[a-z][a-z0-9:-]*/i.exec(tag)?.[0].length;
  if(!start)return tag;
  const prefix='var vpn_return;eval(vpn_rewrite_js((function () { ';
  const suffix=/ \}\)\.toString\(\)\.slice\(14,[ \t]*-2\),[ \t]*2\)\);return vpn_return;$/;
  const attributes=tag.slice(start,-1).replace(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,(whole:string,name:string,double:string|undefined,single:string|undefined)=>{
    let value=double??single;
    if(value===undefined)return whole;
    const handler=/^on[a-z][a-z0-9:_-]*$/i.test(name),url=name.toLowerCase()==='href'&&/^javascript:/i.test(value);
    if(!handler&&!url)return whole;
    const scheme=url?value.slice(0,11):'';
    let source=value.slice(scheme.length),changed=false;
    for(let depth=0;source.startsWith(prefix);depth++){
      const end=suffix.exec(source);
      if(!end||depth===MAX_ENVELOPES)break;
      source=source.slice(prefix.length,end.index);changed=true;
    }
    if(!changed)return whole;
    const quote=double!==undefined?'"':"'",opening=whole.indexOf(quote,whole.indexOf('=')+1);
    return whole.slice(0,opening+1)+scheme+source+quote;
  });
  return tag.slice(0,start)+attributes+'>';
}

/** Large ASP.NET form state and inline images are inert attribute data. Find
 * only an unfinished quoted value/src after skipping complete attributes, so
 * markup-looking text inside another attribute cannot enter this path. */
function largeDataAttribute(tag:string) {
  const opening=/^<(input|img)(?=[\s/>])/i.exec(tag);
  if(!opening)return;
  const name=opening[1]!.toLowerCase();
  let index=opening[0].length;
  while(index<tag.length){
    while(/\s/.test(tag[index]??''))index++;
    const start=index;
    while(index<tag.length&&!/[\s=/>"'<]/.test(tag[index]!))index++;
    if(index===start)return;
    const attribute=tag.slice(start,index).toLowerCase();
    while(/\s/.test(tag[index]??''))index++;
    if(tag[index]!=='=')continue;
    index++;while(/\s/.test(tag[index]??''))index++;
    const quote=tag[index];
    if(quote==='"'||quote==="'"){
      const value=index+1,end=tag.indexOf(quote,value);
      if(end>=0){index=end+1;continue;}
      if(name==='input'&&attribute==='value'||name==='img'&&attribute==='src')return {opening:opening[0],start,quote};
      return;
    }
    while(index<tag.length&&!/[\s>]/.test(tag[index]!))index++;
  }
}

/** A small HTML raw-text tokenizer: quoted attributes and comments cannot open
 * scripts, and a script's JS strings never become a second script boundary. */
function htmlScripts() {
  let pending='',state:'text'|'comment'|'script'|'raw'|'plaintext'|'attribute'='text',rawTag='',rewrite=false;
  let attributeQuote='',continuedTag='';
  return (part:string,final=false):string[]=>{
    pending+=part;const output:string[]=[];
    while(pending){
      if(state==='attribute'){
        const end=pending.indexOf(attributeQuote);
        if(end<0){output.push(pending);pending='';break;}
        output.push(pending.slice(0,end+1));
        pending=continuedTag+pending.slice(end+1);state='text';continue;
      }
      if(state==='plaintext'){output.push(pending);pending='';break;}
      if(state==='comment'){
        const end=pending.indexOf('-->');
        if(end>=0){output.push(pending.slice(0,end+3));pending=pending.slice(end+3);state='text';continue;}
        const count=final?pending.length:Math.max(0,pending.length-2);
        if(count){output.push(pending.slice(0,count));pending=pending.slice(count);}break;
      }
      if(state==='script'||state==='raw'){
        const match=new RegExp('</'+rawTag+'(?=[\\s/>])','i').exec(pending);
        if(match){
          const end=tagEnd(pending,match.index);
          if(end<0){if(pending.length>MAX_SCRIPT)fail('GATEWAY_INLINE_SCRIPT_TOO_LARGE');if(!final)break;}
          else {
            if(state==='script'&&match.index>MAX_SCRIPT)fail('GATEWAY_INLINE_SCRIPT_TOO_LARGE');
            const source=pending.slice(0,match.index);
            const restored=rewrite?unwrap(source):source;
            output.push(rewrite&&standaloneWebvpnConfiguration(restored)?'':restored,pending.slice(match.index,end));
            pending=pending.slice(end);state='text';continue;
          }
        }
        if(final){
          if(rewrite&&PREFIX.test(pending))fail('GATEWAY_SCRIPT_WRAPPER_UNSUPPORTED');
          output.push(pending);pending='';break;
        }
        if(state==='script'){if(pending.length>MAX_SCRIPT)fail('GATEWAY_INLINE_SCRIPT_TOO_LARGE');break;}
        const count=Math.max(0,pending.length-rawTag.length-4);
        if(count){output.push(pending.slice(0,count));pending=pending.slice(count);}break;
      }
      const opening=pending.indexOf('<');
      if(opening<0){output.push(pending);pending='';break;}
      if(opening){output.push(pending.slice(0,opening));pending=pending.slice(opening);}
      if(pending.length<4&&!final)break;
      if(pending.startsWith('<!--')){output.push('<!--');pending=pending.slice(4);state='comment';continue;}
      if(!/^<[A-Za-z!/?]/.test(pending)){output.push('<');pending=pending.slice(1);continue;}
      const end=tagEnd(pending);
      if(end<0){
        if(pending.length>65536){
          const data=largeDataAttribute(pending);
          if(!data)return fail('GATEWAY_HTML_TAG_TOO_LARGE');
          const prefix=eventAttributes(pending.slice(0,data.start)+'>').slice(0,-1);
          output.push(prefix.slice(continuedTag.length),pending.slice(data.start));
          continuedTag=data.opening;attributeQuote=data.quote;state='attribute';pending='';break;
        }
        if(final){output.push(pending.slice(continuedTag.length));pending='';continuedTag='';}break;
      }
      const tag=pending.slice(0,end);pending=pending.slice(end);
      output.push(eventAttributes(tag).slice(continuedTag.length));continuedTag='';
      const name=/^<([a-z][a-z0-9:-]*)(?=[\s/>])/i.exec(tag)?.[1]?.toLowerCase();
      if(name==='script'){state='script';rawTag='script';rewrite=inlineJavaScript(tag);}
      else if(name&&['style','textarea','title','xmp','iframe','noembed','noframes'].includes(name)){state='raw';rawTag=name;rewrite=false;}
      else if(name==='plaintext')state='plaintext';
    }
    return output;
  };
}

export function unwrapWebvpnScripts(body:ReadableStream<Uint8Array>, html:boolean,check:()=>void) {
  const transform=html?htmlOrJavaScript():javascript(),reader=body.getReader();let finished=false;
  const iterator=(async function*(){
    try{
      while(true){
        check();const part=await reader.read();check();
        if(part.done){for(const ready of transform('',true))if(ready)yield Buffer.from(ready,'latin1');finished=true;return;}
        for(let offset=0;offset<part.value.length;offset+=32768){
          check();const text=Buffer.from(part.value.subarray(offset,offset+32768)).toString('latin1');
          for(const ready of transform(text))if(ready)yield Buffer.from(ready,'latin1');
        }
      }
    }finally{if(!finished)await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  })();
  return new ReadableStream<Uint8Array>({
    async pull(target){try{const part=await iterator.next();check();if(part.done)target.close();else target.enqueue(part.value);}catch(error){target.error(error);}},
    async cancel(){await reader.cancel().catch(()=>undefined);await iterator.return();},
  });
}

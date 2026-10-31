import test from 'node:test';
import assert from 'node:assert/strict';
import { unwrapWebvpnScripts } from '../src/node/webvpnScripts.js';

const prefix='vpn_eval((function(){\n',suffix='\n}\n).toString().slice(12, -2),"");';
function chunks(bytes:Uint8Array,size:number){let offset=0;return new ReadableStream<Uint8Array>({pull(target){if(offset>=bytes.length){target.close();return;}target.enqueue(bytes.subarray(offset,offset+size));offset+=size;}});}
async function transform(source:Buffer,html=false,size=7){return Buffer.from(await new Response(unwrapWebvpnScripts(chunks(source,size),html,()=>{})).arrayBuffer());}

test('standalone JavaScript removes exact envelope across arbitrary chunk boundaries without changing GBK or CRLF',async()=>{
 const body=Buffer.concat([Buffer.from('/* original\r\n'),Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from(' */\r\nglobalThis.fixture = "vpn_eval((function(){\\n";')]);
 const wrapped=Buffer.concat([Buffer.from(prefix),body,Buffer.from(suffix)]);
 for(const size of [1,3,21,37,1024])assert.deepEqual(await transform(wrapped,false,size),body);
 const varied=Buffer.concat([Buffer.from(prefix.replace('\n','\r\n')),body,Buffer.from('\r\n}\r\n).toString().slice( 12,  -2 ), "" );\r\n')]);
 assert.deepEqual(await transform(varied,false,1),body);
});

test('normal JavaScript and wrapper-looking JS strings remain byte-for-byte unchanged',async()=>{
 for(const source of [Buffer.from('globalThis.example = '+JSON.stringify(prefix+'example'+suffix)+';'),Buffer.from('/* vpn_eval is application text */\nconst x = 1;'),Buffer.from('vpn_eval')])assert.deepEqual(await transform(source),source);
 await assert.rejects(transform(Buffer.from(prefix+'original();'+suffix.replace(',""',',"unexpected"'))),{code:'GATEWAY_SCRIPT_WRAPPER_UNSUPPORTED'});
});

test('cached nested envelopes and HTML-mislabeled JavaScript unwrap with a fixed depth limit',async()=>{
 const body=Buffer.concat([Buffer.from('/* '),Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from(' */\r\nglobalThis.language="ok";\n')]);
 let source=body;
 for(let depth=1;depth<=4;depth++){
  source=Buffer.concat([Buffer.from(prefix),source,Buffer.from(suffix+'\r\n\n')]);
  for(const html of [false,true])for(const size of [1,29,65536])assert.deepEqual(await transform(source,html,size),body);
 }
 await assert.rejects(transform(Buffer.concat([Buffer.from(prefix),source,Buffer.from(suffix)])),{code:'GATEWAY_SCRIPT_WRAPPER_UNSUPPORTED'});
 assert.equal((await transform(Buffer.from('<script>'+prefix+prefix+'run();'+suffix+suffix+'</script>'),true)).toString(),'<script>run();</script>');
 await assert.rejects(transform(Buffer.from(prefix+prefix+'run();'+suffix)),{code:'GATEWAY_SCRIPT_WRAPPER_UNSUPPORTED'});
});

test('UTF-8 BOM at a script envelope boundary is preserved across byte-split chunks',async()=>{
 const bom=Buffer.from([0xef,0xbb,0xbf]),body=Buffer.from('globalThis.fixture="中文";\r\n');
 for(const html of [false,true])for(const size of [1,2,22,65536]){
  assert.deepEqual(await transform(Buffer.concat([bom,Buffer.from(prefix),body,Buffer.from(suffix)]),html,size),Buffer.concat([bom,body]));
  assert.deepEqual(await transform(Buffer.concat([Buffer.from(prefix),bom,Buffer.from(prefix),body,Buffer.from(suffix+suffix)]),html,size),Buffer.concat([bom,body]));
 }
 const inline=Buffer.concat([Buffer.from('<script>'),bom,Buffer.from(prefix),body,Buffer.from(suffix+'</script>')]);
 assert.deepEqual(await transform(inline,true,1),Buffer.concat([Buffer.from('<script>'),bom,body,Buffer.from('</script>')]));
 assert.deepEqual(await transform(Buffer.concat([bom,body])),Buffer.concat([bom,body]));
 await assert.rejects(transform(Buffer.concat([bom,Buffer.from(prefix+'missingSuffix();')])),{code:'GATEWAY_SCRIPT_WRAPPER_UNSUPPORTED'});
});

test('HTML rewrites only well-delimited JavaScript bodies while respecting comments, attributes and raw-text elements',async()=>{
 const body='globalThis.fixture=1;\r\nconst text="vpn_eval((function(){\\n";';
 const wrapped=prefix+body+suffix;
 const untouched='<!-- <script>'+wrapped+'</script> --><div title="<script>fake</script>">content</div><textarea><script>'+wrapped+'</script></textarea><style>/* <script>'+wrapped+'</script> */</style>';
 const source=untouched+'<script data-label=" src=ignored">'+wrapped+'</script><SCRIPT type="text/javascript">'+wrapped+'</SCRIPT>'+('<script>'+wrapped+'</script>').repeat(5)+'<script type="application/json">'+JSON.stringify(wrapped)+'</script><script type="text/template">'+wrapped+'</script><script src="/app.js">'+wrapped+'</script>';
 const expected=untouched+'<script data-label=" src=ignored">'+body+'</script><SCRIPT type="text/javascript">'+body+'</SCRIPT>'+('<script>'+body+'</script>').repeat(5)+'<script type="application/json">'+JSON.stringify(wrapped)+'</script><script type="text/template">'+wrapped+'</script><script src="/app.js">'+wrapped+'</script>';
 for(const size of [1,13,65536])assert.equal((await transform(Buffer.from(source),true,size)).toString(),expected);
});

test('large inline scripts are bounded and malformed wrapped script boundaries fail explicitly',async()=>{
 const source=Buffer.from('<html><script>'+prefix+'const text="'+'.'.repeat(40000)+'";'+suffix+'</script></html>');
 assert.equal((await transform(source,true,251)).toString(),'<html><script>const text="'+'.'.repeat(40000)+'";</script></html>');
 await assert.rejects(transform(Buffer.from('<script>'+prefix+'run();'),true),{code:'GATEWAY_SCRIPT_WRAPPER_UNSUPPORTED'});
 await assert.rejects(transform(Buffer.from('<script>'+prefix+'.'.repeat(8*1024*1024)+suffix+'</script>'),true,65536),{code:'GATEWAY_INLINE_SCRIPT_TOO_LARGE'});
});

test('large standalone wrapped scripts stream before the source is completely produced',async()=>{
 let produced=0;const count=100,chunk=Buffer.from('/*'+'.'.repeat(16380)+'*/');
 const source=new ReadableStream<Uint8Array>({pull(target){if(!produced){produced++;target.enqueue(Buffer.from(prefix));}else if(produced<=count){produced++;target.enqueue(chunk);}else{target.enqueue(Buffer.from(suffix));target.close();}}});
 const reader=unwrapWebvpnScripts(source,false,()=>{}).getReader();
 const first=await reader.read();assert.equal(first.done,false);assert(produced<count);
 let bytes=first.value!.length;while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;}assert.equal(bytes,count*chunk.length);
});

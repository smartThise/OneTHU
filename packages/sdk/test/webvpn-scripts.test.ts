import test from 'node:test';
import assert from 'node:assert/strict';
import { unwrapWebvpnScripts } from '../src/node/webvpnScripts.js';

const prefix='vpn_eval((function(){\n',suffix='\n}\n).toString().slice(12, -2),"");';
function chunks(bytes:Uint8Array,size:number){let offset=0;return new ReadableStream<Uint8Array>({pull(target){if(offset>=bytes.length){target.close();return;}target.enqueue(bytes.subarray(offset,offset+size));offset+=size;}});}
async function transform(source:Buffer,html=false,size=7){return Buffer.from(await new Response(unwrapWebvpnScripts(chunks(source,size),html,()=>{})).arrayBuffer());}

const vpnConfiguration=`
var __vpn_hostname_data = "webvpn.tsinghua.edu.cn";
var __vpn_protocol_data = "https";
var __vpn_protocol_host = "https://webvpn.tsinghua.edu.cn";
var __vpn_app_hostname_data = "77726476706e69737468656265737421eaff4b8b3f3b2653770bc7b88b5c2d320506b1aec738590a49ba";
var __vpn_app_protocol_data = "http";
var __vpn_app_port_data = "";
var __vpn_js_file = "/wengine-vpn/js/main.js?ver=20211207";
var __vpn_worker_mode = 2;
var __vpn_fast_mode = 0;
var __vpn_host_crypt = true;
var __vpn_host_crypt_key = "wrdvpnisthebest!";
var __vpn_host_crypt_iv = "wrdvpnisthebest!";
var __vpn_hsts = false;
var __vpn_hsts_sub_domains = false;
`;

test('only the complete standalone WebVPN configuration is removed across split HTML streams',async()=>{
 const before=Buffer.concat([Buffer.from('<p>'),Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from('</p>\r\n<script nonce="fixture">')]);
 const after=Buffer.from('</script>\r\n<script>Event.observe(window,"load",init,false);</script><p>中文</p>');
 const expected=Buffer.concat([before,after]);
 for(const size of [1,3,31,32768]){
  assert.deepEqual(await transform(Buffer.concat([before,Buffer.from(vpnConfiguration),after]),true,size),expected);
  assert.deepEqual(await transform(Buffer.concat([before,Buffer.from(prefix+vpnConfiguration+suffix),after]),true,size),expected);
 }
});

test('partial, mixed, unknown, or non-JavaScript configuration-like content remains intact',async()=>{
 const altered=[
  vpnConfiguration+'appReady();',
  vpnConfiguration+'var p_xnxq = "2099-2100-1";',
  vpnConfiguration+'var __vpn_unknown_data = true;',
  vpnConfiguration+'var __vpn_hsts = false;',
  vpnConfiguration.replace('var __vpn_hsts = false;',''),
  vpnConfiguration.replace('"webvpn.tsinghua.edu.cn"','"other.example"'),
  vpnConfiguration.replace('/wengine-vpn/js/main.js','/application/main.js'),
  vpnConfiguration.replace('var __vpn_worker_mode = 2;','var __vpn_worker_mode = currentMode();'),
  vpnConfiguration.replace('var __vpn_fast_mode = 0;','var __vpn_fast_mode = "0";'),
 ];
 for(const source of altered){
  const html=Buffer.from('<script>'+source+'</script>');
  assert.deepEqual(await transform(html,true,1),html);
 }
 for(const start of ['<script type="application/json">','<script type="text/template">','<script src="/app.js">','<textarea><script>','<!--<script>']){
  const html=Buffer.from(start+vpnConfiguration+'</script>');
  assert.deepEqual(await transform(html,true,7),html);
 }
 assert.deepEqual(await transform(Buffer.from(vpnConfiguration),false,1),Buffer.from(vpnConfiguration));
});

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

test('HTML event and javascript-link envelopes restore their original handlers across chunk boundaries',async()=>{
 const wrap=(source:string)=>'var vpn_return;eval(vpn_rewrite_js((function () { '+source+' }).toString().slice(14, -2), 2));return vpn_return;';
 const handler='showhidediv(); return false;',wrapped=wrap(handler);
 const source='<a onclick="'+wrapped+'" href="javascript:'+wrap('openMenu()')+'">query</a><input ONCHANGE=\''+wrap('choose(&quot;fixture&quot;)')+'\'>';
 const expected='<a onclick="'+handler+'" href="javascript:openMenu()">query</a><input ONCHANGE=\'choose(&quot;fixture&quot;)\'>';
 for(const size of [1,13,65536])assert.equal((await transform(Buffer.from(source),true,size)).toString(),expected);
 const inert='<div title=\'onclick="'+wrapped+'"\'></div><!-- <a onclick="'+wrapped+'"> --><script type="application/json">'+JSON.stringify(wrapped)+'</script><textarea><a onclick="'+wrapped+'"></textarea>';
 assert.equal((await transform(Buffer.from(inert),true,1)).toString(),inert);
 for(const text of [wrapped.replace('slice(14','slice(13'),wrapped.replace('2));return','3));return'),'applicationText('+JSON.stringify(wrapped)+')']){
  const html='<a onclick=\''+text+'\'>same</a>';assert.equal((await transform(Buffer.from(html),true,3)).toString(),html);
 }
});

test('large ASP.NET state and inline image attributes stream without changing data or losing surrounding handlers',async()=>{
 const handler=(code:string)=>'var vpn_return;eval(vpn_rewrite_js((function () { '+code+' }).toString().slice(14, -2), 2));return vpn_return;';
 const hiddenStart='<form><INPUT type="hidden" name="__VIEWSTATE" onfocus="'+handler('beforeState()')+'" id="__VIEWSTATE" value="';
 const hiddenExpected='<form><INPUT type="hidden" name="__VIEWSTATE" onfocus="beforeState()" id="__VIEWSTATE" value="';
 const state=Buffer.concat([Buffer.from('A'.repeat(91248)),Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from('<script>inert()</script>')]);
 const image="<img src='data:image/png;base64,"+'B'.repeat(100000);
 const closing='" onchange="'+handler('afterState()')+'">'+image+"' onload=\""+handler('loaded()')+'"><script>'+prefix+'afterImage();'+suffix+'</script></form>';
 const expectedClosing='" onchange="afterState()">'+image+"' onload=\"loaded()\"><script>afterImage();</script></form>";
 const source=Buffer.concat([Buffer.from(hiddenStart),state,Buffer.from(closing)]);
 const expected=Buffer.concat([Buffer.from(hiddenExpected),state,Buffer.from(expectedClosing)]);
 for(const size of [4093,32768,65536])assert.deepEqual(await transform(source,true,size),expected);
});

test('oversized data attributes retain quote state across isolated closing quotes and successive values',async()=>{
 const start='<input value="'+'x'.repeat(100000),middle='" value=\'',end='z'.repeat(100000)+"'><script>"+prefix+'finish();'+suffix+'</script>';
 const sourceParts=[start,'"'," value='",'z'.repeat(100000),"'",'><script>',prefix+'finish();'+suffix,'</script>'];
 let index=0;
 const body=new ReadableStream<Uint8Array>({pull(target){if(index===sourceParts.length)target.close();else target.enqueue(Buffer.from(sourceParts[index++]!));}});
 const actual=Buffer.from(await new Response(unwrapWebvpnScripts(body,true,()=>{})).arrayBuffer());
 const expected=start+middle+end;
 assert.equal(actual.toString(),expected.replace('<script>'+prefix+'finish();'+suffix+'</script>','<script>finish();</script>'));
});

test('large data values start flowing before the entire tag or document is received',async()=>{
 let produced=0;
 const count=64,chunk=Buffer.from('A'.repeat(32768));
 const body=new ReadableStream<Uint8Array>({pull(target){
  if(produced===0){produced++;target.enqueue(Buffer.from('<input type="hidden" name="__VIEWSTATE" value="'));}
  else if(produced<=count){produced++;target.enqueue(chunk);}
  else{target.enqueue(Buffer.from('">'));target.close();}
 }});
 const reader=unwrapWebvpnScripts(body,true,()=>{}).getReader();
 let received=0;
 while(received<100000){const part=await reader.read();assert.equal(part.done,false);received+=part.value!.byteLength;}
 assert(produced<count);
 while(true){const part=await reader.read();if(part.done)break;received+=part.value!.byteLength;}
 assert.equal(received,Buffer.byteLength('<input type="hidden" name="__VIEWSTATE" value="">')+count*chunk.byteLength);
});

test('large-data handling does not relax script, event, or unrelated attribute parsing limits',async()=>{
 for(const start of ['<div title="','<input onclick="','<script data-value="','<input data-label="fake value=\'']){
  await assert.rejects(transform(Buffer.from(start+'A'.repeat(100000)+'">'),true,32768),{code:'GATEWAY_HTML_TAG_TOO_LARGE'});
 }
 const incomplete=Buffer.from('<input value="'+'A'.repeat(100000));
 assert.deepEqual(await transform(incomplete,true,32768),incomplete);
});

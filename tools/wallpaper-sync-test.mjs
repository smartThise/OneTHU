/** Portable wallpaper transfer, read-only restore and asynchronous account isolation. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile = p => ts.transpileModule(fs.readFileSync(p, 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const archiveCode = compile('apps/desktop/src/state/wallpArchive.ts');
const syncCode = compile('apps/desktop/src/state/wallpsync.ts');
const repoCode = compile('apps/desktop/src/lib/ownedCloudRepo.ts');
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAN8AAAAASUVORK5CYII=';
const row = ref => ({id:'one',name:'Wallpaper',at:1,ref});
const doc = ref => ({v:2,global:ref,library:ref ? [row(ref)] : []});
const ownRepo = (overrides = {}) => ({id:'own',name:'OneTHU',repoType:'mine',owner:'user@fixture.invalid',isVirtual:false,size:100,mtime:1,...overrides});
function load(code, imports = {}, env = {}) {
  const exports = {};
  vm.runInNewContext(code, {exports,require:id=>{assert.ok(id in imports,id);return imports[id]}, TextEncoder,TextDecoder,Uint8Array,btoa,atob,console,...env});
  return exports;
}
const archive = load(archiveCode);
const normalize = value => JSON.parse(JSON.stringify(value));
function fixture(options = {}) {
  const calls = [], storage = new Map();
  const state = {token:'account-a',version:1,doc:doc('builtin:ink'),repos:[ownRepo()],directories:{'/':[{kind:'dir',name:'壁纸'}],'/壁纸':[{kind:'file',name:'onethu-wallpaper.json',size:1024}]}, archive:doc(image), ...options};
  const invoke = async (command,args) => {
    calls.push({command,args});
    if (state.hook) await state.hook(command,args,state);
    if (state.failure?.command === command) throw Error(state.failure.message);
    switch (command) {
      case 'seafile_repos': return state.repos;
      case 'seafile_account': return {email:'user@fixture.invalid'};
      case 'seafile_create_repo': {const made=ownRepo();state.repos.push(made);return made;}
      case 'seafile_dir': return state.directories[args.path] ?? [];
      case 'seafile_read_bytes': return Buffer.from(JSON.stringify(state.archive)).toString('base64');
      case 'wallpaper_read': return image.split(',')[1];
      case 'wallpaper_save': return '/current-device/wallpapers/' + args.name;
      case 'seafile_upload_wallpaper': state.upload = JSON.parse(args.content);return 1;
      case 'seafile_mkdir': case 'seafile_upload': case 'wallpaper_delete': return;
      default: throw Error('Unexpected command: ' + command);
    }
  };
  const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  const cloud={ensureSeafileLoaded:async()=>{},getSeafileToken:()=>state.token,getSeafileCredentialVersion:()=>state.version};
  const imports={'@tauri-apps/api/core':{invoke},'../i18n/index.js':{t:(k,v)=>k+(v?' '+Object.values(v).join(' '):'')},'./seafile.js':cloud,'./wallpArchive.js':archive,'./wallpaper.js':{wallpaperSnapshot:()=>state.doc,replaceWallpaperDoc:d=>{state.doc=d;state.applied=true;return true;}},'../lib/cloudWallpaperImage.js':{shrinkWallpaperForCloud:async()=>null}};
  imports['../lib/ownedCloudRepo.js']=load(repoCode,imports,{localStorage});
  const api=load(syncCode,imports,{localStorage});
  return {state,calls,api};
}
let count=0;
async function test(name,fn) { await fn(); count++;console.log('✓ '+name); }
await test('exports local media bytes once for the library and active wallpaper',async()=>{
  let reads=0;
  const out=await archive.exportWallpaperArchive(doc('local:/device-a/wallpapers/picture.png'),async path=>{reads++;assert.equal(path,'/device-a/wallpapers/picture.png');return image.split(',')[1];});
  assert.equal(out.v,3);assert.equal(reads,1);assert.equal(Object.keys(out.assets).length,1);assert.equal(out.global,out.library[0].ref);assert.equal(JSON.stringify(out).includes('/device-a/'),false);
  let writes=0;
  const restored=await archive.importWallpaperArchive(out,async(b64,ext)=>{writes++;assert.equal(b64,image.split(',')[1]);assert.equal(ext,'png');return '/device-b/wallpapers/photo.png';});
  assert.equal(writes,1);assert.equal(restored.global,'local:/device-b/wallpapers/photo.png');assert.equal(restored.library[0].ref,restored.global);
});
await test('inline v2 and gradient-only archives remain compatible',async()=>{
  const restored=await archive.importWallpaperArchive(doc(image),async()=>'/new/photo.png');assert.equal(restored.global,'local:/new/photo.png');
  const builtin=await archive.importWallpaperArchive(doc('builtin:ink'),async()=>assert.fail('gradient needs no file'));assert.deepEqual(normalize(builtin),{...doc('builtin:ink'),v:3,day:null,night:null});
});
await test('old local-path archives are rejected before any filesystem write',async()=>{
  await assert.rejects(archive.importWallpaperArchive(doc('local:/another-device/private.txt'),async()=>assert.fail()),/legacy-local/);
});
for (const [name,value] of [
  ['empty object',{}],['wrong version',{...doc(null),v:4}],['empty array',[]],
  ['remote URL',doc('https://untrusted.invalid/photo.png')],['SVG',doc('data:image/svg+xml;base64,PHN2Zz4=')],
  ['malformed base64',doc('data:image/png;base64,@@@@')],
  ['unknown builtin',doc('builtin:unknown')],
  ['missing asset',{v:3,global:'asset:0',library:[],assets:{}}],
  ['prototype asset',{v:3,global:'__proto__',library:[],assets:{}}],
  ['extra library items',{v:2,global:null,library:Array.from({length:13},(_,i)=>({...row(image),id:String(i)}))}],
  ['duplicate ids',{v:2,global:null,library:[row(image),row(image)]}],
]) await test('rejects '+name+' before writing',()=>assert.rejects(archive.importWallpaperArchive(value,async()=>assert.fail('must validate first'))));
await test('validates later assets before saving earlier valid ones',async()=>{
  await assert.rejects(archive.importWallpaperArchive({v:3,global:'asset:0',library:[row('asset:1')],assets:{'asset:0':image,'asset:1':'bad'}},async()=>assert.fail('must validate all first')));
});
for (const [name,options] of [
  ['no personal library',{repos:[]}],
  ['only a received same-name library',{repos:[ownRepo({repoType:'shared'})]}],
  ['no wallpaper directory',{directories:{'/':[]}}],
  ['no archive file',{directories:{'/':[{kind:'dir',name:'壁纸'}],'/壁纸':[]}}],
]) await test('restore is read-only when '+name,async()=>{
  const f=fixture(options);const result=await f.api.restoreWallpaperFromCloud();assert.equal(result.ok,false);assert.match(result.msg,/noArchive/);
  assert.equal(f.calls.some(c=>['seafile_create_repo','seafile_mkdir','seafile_read_bytes','wallpaper_save','seafile_upload','seafile_upload_wallpaper'].includes(c.command)),false);assert.equal(f.state.applied,undefined);
});
await test('403 remains an explicit permission failure with local wallpaper preserved',async()=>{
  const f=fixture({failure:{command:'seafile_read_bytes',message:'HTTP 403: {"error_msg":"You do not have permission to access this file"}'}});
  const result=await f.api.restoreWallpaperFromCloud();assert.match(result.msg,/permissionDenied/);assert.doesNotMatch(result.msg,/noArchive/);assert.equal(f.state.doc.global,'builtin:ink');assert.equal(f.state.applied,undefined);
});
await test('upload serializes portable bytes and omits the device path',async()=>{
  const f=fixture({doc:doc('local:/original/wallpapers/photo.png')});assert.equal((await f.api.syncWallpaperToCloud()).ok,true);assert.equal(f.state.upload.v,3);assert.equal(f.state.upload.assets['asset:0'],image);assert.equal(JSON.stringify(f.state.upload).includes('/original/'),false);
});
await test('restoration commits only paths created on this device',async()=>{
  const f=fixture();assert.equal((await f.api.restoreWallpaperFromCloud()).ok,true);assert.match(f.state.doc.global,/^local:\/current-device\/wallpapers\//);assert.equal(f.state.doc.global,f.state.doc.library[0].ref);assert.equal(f.calls.filter(c=>c.command==='wallpaper_save').length,1);
});
await test('old backup reports re-upload advice and preserves existing wallpaper',async()=>{
  const f=fixture({archive:doc('local:/old-device/wallpapers/photo.png')});const result=await f.api.restoreWallpaperFromCloud();assert.equal(result.ok,false);assert.match(result.msg,/legacyLocalArchive/);assert.equal(f.state.doc.global,'builtin:ink');assert.equal(f.calls.some(c=>c.command==='wallpaper_read'),false);
});
await test('account switch during cloud read prevents saving and replacing',async()=>{
  const f=fixture({hook:async(cmd,args,state)=>{if(cmd==='seafile_read_bytes'){state.token='account-b';state.version++;}}});const result=await f.api.restoreWallpaperFromCloud();assert.equal(result.ok,false);assert.match(result.msg,/accountChanged/);assert.equal(f.calls.some(c=>c.command==='wallpaper_save'),false);assert.equal(f.state.applied,undefined);
});
await test('account switch while saving cleans only newly restored files',async()=>{
  const f=fixture({hook:async(cmd,args,state)=>{if(cmd==='wallpaper_save')state.version++;}});const result=await f.api.restoreWallpaperFromCloud();assert.equal(result.ok,false);assert.match(result.msg,/accountChanged/);assert.equal(f.state.applied,undefined);const deleted=f.calls.filter(c=>c.command==='wallpaper_delete');assert.equal(deleted.length,1);assert.match(deleted[0].args.path,/^\/current-device\/wallpapers\/restore-/);
});
await test('wallpaper changed during restoration wins over the downloaded archive',async()=>{
  const f=fixture({hook:async(cmd,args,state)=>{if(cmd==='wallpaper_save')state.doc=doc('builtin:dusk');}});const result=await f.api.restoreWallpaperFromCloud();assert.equal(result.ok,false);assert.match(result.msg,/changedLocally/);assert.equal(f.state.doc.global,'builtin:dusk');assert.equal(f.calls.filter(c=>c.command==='wallpaper_delete').length,1);
});
await test('failed second media write rolls back first temporary media, preserves document',async()=>{
  let saves=0;const f=fixture({archive:{v:2,global:image,library:[row('data:video/mp4;base64,AAAA') ]},hook:async cmd=>{if(cmd==='wallpaper_save'&&++saves===2)throw Error('disk full');}});assert.equal((await f.api.restoreWallpaperFromCloud()).ok,false);assert.equal(f.state.applied,undefined);assert.equal(f.calls.filter(c=>c.command==='wallpaper_delete').length,1);
});
await test('credential change during local export prevents any cloud writes',async()=>{
  const f=fixture({doc:doc('local:/original/wallpapers/photo.png'),hook:async(cmd,args,state)=>{if(cmd==='wallpaper_read')state.version++;}});assert.equal((await f.api.syncWallpaperToCloud()).ok,false);assert.equal(f.calls.some(c=>c.command==='seafile_upload_wallpaper'||c.command==='seafile_create_repo'),false);
});
await test('oversize archive metadata stops before download and preserves local state',async()=>{
  const f=fixture();f.state.directories['/壁纸'][0].size=64*1024*1024+1;
  const result=await f.api.restoreWallpaperFromCloud();assert.equal(result.ok,false);assert.match(result.msg,/ab4ead4cd60b/);assert.equal(f.calls.some(c=>c.command==='seafile_read_bytes'),false);assert.equal(f.state.applied,undefined);
});
await test('running export budget rejects too much media before serialization or cloud writes',async()=>{
  const b64='A'.repeat(8*1024*1024);
  const refs=Array.from({length:9},(_,index)=>'local:/device/wallpapers/'+index+'.png');
  await assert.rejects(archive.exportWallpaperArchive({v:2,global:refs[0],library:refs.map((ref,index)=>({...row(ref),id:String(index)}))},async()=>b64),/archive-too-large/);
});
await test('native oversized media gets a localized size hint before any cloud mutation',async()=>{
  const f=fixture({doc:doc('local:/original/wallpapers/photo.png'),failure:{command:'wallpaper_read',message:'壁纸文件超过 16 MiB'}});
  const result=await f.api.syncWallpaperToCloud();assert.equal(result.ok,false);assert.equal(result.msg,'state.wallpsync.ab4ead4cd60b');assert.equal(f.calls.some(c=>c.command==='seafile_upload_wallpaper'||c.command==='seafile_create_repo'),false);
});
await test('wallpaper upload creates no temporary file',async()=>{
  const f=fixture();assert.equal((await f.api.syncWallpaperToCloud()).ok,true);assert.equal(f.calls.some(c=>c.command==='write_temp_file'),false);
});
await test('new portable file wins over a retained legacy archive',async()=>{
  const f=fixture();f.state.directories['/壁纸'].push({kind:'file',name:'onethu-wallpaper-v3.json',size:1024});
  f.state.archive=await archive.exportWallpaperArchive(doc(image),async()=>assert.fail());
  assert.equal((await f.api.restoreWallpaperFromCloud()).ok,true);assert.equal(f.calls.find(c=>c.command==='seafile_read_bytes').args.path,'/壁纸/onethu-wallpaper-v3.json');
});
await test('day and night builtin wallpapers survive cloud archive roundtrip',async()=>{
  const source={v:3,global:null,day:'builtin:aurora',night:'builtin:dusk',library:[]};
  const saved=await archive.exportWallpaperArchive(source,async()=>assert.fail('builtin must not read disk'));
  const restored=await archive.importWallpaperArchive(saved,async()=>assert.fail('builtin must not write disk'));
  assert.equal(restored.global,null);assert.equal(restored.day,source.day);assert.equal(restored.night,source.night);
});
await test('day and night local files are portable and deduplicated across every slot',async()=>{
  const one='local:/source/one.png',two='local:/source/two.png';let reads=0,writes=0;
  const saved=await archive.exportWallpaperArchive({v:3,global:one,day:one,night:two,library:[row(one)]},async()=>{reads++;return image.split(',')[1];});
  assert.equal(reads,2);assert.equal(Object.keys(saved.assets).length,2);assert.equal(saved.global,saved.day);assert.equal(saved.day,saved.library[0].ref);
  assert.equal(JSON.stringify(saved).includes('/source/'),false);
  const restored=await archive.importWallpaperArchive(saved,async()=>`/target/${++writes}.png`);
  assert.equal(writes,2);assert.equal(restored.global,restored.day);assert.equal(restored.day,restored.library[0].ref);assert.notEqual(restored.night,restored.day);
});
await test('old archives default new slots while invalid day/night refs stop before writes',async()=>{
  for(const old of [doc(image),await archive.exportWallpaperArchive(doc(image),async()=>assert.fail())]) {
    delete old.day;delete old.night;
    const restored=await archive.importWallpaperArchive(old,async()=>'/restored.png');
    assert.equal(restored.day,null);assert.equal(restored.night,null);
  }
  for(const bad of [{day:{}},{night:'asset:missing'},{day:'local:/other-device/file.png'}]) {
    let writes=0;
    await assert.rejects(archive.importWallpaperArchive({v:3,global:'asset:0',library:[],assets:{'asset:0':image},...bad},async()=>{writes++;return'/unexpected';}));
    assert.equal(writes,0);
  }
});
await test('day/night media share the same budget and each asset is counted once',async()=>{
  const b64='A'.repeat(8*1024*1024);
  const ok=await archive.exportWallpaperArchive({v:3,global:'local:/one.png',day:'local:/two.png',night:'local:/three.png',library:[]},async()=>b64);
  assert.equal(Object.keys(ok.assets).length,3);
  assert.ok(JSON.stringify(ok).length < 64*1024*1024);
  const refs=Array.from({length:9},(_,index)=>'local:/d/'+index+'.png');
  await assert.rejects(archive.exportWallpaperArchive({v:3,global:refs[0],day:refs[1],night:refs[2],library:refs.map((ref,index)=>({...row(ref),id:String(index)}))},async()=>b64),/archive-too-large/);
});
console.log(`Wallpaper sync: ${count} checks passed`);

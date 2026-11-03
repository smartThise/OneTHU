/** Packaging contract: ordinary app builds omit the optional runtime. */
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import path from 'node:path';
for(const platform of ['macos','windows','linux']){
 const config=JSON.parse(readFileSync(`apps/desktop/src-tauri/tauri.${platform}.conf.json`,'utf8'));
 assert(!JSON.stringify(config).includes('cli-runtime'));
}
const base=JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json','utf8'));
assert(!JSON.stringify(base.bundle.resources).includes('cli-runtime'));
const prebuild=readFileSync('apps/desktop/scripts/prebuild.mjs','utf8');
assert.match(prebuild,/if \(process\.env\.ONETHU_BUILD_CLI_PACKAGE === '1'\) execFileSync/);
const packaging=readFileSync('apps/desktop/scripts/package-cli.mjs','utf8');
assert(!packaging.includes('Get-FileHash'),'Windows launcher must work without PowerShell module autoloading');
assert.match(packaging,/\[Security\.Cryptography\.SHA256\]::Create\(\)/);
assert.match(packaging,/\$sha\.ComputeHash\(\$hashInput\)/);
const native=readFileSync('apps/desktop/src-tauri/src/cli_daemon.rs','utf8');
assert.match(native,/let dir = install_dir\(app\)\?/);
assert(!native.includes('resources/cli-runtime'));
if(process.platform==='darwin'){
 for(const root of ['apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos','apps/desktop/src-tauri/target/release/bundle/macos']){
  if(existsSync(root))for(const name of readdirSync(root).filter(name=>name.endsWith('.app'))){assert(!existsSync(path.join(root,name,'Contents/Resources/cli-runtime')));}
 }
}
console.log('✓ default desktop resources exclude Node/CLI; installation is explicit');

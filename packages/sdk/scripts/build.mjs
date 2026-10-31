import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const base=path.resolve(root,'../..');
await mkdir(path.join(root,'dist'),{recursive:true});
const entries={index:'src/index.ts',learn:'src/learn.ts',policy:'src/policy.ts',validation:'src/validation.ts',publicResult:'src/publicResult.ts',tasks:'src/tasks/index.ts','tasks-node':'src/tasks/node.ts',worker:'src/plugins/worker.mjs'};
const result=await build({absWorkingDir:root,entryPoints:entries,bundle:true,outdir:'dist',outExtension:{'.js':'.mjs'},platform:'node',format:'esm',target:'node20',sourcemap:true,metafile:true,
  banner:{js:"import { createRequire as __nodeCreateRequire } from 'node:module'; const require = __nodeCreateRequire(import.meta.url);"},
  alias:{'@onethu/gateway/manager':path.join(base,'packages/gateway/src/manager.mjs'),'@onethu/gateway/policy':path.join(base,'packages/gateway/src/policy.mjs'),'@onethu/gateway/routes':path.join(base,'packages/gateway/src/routes.mjs'),'@onethu/core':path.join(base,'packages/core/src/index.ts'),'@onethu/info-lib/network':path.join(base,'packages/info-lib/src/utils/network.ts'),'@onethu/info-lib':path.join(base,'packages/info-lib/src/index.ts')},
  external:['bufferutil','utf-8-validate'],logLevel:'warning',
});
// Include the actual bundled dependencies' notices, including nested packages.
const packages=new Map();
for(const input of Object.keys(result.metafile.inputs)) {
  let dir=path.dirname(path.resolve(root,input));
  while(dir!==path.dirname(dir)) {
    try {
      const pkg=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));
      if(pkg.name){
        if(pkg.name!=='@onethu/sdk')packages.set(`${pkg.name}@${pkg.version}`,{dir,pkg});
        break;
      }
    } catch(error) { if(error.code!=='ENOENT')throw error; }
    dir=path.dirname(dir);
  }
}
const notices=['OneTHU SDK bundled dependency notices.\n\nEach license applies to its corresponding component.\n'];
for(const [name,{dir,pkg}] of [...packages].sort(([a],[b])=>a.localeCompare(b))) {
  const files=(await readdir(dir)).filter(name=>/^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(name));
  const blocks=[];
  for(const file of files)try{blocks.push(`${file}\n${await readFile(path.join(dir,file),'utf8')}`);}catch(e){if(e.code!=='EISDIR')throw e;}
  if(!blocks.length&&pkg.name.startsWith('@onethu/'))blocks.push(await readFile(path.join(base,'LICENSE'),'utf8'));
  notices.push(`\n${'='.repeat(72)}\n${name}\nDeclared license: ${pkg.license??'See upstream'}\n${pkg.homepage??pkg.repository?.url??''}\n\n${blocks.join('\n\n')}`);
}
await writeFile(path.join(root,'dist/THIRD_PARTY_NOTICES.txt'),notices.join('\n'));
process.stdout.write('OneTHU SDK bundled for Node.js ^20.19.0 || >=22.12.0.\n');

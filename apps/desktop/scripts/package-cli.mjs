#!/usr/bin/env node
/** Independent distribution; never runs from an ordinary app prebuild. */
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
execFileSync(process.execPath,[path.join(root,'apps/desktop/scripts/build-cli-runtime.mjs')],{cwd:root,stdio:'inherit'});
const source=path.join(root,'apps/desktop/src-tauri/resources/cli-runtime');
const meta=JSON.parse(await readFile(path.join(source,'runtime.json'),'utf8'));
const shell=`#!/bin/sh
set -eu
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ ! -f "$dir/node" ]; then
  temp="$dir/.node-$$"
  trap 'rm -f "$temp"' EXIT HUP INT TERM
  gzip -dc "$dir/node.gz" > "$temp"
  if command -v sha256sum >/dev/null 2>&1; then digest=$(sha256sum "$temp" | cut -d ' ' -f 1); else digest=$(shasum -a 256 "$temp" | cut -d ' ' -f 1); fi
  [ "$digest" = "${meta.nodeSha256}" ] || { echo 'CLI Node checksum failed' >&2; exit 1; }
  chmod 700 "$temp"; mv "$temp" "$dir/node"
fi
exec "$dir/node" "$dir/bin/onethu.mjs" "$@"
`;
const powershell=`param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CliArgs)
$ErrorActionPreference='Stop'
$node=[IO.Path]::Combine($PSScriptRoot,'node.exe')
if (![IO.File]::Exists($node)) {
  $temp=[IO.Path]::Combine($PSScriptRoot,('.node-'+[Guid]::NewGuid().ToString()+'.tmp'))
  try {
    $inputFile=[IO.File]::OpenRead([IO.Path]::Combine($PSScriptRoot,'node.gz'))
    try { $gzip=[IO.Compression.GZipStream]::new($inputFile,[IO.Compression.CompressionMode]::Decompress)
      try { $output=[IO.File]::Create($temp); try {$gzip.CopyTo($output)} finally {$output.Dispose()} } finally {$gzip.Dispose()}
    } finally {$inputFile.Dispose()}
    $sha=[Security.Cryptography.SHA256]::Create()
    try {
      $hashInput=[IO.File]::OpenRead($temp)
      try { $digest=[BitConverter]::ToString($sha.ComputeHash($hashInput)).Replace('-','').ToLowerInvariant() }
      finally { $hashInput.Dispose() }
    } finally { $sha.Dispose() }
    if ($digest -ne '${meta.nodeSha256}') {throw 'CLI Node checksum failed'}
    [IO.File]::Move($temp,$node)
  } finally {[IO.File]::Delete($temp)}
}
& $node ([IO.Path]::Combine($PSScriptRoot,'bin/onethu.mjs')) @CliArgs
exit $LASTEXITCODE
`;
await writeFile(path.join(source,'onethu'),shell,{mode:0o755});
await writeFile(path.join(source,'onethu.ps1'),powershell);
await writeFile(path.join(source,'onethu.cmd'),'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0onethu.ps1" %*\r\n');
for(const file of ['onethu','onethu.ps1','onethu.cmd'])meta.files[file]=createHash('sha256').update(await readFile(path.join(source,file))).digest('hex');
delete meta.buildId;meta.buildId=createHash('sha256').update(JSON.stringify(meta)).digest('hex');
await writeFile(path.join(source,'runtime.json'),JSON.stringify(meta,null,2)+'\n');
const output=path.join(root,'output','cli-package');await mkdir(output,{recursive:true});
const archive=path.join(output,`OneTHU-CLI_${meta.version}_${meta.platform}_${meta.arch}.zip`);
await rm(archive,{force:true});
execFileSync(process.platform==='win32'?'python':'python3',['-c',`import sys,zipfile,pathlib
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
 for file in sorted(root.rglob('*')):
  if file.is_file() and not file.name.startswith('._'): archive.write(file,file.relative_to(root).as_posix())
`,source,archive],{stdio:'inherit'});
await writeFile(archive+'.sha256',createHash('sha256').update(await readFile(archive)).digest('hex')+'  '+path.basename(archive)+'\n');
console.log(archive);

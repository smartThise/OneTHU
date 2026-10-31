#!/usr/bin/env bash
set -euo pipefail
# Installs this local package only; no network, npm registry or administrator access.
package_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
install_dir="${ONETHU_CLI_HOME:-$HOME/.local/share/onethu-cli}"
bin_dir="${ONETHU_CLI_BIN:-$HOME/.local/bin}"
node_bin=''
for candidate in "$install_dir/node" "$HOME/.local/share/onethu-cli/node" "$package_dir/node"; do
  if [[ -x "$candidate" ]]; then node_bin="$candidate"; break; fi
done
if [[ -z "$node_bin" ]]; then node_bin="$(command -v node || true)"; fi
if [[ -z "$node_bin" ]] || ! "$node_bin" -e 'const [a,b,c]=process.versions.node.split(".").map(Number);process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>22?0:1)'; then
  echo 'Install Node.js 20.19.x or 22.12+ (Node.js 22 LTS recommended), then run this script again.' >&2
  exit 1
fi
if [[ ! -f "$package_dir/dist/sdk/index.mjs" ]]; then
  echo 'Missing runtime bundle. From the source checkout run: pnpm --filter @onethu/cli build' >&2
  exit 1
fi
mkdir -p "$install_dir" "$bin_dir"
install_dir="$(cd -- "$install_dir" && pwd)"
bin_dir="$(cd -- "$bin_dir" && pwd)"
# Desktop owns its bundled runtime. Installing a shell launcher must not replace
# that live package with a source/npm package or discard its private Node.
reuse_runtime=false
if [[ -x "$install_dir/node" && -f "$install_dir/runtime.json" && -f "$install_dir/bin/onethu.mjs" && -f "$install_dir/dist/sdk/index.mjs" ]]; then reuse_runtime=true; fi
ensure_idle() {
  [[ ! -f "$install_dir/bin/onethu.mjs" ]] && return 0
  "$node_bin" - "$HOME/Library/Application Support/OneTHU CLI" "${ONETHU_DATA_DIR:-}" <<'NODE'
const fs=require('node:fs'),path=require('node:path');
for(const dir of new Set(process.argv.slice(2).filter(Boolean))){
  try{
    const owner=JSON.parse(fs.readFileSync(path.join(dir,'.session.lock','owner.json'),'utf8'));
    if(!Number.isSafeInteger(owner.pid)||owner.pid<1)throw Error('invalid lock');
    try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')continue;throw e;}
    throw Error('active runtime');
  }catch(e){if(e.code==='ENOENT')continue;console.error('OneTHU CLI is running or its profile is busy. Stop it with onethu daemon stop before replacing the installed package.');process.exit(1);}
}
NODE
}
if [[ "$install_dir" != "$package_dir" && "$reuse_runtime" != true ]]; then
  ensure_idle
  stage_dir="$(mktemp -d "${install_dir}.install.XXXXXX")"
  trap 'rm -rf -- "$stage_dir"' EXIT
  for item in package.json bin src scripts dist README.md README.en.md LICENSE LICENSES; do
    cp -R "$package_dir/$item" "$stage_dir/$item"
  done
  for item in node runtime.json; do
    if [[ -f "$package_dir/$item" ]]; then cp -p "$package_dir/$item" "$stage_dir/$item"; fi
  done
  ensure_idle
  backup_dir="${stage_dir}.previous"
  mv "$install_dir" "$backup_dir"
  if ! mv "$stage_dir" "$install_dir"; then mv "$backup_dir" "$install_dir"; exit 1; fi
  rm -rf -- "$backup_dir"
fi
{
  printf '#!/usr/bin/env bash\nset -e\ninstall_dir='; printf '%q\n' "$install_dir"
  cat <<'LAUNCHER'
node_bin=''
for candidate in "$install_dir/node" "$HOME/.local/share/onethu-cli/node"; do
  if [[ -x "$candidate" ]]; then node_bin="$candidate"; break; fi
done
if [[ -z "$node_bin" ]]; then node_bin="$(command -v node || true)"; fi
if [[ -z "$node_bin" ]]; then echo 'Install Node.js 20.19.x or 22.12+ (Node.js 22 LTS recommended), or open OneTHU Desktop once to install its runtime.' >&2; exit 1; fi
exec "$node_bin" "$install_dir/bin/onethu.mjs" "$@"
LAUNCHER
} > "$bin_dir/onethu"
chmod +x "$bin_dir/onethu"
printf 'Installed OneTHU CLI: %s/onethu\n' "$bin_dir"
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) printf 'Add this directory to your shell PATH: %s\n' "$bin_dir" ;;
esac
printf 'Run: onethu auth login; then onethu daemon start for resident tasks.\n'

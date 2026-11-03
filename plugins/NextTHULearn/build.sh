#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo=$(CDPATH= cd -- "$here/../.." && pwd)
esbuild="$repo/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/bin/esbuild"
if [ ! -x "$esbuild" ]; then
  echo '需要 OneTHU 工作区依赖及 esbuild 0.25.12；请先在仓库根目录运行 pnpm install。' >&2
  exit 1
fi
node "$here/generate-assets.mjs"
"$esbuild" "$here/src/content.ts" --bundle --platform=browser --format=iife --target=firefox115,chrome110 --loader:.css=text --outfile="$here/extension/content.js"

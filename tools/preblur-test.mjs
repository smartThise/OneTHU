#!/usr/bin/env node
/* Page-level preblur architecture guard.
 *
 * Large glass surfaces must read one precomputed wallpaper bitmap; only the
 * explicitly listed live regions keep backdrop-filter.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8");
const lib = read("apps/desktop/src/lib/preblur.ts");
const wall = read("apps/desktop/src/components/explorer/WallpaperVideo.tsx");
const css = read("apps/desktop/src/styles/preblur.css");
const main = read("apps/desktop/src/main.tsx");

assert.match(lib, /createImageBitmap/, "preblur decodes wallpaper off the image element");
assert.match(lib, /blur\(\$\{Math\.max\(1, radius \* scale\)\}px\)/, "preblur uses canvas filter");
assert.match(lib, /\["deep", 24\]/, "deep tier preblur radius");
assert.match(lib, /\["rich", 14\]/, "rich tier preblur radius");
assert.match(lib, /\["clear", 6\]/, "clear tier preblur radius");
assert.match(lib, /cache\.set\(ref, job\)/, "preblur is cached per wallpaper ref");
assert.match(wall, /root\.setAttribute\("data-og-prebblur", "on"\)/, "image wallpaper marks preblur active");
assert.match(wall, /root\.removeAttribute\("data-og-prebblur"\)/, "leaving image wallpaper clears preblur");
assert.match(main, /styles\/preblur\.css/, "preblur stylesheet is loaded");
assert.match(css, /--og-prebblur-image/, "preblur image variable is wired");
assert.match(css, /background-attachment: fixed/, "preblur bitmap is viewport-aligned");
assert.match(css, /\.free-item:not\(\.is-note\):not\(\[data-widget="text"\]\)/, "home cards use preblur");
assert.match(css, /\.workbench-board-head/, "board header uses preblur");
assert.match(css, /\.settings-panel[\s\S]{0,500}\.ohx-searchpane[\s\S]{0,500}\.vault-page/, "settings/search/vault remain live");
assert.doesNotMatch(css, /\.explorer-topbar|\.ex-bbar/, "topbar/tabbar untouched by preblur target");
console.log("页面级预模糊 + 实时玻璃豁免：通过");

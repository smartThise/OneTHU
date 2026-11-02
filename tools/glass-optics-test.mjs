/** Glass optics + geometry regression on the real application.
 *
 * Verifies the 2026-10-24 liquid-glass revision at the layer where it can actually
 * be wrong (rendered page, not CSS text):
 *   1. curvature-continuous corners (corner-shape: squircle) reach OneGUI components
 *      and host chrome, while the segment inner radius stays concentric with its track;
 *   2. the reading-surface role actually raises the glass floor for text-bearing
 *      surfaces (light + dark), instead of relying on blur alone;
 *   3. edge refraction is REAL displacement: the rim of an opted-in surface changes
 *      pixels versus the blur-only material, while the centre stays equivalent;
 *      own text is never filtered/transformed;
 *   4. the optics budget holds (≤4 lenses, maps ≤256px, no per-idle churn) and the
 *      capability gate installs nothing on legacy Chromium (<96), reduced motion,
 *      or non-glass skins — the material stays frosted, with no artifact.
 *
 * Browser evidence only: headless Chromium, mock storage, synthetic wallpaper.
 * It does not claim native WebView2/WKWebView GPU behaviour or physical-device cost.
 *
 * Run: node tools/glass-optics-test.mjs
 *   ONETHU_TEST_URL=http://127.0.0.1:5180 to reuse a running Vite server;
 *   ONETHU_PLAYWRIGHT_PATH / CHROME_BIN select local tools;
 *   ONETHU_TEST_OUT overrides the report + screenshot directory.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.ONETHU_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.ONETHU_PLAYWRIGHT_PATH).href : "playwright");
const out = process.env.ONETHU_TEST_OUT ?? join(tmpdir(), "onethu-glass-optics");
mkdirSync(out, { recursive: true });

const checks = [];
const samples = [];
const errors = [];
const check = (ok, label) => {
  checks.push({ ok: Boolean(ok), label });
  if (!ok) errors.push(label);
  console.log((ok ? "✓ " : "✗ ") + label);
};

/* Reuse the running dev server when present so the test never fights the user's
   terminal; otherwise host the real app with an isolated cache directory. */
const requireDesktop = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
let server, cacheDir;
let base = process.env.ONETHU_TEST_URL;
async function reachable(url) {
  try { const res = await fetch(url, { signal: AbortSignal.timeout(1500) }); return res.ok; } catch { return false; }
}
if (!base || !(await reachable(base))) {
  const { createServer } = await import(pathToFileURL(join(dirname(requireDesktop.resolve("vite/package.json")), "dist/node/index.js")).href);
  cacheDir = join(tmpdir(), "onethu-optics-vite-" + process.pid);
  server = await createServer({
    root: resolve("apps/desktop"), configFile: resolve("apps/desktop/vite.config.ts"),
    cacheDir, logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
  });
  await server.listen();
  base = "http://127.0.0.1:" + server.httpServer.address().port;
}
const origin = new URL(base).origin;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  headless: true,
});

async function newPage(userAgent) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    userAgent,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", error => errors.push(String(error.message ?? error)));
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === origin || url.protocol === "data:" || url.protocol === "blob:"
      ? route.continue() : route.abort();
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { value: "Win32" });
    localStorage.setItem("onethu.experience.v1", "full");
    localStorage.setItem("onethu.privacy.v1", JSON.stringify({ acknowledged: true, cloud: true, oh: false }));
    localStorage.setItem("onethu.onboarded.phone", "1");
    localStorage.setItem("onethu.overlay.closed", "1");
    performance.setResourceTimingBufferSize(20000);
  });
  return { context, page };
}

/** Import a Vite-served source module by pathname suffix. */
const moduleUrl = (page, suffix) => page.evaluate(async (suffix) => {
  const entries = performance.getEntriesByType("resource").map(entry => entry.name);
  const hit = entries.findLast(name => new URL(name, location.href).pathname.endsWith(suffix));
  if (!hit) throw new Error("module not served: " + suffix);
  return new URL(hit, location.href).href;
}, suffix);

const call = (page, suffix, name, args = []) => page.evaluate(async ({ suffix, name, args }) => {
  const entries = performance.getEntriesByType("resource").map(entry => entry.name);
  const hit = entries.findLast(value => new URL(value, location.href).pathname.endsWith(suffix));
  if (!hit) throw new Error("module not served: " + suffix);
  const module = await import(hit);
  return module[name](...args);
}, { suffix, name, args });

const alphaOf = (color) => {
  if (!color || color === "transparent") return 0;
  const slash = color.match(/\/\s*([0-9.]+)(%?)\s*\)$/);
  if (slash) return slash[2] ? Number(slash[1]) / 100 : Number(slash[1]);
  const rgba = color.match(/^rgba?\(([^)]+)\)$/);
  if (!rgba) return 1;
  const parts = rgba[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length < 4 ? 1 : Number(parts[3]);
};

async function setMaterial(page, level) {
  await call(page, "/src/lib/glassLevel.ts", "setGlassLevel", [level]);
  await call(page, "/src/lib/opticalRefraction.ts", "setOpticalRefraction", [true]);
  await page.evaluate(() => document.documentElement.dataset.scheme);
}

/** Controlled bench: high-frequency stripes behind a real optical surface. The
 * fixture uses the exported pipeline entry, so it proves the production filter
 * (same code path as the app) rather than a hand-written SVG. Text is laid over the
 * lens and must keep the same box and ink pixels while the rim is displaced. */
async function refractionFixture(page) {
  const setup = await page.evaluate(async () => {
    const entries = performance.getEntriesByType("resource").map(entry => entry.name);
    const hit = entries.findLast(name => new URL(name, location.href).pathname.endsWith("pipeline/refraction.ts"));
    if (!hit) return null;
    const module = await import(new URL(hit, location.href).href);
    document.documentElement.dataset.ogOptics = "on";
    const host = document.createElement("div");
    host.id = "og-optics-bench";
    host.style.cssText = "position:fixed;left:24px;bottom:24px;width:260px;height:150px;z-index:9000;"
      + "background-image:repeating-linear-gradient(90deg,#000 0 8px,#fff 8px 16px)";
    const lens = document.createElement("div");
    lens.className = "og-lens-fixture";
    lens.style.cssText = "position:absolute;inset:24px;border-radius:20px;background:rgba(255,255,255,0.36);"
      + "backdrop-filter:blur(0px);--og-blur-1:0px;--og-saturate:100%;--og-refraction-edge:12px;--og-refraction-scale:24px";
    const label = document.createElement("span");
    label.dataset.tx = "keep";
    label.textContent = "可读性 123";
    label.style.cssText = "position:absolute;inset:0;display:grid;place-items:center;font:14px/1.4 system-ui;color:#111";
    lens.append(label);
    host.append(lens);
    document.body.append(host);
    window.__ogOpticsBenchStop = module.installGlassRefraction(".og-lens-fixture");
    for (let i = 0; i < 40 && !lens.hasAttribute("data-og-refraction"); i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const id = lens.style.getPropertyValue("backdrop-filter").match(/#([^")]+)/)?.[1] ?? null;
    const map = id ? document.getElementById(id)?.querySelector("feDisplacementMap") ?? null : null;
    return {
      installed: lens.hasAttribute("data-og-refraction"),
      id,
      hasMap: Boolean(map),
      clip: host.getBoundingClientRect().toJSON(),
      lensRect: lens.getBoundingClientRect().toJSON(),
      label: label.getBoundingClientRect().toJSON(),
      labelFilter: getComputedStyle(label).filter,
    };
  });
  if (!setup) return null;
  const clip = {
    x: Math.round(setup.clip.x), y: Math.round(setup.clip.y),
    width: Math.round(setup.clip.width), height: Math.round(setup.clip.height),
  };
  const on = (await page.screenshot({ clip, animations: "disabled" })).toString("base64");
  const scale = await page.evaluate(() => {
    const filter = document.getElementById("og-optics-bench")?.querySelector(".og-lens-fixture");
    const id = filter?.style.getPropertyValue("backdrop-filter").match(/#([^")]+)/)?.[1];
    const map = id ? document.getElementById(id)?.querySelector("feDisplacementMap") : null;
    scale: {
      if (!map) return null;
      const previous = map.getAttribute("scale");
      map.setAttribute("scale", "0");
      return previous;
    }
  });
  await page.waitForTimeout(200);
  const off = (await page.screenshot({ clip, animations: "disabled" })).toString("base64");
  const after = await page.evaluate(() => {
    const bench = document.getElementById("og-optics-bench");
    const lens = bench?.querySelector(".og-lens-fixture");
    const id = lens?.style.getPropertyValue("backdrop-filter").match(/#([^")]+)/)?.[1];
    const map = id ? document.getElementById(id)?.querySelector("feDisplacementMap") : null;
    if (map) map.setAttribute("scale", "24");
    return {
      label: bench?.querySelector("span")?.getBoundingClientRect().toJSON() ?? null,
      lenses: document.querySelectorAll("[data-og-refraction='edge']").length,
    };
  });
  const pixels = await page.evaluate(async ({ on, off, lensRect, clip }) => {
    const load = async (data) => {
      const image = new Image();
      image.src = "data:image/png;base64," + data;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    };
    const a = await load(on), b = await load(off);
    const { width, height } = a;
    const left = lensRect.x - clip.x, top = lensRect.y - clip.y;
    const right = left + lensRect.width, bottom = top + lensRect.height;
    const band = 9, inner = 34;
    let edge = 0, edgeCount = 0, centre = 0, centreCount = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x < left || y < top || x >= right || y >= bottom) continue;
        const toLensEdge = Math.min(x - left, y - top, right - x, bottom - y);
        const i = (y * width + x) * 4;
        const delta = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
        if (toLensEdge < band) { edge += delta; edgeCount++; } else if (toLensEdge > inner) { centre += delta; centreCount++; }
      }
    }
    return { edge: edge / Math.max(1, edgeCount), centre: centre / Math.max(1, centreCount), edgeCount, centreCount };
  }, { on, off, lensRect: setup.lensRect, clip });
  await page.evaluate(() => {
    window.__ogOpticsBenchStop?.();
    document.getElementById("og-optics-bench")?.remove();
  });
  return { setup, pixels, after, scale };
}

let active = null;
try {
  /* ── A. modern Chromium: everything active ─────────────────────────────── */
  const { context, page } = await newPage();
  active = { context, page };
  await page.goto(base + "/?explorer-preview=home");
  await page.locator(".free-item:visible").first().waitFor();
  await page.waitForTimeout(600);

  const capability = await page.evaluate(() => ({
    cornerShape: CSS.supports("corner-shape", "squircle"),
    backdropFilterUrl: CSS.supports("backdrop-filter", 'url("#probe")'),
    ua: navigator.userAgent,
  }));
  samples.push({ capability });

  // A1. Curvature-continuous corners reach library components and host chrome.
  check(capability.cornerShape, "engine supports corner-shape: squircle (curvature-continuous corners)");
  if (capability.cornerShape) {
    const shapes = await page.evaluate(() => {
      const read = (selector, property = "cornerShape") => {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el)[property] || getComputedStyle(el).cornerShape : null;
      };
      const fixture = document.createElement("div");
      fixture.innerHTML = '<div class="og-card" id="og-container-fixture">card</div>'
        + '<div class="og-segment" id="og-geometry-fixture"><button class="og-segment-item">A</button><button class="og-segment-item">B</button></div>'
        + '<button class="og-btn og-btn--solid" id="og-btn-fixture">B</button>'
        + '<div class="og-input" id="og-input-fixture"><input class="og-input-el"></div>';
      document.body.append(fixture);
      const containers = ["#og-container-fixture", ".free-item"].map(selector => [selector, read(selector)]).filter(([, value]) => value !== null);
      const controls = ["#og-btn-fixture", ".og-segment-item", "#og-input-fixture"].map(selector => [selector, read(selector)]).filter(([, value]) => value !== null);
      const segment = document.querySelector("#og-geometry-fixture .og-segment");
      const item = document.querySelector("#og-geometry-fixture .og-segment-item");
      const result = {
        containers,
        controls,
        segmentCorner: segment ? getComputedStyle(segment).cornerShape : null,
        itemCorner: item ? getComputedStyle(item).cornerShape : null,
        itemRadius: item ? getComputedStyle(item).borderTopLeftRadius : null,
        trackRadius: segment ? getComputedStyle(segment).borderTopLeftRadius : null,
      };
      // Keep the fixture for the state-layer check below; marker makes cleanup explicit.
      fixture.setAttribute("data-keep", "1");
      return result;
    });
    samples.push({ geometry: shapes });
    const isSquircle = (value) => value === "squircle" || value === "superellipse(2)";
    const isRound = (value) => value === "round" || value === "superellipse(1)";
    // Corrected expectation (user): BOTH the element body and its state layer are
    // curvature-continuous superellipses; the hover fill must not fall back to a circle.
    check(shapes.containers.length > 0 && shapes.containers.every(([, value]) => isSquircle(value)),
      "container surfaces adopt curvature-continuous corners (" + shapes.containers.map(([selector]) => selector).join(", ") + ")");
    check(shapes.controls.length > 0 && shapes.controls.every(([, value]) => isSquircle(value)),
      "interactive controls use the same superellipse body (buttons/inputs/segment items)");
    const stateLayer = await page.evaluate(() => {
      const button = document.querySelector("#og-btn-fixture");
      if (!button) return { corner: null, radius: null };
      const after = getComputedStyle(button, "::after");
      return { corner: after.cornerShape, radius: after.borderRadius };
    });
    check(isSquircle(stateLayer.corner),
      "hover/active state layer inherits the same superellipse (radius " + stateLayer.radius + ")");
    const quick = await page.evaluate(() => {
      const el = document.querySelector(".oneshot-button");
      if (!el) return null;
      const style = getComputedStyle(el);
      return { radius: parseFloat(style.borderTopLeftRadius), corner: style.cornerShape };
    });
    check(quick && quick.radius > 100 && isRound(quick.corner),
      "bottom quick-launch buttons are true capsules (rounded ends, not superellipse)");
    const search = await page.evaluate(() => {
      const el = document.querySelector(".ohx-capsule");
      if (!el) return null;
      const style = getComputedStyle(el);
      return { radius: parseFloat(style.borderTopLeftRadius), corner: style.cornerShape };
    });
    check(search && search.radius > 100 && isRound(search.corner),
      "top search bar is a true capsule (rounded ends, not superellipse)");
    await page.evaluate(() => document.querySelector("#og-btn-fixture")?.closest("[data-keep]")?.remove());
    // Concentric: 10px track − 2px padding − 1px border = 7px inner radius.
    check(shapes.itemRadius === "7px", "segment item radius is concentric with its track (" + shapes.itemRadius + ")");
  }

  // A2. Reading-surface floor on the glass skin, light then dark.
  await setMaterial(page, "clear");
  await call(page, "/src/state/wallpaper.ts", "setGlobalWallpaper", ["builtin:aurora"]);
  await page.waitForTimeout(1400);
  const light = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement("div");
    probe.style.background = "var(--og-fill-reading)";
    document.body.append(probe);
    const readingFill = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const card = document.querySelector(".free-item:not([hidden])");
    return {
      skin: document.documentElement.dataset.ogSkin,
      reading: root.getPropertyValue("--og-fill-reading").trim(),
      readingFill,
      cardFill: card ? getComputedStyle(card).backgroundColor : null,
      readingBlur: root.getPropertyValue("--og-reading-blur").trim(),
    };
  });
  samples.push({ light });
  check(light.skin === "glass", "clear level maps onto the glass skin");
  check(light.reading.includes("color-mix("), "reading surfaces resolve to a translucent material, not an opaque plate");
  check(alphaOf(light.readingFill) >= 0.55, "clear light reading floor ≥ 55% (" + alphaOf(light.readingFill).toFixed(2) + ")");
  check(alphaOf(light.cardFill) >= 0.34, "clear light surface floor ≥ 34% (" + alphaOf(light.cardFill).toFixed(2) + ")");
  check(light.readingBlur.includes("blur("), "reading surfaces keep the surface blur");
  const toolbar = await page.evaluate(() => {
    const el = document.querySelector(".board-viewport-tools");
    if (!el) return null;
    const style = getComputedStyle(el);
    return { bg: style.backgroundColor, backdrop: style.backdropFilter };
  });
  samples.push({ toolbar });
  check(toolbar && alphaOf(toolbar.bg) > 0 && alphaOf(toolbar.bg) < 0.9 && toolbar.backdrop !== "none",
    "home right-side toolbar uses the glass material (translucent + optical backdrop)");

  await page.evaluate(() => { document.documentElement.dataset.scheme = "dark"; });
  await page.waitForTimeout(700);
  const dark = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--og-fill-reading)";
    document.body.append(probe);
    const readingFill = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const card = document.querySelector(".free-item:not([hidden])");
    return {
      cardFill: card ? getComputedStyle(card).backgroundColor : null,
      readingFill,
      reading: getComputedStyle(document.documentElement).getPropertyValue("--og-fill-reading").trim(),
    };
  });
  samples.push({ dark });
  check(alphaOf(dark.cardFill) >= 0.18, "clear dark surface floor ≥ 18% after the dark-veil revision (" + alphaOf(dark.cardFill).toFixed(2) + ")");
  check(alphaOf(dark.readingFill) >= 0.42, "clear dark reading floor ≥ 42% after the dark-veil revision (" + alphaOf(dark.readingFill).toFixed(2) + ")");
  await page.evaluate(() => { document.documentElement.dataset.scheme = "light"; });
  await page.waitForTimeout(500);

  // A3. Real edge refraction, its budget, and text integrity.
  const optics = await page.evaluate(() => {
    const lenses = [...document.querySelectorAll("[data-og-refraction='edge']")];
    return {
      count: lenses.length,
      surfaces: lenses.map(el => {
        const style = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          cls: el.className?.toString?.().slice(0, 90) ?? "",
          filter: el.style.getPropertyValue("backdrop-filter"),
          backdrop: style.backdropFilter,
          ownFilter: style.filter,
          ownTransform: style.transform,
        };
      }),
      filters: [...document.querySelectorAll("svg[data-og-optics] filter")].map(filter => ({
        id: filter.id,
        displacement: Boolean(filter.querySelector("feDisplacementMap")),
        maps: [...filter.querySelectorAll("feImage")].map(image => {
          const value = image.getAttribute("data-map") ?? "0x0";
          const [width, height] = value.split("x").map(Number);
          return { width, height, stretch: [Number(image.getAttribute("width")), Number(image.getAttribute("height"))] };
        }),
      })),
    };
  });
  samples.push({ optics });
  check(optics.count > 0, "edge refraction is installed on at least one visible surface");
  check(optics.count <= 4, "optics budget: at most 4 simultaneous lenses (" + optics.count + ")");
  check(optics.surfaces.every(surface => surface.filter.includes("url(")), "each lens replaces the material with a real SVG filter");
  check(optics.filters.length > 0 && optics.filters.every(filter => filter.displacement), "each filter contains feDisplacementMap (real displacement)");
  check(optics.filters.every(filter => filter.maps.every(map => map.width <= 256 && map.height <= 256)),
    "displacement maps are capped at 256px on the longest side");
  check(optics.surfaces.every(surface => surface.ownFilter === "none" && surface.ownTransform === "none"),
    "the lens never becomes a real filter/transform on the surface or its content");

  const bench = await refractionFixture(page);
  samples.push({ bench });
  check(bench?.setup?.installed === true && bench?.setup?.hasMap === true, "the exported pipeline installs a real displacement lens on the bench surface");
  if (bench) {
    check(bench.pixels.edge > 2, "refraction visibly displaces the rim (" + bench.pixels.edge.toFixed(2) + " mean channel delta)");
    check(bench.pixels.centre <= bench.pixels.edge * 0.5,
      "only the rim is displaced; the lens body stays frosted (centre " + bench.pixels.centre.toFixed(2) + " vs rim " + bench.pixels.edge.toFixed(2) + ")");
    check(bench.setup.labelFilter === "none", "text over the lens is painted normally (no CSS filter)");
    const sameBox = bench.after.label && Math.abs(bench.after.label.x - bench.setup.label.x) < 0.5
      && Math.abs(bench.after.label.y - bench.setup.label.y) < 0.5
      && Math.abs(bench.after.label.width - bench.setup.label.width) < 0.5
      && Math.abs(bench.after.label.height - bench.setup.label.height) < 0.5;
    check(sameBox, "text layout is unaffected by the refraction pass");
  }

  // A4. No churn while idle: ids stay stable, so there is no per-frame rebuild loop.
  const before = await page.evaluate(() => [...document.querySelectorAll("svg[data-og-optics] filter")].map(filter => filter.id).join(","));
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => [...document.querySelectorAll("svg[data-og-optics] filter")].map(filter => filter.id).join(","));
  check(before === after && before.length > 0, "no filter rebuild while the page is idle (no animation loop)");

  // A5. Reduced motion / non-glass skin release every lens.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(350);
  const reduced = await page.evaluate(() => document.querySelectorAll("[data-og-refraction='edge']").length);
  check(reduced === 0, "reduced motion releases lenses (material falls back to frosted glass)");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(350);
  await call(page, "/src/lib/glassLevel.ts", "setGlassLevel", ["balanced"]);
  await page.waitForTimeout(350);
  const neutral = await page.evaluate(() => ({
    skin: document.documentElement.dataset.ogSkin,
    lenses: document.querySelectorAll("[data-og-refraction='edge']").length,
  }));
  check(neutral.skin === "neutral" && neutral.lenses === 0, "leaving the glass skin removes the optics entirely");

  await page.screenshot({ path: join(out, "desktop-glass-optics.png"), animations: "disabled" });
  await context.close();
  active = null;

  /* ── B. legacy engine: nothing installed, material untouched ───────────── */
  const legacyUa = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/90.0.4430.210 Mobile Safari/537.36";
  const legacy = await newPage(legacyUa);
  active = legacy;
  // Emulate the missing runtime capability too. A UA-only override must not
  // misclassify a modern WebView that uses OneTHU's campus-compatible UA.
  await legacy.page.addInitScript(() => {
    Object.defineProperty(globalThis, "structuredClone", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "userAgentData", { value: { brands: [{ brand: "Chromium", version: "90" }] }, configurable: true });
  });
  await legacy.page.goto(base + "/?explorer-preview=home");
  await legacy.page.locator(".free-item:visible").first().waitFor();
  await legacy.page.waitForTimeout(500);
  const legacyCapability = await legacy.page.evaluate(async () => {
    const entries = performance.getEntriesByType("resource").map(entry => entry.name);
    const hit = entries.findLast(name => new URL(name, location.href).pathname.endsWith("pipeline/refraction.ts"));
    if (!hit) return { served: false };
    const module = await import(new URL(hit, location.href).href);
    return { served: true, supported: module.refractionSupported() };
  });
  await setMaterial(legacy.page, "clear");
  await call(legacy.page, "/src/state/wallpaper.ts", "setGlobalWallpaper", ["builtin:aurora"]);
  await legacy.page.waitForTimeout(1200);
  const legacyState = await legacy.page.evaluate(() => {
    const card = document.querySelector(".free-item");
    const style = card ? getComputedStyle(card) : null;
    return {
      lenses: document.querySelectorAll("[data-og-refraction='edge']").length,
      svg: Boolean(document.querySelector("svg[data-og-optics]")),
      blur: style ? style.backdropFilter : null,
      inline: card ? card.style.getPropertyValue("backdrop-filter") : null,
    };
  });
  samples.push({ legacy: { legacyCapability, legacyState } });
  check(legacyCapability.served && legacyCapability.supported === false, "<WebView96 is gated off by the capability check");
  check(legacyState.lenses === 0 && !legacyState.svg, "legacy engine installs no lens definitions or attributes");
  check(legacyState.blur?.includes("blur(") && !legacyState.inline?.includes("url("), "legacy engine keeps the plain frosted material (no broken backdrop)");
  await legacy.context.close();
  active = null;
} catch (error) {
  if (active) await active.page.screenshot({ path: join(out, "failure.png") }).catch(() => undefined);
  errors.push(String(error?.message ?? error));
  if (error?.stack) console.error(error.stack);
} finally {
  writeFileSync(join(out, "report.json"), JSON.stringify({
    passed: errors.length === 0 && checks.every(item => item.ok),
    checks,
    samples,
    errors,
    base,
    out,
  }, null, 2));
  await browser.close();
  if (server) await server.close();
}

const failed = checks.filter(item => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (errors.length) {
  console.error("failures:\n" + errors.map(error => " - " + error).join("\n"));
  process.exitCode = 1;
}

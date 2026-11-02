/** Real optical edge refraction for OneGUI glass materials.
 *
 * The backdrop behind an opted-in surface is displaced along the surface's edge
 * normals (a superellipse, `corner-shape: squircle`), then feathered into the
 * ordinary frosted body. Only the *backdrop* is refracted: the element's own text
 * and icons are painted afterwards by the normal foreground pipeline and never
 * move, blur or scale.
 *
 * Cost model (deliberate, bounded, no animation loop):
 *   - at most `maxSurfaces` simultaneous lenses (2 on touch), each ≤ `maxSurfaceArea`;
 *   - at most `maxCandidates` observed nodes, discovered from one host selector;
 *   - displacement/mask maps are generated on demand, capped at `mapSide` px and
 *     never larger than the surface, then reused until geometry/material changes;
 *   - work happens in coalesced animation frames triggered only by intersection,
 *     resize, DOM insertion and style-axis changes — never per scroll frame.
 *
 * Capability gate: Chromium ≥ 96 only (unprefixed backdrop-filter + SVG filter
 * references), using Client Hints/runtime capabilities when the UA is overridden.
 * Older WebViews, WebKit/Gecko, reduced-transparency, reduced-motion,
 * forced-colors, hidden documents and low-core devices keep the existing frosted
 * material (blur + rim) with no artifact, because nothing is installed at all.
 */
const NS = "http://www.w3.org/2000/svg";

export const REFRACTION_LIMITS = {
  surfaces: 8,
  touchSurfaces: 2,
  candidates: 32,
  surfaceArea: 240_000,
  totalArea: 1_200_000,
  mapSide: 256,
  minChromium: 96,
} as const;

/** Inward distance to the edge and the outward unit normal, for a superellipse.
 * `exponent` 4 is the CSS `squircle` shape (verified: corner fill 0.927 of a
 * r×r box); exponent 2 would be a plain circular arc. */
export function glassEdge(
  x: number, y: number, width: number, height: number, radius: number, exponent = 4,
): [distance: number, nx: number, ny: number] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const dx = Math.min(x, width - x);
  const dy = Math.min(y, height - y);
  const sx = x < width / 2 ? -1 : 1;
  const sy = y < height / 2 ? -1 : 1;
  if (r > 0 && dx < r && dy < r) {
    const u = (r - dx) / r;
    const v = (r - dy) / r;
    const gx = u ** (exponent - 1);
    const gy = v ** (exponent - 1);
    const length = Math.hypot(gx, gy) || 1;
    // Signed approximation of the implicit function, scaled to the corner box.
    const distance = (1 - u ** exponent - v ** exponent) * r / (exponent * length);
    return [distance, sx * gx / length, sy * gy / length];
  }
  return dx < dy ? [dx, sx, 0] : [dy, 0, sy];
}

function chromiumMajor(): number {
  const hints = (navigator as Navigator & { userAgentData?: { brands?: { brand: string; version: string }[] } }).userAgentData;
  const versions = (hints?.brands ?? []).filter(item => /^(?:Chromium|Google Chrome|Microsoft Edge|Android WebView)$/i.test(item.brand))
    .map(item => Number.parseInt(item.version, 10)).filter(Number.isFinite);
  if (versions.length) return Math.max(...versions);
  const match = navigator.userAgent.match(/(?:Chromium|Chrome|Edg)\/(\d+)/);
  return match ? Number(match[1]) : 0;
}

/** True only where the full pipeline is known to work: Chromium's SVG backdrop
 * filter, plus the modern CSS.supports parsing surface. */
export function refractionSupported(): boolean {
  if (typeof CSS === "undefined") return false;
  if (typeof SVGFEDisplacementMapElement === "undefined") return false;
  if (!CSS.supports("backdrop-filter", 'url("#og-refraction-probe")')) return false;
  // The campus gateway requires the App's fixed Chrome/79 UA. Blink's vendor
  // and structuredClone (Chromium 98+) still describe the actual runtime when
  // Client Hints are unavailable or suppressed by a custom WebView UA.
  if (/Apple/i.test(navigator.vendor ?? "") || /Firefox\//.test(navigator.userAgent)) return false;
  if (/Google Inc\./.test(navigator.vendor ?? "") && typeof structuredClone === "function") return true;
  return chromiumMajor() >= REFRACTION_LIMITS.minChromium;
}

type Lens = {
  el: HTMLElement;
  visible: boolean;
  filter?: SVGFilterElement;
  /** Filter attributes that were baked into the current map/filter pair. */
  signature?: string;
  /** Index in the host's selector match order, for a stable budget. */
  order: number;
  /** 元素原本的内联 backdrop-filter（许多浮层把材质写在 inline style 里）。
   *  lens 因面积/预算/降级释放时必须还原它，而不是删掉整个材质——否则大面板会变成
   *  「半透明但没有模糊」的裸面（用户实测：搜索/OH 面板打开后模糊丢失）。 */
  inlineBackdrop?: string;
  inlineWebkitBackdrop?: string;
};

let nextLens = 0;

/** Map pixel dimensions, mirroring buildMaps' cap — exposed for regression tests
 * without reading the encoded data URL. */
function mapSize(width: number, height: number): string {
  const ratio = Math.min(1, REFRACTION_LIMITS.mapSide / Math.max(width, height));
  return `${Math.max(2, Math.ceil(width * ratio))}x${Math.max(2, Math.ceil(height * ratio))}`;
}
/** Computed colour alpha for every syntax Chromium may serialize: legacy
 * `rgba(…)`, modern `color(srgb … / a)`, `transparent`, and plain opaque colours. */
function alphaOf(color: string): number {
  if (!color || color === "transparent") return 0;
  const slash = color.match(/\/\s*([0-9.]+)(%?)\s*\)$/);
  if (slash) return slash[2] ? Number(slash[1]) / 100 : Number(slash[1]);
  const legacy = color.match(/^rgba?\(([^)]+)\)$/);
  const body = legacy?.[1];
  if (!body) return 1;
  const parts = body.split(/[\s,/]+/).filter(Boolean);
  return parts.length < 4 ? 1 : Number(parts[3]);
}

/** A material is visible to refraction only when it is genuinely semi-transparent:
 * fully transparent frames (no material at all) and opaque plates are skipped. */
function translucent(color: string): boolean {
  const alpha = alphaOf(color);
  return alpha > 0.01 && alpha < 0.995;
}

function svgNode<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** Neutral displacement field (R = x axis, G = y axis) computed from the
 * superellipse edge normals. The field is full-surface: 128 = no displacement,
 * edge band bends inward and fades to neutral at the band's inner edge. The
 * camera reads this as one continuous lens, not a separate rim/body composite. */
function buildField(width: number, height: number, radius: number, edge: number): string {
  const ratio = Math.min(1, REFRACTION_LIMITS.mapSide / Math.max(width, height));
  const w = Math.max(2, Math.ceil(width * ratio));
  const h = Math.max(2, Math.ceil(height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const field = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [distance, nx, ny] = glassEdge((x + 0.5) * width / w, (y + 0.5) * height / h, width, height, radius);
      const t = Math.min(1, Math.max(0, distance / edge));
      // Strongest bend at the physical edge, fading to zero at the band's inner edge.
      const bend = t < 1 ? (1 - t) ** 2 : 0;
      const i = (y * w + x) * 4;
      // Sampling opposite to the outward normal pulls the backdrop inward, so the
      // rim never reads transparent where the filter cannot see beyond the box.
      field.data[i] = Math.round(127.5 * (1 - nx * bend));
      field.data[i + 1] = Math.round(127.5 * (1 - ny * bend));
      field.data[i + 2] = 128;
      field.data[i + 3] = 255;
    }
  }
  ctx.putImageData(field, 0, 0);
  return canvas.toDataURL();
}

/** Install once from the host's style lifecycle. Returns a teardown that restores
 * every touched element to its stylesheet-defined material. */
export function installGlassRefraction(selector: string, root: HTMLElement = document.documentElement): () => void {
  if (!refractionSupported() || !selector) return () => undefined;
  const groups = selector.split(",").map(part => part.trim()).filter(Boolean);
  if (!groups.length) return () => undefined;
  if (typeof ResizeObserver === "undefined" || typeof IntersectionObserver === "undefined") return () => undefined;
  const cores = navigator.hardwareConcurrency;
  if (cores > 0 && cores <= 4) return () => undefined;

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const reducedTransparency = matchMedia("(prefers-reduced-transparency: reduce)");
  const forcedColors = matchMedia("(forced-colors: active)");
  const coarse = matchMedia("(pointer: coarse)");
  const media = [reducedMotion, reducedTransparency, forcedColors, coarse];

  const svg = svgNode("svg", {
    width: "0", height: "0", "aria-hidden": "true", focusable: "false",
    "data-og-optics": "edge-refraction",
  });
  const defs = svgNode("defs", {});
  svg.append(defs);

  const lenses = new Map<HTMLElement, Lens>();
  let frame = 0;
  let stopped = false;

  const active = (): boolean => root.dataset.ogSkin === "glass"
    && root.dataset.ogOptics !== "off"
    && root.dataset.ogMotion !== "reduced"
    && !document.hidden
    && !reducedMotion.matches
    && !reducedTransparency.matches
    && !forcedColors.matches;

  function release(lens: Lens): void {
    lens.filter?.remove();
    lens.filter = undefined;
    lens.signature = undefined;
    if (lens.inlineBackdrop) lens.el.style.setProperty("backdrop-filter", lens.inlineBackdrop);
    else lens.el.style.removeProperty("backdrop-filter");
    if (lens.inlineWebkitBackdrop) lens.el.style.setProperty("-webkit-backdrop-filter", lens.inlineWebkitBackdrop);
    else lens.el.style.removeProperty("-webkit-backdrop-filter");
    lens.el.removeAttribute("data-og-refraction");
  }

  function forget(lens: Lens): void {
    release(lens);
    io.unobserve(lens.el);
    resize.unobserve(lens.el);
    lenses.delete(lens.el);
  }

  function pruneDisconnected(): boolean {
    let removed = false;
    for (const lens of lenses.values()) if (!lens.el.isConnected) {
      forget(lens);
      removed = true;
    }
    return removed;
  }

  /** Coalesce every trigger into one bounded pass. */
  function schedule(): void {
    if (frame || stopped) return;
    frame = requestAnimationFrame(update);
  }

  function materialSignature(el: HTMLElement, style: CSSStyleDeclaration): string | null {
    if (style.display === "none" || style.visibility !== "visible") return null;
    if (Number(style.opacity) < 1) return null;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (!width || !height) return null;
    const area = width * height;
    if (area > REFRACTION_LIMITS.surfaceArea) return null;
    // Only translucent materials show a refracted backdrop: opaque plates hide the
    // displacement and fully transparent frames have no material to shape.
    if (!translucent(style.backgroundColor)) return null;
    const radii = [
      style.borderTopLeftRadius, style.borderTopRightRadius,
      style.borderBottomRightRadius, style.borderBottomLeftRadius,
    ].map(value => parseFloat(value) || 0);
    const base = radii[0] ?? 0;
    if (radii.some(value => Math.abs(value - base) > 0.5)) return null;
    const radius = Math.min(base, width / 2, height / 2);
    /* 整块均匀模糊：直接用元素所在档位的原始 blur；不经过会在根节点
       提前解析的中间变量，保证嵌在测试/局部容器里也能正确继承。 */
    const blur = Math.max(0, parseFloat(style.getPropertyValue("--og-blur-1")) || 0);
    const saturate = Math.max(0, (parseFloat(style.getPropertyValue("--og-saturate")) || 100) / 100);
    const edge = Math.min(
      Math.max(parseFloat(style.getPropertyValue("--og-refraction-edge")) || 10, 4),
      Math.min(width, height) / 2,
    );
    const scale = Math.min(Math.max(parseFloat(style.getPropertyValue("--og-refraction-scale")) || 12, 0), 96);
    if (!scale) return null;
    return [width, height, Math.round(radius * 10) / 10, blur, saturate, edge, scale].join(":");
  }

  function apply(lens: Lens, signature: string): void {
    const [width = 0, height = 0, radius = 0, blur = 0, saturate = 1, edge = 1, scale = 0] =
      signature.split(":").map(Number);
    if (!width || !height) return;
    const field = buildField(width, height, radius, edge);
    if (!field) return;
    lens.filter?.remove();
    const id = `og-lens-${++nextLens}`;
    const filter = svgNode("filter", {
      id, x: "-10%", y: "-10%", width: "120%", height: "120%",
      "color-interpolation-filters": "sRGB", "primitiveUnits": "userSpaceOnUse",
    });
    /* 整块均匀模糊：全表面同一 stdDeviation，边缘不额外降模糊。
       位移只改变采样位置，不改变模糊半径。 */
    filter.append(
      svgNode("feGaussianBlur", { in: "SourceGraphic", stdDeviation: String(blur), result: "frost" }),
      svgNode("feImage", {
        href: field, x: "0", y: "0", width: String(width), height: String(height),
        "data-map": mapSize(width, height), preserveAspectRatio: "none", result: "normals",
      }),
      svgNode("feDisplacementMap", {
        in: "frost", in2: "normals", scale: String(scale),
        xChannelSelector: "R", yChannelSelector: "G", result: "bent",
      }),
      svgNode("feColorMatrix", { in: "bent", type: "saturate", values: String(saturate) }),
    );
    defs.append(filter);
    lens.filter = filter;
    lens.signature = signature;
    // The filter URL is per-element dynamic data, so it is written inline; every
    // static appearance decision still lives in the material tokens.
    lens.el.style.setProperty("backdrop-filter", `url("#${id}")`);
    lens.el.style.setProperty("-webkit-backdrop-filter", `url("#${id}")`);
    lens.el.setAttribute("data-og-refraction", "edge");
  }

  /** Ancestors that already isolate a backdrop must not be nested again. */
  function canNest(el: HTMLElement): boolean {
    for (let parent = el.parentElement; parent && parent !== root; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.backdropFilter !== "none" || style.filter !== "none" || Number(style.opacity) < 1) return false;
    }
    /* 卡内 .og-surface 不再重复模糊，也绝不抢 lens；只有顶层卡片/overlay 才采样。 */
    if (el.matches(".og-surface") && !el.matches(".og-surface--overlay")) {
      if (el.parentElement?.closest(".og-surface")) return false;
    }
    return true;
  }

  function update(): void {
    frame = 0;
    if (stopped) return;
    pruneDisconnected();
    const on = active();
    const limit = coarse.matches ? REFRACTION_LIMITS.touchSurfaces : REFRACTION_LIMITS.surfaces;
    const candidates = [...lenses.values()].filter(lens => lens.el.isConnected).sort((a, b) => a.order - b.order);
    const used: Lens[] = [];
    let area = 0;
    for (const lens of candidates) {
      if (!on || !lens.visible || used.length >= limit) {
        // Every off condition must also release: leaving the glass skin, reduced
        // motion/transparency or the budget must restore the stylesheet material.
        release(lens);
        continue;
      }
      {
        const style = getComputedStyle(lens.el);
        const signature = materialSignature(lens.el, style);
        if (!signature) { release(lens); continue; }
        const [width = 0, height = 0] = signature.split(":").map(Number);
        if (!width || !height) { release(lens); continue; }
        if (area + width * height > REFRACTION_LIMITS.totalArea) { release(lens); continue; }
        if (used.some(other => other.el.contains(lens.el) || lens.el.contains(other.el))) { release(lens); continue; }
        if (!canNest(lens.el)) { release(lens); continue; }
        if (signature !== lens.signature || !lens.filter) {
          release(lens);
          apply(lens, signature);
        }
        if (lens.filter) { used.push(lens); area += width * height; }
      }
    }
    if (used.length && !svg.isConnected) document.body.append(svg);
    if (!used.length) svg.remove();
  }

  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const lens = lenses.get(entry.target as HTMLElement);
      if (lens) lens.visible = entry.isIntersecting;
    }
    schedule();
  }, { threshold: 0.01 });

  const resize = new ResizeObserver(schedule);

  function discover(subtree: Element): void {
    // 选择器按逗号分组：越靠前的组优先级越高（宿主管"哪些面先获得光学层"）。
    // 同一组内按文档序，保证结果稳定可复现。
    for (let group = 0; group < groups.length; group++) {
      const query = groups[group];
      if (!query) continue;
      const add = (el: Element): void => {
        if (!(el instanceof HTMLElement) || lenses.has(el)) return;
        if (lenses.size >= REFRACTION_LIMITS.candidates) return;
        const lens: Lens = {
          el,
          visible: false,
          order: group * 10_000 + nextLens++,
          inlineBackdrop: el.style.getPropertyValue("backdrop-filter"),
          inlineWebkitBackdrop: el.style.getPropertyValue("-webkit-backdrop-filter"),
        };
        lenses.set(el, lens);
        io.observe(el);
        resize.observe(el);
      };
      if (subtree.matches(query)) add(subtree);
      for (const el of subtree.querySelectorAll(query)) add(el);
    }
  }

  discover(document.body);
  const mutations = new MutationObserver(records => {
    const removed = pruneDisconnected();
    let changed = removed;
    for (const record of records) {
      if (record.target === svg || svg.contains(record.target)) continue;
      for (const added of record.addedNodes) {
        if (!(added instanceof Element) || added === svg || svg.contains(added)) continue;
        discover(added);
        changed = true;
      }
    }
    // Existing nodes that were beyond the candidate budget can now be observed.
    if (removed) discover(document.body);
    if (changed) schedule();
  });
  mutations.observe(document.body, { childList: true, subtree: true });

  const axes = new MutationObserver(schedule);
  axes.observe(root, {
    attributes: true,
    attributeFilter: ["data-og-skin", "data-og-skin-level", "data-og-scheme", "data-og-motion", "data-og-density", "data-og-optics"],
  });
  for (const query of media) query.addEventListener("change", schedule);
  document.addEventListener("visibilitychange", schedule);
  schedule();

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    mutations.disconnect();
    axes.disconnect();
    io.disconnect();
    resize.disconnect();
    for (const query of media) query.removeEventListener("change", schedule);
    document.removeEventListener("visibilitychange", schedule);
    for (const lens of lenses.values()) release(lens);
    lenses.clear();
    svg.remove();
  };
}

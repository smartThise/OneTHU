/**
 * 全字符对比度引擎 · 定格版（2026-10-14 用户拍板，当天二次修订；2026-10-16 三修）
 * 契约（不改）：
 *  ① 「实时渲染字体颜色应该在用户看到的那一刻就停止为静态」——首进视口定格一次；
 *  ② 「壁纸切换/主题切换/玻璃质等级切换时，字体颜色都要重新取一遍」；
 *  ③ 滚动与普通 DOM 变更不触发重算（那是首版乱闪的根源）。
 *
 * 2026-10-16 三修（用户反馈：「还是会出现白字在白底/接近白底，同时深色上出现黑字」）：
 *  A. **定格没生效**（最致命）：`scanNew()` 把元素加进 tracked 后才 `io.observe()`，
 *     而 IO 回调又走 `settle(el)` —— 它第一行就因 `tracked.has(el)` 直接 return。
 *     于是"新挂载的每个元素都只是被观察、从来没被定格"：整机只有环境变更那一次
 *     `settleAll` 真正写过色。实测某页 98 个文本块里只有 12 个被写过色，43 个低于 3:1。
 *     → 拆成两个集合：`seen`（登记过，防重复观察）/ `settled`（已定格，生命周期只进一次）。
 *  B. **合成在亮度空间做**：`L = L*(1-a) + lum(fill)*a` 对"浅玻璃压深底"系统性高估
 *     （#151517 上压 44% 白：真值 L≈0.19，线性估到 0.45）→ 引擎以为底很亮 → 写黑字
 *     → 深色玻璃上黑字。→ 改成 **逐层在 sRGB 空间合成，最后一步才转亮度**。
 *  C. **视频壁纸被当成纯色**：旧实现给 `data:video/` `local:*.mp4` 直接刷一块 #151517，
 *     可视频画面是亮的（用户那张实测九宫格 L 0.07–0.36、p95 到 0.6）→ 引擎认定"底很暗"
 *     → 主题白字"已达标"→ 一字节不碰 → **白字压在视频亮部上**。
 *     → 直接 `drawImage(<video>)` 采真实帧（含 .wall-video-veil 的 20% 暗纱），
 *       并按 VIDEO_TICK_MS 低频重采样（画面在动，静态近似必然过期）。
 *  D. 漂移只修**已经看不清**的元素（还看得清就保留），避免视频播放时字色反复横跳。
 *  E. 覆盖扩到「自有文本 + 还有子元素」的混排宿主（旧实现要求 children.length===0，
 *     `<div>文本 <b>粗</b></div>` 这类整块漏掉）。
 *  F. 零尺寸（还没布局/在 display:none 里）不判定：旧实现按 (0,0) 算出一色并锁死，
 *     元素真正露出来时因已在 tracked 里而永远不再重算。
 *  G. **反差纱模型错**：`.explorer-content::before` 是全屏 `position: fixed; inset: 0` 的一层，
 *     只按壁纸明暗决定（暗→白 34%、亮→黑 36%，四种明暗组合都盖），而旧实现只认
 *     「暗壁纸+亮主题」一种组合、还把栏体与画布件排除在外 → 钟面底算成 0.15（实际 0.34）
 *     → 白字判"达标"。实测：引擎采到的壁纸 (68,107,138) 叠白 34% = (132,157,178)，
 *     与实测底 (131,157,178) 逐通道差 ≤1。
 *  H. `settleAll()` 把元素记进 `seen` 却不挂 IO → 它们永远进不了 `visible`，
 *     视频漂移那一整路空转（实测 visible 只有 2 个元素）。
 *  I. 变更点**定向扫描**：全树扫会被 NODE_BUDGET 截断，后追加的大面板（设置页那一整块）
 *     在 4000 节点之后 → 整块没人管。改成按 MutationObserver 的 addedNodes 扫对应子树。
 */
import { renderedColor } from "./textContrastColor.js";
import { builtinCss, displayRef, subscribeWallpaper, wallpaperSnapshot, wallpaperVeilSnapshot } from "../state/wallpaper.js";

/** Canvas APIs need a resolved color; CSS roles remain the single palette source. */
function renderColor(role: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(role).trim();
}

const CELL = 8;              // 壁纸离屏网格（px）
const TILE = 96;             // 瓦片颜色缓存粒度
const NODE_BUDGET = 4000;    // 单轮新增叶子预算
const MIN_CONTRAST = 4.5;
const VIDEO_TICK_MS = 1500;  // 视频壁纸重采样节拍
const VIDEO_VEIL = 0.2;      // 与 .wall-video-veil 同值

type Rgb = [number, number, number];
type Mode = "first" | "env" | "drift";

const tileCache = new Map<string, Rgb>();
/** 登记过（防同元素重复 observe） */
const seen = new WeakSet<HTMLElement>();
/** 已定格（生命周期只进一次；环境变更时 delete 掉再重取） */
const settled = new WeakSet<HTMLElement>();
/** 当前在视口里的已登记元素（视频漂移只扫这一撮，不扫全树） */
const visible = new Set<HTMLElement>();
let wall: HTMLCanvasElement | null = null;
let wallKind: "none" | "css" | "image" | "video" = "none";
let wallKey = "";
let started = false;
let visIO: IntersectionObserver | null = null;
const pendingRoots: HTMLElement[] = [];
let reapplyScheduled = 0;
let videoSig = "";
let videoReady = false;
let driftTicks = 0;

function lum(rgb: Rgb): number {
  const f = (c: number) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function contrast(a: number, b: number): number {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB 逐通道叠一层（top 压在 base 上）——合成必须在 sRGB 空间做，见文件头 B */
function mixRgb(base: Rgb, top: Rgb, a: number): Rgb {
  const k = a < 0 ? 0 : a > 1 ? 1 : a;
  return [
    base[0] * (1 - k) + top[0] * k,
    base[1] * (1 - k) + top[1] * k,
    base[2] * (1 - k) + top[2] * k,
  ];
}

function isVideoRef(ref: string): boolean {
  return ref.startsWith("data:video/") || (ref.startsWith("local:") && /\.(mp4|webm)$/i.test(ref));
}

/** 壳层壁纸视频（ShellWallpaperLayer 渲染的那个） */
function shellVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>(".shell-wallpaper video");
}

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number): void {
  if (!sw || !sh) return;
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const scale = Math.max(cw / sw, ch / sh);
  const dw = sw * scale, dh = sh * scale;
  ctx.drawImage(src, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
}

function rebuildWall(force = false): void {
  const wp = wallpaperSnapshot();
  const ref = wp.global;
  const W = window.innerWidth, H = window.innerHeight;
  const kind: typeof wallKind = !ref ? "none" : isVideoRef(ref) ? "video" : builtinCss(ref) ? "css" : "image";
  const key = (ref ?? "none") + "|" + W + "x" + H + "|" + kind;
  if (!force && key === wallKey && wall) return;
  wallKey = key;
  wallKind = kind;
  videoSig = "";
  videoReady = false;
  tileCache.clear();
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(W / CELL));
  c.height = Math.max(1, Math.ceil(H / CELL));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) { wall = null; return; }
  ctx.fillStyle = renderColor("--og-canvas");
  ctx.fillRect(0, 0, c.width, c.height);
  if (!ref) { wall = c; return; }
  if (kind === "video") {
    // 视频没解码出来时的兜底色：视频壁纸下面永远是深色幕，按最坏情况（暗）兜，
    // 一旦拿到真实帧立刻重采（driftTick 会在下一拍补上）。
    ctx.fillStyle = renderColor("--og-video-fallback");
    ctx.fillRect(0, 0, c.width, c.height);
    wall = c;
    paintVideoFrame();
    return;
  }
  const css = kind === "css" ? builtinCss(ref) : null;
  if (css) {
    const stops = [...css.matchAll(/(#[0-9a-fA-F]{6}|rgba?\([^)]*\))\s+(\d+)%/gi)]
      .map((m) => ({ color: m[1] as string, at: Number(m[2]) / 100 }));
    const deg = Number((css.match(/(-?\d+)deg/) ?? [])[1] ?? "180");
    const rad = ((deg - 90) * Math.PI) / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);
    const cx = c.width / 2, cy = c.height / 2;
    const len = (Math.abs(c.width * dx) + Math.abs(c.height * dy)) / 2;
    const g = ctx.createLinearGradient(cx - dx * len, cy - dy * len, cx + dx * len, cy + dy * len);
    if (stops.length === 0) {
      ctx.fillStyle = renderColor("--og-canvas");
    } else {
      for (const st of stops) g.addColorStop(Math.min(1, Math.max(0, st.at)), st.color);
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, c.width, c.height);
    wall = c;
    return;
  }
  const img = new Image();
  img.onload = () => {
    try {
      drawCover(ctx, img, img.naturalWidth || 1, img.naturalHeight || 1);
      wall = c;
      tileCache.clear();
      settleAll();
      scanNew();
    } catch { wall = null; }
  };
  img.onerror = () => { wall = null; };
  img.src = displayRef(ref);
}

/** 把当前视频帧画进采样画布（含暗纱）。拿到帧返回 true。 */
function paintVideoFrame(): boolean {
  if (!wall || wallKind !== "video") return false;
  const v = shellVideo();
  if (!v || v.readyState < 2 || !v.videoWidth) return false;
  const ctx = wall.getContext("2d");
  if (!ctx) return false;
  try {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    drawCover(ctx, v, v.videoWidth, v.videoHeight);
    if (VIDEO_VEIL > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${VIDEO_VEIL})`;
      ctx.fillRect(0, 0, wall.width, wall.height);
    }
    ctx.getImageData(0, 0, 1, 1);   // 探一次：跨域视频会把画布标脏，读回即抛
  } catch {
    ctx.globalAlpha = 1;
    ctx.fillStyle = renderColor("--og-video-fallback");
    ctx.fillRect(0, 0, wall.width, wall.height);
    tileCache.clear();
    return false;   // 退回兜底色，但别让 getImageData 每次都抛（那会让整台引擎静默失效）
  }
  tileCache.clear();
  return true;
}

/** 视频帧指纹（12 点量化）——画面没变就不触发重算 */
function videoSignature(): string {
  if (!wall) return "";
  const ctx = wall.getContext("2d");
  if (!ctx) return "";
  const out: number[] = [];
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const x = Math.min(wall.width - 1, Math.floor(((gx + 0.5) / 4) * wall.width));
      const y = Math.min(wall.height - 1, Math.floor(((gy + 0.5) / 3) * wall.height));
      const d = ctx.getImageData(x, y, 1, 1).data;
      out.push(((d[0] as number) >> 4) << 8 | ((d[1] as number) >> 4) << 4 | ((d[2] as number) >> 4));
    }
  }
  return out.join(",");
}

function tileRgb(vx: number, vy: number): Rgb {
  const key = Math.floor(vx / TILE) + ":" + Math.floor(vy / TILE);
  const hit = tileCache.get(key);
  if (hit) return hit;
  let v: Rgb = [128, 128, 128];
  if (wall) {
    const ctx = wall.getContext("2d");
    if (ctx) {
      try {
        const cx = Math.min(wall.width - 1, Math.max(0, Math.floor(vx / CELL)));
        const cy = Math.min(wall.height - 1, Math.max(0, Math.floor(vy / CELL)));
        const d = ctx.getImageData(cx, cy, 1, 1).data;
        v = [d[0] as number, d[1] as number, d[2] as number];
      } catch { /* 画布被污染：按中灰兜，宁可少判也不炸整台引擎 */ }
    }
  }
  tileCache.set(key, v);
  return v;
}

/** 定格时刻的壁纸颜色（元素矩形内瓦片均值，sRGB 空间） */
function wallRgb(rect: DOMRect): Rgb {
  let r = 0, g = 0, b = 0, n = 0;
  const step = TILE / 2;
  const right = Math.min(rect.right, window.innerWidth);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  for (let x = Math.max(0, rect.left); x < right; x += step) {
    for (let y = Math.max(0, rect.top); y < bottom; y += step) {
      const c = tileRgb(x + step / 2, y + step / 2);
      r += c[0]; g += c[1]; b += c[2]; n++;
    }
  }
  if (n) return [r / n, g / n, b / n];
  return tileRgb(
    Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
    Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)),
  );
}



function parseLayers(el: HTMLElement): Array<{ a: number; rgb: Rgb }> {
  const layers: Array<{ a: number; rgb: Rgb }> = [];
  let hop = 0;
  for (let p: HTMLElement | null = el; p && hop < 40; p = p.parentElement, hop++) {
    // 从元素自身起收集：文字叶子常常自己就带一层玻璃底（按钮/chip/栏体），
    // 旧实现只从 parentElement 起算 → 漏掉它 → 底被估成透明 → 误判"底很亮" → 写白字。
    if (p.tagName === "HTML") break;
    const cs = getComputedStyle(p);
    collect(cs.backgroundColor);
    const bi = cs.backgroundImage;
    if (bi && bi !== "none") {
      for (const m of bi.matchAll(/(?:rgba?|color)\([^)]*\)/g)) collect(m[0]);
      // hex 停靠点此前被整片漏掉（gel token 的 tint 渐变里就有）
      for (const m of bi.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) collect(m[0]);
    }
    if (p.classList.contains("wall-video-veil")) collect("rgba(0, 0, 0, 0.2)");
    // The sampled wallpaper sits above body/html. Their opaque canvas is BEHIND
    // that image, so compositing it again would erase the wallpaper sample.
    if (p.classList.contains("explorer-shell")) break;
  }
  return layers;
  function collect(raw: string): void {
    const parsed = renderedColor(raw);
    if (parsed && parsed.a > 0) layers.push(parsed);
  }
}

/** 元素背后的真实颜色 → 相对亮度（sRGB 逐层合成，最后转亮度） */
function compositeLum(el: HTMLElement): number {
  let c = wallRgb(el.getBoundingClientRect());
  /* 壁纸遮罩是**全屏** fixed 层：浅色主题永远白纱、深色主题永远黑纱，
     浓度由用户在 设置→外观 调（state/wallpaper.veil）。引擎必须按同一模型合成，
     否则会再次出现「深色壁纸无遮罩 → 白字被判断为已达标」的可读性回归。 */
  const schemeIsDark = document.documentElement.dataset.scheme === "dark";
  const veil = wallpaperVeilSnapshot();
  if (veil) c = mixRgb(c, schemeIsDark ? [0, 0, 0] : [255, 255, 255], veil);
  const layers = parseLayers(el);
  // parseLayers 是「由内向外」收集的；合成必须「由外向内」才等价于真实叠放顺序
  for (let i = layers.length - 1; i >= 0; i--) {
    const ly = layers[i] as { a: number; rgb: Rgb };
    c = mixRgb(c, ly.rgb, ly.a);
  }
  return Math.round(Math.min(1, Math.max(0, lum(c))) * 20) / 20;
}

const WANT_DARK = "var(--og-contrast-ink-light)";
const WANT_LIGHT = "var(--og-contrast-ink-dark)";

function hasOwnText(el: HTMLElement): boolean {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3 && (n.textContent ?? "").trim()) return true;
  }
  return false;
}

function colorRgb(raw: string): Rgb | null {
  return renderedColor(raw)?.rgb ?? null;
}

function inViewport(rect: DOMRect): boolean {
  return rect.bottom > -120 && rect.top < window.innerHeight + 120 && rect.width >= 2 && rect.height >= 2;
}

/** 采样必须发生在「最终合成态」：祖先 opacity < 1 / filter / 混合模式都会改变背景栈。
    入场动画、遮罩淡入、页面转场期间祖先 opacity 在中间态，此时定格会把字色锁成反色
    （用户实测「文字颜色突变」）。不稳定就延后重试，绝不在中间态写锁。 */
function hasTransientAncestor(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node && node !== document.documentElement; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (Number(cs.opacity) < 0.999 || cs.filter !== "none" || cs.mixBlendMode !== "normal") return true;
  }
  return false;
}

/** 主题切换期间 CSS 正在做颜色/背景过渡（html.theme-anim），令牌与合成色都在动；
    这时取色必然取到中间值，延后到过渡结束再定格。 */
function samplingDelayed(): boolean {
  return document.documentElement.classList.contains("theme-anim");
}

function retryAfterStable(el: HTMLElement, mode: Mode, delay = 420): void {
  if (el.dataset.txRetry === "1") return;
  // 永久半透明（如禁用态/设计上压暗的子树）不应该无限重排。最多试 3 次。
  const attempts = Number(el.dataset.txRetryCount ?? "0");
  if (attempts >= 3) return;
  el.dataset.txRetryCount = String(attempts + 1);
  el.dataset.txRetry = "1";
  window.setTimeout(() => {
    if (!el.isConnected) return;
    delete el.dataset.txRetry;
    settleTarget(el, mode === "env" ? "env" : "first");
  }, delay);
}

/** 环境重取（主题/玻璃档/壁纸）时墨色走一次过渡：直接跳色会被读成「文字颜色突变」。
    首帧定格不能过渡——那会让首帧先画令牌色再淡入引擎色。 */
function transitionInk(el: HTMLElement): void {
  el.style.setProperty("transition", "color var(--og-dur-2) var(--og-ease-standard)");
  window.setTimeout(() => {
    if (el.isConnected) el.style.removeProperty("transition");
  }, 260);
}

/**
 * 定格一个文本宿主。
 *  mode = first：生命周期只进一次（进视口那一刻）
 *  mode = env  ：壁纸/主题/玻璃档变更后的重取（调用方已先清掉上一轮内联色）
 *  mode = drift：视频画面变了——**只修已经看不清的**，还看得清就原样保留（防字色横跳）
 */
function settle(el: HTMLElement, mode: Mode = "first"): void {
  if (mode === "first" && settled.has(el)) return;
  seen.add(el);
  try {
    if (el.closest('[data-tx="keep"]')) { clearLock(el, mode === "env"); return; }
    if (!hasOwnText(el)) return;
    const rect = el.getBoundingClientRect();
    if (!inViewport(rect)) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return;
    if (samplingDelayed() || hasTransientAncestor(el)) { retryAfterStable(el, mode); return; }
    delete el.dataset.txRetryCount;
    const cur = colorRgb(cs.color);
    if (!cur) return;
    const bg = compositeLum(el);
    const curLum = lum(cur);
    // 当前字色看得清 → 一字节不碰（drift 时这就是"视频在放也别让字色来回翻"的闸门）
    if (contrast(curLum, bg) >= MIN_CONTRAST) { settled.add(el); return; }
    // 黑白二选一必须「两个候选都算一遍取高者」：
    // 旧实现用 bg < 0.5 当分界是错的——0.5 是 sRGB 中灰，不是白字/黑字等对比的交叉点（交叉点 L≈0.179）。
    const white = contrast(1, bg), black = contrast(0, bg);
    const ink = white >= black ? WANT_DARK : WANT_LIGHT;
    if (mode === "env") transitionInk(el);
    el.style.setProperty("color", ink);
    el.dataset.tx = "lock";
    settled.add(el);
    inkIconsWith(el, ink);
  } catch { /* 单叶失败不影响整体 */ }
}

/** 壁纸/主题/玻璃档变化：清掉已定格的内联色，就地按新背景重取一次。
 *  刻意不新增滚动触发——那是首版乱闪的根源，此函数只由这三类显式变更调用。 */
/* ── 图标自适应（2026-10-14 用户点名）──────────────────────────────
   图标是 SVG，颜色走 currentColor，**没有**文本子节点 → 上面的 settle() 永远不会处理它们，
   于是浅笔画压在浅玻璃上等于隐形（用户：「很多 icon 没有颜色变深导致看不见」）。
   这里给图标单独的定格：找「含 SVG 且自身无文本」的容器，按同一套候选取优规则改它的 color
   （SVG 继承 currentColor）。同样只在首进视口定格一次，并在环境变更时随 settleAll 重取。 */
function isIconHost(el: HTMLElement): boolean {
  if (!el.querySelector("svg")) return false;
  return !hasOwnText(el);
}

/** 同控件里已有文字宿主时，图标直接取它的墨色（未定格也算）：
 *  文字没被逼到要换墨的场合，图标也不该自己另选一种，否则会出现"图标白、文字灰"。 */
function siblingTextInk(el: HTMLElement): string | null {
  const scope = el.closest("button, a, [role='button'], .og-btn, .ex-bbar-btn");
  if (!scope) return null;
  for (const candidate of scope.querySelectorAll("span, strong, small, label, p")) {
    if (candidate === el || candidate.closest('[data-tx="keep"]')) continue;
    if (!(candidate instanceof HTMLElement) || !hasOwnText(candidate)) continue;
    return getComputedStyle(candidate).color;
  }
  return null;
}

function settleIcon(el: HTMLElement, mode: Mode = "first"): void {
  if (mode === "first" && settled.has(el)) return;
  seen.add(el);
  try {
    if (el.closest('[data-tx="keep"]')) { clearLock(el); return; }
    const rect = el.getBoundingClientRect();
    if (rect.width < 6 || rect.height < 6) return;
    if (rect.bottom < -120 || rect.top > window.innerHeight + 120) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return;
    if (samplingDelayed() || hasTransientAncestor(el)) { retryAfterStable(el, mode); return; }
    delete el.dataset.txRetryCount;
    const cur = colorRgb(cs.color);
    if (!cur) return;
    /* 先对齐同控件文字的墨色：文字若已按卡片底取色，图标不能自己另算一套。 */
    const sibling = siblingTextInk(el);
    if (sibling && sibling !== cs.color) {
      if (mode === "env") transitionInk(el);
      el.style.setProperty("color", sibling);
      el.dataset.txi = "lock";
      settled.add(el);
      return;
    }
    // 纯白/纯黑会被认成"已达标"，但它们正是"隐形笔画"本身 → 极性不对就必须重算
    const nearExtreme = cur[0] > 240 || cur[0] < 24;
    const bg = compositeLum(el);
    const curLum = lum(cur);
    const white = contrast(1, bg), black = contrast(0, bg);
    const wantIsWhite = white >= black;
    const curIsWhite = curLum > 0.5;
    const readable = contrast(curLum, bg) >= MIN_CONTRAST;
    if (readable && (!nearExtreme || wantIsWhite === curIsWhite)) { settled.add(el); return; }
    if (mode === "env") transitionInk(el);
    el.style.setProperty("color", wantIsWhite ? WANT_DARK : WANT_LIGHT);
    el.dataset.txi = "lock";
    settled.add(el);
  } catch { /* 单叶失败不影响整体 */ }
}

/** 文本被压成墨色/白色后，同一控件里的图标容器必须用同一支墨：
 *  图标宿主有自己的底（如 sphere-ball 的小圆球），compositeLum 看的是那颗球而不是
 *  卡片最终底色，于是会出现「文字已转黑、图标仍是白的」分叉（深色主题 + 亮自定义壁纸）。
 *  这里只给「无文字、包着 svg」的容器上色，不碰标签文字。 */
function inkIconsWith(el: HTMLElement, ink: string): void {
  const scope = el.closest("button, a, [role='button'], .og-btn, .ex-bbar-btn") ?? el.parentElement;
  if (!scope) return;
  for (const svg of scope.querySelectorAll("svg")) {
    const host = svg.parentElement;
    if (!host || host === el || host.closest('[data-tx="keep"]') || hasOwnText(host)) continue;
    host.style.setProperty("color", ink);
    host.dataset.txi = "lock";
    settled.add(host);
  }
}

function settleTarget(el: HTMLElement, mode: Mode): void {
  // These controls own an atomic foreground/background pair for each state.
  // Locking an inactive label's ink would override its selected state's CSS.
  if (el.closest(".og-segment, .segmented, .og-tabs, .ex-tab, .og-btn--solid, .btn-primary, .oneshot-button, #ex-bbar-onego-btn, .vault-box-button, .vault-box-label")) {
    clearLock(el);
    return;
  }
  if (isIconHost(el)) settleIcon(el, mode);
  else settle(el, mode);
}

function isSettledTarget(el: HTMLElement): boolean {
  return hasOwnText(el) || isIconHost(el);
}

function clearLock(el: HTMLElement, animate = false): void {
  if (el.dataset.tx === "lock" || el.dataset.txi === "lock") {
    if (animate) transitionInk(el);
    el.style.removeProperty("color");
    delete el.dataset.tx;
    delete el.dataset.txi;
  }
  settled.delete(el);   // 清过色 = 回到未定格，重新露面时按新背景重取
}

/** 全树重取（环境变更 / 图像解码完成）：先清干净上一轮内联色，再逐个按新背景重取。
 *  根节点不只取壳层——模态、导览、浮层都是 body 下的兄弟 portal，只扫壳层会让它们
 *  在主题切换后保留上一轮的定格色（深色模式里黑字就是这么留下来的）。 */
function settleAll(): void {
  const shell = (document.querySelector(".explorer-shell") as HTMLElement | null) ?? document.body;
  const roots: HTMLElement[] = [shell];
  for (const child of Array.from(document.body.children)) {
    if (child instanceof HTMLElement && child !== shell && !shell.contains(child)) roots.push(child);
  }
  const list: HTMLElement[] = [];
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode() as HTMLElement | null;
    let budget = NODE_BUDGET;
    while (node && budget > 0) {
      const el = node;
      node = walker.nextNode() as HTMLElement | null;
      budget--;
      if (el instanceof SVGElement) continue;
      if (el.closest('[data-tx="keep"]')) {
        // 从「曾被引擎锁定」切到「主题墨色」：清掉旧内联色，让 CSS 重新接管
        clearLock(el);
        continue;
      }
      if (!isSettledTarget(el)) continue;
      if (!seen.has(el) && !inViewport(el.getBoundingClientRect())) continue;
      seen.add(el);
      visIO?.observe(el);     // 登记过就得挂上观察：否则永远进不了 visible，视频漂移那一路看不见它
      clearLock(el, true);
      list.push(el);
    }
  }
  // 一次性清干净再重算，避免集合读写交错漏元素
  for (const el of list) settleTarget(el, "env");
}

/** 视频画面变了：只扫当前视口里的那撮（全树 walk 撑不起 1.5s 的节拍） */
function settleVisible(): void {
  for (const el of visible) {
    if (!el.isConnected || !isSettledTarget(el)) continue;
    settleTarget(el, "drift");
  }
}

/** 走一棵子树（含根本身），把没登记过的文本/图标宿主挂上观察并就地定格 */
function scanSubtree(root: HTMLElement, rootBudget: { n: number }): void {
  const visit = (el: HTMLElement): void => {
    if (rootBudget.n <= 0) return;
    rootBudget.n--;
    if (!(el instanceof SVGElement) && !seen.has(el) && !el.closest('[data-tx="keep"]')) {
      if (hasOwnText(el) || isIconHost(el)) {
        seen.add(el);
        visIO?.observe(el);
        // 已经在视口里：立刻定格，不等 IO 回调（少一帧白闪）
        if (inViewport(el.getBoundingClientRect())) settleTarget(el, "first");
      }
    }
    for (const child of Array.from(el.children)) visit(child as HTMLElement);
  };
  visit(root);
}

/** roots 给了就只扫这几棵（变更点定向），没给就全树扫（安装/环境变更/尺寸变化） */
function scanNew(roots?: HTMLElement[]): void {
  if (!wall) { rebuildWall(); if (!wall) return; }
  const budget = { n: NODE_BUDGET };
  const list = roots && roots.length ? roots : [(document.querySelector(".explorer-shell") as HTMLElement | null) ?? document.body];
  for (const r of list) {
    if (r && r.isConnected) scanSubtree(r, budget);
    if (budget.n <= 0) break;
  }
}

function startIO(): void {
  visIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const t = e.target as HTMLElement;
      if (e.isIntersecting) {
        visible.add(t);
        // 用户看到的那一刻，一次定格（图标与文字同规则，各自分流）
        settleTarget(t, "first");
      } else {
        visible.delete(t);
      }
    }
  }, { root: null, threshold: 0.01 });
}

/** 环境变了（壁纸/主题/玻璃档）：重建壁纸采样 → 已定格元素重取色。
 *  OneGUI 的调色板是随后注入的样式表：只取一次会在旧调色板下定格出反向字色
 *  （深色主题里留下黑字）。80ms 后再兜一次，确保读到落定后的令牌与壁纸底色。 */
function reapplyAll(): void {
  // 多次环境变更（theme → OneGUI skin → 壁纸）合并成一次重取：分两轮会先锁一种墨、
  // 再清锁换另一种墨，用户看到的就是「文字颜色突变」。
  if (reapplyScheduled) { window.clearTimeout(reapplyScheduled); reapplyScheduled = 0; }
  const run = (): void => {
    reapplyScheduled = 0;
    // 主题切换有 420ms 的颜色过渡：此刻清锁再重取会取到中间色。
    // 等过渡（含 OneGUI 随后注入的调色板）完全落定后一次取完。
    if (samplingDelayed()) { reapplyAll(); return; }
    rebuildWall(true);
    // 视频帧还没解码出来时不急：driftTick 下一拍会拿到真帧并补一次
    settleAll();
    scanNew();
  };
  reapplyScheduled = window.setTimeout(run, samplingDelayed() ? 560 : 180);
}

/** 视频壁纸：画面在动，静态近似必然过期 → 低频重采真实帧，只修已经看不清的字 */
function driftTick(): void {
  if (wallKind !== "video" || !wall) return;
  if (!paintVideoFrame()) return;
  const sig = videoSignature();
  if (++driftTicks % 12 === 0) {
    for (const el of visible) if (!el.isConnected) visible.delete(el);
  }
  // 真帧第一次到手：此前是按兜底色判的，结论整体不可信 → 全树重取一次；
  // 之后画面只是"变"，就只修已经看不清的（drift），不做整体重刷（防字色横跳）。
  if (!videoReady) {
    videoReady = true;
    videoSig = sig;
    settleAll();
    scanNew();
    return;
  }
  if (sig === videoSig) return;
  videoSig = sig;
  settleVisible();
}

/** 启动（main.tsx 调一次；幂等） */
export function installTextContrast(): void {
  if (started) return;
  started = true;
  rebuildWall();
  startIO();
  subscribeWallpaper(() => reapplyAll());
  const mo = new MutationObserver((records) => {
    // 主题(dark)/玻璃档/壁纸明暗/主题包变了 → 已定格元素重取色（用户点名的实时契约）
    if (records.some((r) => r.type === "attributes")) { reapplyAll(); return; }
    for (const r of records) {
      for (const n of Array.from(r.addedNodes)) {
        if (n.nodeType === 1) pendingRoots.push(n as HTMLElement);
        else if (n.nodeType === 3 && n.parentElement) pendingRoots.push(n.parentElement);
      }
    }
    if (!pendingRoots.length) return;
    // 同步扫描（MutationObserver 回调发生在渲染之前）：等定时器/rAF 再扫会让首帧
    // 先画出令牌色、下一帧才被引擎改色——用户看到的就是「文字颜色突变」。
    // 同步写入的内联色直接进入首次绘制；NODE_BUDGET 兜住大页面的一次性开销。
    const roots = pendingRoots.splice(0, pendingRoots.length);
    scanNew(roots);
  });
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,                       // 只管环境属性，不监听 style（否则自触发死循环）
    attributeFilter: ["data-scheme", "data-glass", "data-theme", "data-wallpaper-lum", "data-og-skin", "data-og-skin-level", "data-og-scheme", "data-dynamic"],
  });
  window.addEventListener("resize", () => reapplyAll());
  window.addEventListener("onethu:dynamic-palette", reapplyAll);
  // 视频壁纸的挂载/起播可能晚于引擎：下一拍 paintVideoFrame 会成功，drift 自然补上
  window.setInterval(driftTick, VIDEO_TICK_MS);
  scanNew();
  /* dev 自检钩子：量某个元素引擎眼中的"底"（无头/真机排查对比度都靠它，不进产物） */
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__txProbe = (el: Element) => {
      const host = el as HTMLElement;
      const rect = host.getBoundingClientRect();
      return {
        kind: wallKind,
        wall: wallRgb(rect).map((n) => Math.round(n)),
        layers: parseLayers(host).map((l) => ({ a: l.a, rgb: l.rgb })),
        bg: compositeLum(host),
        color: getComputedStyle(host).color,
        lock: host.dataset.tx ?? host.dataset.txi ?? null,
        seenVisible: visible.has(host),
        seen: seen.has(host),
        isSettled: settled.has(host),
        ownText: hasOwnText(host),
      };
    };
    (window as unknown as Record<string, unknown>).__txStats = () => ({
      visible: visible.size,
      locks: document.querySelectorAll('[data-tx="lock"]').length,
      ilocks: document.querySelectorAll('[data-txi="lock"]').length,
      kind: wallKind,
    });
    (window as unknown as Record<string, unknown>).__txDrift = () => { driftTick(); return true; };
  }
}

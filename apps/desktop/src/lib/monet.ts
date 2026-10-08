/**
 * MD3 Monet 取色算法（仓库内实现，不引第三方依赖）。
 *
 * 用途（霖 2026-10-01 #1）：「我的」页那条彩色背景带要的是**主题色色盘**渐变——
 * 从当前主题的源色出发，按 Monet 的规则派生 primary / secondary / tertiary 三条色调板，
 * 各取几档 tone 当渐变停点。这样换主题（含第三方主题插件）时整条带的色相跟着变，
 * 而不是写死两三个颜色。
 *
 * 实现范围是 Monet 的「源色 → 色调板」这一段：
 *   ColorUtils（ARGB/XYZ/L*）→ ViewingConditions（D65、平均环绕）→ Cam16（正/逆变换）
 *   → Hct（色相/彩度/明度）→ TonalPalette（取某一档 tone）→ 三条板。
 * 图片取色（Celebi 量化）与 scheme/spec 全量角色映射不在范围内——这里只服务渐变带。
 *
 * 对照：material-color-utilities（Apache-2.0）的 ColorUtils / Cam16 / Hct / HctSolver /
 * TonalPalette / CorePalette。算法口径与官方一致，验证向量见 tools/monet-test.mjs：
 * 源色 #6750A4 派生出的 primary/secondary/tertiary 在 tone 40 上应分别落到
 * #6750A4 / #625B71 / #7D5260（MD3 基线方案），容差 ±3/通道（官方老版求解器本身
 * 是 |Δy|<0.002 的牛顿迭代，不是闭式解）。
 */

/* ══════════ ColorUtils ══════════ */

const clamp = (lo: number, hi: number, v: number): number => Math.min(hi, Math.max(lo, v));
const clampInt = (lo: number, hi: number, v: number): number => clamp(lo, hi, Math.round(v));

/** sRGB 分量（0–255）→ 线性（官方口径：0–100，与 XYZ/L* 同刻度） */
export function linearize(component255: number): number {
  const v = component255 / 255;
  return (v <= 0.040449936 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)) * 100;
}

/** 线性（0–100）→ sRGB 分量（0–255） */
export function delinearize(component: number): number {
  const v = component / 100;
  return v <= 0.0031308 ? v * 12.92 * 255 : (1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;
}

export function argbFromRgb(r: number, g: number, b: number): number {
  return (((255 << 24) | (clampInt(0, 255, r) << 16) | (clampInt(0, 255, g) << 8) | clampInt(0, 255, b)) >>> 0);
}

export const redFromArgb = (argb: number): number => (argb >> 16) & 255;
export const greenFromArgb = (argb: number): number => (argb >> 8) & 255;
export const blueFromArgb = (argb: number): number => argb & 255;

export function hexFromArgb(argb: number): string {
  const r = redFromArgb(argb);
  const g = greenFromArgb(argb);
  const b = blueFromArgb(argb);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function argbFromHex(hex: string): number {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const v = parseInt(full.slice(0, 6), 16);
  return Number.isNaN(v) ? 0xff000000 : ((v | 0xff000000) >>> 0);
}

/**
 * CSS 颜色串 → ARGB。
 * 主题令牌算出来的值可能是 #hex，也可能是 rgb()/rgba()（浏览器把 color-mix/oklch 解析完
 * 一般回 rgb）。两种都吃；其它写法（未解析的 var、color-mix 字面量）返回 null，让调用方回落。
 */
export function argbFromCssColor(css: string): number | null {
  const v = css.trim();
  if (!v) return null;
  if (v.startsWith("#")) return argbFromHex(v);
  const m = /^rgba?\(([^)]+)\)$/i.exec(v);
  const body = m?.[1];
  if (!body) return null;
  const parts = body.split(/[\s,/]+/).filter(Boolean).map(Number);
  const [r, g, b] = parts;
  if (r === undefined || g === undefined || b === undefined) return null;
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  return argbFromRgb(r, g, b);
}

/** sRGB → CIE XYZ（D65） */
export function xyzFromArgb(argb: number): [number, number, number] {
  const r = linearize(redFromArgb(argb));
  const g = linearize(greenFromArgb(argb));
  const b = linearize(blueFromArgb(argb));
  return [
    0.41233895 * r + 0.35762064 * g + 0.18051042 * b,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    0.01932141 * r + 0.11916382 * g + 0.95034478 * b,
  ];
}

/** XYZ → sRGB（超域裁剪） */
export function argbFromXyz(x: number, y: number, z: number): number {
  const r = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  const g = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  const b = 0.0557 * x - 0.204 * y + 1.057 * z;
  return argbFromRgb(delinearize(r), delinearize(g), delinearize(b));
}

/** CIE L*（明度，0–100） */
export function lstarFromY(y: number): number {
  const e = 216 / 24389;
  const v = y / 100;
  return v <= e ? (v * 24389) / 27 : Math.cbrt(v) * 116 - 16;
}

export function yFromLstar(lstar: number): number {
  return 100 * (lstar > 8 ? Math.pow((lstar + 16) / 116, 3) : lstar / (24389 / 27));
}

export const lstarFromArgb = (argb: number): number => lstarFromY(xyzFromArgb(argb)[1]);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/* ══════════ ViewingConditions（官方默认：D65、L*=50 背景、平均环绕） ══════════ */

export interface ViewingConditions {
  n: number;
  aw: number;
  nbb: number;
  ncb: number;
  c: number;
  nc: number;
  rgbD: [number, number, number];
  fl: number;
  flRoot: number;
  z: number;
}

function makeViewingConditions(
  whitePoint: [number, number, number],
  adaptingLuminance: number,
  backgroundLstar: number,
  surround: number,
  discountingIlluminant: boolean,
): ViewingConditions {
  const rW = 0.401288 * whitePoint[0] + 0.650173 * whitePoint[1] - 0.051461 * whitePoint[2];
  const gW = -0.250268 * whitePoint[0] + 1.204414 * whitePoint[1] + 0.045854 * whitePoint[2];
  const bW = -0.002079 * whitePoint[0] + 0.048952 * whitePoint[1] + 0.953127 * whitePoint[2];
  const f = 0.8 + surround / 10;
  const c = f >= 0.9 ? lerp(0.59, 0.69, (f - 0.9) * 10) : lerp(0.525, 0.59, (f - 0.8) * 10);
  const d = discountingIlluminant ? 1 : clamp(0, 1, 1 - (1 / 3.6) * Math.exp((-adaptingLuminance - 42) / 92));
  const nc = f;
  const rgbD: [number, number, number] = [d * (100 / rW) + 1 - d, d * (100 / gW) + 1 - d, d * (100 / bW) + 1 - d];
  const k = 1 / (5 * adaptingLuminance + 1);
  const k4 = k * k * k * k;
  const fl = k4 * adaptingLuminance + 0.1 * (1 - k4) * (1 - k4) * Math.cbrt(5 * adaptingLuminance);
  const flRoot = Math.pow(fl, 0.25);
  const n = yFromLstar(backgroundLstar) / whitePoint[1];
  const z = 1.48 + Math.sqrt(n);
  const nbb = 0.725 / Math.pow(n, 0.2);
  const ncb = nbb;
  const rgbAFactors: [number, number, number] = [
    Math.pow((fl * rgbD[0] * rW) / 100, 0.42),
    Math.pow((fl * rgbD[1] * gW) / 100, 0.42),
    Math.pow((fl * rgbD[2] * bW) / 100, 0.42),
  ];
  const rgbA: [number, number, number] = [
    (400 * rgbAFactors[0]) / (rgbAFactors[0] + 27.13),
    (400 * rgbAFactors[1]) / (rgbAFactors[1] + 27.13),
    (400 * rgbAFactors[2]) / (rgbAFactors[2] + 27.13),
  ];
  const aw = (2 * rgbA[0] + rgbA[1] + rgbA[2] / 20 - 0.305) * nbb;
  return { n, aw, nbb, ncb, c, nc, rgbD, fl, flRoot, z };
}

export const DEFAULT_VIEWING_CONDITIONS: ViewingConditions = makeViewingConditions(
  [95.047, 100, 108.883],
  (200 / Math.PI) * yFromLstar(50) / 100,
  50,
  2,
  false,
);

/* ══════════ CAM16 ══════════ */

export interface Cam16 {
  hue: number;
  chroma: number;
  j: number;
}

export function cam16FromXyz(x: number, y: number, z: number, vc: ViewingConditions = DEFAULT_VIEWING_CONDITIONS): Cam16 {
  const rC = 0.401288 * x + 0.650173 * y - 0.051461 * z;
  const gC = -0.250268 * x + 1.204414 * y + 0.045854 * z;
  const bC = -0.002079 * x + 0.048952 * y + 0.953127 * z;
  const rD = vc.rgbD[0] * rC;
  const gD = vc.rgbD[1] * gC;
  const bD = vc.rgbD[2] * bC;

  const rAF = Math.pow((vc.fl * Math.abs(rD)) / 100, 0.42);
  const gAF = Math.pow((vc.fl * Math.abs(gD)) / 100, 0.42);
  const bAF = Math.pow((vc.fl * Math.abs(bD)) / 100, 0.42);
  const rA = Math.sign(rD) * ((400 * rAF) / (rAF + 27.13));
  const gA = Math.sign(gD) * ((400 * gAF) / (gAF + 27.13));
  const bA = Math.sign(bD) * ((400 * bAF) / (bAF + 27.13));

  const a = (11 * rA - 12 * gA + bA) / 11;
  const b = (rA + gA - 2 * bA) / 9;
  const u = (20 * rA + 20 * gA + 21 * bA) / 20;
  const p2 = (40 * rA + 20 * gA + bA) / 20;

  let hue = (Math.atan2(b, a) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  else if (hue >= 360) hue -= 360;
  const hueRadians = (hue * Math.PI) / 180;

  const ac = p2 * vc.nbb;
  const j = 100 * Math.pow(ac / vc.aw, vc.c * vc.z);
  const eHue = 0.25 * (Math.cos(hueRadians + 2) + 3.8);
  const t = ((50000 / 13) * vc.nc * vc.ncb * eHue * Math.hypot(a, b)) / (u + 0.305);
  const alpha = Math.pow(t, 0.9) * Math.pow(1.64 - Math.pow(0.29, vc.n), 0.73);
  const chroma = alpha * Math.sqrt(j / 100);
  return { hue, chroma, j };
}

export const cam16FromInt = (argb: number, vc = DEFAULT_VIEWING_CONDITIONS): Cam16 => {
  const [x, y, z] = xyzFromArgb(argb);
  return cam16FromXyz(x, y, z, vc);
};

/** CAM16 (J, C, h) → XYZ（官方逆变换；牛顿求解器靠它把 tone 拉回 sRGB） */
export function xyzFromJch(j: number, chroma: number, hueRadians: number, vc: ViewingConditions = DEFAULT_VIEWING_CONDITIONS): [number, number, number] {
  const alpha = chroma === 0 || j === 0 ? 0 : chroma / Math.sqrt(j / 100);
  const t = Math.pow(alpha / Math.pow(1.64 - Math.pow(0.29, vc.n), 0.73), 1 / 0.9);
  const eHue = 0.25 * (Math.cos(hueRadians + 2) + 3.8);
  const p1 = eHue * (50000 / 13) * vc.nc * vc.ncb;
  /* 注意：正变换里 ac = p2 * nbb（j = 100·(ac/aw)^(cz)），所以这里解出的
     aw·(j/100)^(1/cz) 是 ac，要除回 nbb 才是线性方程组里的 p2（否则往返差 ~4%）。 */
  const p2 = (vc.aw * Math.pow(j / 100, 1 / vc.c / vc.z)) / vc.nbb;
  const hSin = Math.sin(hueRadians);
  const hCos = Math.cos(hueRadians);
  const gamma = (23 * (p2 + 0.305) * t) / (23 * p1 + 11 * t * hCos + 108 * t * hSin);
  const a = gamma * hCos;
  const b = gamma * hSin;
  const rA = (460 * p2 + 451 * a + 288 * b) / 1403;
  const gA = (460 * p2 - 891 * a - 261 * b) / 1403;
  const bA = (460 * p2 - 220 * a - 6300 * b) / 1403;
  const rCBase = Math.max(0, (27.13 * Math.abs(rA)) / (400 - Math.abs(rA)));
  const gCBase = Math.max(0, (27.13 * Math.abs(gA)) / (400 - Math.abs(gA)));
  const bCBase = Math.max(0, (27.13 * Math.abs(bA)) / (400 - Math.abs(bA)));
  const rC = Math.sign(rA) * (100 / vc.fl) * Math.pow(rCBase, 1 / 0.42);
  const gC = Math.sign(gA) * (100 / vc.fl) * Math.pow(gCBase, 1 / 0.42);
  const bC = Math.sign(bA) * (100 / vc.fl) * Math.pow(bCBase, 1 / 0.42);
  const rF = rC / vc.rgbD[0];
  const gF = gC / vc.rgbD[1];
  const bF = bC / vc.rgbD[2];
  const x = 1.86206786 * rF - 1.01125463 * gF + 0.14918677 * bF;
  const y = 0.38752654 * rF + 0.62144744 * gF - 0.00897398 * bF;
  const z = -0.0158415 * rF - 0.03412294 * gF + 1.04996444 * bF;
  return [x, y, z];
}

/* ══════════ HCT（色相 / 彩度 / 明度） ══════════ */

/** HCT → ARGB：官方口径是牛顿迭代解 Y(tone)，这里迭代到 |Δy| < 1e-4，再自检一次 */
export function argbFromHct(hue: number, chroma: number, tone: number, vc = DEFAULT_VIEWING_CONDITIONS): number {
  if (chroma < 0.0001 || tone < 0.0001 || tone > 99.9999) {
    /* 无彩度或极端明度：直接给灰阶（官方同口径） */
    const gray = clampInt(0, 255, delinearize(yFromLstar(tone)));
    return argbFromRgb(gray, gray, gray);
  }
  let h = hue % 360;
  if (h < 0) h += 360;
  const hueRadians = (h * Math.PI) / 180;
  const y = yFromLstar(tone);
  let j = Math.sqrt(y) * 11;
  for (let i = 0; i < 12; i++) {
    const [x1, y1, z1] = xyzFromJch(j, chroma, hueRadians, vc);
    if (Math.abs(y1 - y) < 1e-4) return argbFromXyz(x1, y1, z1);
    j -= ((y1 - y) * j) / (2 * y1);
    if (!(j > 0) || !Number.isFinite(j)) break;
  }
  /* 牛顿没收敛（极端彩度）：退化为「先按目标明度做近似，再夹回色域」 */
  const gray = delinearize(y);
  return argbFromRgb(gray, gray, gray);
}

export function hctFromArgb(argb: number): { hue: number; chroma: number; tone: number } {
  const cam = cam16FromInt(argb);
  return { hue: cam.hue, chroma: cam.chroma, tone: lstarFromArgb(argb) };
}

/* ══════════ TonalPalette（某一色相/彩度下取任意 tone） ══════════ */

export interface TonalPalette {
  hue: number;
  chroma: number;
  /** 取某一档 tone（0 黑 – 100 白）的 ARGB */
  tone: (t: number) => number;
}

export const tonalPalette = (hue: number, chroma: number): TonalPalette => ({
  hue,
  chroma,
  tone: (t: number) => argbFromHct(hue, chroma, t),
});

/* ══════════ Monet：源色 → 三条色调板 ══════════ */

export interface MonetPalettes {
  /** 源色的 HCT（调试/护栏用） */
  source: { hue: number; chroma: number; tone: number };
  primary: TonalPalette;
  secondary: TonalPalette;
  tertiary: TonalPalette;
  neutral: TonalPalette;
}

/**
 * 官方 CorePalette.of(argb) 的口径：primary 用源色色相 + 源色彩度；
 * secondary 同色相、彩度 /3；tertiary 色相 +60、彩度 /2；neutral 同色相、彩度 /20（下限 4）。
 * 这三条正好复现 MD3 基线（源 #6750A4 → #6750A4 / #625B71 / #7D5260）。
 */
export function palettesFromSource(argb: number): MonetPalettes {
  const source = hctFromArgb(argb);
  const hue = source.hue;
  const chroma = source.chroma;
  return {
    source,
    primary: tonalPalette(hue, chroma),
    secondary: tonalPalette(hue, chroma / 3),
    tertiary: tonalPalette(hue + 60, chroma / 2),
    neutral: tonalPalette(hue, Math.max(4, chroma / 20)),
  };
}

/* ══════════ 「我的」页渐变带用的色盘停点 ══════════ */

/**
 * 色盘停点口径：全部来自上面三条 Monet 板，不写死任何颜色。
 *   primary 板（源色相）取两档当主调，tertiary 板（色相 +60）取两档当色相变化，
 *   secondary 板（同色相、低彩度）当中间过渡——这样带子既认得出是主题色，又有色相流动，
 *   不是单色。换主题（含第三方主题插件）时整条带跟着换。
 * 明度都取在偏亮一侧（55–85）：这条带压在页面顶部当装饰，太暗会显脏。
 */
export const MINE_GRADIENT_TONES: { palette: "primary" | "secondary" | "tertiary"; tone: number }[] = [
  { palette: "primary", tone: 85 },
  { palette: "tertiary", tone: 70 },
  { palette: "primary", tone: 65 },
  { palette: "secondary", tone: 80 },
  { palette: "tertiary", tone: 55 },
];

export interface PaletteGradient {
  /** 源色（hex），护栏与调试用 */
  source: string;
  /** 停点颜色（hex，顺序与 MINE_GRADIENT_TONES 一致） */
  colors: string[];
}

/** 源色 hex → 渐变停点（纯函数，可单测/护栏直接跑） */
export function paletteGradientStops(sourceHex: string): PaletteGradient {
  const argb = argbFromHex(sourceHex);
  const p = palettesFromSource(argb);
  const colors = MINE_GRADIENT_TONES.map((s) => hexFromArgb(p[s.palette].tone(s.tone)));
  return { source: hexFromArgb(argb), colors };
}

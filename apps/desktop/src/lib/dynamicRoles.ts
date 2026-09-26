/**
 * 动态取色的角色映射（§3.4）——纯函数、无 I/O，单测见 tools/dynamic-color-test.mjs。
 *
 * 分工：原生侧只回「系统 Material You 调色板」（族 × 档位），映射在这里做。
 *   - 品牌族（accent1/accent2）与中性族（neutral1/neutral2）跟随取色；
 *   - 功能色（error / warning / success）与焦点环**不跟随**——「红=危险、琥珀=警告、绿=成功」
 *     是跨主题的语义约定，跟着壁纸变成紫色会直接伤可用性；
 *   - 面层级用 mix() 从基面派生：系统调色板的档位很稀疏（1000 → 900 是一大跳），
 *     直接取相邻档做卡片面会得到刺眼的分层。
 *
 * 档位：本模块内部一律用 **M3 tone**（0=黑 … 100=白）表达语义，由 makeLookup() 落到具体档位键。
 * **方向不能假设**：真机（Xiaomi / Android 16）实测 system_neutral1_10 = #FDFCFF（近白）、
 * system_neutral1_1000 = #000000（黑）——后缀与 tone 是反的；AOSP 的命名约定相反。
 * 所以运行时先从中性族两端自检方向，再按 tone 就近取档（档位稀疏时取最近的一档）。
 * 取不到的档位一律返回 null → 该角色不注入 → 保留 tokens.css 的默认值（厂商 ROM 裁档时安全）。
 */

export type DynamicPalette = Record<string, Record<string, string>>;

export interface DynamicRoles {
  light: Record<string, string>;
  dark: Record<string, string>;
}

const parseHex = (v: string | undefined): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec((v ?? "").trim());
  if (!m) return null;
  const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = (rgb: [number, number, number]): string =>
  "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");

/** sRGB 线性插值（与 CSS color-mix 的口径一致，够用且可单测） */
export function mix(a: string, b: string, ratio: number): string | null {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return null;
  return toHex([
    ca[0] + (cb[0] - ca[0]) * ratio,
    ca[1] + (cb[1] - ca[1]) * ratio,
    ca[2] + (cb[2] - ca[2]) * ratio,
  ]);
}

/** 十六进制 → rgba(...)（描边/骨架屏那些角色在令牌里本来就是半透明叠色） */
export function alpha(color: string, a: number): string | null {
  const c = parseHex(color);
  return c ? "rgba(" + c[0] + ", " + c[1] + ", " + c[2] + ", " + a + ")" : null;
}

/** 相对亮度（判断档位方向用） */
const lin = (v: number): number => {
  const x = v / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};
/** 相对亮度（判断档位方向用）——逐分量取值，元组下标在 noUncheckedIndexedAccess 下也是安全的 */
const relLum = (rgb: [number, number, number]): number =>
  0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);

/** 档位方向自检：低档更亮 → 后缀与 M3 tone 反向（真机 Android 16 实测如此） */
export function detectInverted(palette: DynamicPalette): boolean {
  const bag = palette?.neutral;
  if (!bag) return false;
  const keys = Object.keys(bag)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (keys.length < 2) return false;
  const lo = parseHex(bag[String(keys[0])]);
  const hi = parseHex(bag[String(keys[keys.length - 1])]);
  if (!lo || !hi) return false;
  return relLum(lo) > relLum(hi);
}

/** 取色器：族 + **M3 tone**（0…100）→ #rrggbb；缺失返回 null */
type Tone = (family: string, tone: number) => string | null;

/** 按 tone 就近取档：档位稀疏（0/10/50/100…）时取最接近的一档 */
function makeLookup(palette: DynamicPalette): Tone {
  const inverted = detectInverted(palette);
  return (family, tone) => {
    const bag = palette?.[family];
    if (!bag) return null;
    const keys = Object.keys(bag)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (!keys.length) return null;
    const target = inverted ? 1000 - tone * 10 : tone * 10;
    let best = keys[0] as number;
    for (const k of keys) if (Math.abs(k - target) < Math.abs(best - target)) best = k;
    const v = bag[String(best)];
    return typeof v === "string" && parseHex(v) ? (v.startsWith("#") ? v : "#" + v) : null;
  };
}

interface Spec {
  /** 该组依赖的族：缺了就不产出这一组（避免"半跟随"的诡异观感） */
  needs: string[];
  role: string;
  light: (t: Tone) => string | null;
  dark: (t: Tone) => string | null;
}

/* 中性面在两种模式下的叠色方向相反：亮色往深里调，暗色往浅里调 */
const SURFACE_STEPS: Array<[string, number, number]> = [
  // [角色, 亮色叠色比例, 暗色叠色比例]
  ["surface-container-lowest", 0, 0.1],
  ["surface-container-low", 0.05, 0.18],
  ["surface-container", 0.07, 0.26],
  ["surface-container-high", 0.16, 0.34],
];

const SPECS: Spec[] = [
  /* ---------- 品牌族 ---------- */
  { needs: ["primary"], role: "primary", light: (t) => t("primary", 40), dark: (t) => t("primary", 80) },
  {
    needs: ["primary"],
    role: "primary-hover",
    // MD3 没有 hover 色：用 12% 状态层叠色（亮色向 on-primary=白 偏亮，暗色向 20 号深档偏暗）
    light: (t) => {
      const p = t("primary", 40);
      const on = t("primary", 100);
      return p && on ? mix(p, on, 0.12) : null;
    },
    dark: (t) => {
      const p = t("primary", 80);
      const on = t("primary", 20);
      return p && on ? mix(p, on, 0.12) : null;
    },
  },
  { needs: ["primary"], role: "on-primary", light: (t) => t("primary", 100), dark: (t) => t("primary", 20) },
  { needs: ["secondary"], role: "secondary", light: (t) => t("secondary", 40), dark: (t) => t("secondary", 80) },
  {
    needs: ["secondary"],
    role: "secondary-container",
    light: (t) => t("secondary", 90),
    dark: (t) => t("secondary", 30),
  },
  {
    needs: ["secondary"],
    role: "secondary-container-border",
    light: (t) => {
      const c = t("secondary", 90);
      const s = t("secondary", 40);
      return c && s ? mix(c, s, 0.35) : null;
    },
    dark: (t) => {
      const c = t("secondary", 30);
      const s = t("secondary", 80);
      return c && s ? mix(c, s, 0.35) : null;
    },
  },

  /* ---------- 中性族：面 ---------- */
  { needs: ["neutral"], role: "surface", light: (t) => t("neutral", 1000), dark: (t) => t("neutral", 10) },
  ...SURFACE_STEPS.map(([role, lightStep, darkStep]): Spec => ({
    needs: ["neutral"],
    role,
    light: (t) => {
      const base = t("neutral", 100);
      const tint = t("neutral", 90);
      if (!base) return null;
      return lightStep === 0 ? base : tint ? mix(base, tint, lightStep) : null;
    },
    dark: (t) => {
      const base = t("neutral", 10);
      const tint = t("neutral", 30);
      if (!base) return null;
      return darkStep === 0 ? base : tint ? mix(base, tint, darkStep) : null;
    },
  })),
  {
    needs: ["neutral"],
    role: "skeleton",
    light: (t) => {
      const on = t("neutral", 10);
      return on ? alpha(on, 0.04) : null;
    },
    dark: (t) => {
      const on = t("neutral", 90);
      return on ? alpha(on, 0.06) : null;
    },
  },

  /* ---------- 中性族：文字与描边 ---------- */
  { needs: ["neutral"], role: "on-surface", light: (t) => t("neutral", 10), dark: (t) => t("neutral", 90) },
  {
    needs: ["neutralVariant"],
    role: "on-surface-variant",
    light: (t) => t("neutralVariant", 30),
    dark: (t) => t("neutralVariant", 80),
  },
  { needs: ["neutralVariant"], role: "outline", light: (t) => t("neutralVariant", 50), dark: (t) => t("neutralVariant", 60) },
  {
    needs: ["neutral"],
    role: "on-surface-disabled",
    light: (t) => t("neutral", 80),
    dark: (t) => t("neutral", 20),
  },
  /* 描边与状态层在令牌里本就是「on-surface + 透明度」的叠色，所以跟着 on-surface 走 */
  {
    needs: ["neutral"],
    role: "outline-variant",
    light: (t) => {
      const on = t("neutral", 10);
      return on ? alpha(on, 0.1) : null;
    },
    dark: (t) => {
      const on = t("neutral", 90);
      return on ? alpha(on, 0.1) : null;
    },
  },
  {
    needs: ["neutral"],
    role: "outline-soft",
    light: (t) => {
      const on = t("neutral", 10);
      return on ? alpha(on, 0.04) : null;
    },
    dark: (t) => {
      const on = t("neutral", 90);
      return on ? alpha(on, 0.05) : null;
    },
  },
  {
    needs: ["neutral"],
    role: "outline-strong",
    light: (t) => {
      const on = t("neutral", 10);
      return on ? alpha(on, 0.16) : null;
    },
    dark: (t) => {
      const on = t("neutral", 90);
      return on ? alpha(on, 0.18) : null;
    },
  },
  {
    needs: ["neutral"],
    role: "state-hover",
    light: (t) => {
      const on = t("neutral", 10);
      return on ? alpha(on, 0.06) : null;
    },
    dark: (t) => {
      const on = t("neutral", 90);
      return on ? alpha(on, 0.06) : null;
    },
  },
  {
    needs: ["neutral"],
    role: "state-pressed",
    light: (t) => {
      const on = t("neutral", 10);
      return on ? alpha(on, 0.1) : null;
    },
    dark: (t) => {
      const on = t("neutral", 90);
      return on ? alpha(on, 0.1) : null;
    },
  },
];

/** 骨架屏流光在两种模式下都是"白光扫过"，与取色无关，故写死（与令牌基线同值） */
const SKELETON_SHINE = { light: "rgba(255, 255, 255, 0.6)", dark: "rgba(255, 255, 255, 0.12)" };

export function rolesFromPalette(palette: DynamicPalette): DynamicRoles {
  const tone = makeLookup(palette);
  const has = (family: string): boolean => Object.keys(palette?.[family] ?? {}).length > 0;

  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  for (const spec of SPECS) {
    if (!spec.needs.every(has)) continue;
    const l = spec.light(tone);
    const d = spec.dark(tone);
    if (l) light["--md-sys-color-" + spec.role] = l;
    if (d) dark["--md-sys-color-" + spec.role] = d;
  }
  /* 面在，才有骨架屏；没有面就整体不注入，避免"半套"配色 */
  if (has("neutral")) {
    light["--md-sys-color-skeleton-shine"] = SKELETON_SHINE.light;
    dark["--md-sys-color-skeleton-shine"] = SKELETON_SHINE.dark;
  }
  return { light, dark };
}

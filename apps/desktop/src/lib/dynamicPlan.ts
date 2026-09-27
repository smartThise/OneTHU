/**
 * 取色开关的状态机（§3.4）——纯函数、无 I/O，单测见 tools/dynamic-color-test.mjs。
 *
 * **不变量：开启一定要真的开启。** 系统提供不了调色板时（Windows 桌面 / Android < 12 /
 * ROM 裁掉调色板）降级到「清华紫」主题并把开关置为开；否则会出现
 * 「点了开关、主题变了、开关还是关的、也回不去」的死结——Windows 侧实测到过这个 bug：
 * 旧实现走降级分支时 writePref(false) 且返回 false，开关被写成关，
 * 用户再点只会重复把主题刷成清华紫，永远回不到原来的主题。
 *
 * 快照（被顶掉的主题）只在**用户主动开启**时覆盖：
 * 开机自举时主题已被上一轮让位（activeThemeId() 为 null），覆盖等于把用户真正选的主题弄丢
 * （真机残留过一次 restore=violet 配 pref=0；那种状态再关掉会把「跟随昼夜」的用户错误地拉到 violet）。
 */
import type { DynamicPalette } from "./dynamicRoles.js";

/** 调色板是否可用（空对象也算不可用） */
export const paletteUsable = (p: DynamicPalette | null): boolean => !!p && Object.keys(p).length > 0;

export interface DynamicPlan {
  /** palette = 真取色；fallback = 系统给不了调色板，改用「清华紫」主题 */
  mode: "palette" | "fallback";
  /** 是否覆盖「被顶掉的主题」快照 */
  touchRestore: boolean;
  /** 快照值（touchRestore 为 true 时写入，null = 清空，关掉开关时接回昼夜调度） */
  restoreTo: string | null;
}

export function dynamicPlan(usable: boolean, alreadyOn: boolean, activeTheme: string | null): DynamicPlan {
  return {
    mode: usable ? "palette" : "fallback",
    touchRestore: !alreadyOn,
    restoreTo: alreadyOn ? null : activeTheme,
  };
}

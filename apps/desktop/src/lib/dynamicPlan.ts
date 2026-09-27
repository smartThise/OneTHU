/**
 * 取色开关的状态机（§3.4）——纯函数、无 I/O，单测见 tools/dynamic-color-test.mjs。
 *
 * **不变量：开启一定要真的开启。** 系统提供不了调色板时（Windows 桌面 / Android < 12 /
 * ROM 裁掉调色板）降级到「清华紫」主题并把开关置为开；否则会出现
 * 「点了开关、主题变了、开关还是关的、也回不去」的死结——Windows 侧实测到过这个 bug：
 * 旧实现走降级分支时 writePref(false) 且返回 false，开关被写成关，
 * 用户再点只会重复把主题刷成清华紫，永远回不到原来的主题。
 *
 * 快照只在**用户主动开启**时覆盖：开机自举时主题已被上一轮让位，覆盖等于把用户真正选的主题弄丢
 * （真机残留过一次 restore=violet 配 pref=0；那种状态再关掉会把「跟随昼夜」的用户错误地拉到 violet）。
 *
 * **快照必须能表达"用户当时没选主题（基础令牌）"**：早期版本用"id 或 null"表示，
 * "记的是 null"与"没记过快照"无法区分；再叠加降级分支把 activeId 占成了清华紫，
 * 关掉开关就停在清华紫不动——用户看到的正是「要手动再选一次才刷新」（Windows 侧反馈）。
 * 所以这里用 { action } 判别式把两种含义分开，activeId 允许为 null。
 */
import type { DynamicPalette } from "./dynamicRoles.js";

/** 调色板是否可用（空对象也算不可用） */
export const paletteUsable = (p: DynamicPalette | null): boolean => !!p && Object.keys(p).length > 0;

export interface DynamicPlan {
  /** palette = 真取色；fallback = 系统给不了调色板，改用「清华紫」主题 */
  mode: "palette" | "fallback";
  /** keep = 保留已存快照（开机自举）；set = 按用户开启时的状态覆盖 */
  restore: { action: "keep" } | { action: "set"; activeId: string | null };
}

export function dynamicPlan(usable: boolean, alreadyOn: boolean, activeTheme: string | null): DynamicPlan {
  return {
    mode: usable ? "palette" : "fallback",
    restore: alreadyOn ? { action: "keep" } : { action: "set", activeId: activeTheme },
  };
}

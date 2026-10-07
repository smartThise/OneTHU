/**
 * 双端布局断点：**全应用唯一来源**（UI/UX 改造方案 §2.8.1）。
 *
 * 三档（禁止组件各写一份 matchMedia，也禁止再出现 860/861 这类散落魔数）：
 *   compact  < 600px   手机竖屏：底部 5 Tab，单列
 *   medium   600–840   手机横屏/平板竖屏/小窗：底部 Tab 保持，内容单列 ≤600 居中（过渡态）
 *   expanded ≥ 840px   PC/平板横屏：侧边栏壳
 *
 * CSS 侧与这里一一对应：媒体查询用 max-width: 839.98px / min-width: 840px，
 * 避免 839.5px 这类小数宽度落在两档之间。
 */
export const BP = { medium: 600, expanded: 840 } as const;

export type PlatformLayout = "compact" | "medium" | "expanded";

/** 由视口宽度判定档位（纯函数，便于单测） */
export function platformOf(width: number): PlatformLayout {
  if (width < BP.medium) return "compact";
  if (width < BP.expanded) return "medium";
  return "expanded";
}

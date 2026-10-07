/**
 * 断点订阅 hook（唯一读取点，§2.8.1）。
 * 组件一律 `usePlatformLayout()` / `useExpanded()`，不要各自 matchMedia——
 * 之前 Layout / Today / TasksPage 各写一份，断点还分别是 860 / 1080，改一处必漏三处。
 */
import { useEffect, useState } from "react";
import { BP, platformOf, type PlatformLayout } from "./platform.js";

export function usePlatformLayout(): PlatformLayout {
  const [layout, setLayout] = useState<PlatformLayout>(() =>
    typeof window === "undefined" ? "expanded" : platformOf(window.innerWidth),
  );
  useEffect(() => {
    const queries = [
      window.matchMedia(`(min-width: ${BP.medium}px)`),
      window.matchMedia(`(min-width: ${BP.expanded}px)`),
    ];
    const sync = (): void => setLayout(platformOf(window.innerWidth));
    sync();
    for (const q of queries) q.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      for (const q of queries) q.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);
  return layout;
}

/** PC/平板横屏档（≥840px）：侧边栏壳、双栏页面 */
export function useExpanded(): boolean {
  return usePlatformLayout() === "expanded";
}

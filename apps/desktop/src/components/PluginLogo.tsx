/** 插件 logo 统一解析点：assets/plugins/<id>.svg 即图片 logo（白底方图约定），
 *  无资产回退到双字母针脚。新增插件 logo = 往该目录放一个 <id>.svg，零代码。 */
import { type ReactNode } from "react";

const logos = import.meta.glob("../assets/plugins/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export function pluginLogoUrl(id: string): string | null {
  return logos[`../assets/plugins/${id}.svg`] ?? null;
}

export function PluginLogo({ id, fallback }: { id: string; fallback: ReactNode }): ReactNode {
  const url = pluginLogoUrl(id);
  if (!url) return <>{fallback}</>;
  return <img className="plg-logo" src={url} alt="" draggable={false} />;
}

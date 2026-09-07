/** 插件 logo 统一解析点：logo 随插件包走（plugins/<id>/logo.svg|png），
 *  由宿主读取转 dataURL；无 logo 回退双字母针脚。第三方插件包内自带即生效。 */
import { useEffect, useState, type ReactNode } from "react";

const cache = new Map<string, string | null>();
const pend = new Map<string, Promise<string | null>>();

function load(id: string): Promise<string | null> {
  const hit = cache.get(id);
  if (hit !== undefined) return Promise.resolve(hit);
  let p = pend.get(id);
  if (!p) {
    p = (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const data = await invoke<string | null>("plugin_logo_data", { id });
        cache.set(id, data);
        return data;
      } catch {
        cache.set(id, null);
        return null;
      } finally {
        pend.delete(id);
      }
    })();
    pend.set(id, p);
  }
  return p;
}

export function PluginLogo({ id, fallback }: { id: string; fallback: ReactNode }): ReactNode {
  const [url, setUrl] = useState<string | null | undefined>(cache.get(id));
  useEffect(() => {
    let alive = true;
    if (url === undefined) {
      void load(id).then((u) => {
        if (alive) setUrl(u);
      });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (url === undefined || url === null) return <>{fallback}</>;
  return <img className="plg-logo" src={url} alt="" draggable={false} />;
}

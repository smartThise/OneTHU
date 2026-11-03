import { useLocale as useUiLocale } from "../../i18n/index.js";
/**
 * 壁纸渲染件（2026-10-13 二期）：
 * - WallpaperVideoBox：动态壁纸 <video> 层（自动播放 / 循环 / 静音起播；inactive 面板暂停省电）。
 *   浏览器自动播放策略要求先静音起播——声音开关（设置→外观，默认关）在用户手势的渲染里
 *   才放开 muted，放开动作天然在手势上下文内。画面上固定叠 20% 暗纱保证内容可读。
 * - ShellWallpaperLayer：壳层「全屏档」壁纸——挂在 .explorer-shell 首位，fixed 铺满、
 *   z-index 在栏体之下/内容之下（栏体玻璃透出它）；同时给 shell 挂 has-shell-wallpaper
 *   与 data-wallpaper-lum="dark|light"，栏体玻璃与文字色据此分支（见 explorer.css）。
 */
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import {
  displayRef,
  ensureWallpaperLum,
  shellWallpaperSnapshot,
  subscribeWallpaper,
  videoSoundSnapshot,
} from "../../state/wallpaper.js";
import { preblurWallpaper } from "../../lib/preblur.js";

export function WallpaperVideoBox({
  src,
  sound,
  active,
}: {
  src: string;
  sound: boolean;
  active: boolean;
}): ReactNode {
  const uiLocale = useUiLocale();

  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) void v.play().catch(() => undefined);
    else v.pause();
  }, [active, src]);
  return (
    <div className="wall-video-layer" aria-hidden="true">
      <video ref={ref} src={displayRef(src)} autoPlay muted={!sound} loop playsInline />
      <div className="wall-video-veil" />
    </div>
  );
}

export function ShellWallpaperLayer(): ReactNode {
  const uiLocale = useUiLocale();

  const wp = useSyncExternalStore(subscribeWallpaper, shellWallpaperSnapshot, shellWallpaperSnapshot);
  const sound = useSyncExternalStore(subscribeWallpaper, videoSoundSnapshot, videoSoundSnapshot);
  const anchor = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const vars = ["--og-prebblur-deep", "--og-prebblur-rich", "--og-prebblur-clear"] as const;
    let cancelled = false;
    let timer = 0;
    const clear = (): void => {
      root.removeAttribute("data-og-prebblur");
      for (const key of vars) root.style.removeProperty(key);
    };
    if (!wp || wp.kind !== "image") {
      clear();
      return clear;
    }
    timer = window.setTimeout(() => {
      void preblurWallpaper(wp.ref).then((set) => {
        if (cancelled) return;
        root.style.setProperty("--og-prebblur-deep", `url("${set.deep}")`);
        root.style.setProperty("--og-prebblur-rich", `url("${set.rich}")`);
        root.style.setProperty("--og-prebblur-clear", `url("${set.clear}")`);
        root.setAttribute("data-og-prebblur", "on");
      }).catch(clear);
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clear();
    };
  }, [wp]);
  useEffect(() => {
    const shell = anchor.current?.parentElement;
    if (!shell) return;
    if (!wp) {
      shell.removeAttribute("data-wallpaper-lum");
      shell.classList.remove("has-shell-wallpaper");
      return;
    }
    shell.classList.add("has-shell-wallpaper");
    shell.setAttribute("data-wallpaper-lum", wp.lum);
    /* 图片壁纸：确保亮度已采样（算完发变更，纱与文字分支自动收敛） */
    if (wp.kind === "image") ensureWallpaperLum(wp.ref);
  }, [wp]);
  return (
    <div ref={anchor} className="shell-wallpaper" aria-hidden="true">
      {wp && wp.kind === "video" ? <WallpaperVideoBox src={wp.ref} sound={sound} active /> : null}
      {wp && wp.kind !== "video" ? (
        <div className="shell-wallpaper-img" style={{ backgroundImage: wp.backgroundImage ?? undefined }} />
      ) : null}
    </div>
  );
}

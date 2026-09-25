/**
 * 手机端「长按看图」。
 *
 * 正文图片（网络学堂通知/作业/讨论区、信息门户成绩单与校历、文件预览里的图片）在手机上
 * 只能缩在流里看：小字看不清，也没有任何存下来的办法。长按图片 → 单独一屏看这张图：
 * 双指缩放、单指拖动，底部「保存图片」写进系统相册，单击任意处退出。
 *
 * 为什么不交给 WebView 自带的长按菜单：原生菜单只有「下载图片」，落点是浏览器的下载
 * 目录，相册里看不到；而且正文图片的 src 是应用侧带会话抓来的 dataURL，交给系统下载器
 * 等于把会话资源从 WebView 里再复制一份出去。
 *
 * 纪律（与 TextPeek 同一套）：
 *  1) 只在真机密度层（html.is-phone：触屏 + 窄窗）挂行为，桌面完全不受影响；
 *  2) 长按与滚动/双指互斥：位移超过 12px 或出现第二根手指即取消，滚动列表不会误开；
 *  3) 小图标不参与（渲染尺寸 < 44px 或原始尺寸 < 48px）——插件 logo、行内图标仍保留
 *     系统长按菜单；
 *  4) 富文本编辑器（contenteditable）里的图片不参与——那里的长按是选词与图片操作；
 *  5) 长按开图这一下必须吞掉后续 click，否则松手会把底下的行/卡片一并点开（同 TextPeek）。
 *
 * 安卓返回键：wry 的返回回调只做 `webView.goBack()`（没有给 JS 的钩子），而应用路由只听
 * `hashchange`。因此开图时压入一层**URL 与当前完全相同**的历史条目：返回键弹回这层时
 * hash 没变、路由不动，却有一个 `popstate` 可用来关浮层——返回键先退出看图，再按才回上一级。
 * 点按关闭时要把这层弹掉（history.back），否则下一次返回键会被这层空条目吃掉。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { saveImageToGallery } from "../lib/imageSave.js";
import { showToast } from "../state/toast.js";

/** 写在 history.state 里的看图标记：返回键靠它认出「弹掉的是看图这一层」 */
const VIEWER_STATE = "onethu-imgview";

/** 按住多久算长按：原生上下文菜单约 500ms 弹出，必须更早接管 */
const LONGPRESS_MS = 400;
/** 长按期间允许的位移（滚动会立刻超出这个值） */
const LONGPRESS_SLOP_PX = 12;
/** 单击判定：位移上限。时长上限取得很宽——浮层里的长按没有别的语义，用户按得慢也算单击 */
const TAP_SLOP_PX = 10;
const TAP_MAX_MS = 1200;
/** 参与长按的图片：渲染尺寸 / 原始尺寸下限 */
const MIN_RENDER_PX = 44;
const MIN_NATURAL_PX = 48;
/** 缩放范围 */
const MIN_SCALE = 1;
const MAX_SCALE = 6;
/** 浮层层级：压住页面与预览弹窗（1000）、底部弹层（9990–9992），
 *  但让轻提示（9996）压得住——保存结果必须看得见 */
const Z_VIEW = 9993;

/** 真机密度标记由 main.tsx 挂在 <html> 上；桌面永不命中 */
function isPhoneMode(): boolean {
  return document.documentElement.classList.contains("is-phone");
}

/** 编辑器里的图片不参与（Quill 等富文本根的 contenteditable） */
function inEditor(el: Element): boolean {
  return !!el.closest('[contenteditable=""],[contenteditable="true"]');
}

/** 这张图此刻是否值得长按看图（失败的图、占位图、小图标都不算） */
function isViewable(img: HTMLImageElement): boolean {
  const src = img.currentSrc || img.src || "";
  if (!/^(data:|blob:|https?:)/i.test(src)) return false;
  if (img.naturalWidth < MIN_NATURAL_PX || img.naturalHeight < MIN_NATURAL_PX) return false;
  const r = img.getBoundingClientRect();
  if (r.width < MIN_RENDER_PX || r.height < MIN_RENDER_PX) return false;
  if (inEditor(img)) return false;
  const cs = getComputedStyle(img);
  return cs.visibility === "visible" && cs.display !== "none";
}

type Shot = { src: string; alt: string };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function ImageViewerHost(): ReactNode {
  const [shot, setShot] = useState<Shot | null>(null);
  /** 浮层是否开着：事件回调里要同步读，不能等 state 回流 */
  const openRef = useRef(false);
  /** 是否压着一层看图历史条目（返回键靠它接住） */
  const pushedRef = useRef(false);

  /** 收起浮层本身（不碰历史） */
  const hide = useCallback((): void => {
    openRef.current = false;
    setShot(null);
  }, []);

  const open = useCallback((img: HTMLImageElement): void => {
    openRef.current = true;
    setShot({ src: img.currentSrc || img.src, alt: img.getAttribute("alt") ?? "" });
    // 同 URL 的历史条目：返回键弹回它时路由不变，只多出一个 popstate（见文件头说明）
    try {
      history.pushState(VIEWER_STATE, "", location.href);
      pushedRef.current = true;
    } catch {
      // 历史不可用（极端情况）：退化成只能点按关闭，不影响看图
      pushedRef.current = false;
    }
  }, []);

  const close = useCallback((): void => {
    // 点按关闭：把刚压进去的那层弹掉，否则下一次返回键会被这层空条目吃掉。
    // 先确认栈顶确实是看图条目——看图期间若被程序化导航压了别的条目，弹它就会误改页面。
    if (pushedRef.current) {
      pushedRef.current = false;
      if (history.state === VIEWER_STATE) history.back();
    }
    hide();
  }, [hide]);

  /** 安卓返回键：弹掉看图这一层就退出看图，再按才回上一级 */
  useEffect(() => {
    // 上次运行留下的空条目（例如看图时进程被杀、重启后恢复历史）：先清掉，别吃返回键
    if (history.state === VIEWER_STATE) history.replaceState(null, "", location.href);
    const onPop = (e: PopStateEvent): void => {
      if (e.state === VIEWER_STATE) return; // 前进回到看图条目：不关
      if (!openRef.current) {
        pushedRef.current = false;
        return;
      }
      pushedRef.current = false; // 条目已由返回键弹掉，这里不能再 back()
      hide();
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [hide]);

  /** 看图期间在 <html> 上打标记：右下角常驻的刷新按钮层级高于浮层，靠这个类把它收起来 */
  useEffect(() => {
    document.documentElement.classList.toggle("imgview-open", !!shot);
    return () => document.documentElement.classList.remove("imgview-open");
  }, [shot]);

  useEffect(() => {
    /** 按住中的候选图（计时器到点即开图） */
    let candidate: { img: HTMLImageElement; x: number; y: number } | null = null;
    let timer = 0;
    /** 这一次手势已经开了图：随之而来的 touchend / click 一律吞掉 */
    let fired = false;

    const cancel = (): void => {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      candidate = null;
    };

    const onTouchStart = (e: TouchEvent): void => {
      if (!isPhoneMode() || openRef.current) return;
      cancel();
      fired = false;
      if (e.touches.length > 1) return;
      const hit = e.target instanceof Element ? e.target.closest("img") : null;
      if (!(hit instanceof HTMLImageElement) || !isViewable(hit)) return;
      const t = e.touches[0];
      if (!t) return;
      candidate = { img: hit, x: t.clientX, y: t.clientY };
      timer = window.setTimeout(() => {
        timer = 0;
        const c = candidate;
        candidate = null;
        if (!c || !c.img.isConnected) return;
        fired = true;
        open(c.img);
      }, LONGPRESS_MS);
    };

    const onTouchMove = (e: TouchEvent): void => {
      if (!candidate) return;
      if (e.touches.length > 1) {
        cancel();
        return;
      }
      const t = e.touches[0];
      if (!t) {
        cancel();
        return;
      }
      if (
        Math.abs(t.clientX - candidate.x) > LONGPRESS_SLOP_PX ||
        Math.abs(t.clientY - candidate.y) > LONGPRESS_SLOP_PX
      ) {
        cancel();
      }
    };

    const onTouchEnd = (e: TouchEvent): void => {
      cancel();
      if (!fired) return;
      fired = false;
      // 松手这一下不许再变成 click（否则底下的行会被点开）
      e.preventDefault();
    };

    /**
     * 原生长按菜单是本功能唯一的正面冲突：候选期与看图期一律拦掉。
     * 其余元素保持原样——正文选词、链接菜单都还要用系统的那一套。
     */
    const onContextMenu = (e: MouseEvent): void => {
      if (!isPhoneMode()) return;
      const hit = e.target instanceof Element ? e.target.closest("img") : null;
      const onTarget = hit instanceof HTMLImageElement && isViewable(hit);
      if (openRef.current || candidate || fired || onTarget) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    /** 兜底：个别内核上 touchend 的 preventDefault 压不住 synthetic click */
    const onClickCapture = (e: MouseEvent): void => {
      if (!fired) return;
      fired = false;
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    document.addEventListener("touchcancel", cancel, { capture: true, passive: true });
    document.addEventListener("scroll", cancel, { capture: true, passive: true });
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      document.removeEventListener("touchstart", onTouchStart, { capture: true });
      document.removeEventListener("touchmove", onTouchMove, { capture: true });
      document.removeEventListener("touchend", onTouchEnd, { capture: true });
      document.removeEventListener("touchcancel", cancel, { capture: true });
      document.removeEventListener("scroll", cancel, { capture: true });
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("click", onClickCapture, true);
      cancel();
    };
  }, [open]);

  if (!shot) return null;
  return <Viewer shot={shot} onClose={close} />;
}

/** 手势状态：单指按下的落点/起点位移量，双指的距离与中点（焦点保持要用） */
interface Gesture {
  mode: "idle" | "tap" | "pan" | "pinch";
  multi: boolean;
  startX: number;
  startY: number;
  startT: number;
  baseX: number;
  baseY: number;
  baseScale: number;
  pinchDist: number;
  pinchCx: number;
  pinchCy: number;
}

function Viewer({ shot, onClose }: { shot: Shot; onClose: () => void }): ReactNode {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  /** 当前缩放与位移（直接写进 style，不走 state——手势期间每帧都要改） */
  const view = useRef({ scale: 1, x: 0, y: 0 });
  const gesture = useRef<Gesture>({
    mode: "idle",
    multi: false,
    startX: 0,
    startY: 0,
    startT: 0,
    baseX: 0,
    baseY: 0,
    baseScale: 1,
    pinchDist: 0,
    pinchCx: 0,
    pinchCy: 0,
  });
  const [saving, setSaving] = useState(false);

  /** 退出：先把缩放复位，下次打开是原图大小 */
  const shut = useCallback((): void => {
    view.current = { scale: 1, x: 0, y: 0 };
    onClose();
  }, [onClose]);

  /** 位移夹取：放大后可以拖到边，但不许把图整个拖出屏幕 */
  const clampXY = useCallback((scale: number, x: number, y: number): [number, number] => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage) return [x, y];
    const overX = Math.max(0, (img.offsetWidth * scale - stage.clientWidth) / 2);
    const overY = Math.max(0, (img.offsetHeight * scale - stage.clientHeight) / 2);
    return [clamp(x, -overX - 24, overX + 24), clamp(y, -overY - 24, overY + 24)];
  }, []);

  const paint = useCallback((): void => {
    const img = imgRef.current;
    if (!img) return;
    const v = view.current;
    img.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.scale})`;
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const g = gesture.current;
    const v = view.current;

    /** 前两根手指（不足两根返回 null） */
    const two = (e: TouchEvent): [Touch, Touch] | null => {
      const a = e.touches[0];
      const b = e.touches[1];
      return a && b ? [a, b] : null;
    };
    const distance = (a: Touch, b: Touch): number => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const midpoint = (a: Touch, b: Touch): { x: number; y: number } => ({
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
    });

    /** 以当前位置为新起点重设手势基准（视角本身不动） */
    const rebase = (x: number, y: number): void => {
      g.startX = x;
      g.startY = y;
      g.baseX = v.x;
      g.baseY = v.y;
      g.baseScale = v.scale;
    };

    const beginPinch = (pair: [Touch, Touch]): void => {
      const [a, b] = pair;
      const m = midpoint(a, b);
      g.mode = "pinch";
      g.multi = true;
      g.pinchDist = Math.max(1, distance(a, b));
      g.pinchCx = m.x;
      g.pinchCy = m.y;
      g.baseScale = v.scale;
      g.baseX = v.x;
      g.baseY = v.y;
    };

    const onStart = (e: TouchEvent): void => {
      const pair = e.touches.length >= 2 ? two(e) : null;
      if (pair) {
        beginPinch(pair);
        e.preventDefault();
        return;
      }
      const t = e.touches[0];
      if (!t) return;
      g.mode = "tap";
      g.startT = Date.now();
      rebase(t.clientX, t.clientY);
    };

    const onMove = (e: TouchEvent): void => {
      if (g.mode === "idle") return;
      // 看图期间浏览器不许插手：不滚页面、不做它自己的双指缩放
      e.preventDefault();

      const pair = e.touches.length >= 2 ? two(e) : null;
      if (pair) {
        if (g.mode !== "pinch") {
          beginPinch(pair);
          return;
        }
        const [a, b] = pair;
        const dist = Math.max(1, distance(a, b));
        const scale = clamp((g.baseScale * dist) / g.pinchDist, MIN_SCALE, MAX_SCALE);
        const stage = stageRef.current;
        if (!stage) return;
        // 焦点保持：双指中点下的那个内容点，整个手势里始终跟着中点走
        const rect = stage.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const ratio = scale / g.baseScale;
        const m = midpoint(a, b);
        const [x, y] = clampXY(
          scale,
          m.x - ratio * (g.pinchCx - cx - g.baseX) - cx,
          m.y - ratio * (g.pinchCy - cy - g.baseY) - cy,
        );
        v.scale = scale;
        v.x = x;
        v.y = y;
        paint();
        return;
      }

      const t = e.touches[0];
      if (!t) return;
      if (g.mode === "pinch") {
        // 双指松掉一根：以当前位置为新的起点继续拖
        g.mode = "pan";
        rebase(t.clientX, t.clientY);
        return;
      }
      const dx = t.clientX - g.startX;
      const dy = t.clientY - g.startY;
      if (g.mode === "tap" && (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX)) g.mode = "pan";
      if (g.mode !== "pan" || v.scale <= MIN_SCALE) return;
      const [x, y] = clampXY(v.scale, g.baseX + dx, g.baseY + dy);
      v.x = x;
      v.y = y;
      paint();
    };

    const onEnd = (e: TouchEvent): void => {
      if (g.mode === "idle") return;
      if (e.touches.length > 0) {
        // 还有手指按着（双指松掉一根）：不判定单击，直接转拖动
        if (g.mode === "pinch") {
          const t = e.touches[0];
          if (t) {
            g.mode = "pan";
            rebase(t.clientX, t.clientY);
          }
        }
        return;
      }
      const tap = g.mode === "tap" && !g.multi && Date.now() - g.startT <= TAP_MAX_MS;
      const onButton = e.target instanceof Element && !!e.target.closest(".imgview-save");
      g.mode = "idle";
      g.multi = false;
      // 单击任意处退出；只有「保存图片」按钮吃掉的这一下不算
      if (tap && !onButton) shut();
    };

    const onCancel = (): void => {
      g.mode = "idle";
      g.multi = false;
    };

    root.addEventListener("touchstart", onStart, { passive: false });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd, { passive: false });
    root.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onCancel);
    };
  }, [clampXY, paint, shut]);

  const save = useCallback((): void => {
    setSaving(true);
    void saveImageToGallery(shot.src, shot.alt)
      .then(() => showToast("已保存到相册", 3000))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(`保存失败：${msg}`, 9000);
      })
      .finally(() => setSaving(false));
  }, [shot]);

  return createPortal(
    <div className="imgview" ref={rootRef} style={{ zIndex: Z_VIEW }} role="dialog" aria-modal="true" aria-label="查看图片">
      <div className="imgview-stage" ref={stageRef}>
        <img className="imgview-img" ref={imgRef} src={shot.src} alt="" draggable={false} />
      </div>
      <div className="imgview-bar">
        <button
          type="button"
          className="btn imgview-save"
          disabled={saving}
          onClick={(e) => {
            e.stopPropagation();
            save();
          }}
        >
          {saving ? "保存中" : "保存图片"}
        </button>
      </div>
    </div>,
    document.body,
  );
}

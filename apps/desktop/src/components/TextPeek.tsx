/**
 * 手机端「双击看全文」。
 *
 * 被 text-overflow: ellipsis / -webkit-line-clamp 截断的文本，在真机上既看不全、
 * 也复制不了。双击它 → 在文本旁弹出一块浮层：整段文本换行显示（撑不下时浮层内部
 * 滚动），并且保持可选中（长按出系统复制菜单）。
 *
 * 为什么不用 dblclick 了事：
 *  1) Android WebView 的双击默认被浏览器当成「双击缩放」手势吃掉，等不到可用的
 *     dblclick；
 *  2) 被截断的文本多半挂在可点击行里（课程名 / 插件名 / 日程标题），第一次点按就
 *     会把行点开跳走，根本等不到第二次点按。所以命中「截断文本 + 该处可点」时，
 *     先把这次 click 按住不发，DOUBLE_GAP_MS 内没有第二次点按再原样补发回去；
 *  3) 只有真机（html.is-phone）挂行为，桌面窄窗完全不受影响。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** 按住超过此毫秒数 = 长按（选词 / 上下文菜单），不参与双击判定 */
const PRESS_MAX_MS = 280;
/** 两次点按的最大间隔：沿用 Android 自己的双击判定窗口 */
const DOUBLE_GAP_MS = 300;
/** 两次点按允许的位移（指头没那么准） */
const DOUBLE_SLOP_PX = 32;
/** 浮层与视口边缘的留白 / 与文本的间距 */
const EDGE_PX = 10;
const GAP_PX = 8;
/** 浮层最大宽度：再宽就失去「贴着这段文本」的指向性 */
const MAX_W_PX = 340;
/** 浮层层级：盖住页面内容，但让确认弹窗 / 插件遮罩仍然压得住它 */
const Z_PEEK = 9994;

type Anchor = { left: number; top: number; bottom: number; cx: number };
type Peek = { text: string; anchor: Anchor };
type Placement = { left: number; top: number; width: number; side: "top" | "bottom"; arrowX: number };

/** 真机密度标记由 main.tsx 挂在 <html> 上（触屏 + 窄窗），桌面永不命中 */
function isPhoneMode(): boolean {
  return document.documentElement.classList.contains("is-phone");
}

/**
 * 行内元素没有自己的盒模型（scrollWidth / clientWidth 恒为 0），不可能是"承载
 * 省略号"的那一层——它们由外层块级盒子统一裁剪，跳过它们才能找到正确的宿主。
 */
function hasOwnBox(el: HTMLElement): boolean {
  const d = getComputedStyle(el).display;
  return d !== "inline" && d !== "contents" && d !== "none";
}

/** -webkit-line-clamp 的计算值（各版本暴露方式不一致，两条路都试） */
function clampLines(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const raw = cs.getPropertyValue("-webkit-line-clamp")
    || (cs as CSSStyleDeclaration & { webkitLineClamp?: string }).webkitLineClamp
    || "";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 去掉行数钳制后这段文本的真实高度。
 * Blink 对 line-clamp 有两种实现：一种把溢出内容留在盒子里（scrollHeight 会变大），
 * 另一种直接在布局期截断（scrollHeight 不再暴露被裁掉的部分）。后者只能拿一份
 * 「同父节点、同宽度、去掉 clamp」的离屏副本量一遍——放在原文旁边是为了让
 * `.foo b { ... }` 这类后代选择器照样命中。
 */
function unclampedHeight(el: HTMLElement): number {
  const host = el.parentElement;
  if (!host) return 0;
  const cs = getComputedStyle(el);
  const padL = Number.parseFloat(cs.paddingLeft) || 0;
  const padR = Number.parseFloat(cs.paddingRight) || 0;
  const probe = el.cloneNode(true) as HTMLElement;
  const s = probe.style;
  s.position = "fixed";
  s.left = "-10000px";
  s.top = "0";
  s.boxSizing = "content-box";
  s.width = `${Math.max(0, el.clientWidth - padL - padR)}px`;
  s.height = "auto";
  s.minHeight = "0";
  s.maxHeight = "none";
  s.overflow = "visible";
  s.display = "block";
  s.setProperty("-webkit-line-clamp", "unset");
  s.setProperty("-webkit-box-orient", "unset");
  s.visibility = "hidden";
  s.pointerEvents = "none";
  host.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
}

/**
 * 这个盒子此刻是不是"有文本被藏起来了"。
 * 横向看 scrollWidth，纵向看 scrollHeight / 去钳副本——只有真的被裁掉才算，
 * 正常换行放得下的文本一律返回 false（否则双击任何字都会弹框）。
 */
function isClipped(el: HTMLElement): boolean {
  if (!hasOwnBox(el)) return false;
  if (el.clientWidth <= 0 && el.clientHeight <= 0) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility !== "visible") return false;

  // 横向：nowrap + ellipsis，被裁掉的宽度体现在 scrollWidth 上（最可靠的一路）
  if (cs.textOverflow === "ellipsis" && el.clientWidth > 0 && el.scrollWidth - el.clientWidth > 1) {
    return true;
  }

  const lines = clampLines(el);
  const boxClamp = cs.display === "-webkit-box" || cs.display === "-webkit-inline-box";
  if (lines > 0 || boxClamp) {
    if (el.clientHeight > 0 && el.scrollHeight - el.clientHeight > 1) return true;
    if (el.getBoundingClientRect().height + 1 < unclampedHeight(el)) return true;
  }
  return false;
}

/** 从命中点往上找第一个「真的在裁文本」的盒子；行内祖先会被 hasOwnBox 跳过 */
function findClipped(start: EventTarget | null): HTMLElement | null {
  let el = start instanceof HTMLElement ? start : null;
  for (; el; el = el.parentElement) {
    if (el === document.body || el === document.documentElement) break;
    if (isClipped(el)) return el;
  }
  return null;
}

/** 块级盒子的 display 前缀：它们之间要补一个断行，否则 <div>a</div><div>b</div> 会粘成 "ab" */
const BLOCK_DISPLAY = /^(block|flow-root|list-item|table|flex|grid|-webkit-box|-webkit-flex|ruby)/;

/**
 * 整段文本。
 * 这里刻意**不用 innerText**：Blink 的 -webkit-line-clamp 是布局期就把多余行切掉的
 * （这也正是 scrollHeight 不可靠的原因），而 innerText 取的是"渲染出来的文字"，
 * 有可能只拿到可见的那两行——那就等于把截断又原样演一遍。改成自己走 DOM：
 * 跳过没渲染的子树（display:none / visibility:hidden / aria-hidden），块级之间
 * 与 <br> 补断行，最后把空白并成一个空格。
 */
function readFullText(el: HTMLElement): string {
  const out: string[] = [];
  const pushBreak = (): void => {
    const last = out[out.length - 1];
    if (last && !/\s$/.test(last)) out.push("\n");
  };
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) { out.push(node.nodeValue ?? ""); return; }
    if (!(node instanceof Element)) return;
    if (node instanceof HTMLBRElement) { out.push("\n"); return; }
    let display = "";
    if (node instanceof HTMLElement) {
      const cs = getComputedStyle(node);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      display = cs.display;
    }
    if (node.getAttribute("aria-hidden") === "true") return;
    const block = BLOCK_DISPLAY.test(display);
    if (block) pushBreak();
    for (const child of Array.from(node.childNodes)) walk(child);
    if (block) pushBreak();
  };
  for (const child of Array.from(el.childNodes)) walk(child);
  return out.join("").replace(/\s+/g, " ").trim();
}

/**
 * 这一处的点按会不会触发动作（祖先有 onClick 之类的行/卡片）。
 * cursor 是继承属性——祖先设了 pointer，后代读到的也是 pointer，一次读值即可覆盖
 * 整条祖先链；再补一遍原生可交互标签，避免按钮那种默认 cursor 不是 pointer 的漏网。
 */
function isClickable(el: HTMLElement): boolean {
  if (getComputedStyle(el).cursor === "pointer") return true;
  return !!el.closest("a[href],button,[role='button'],[role='link'],label,summary,input,select,textarea");
}

function anchorOf(el: HTMLElement): Anchor {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, bottom: r.bottom, cx: r.left + r.width / 2 };
}

export function TextPeekHost(): ReactNode {
  const [peek, setPeek] = useState<Peek | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** 浮层是否开着：事件回调里要同步读，不能等 state 回流 */
  const openRef = useRef(false);

  const openPeek = useCallback((text: string, anchor: Anchor): void => {
    openRef.current = true;
    setPlace(null);
    setPeek({ text, anchor });
  }, []);

  const closePeek = useCallback((): void => {
    openRef.current = false;
    setPeek(null);
    setPlace(null);
  }, []);

  useEffect(() => {
    /** 挂起中的那次 click（等第二次点按） */
    let pending: { el: HTMLElement; x: number; y: number } | null = null;
    let timer = 0;
    /** 上一次点按（用于判定第二次） */
    let lastTap: { t: number; x: number; y: number } | null = null;
    let pressAt = 0;
    let multi = false;
    /** 被 preventDefault 按住的那次 click 有没有其实还是发出去了 */
    let sawNativeClick = false;
    /** 临时被打上 touch-action:manipulation 的盒子（连同它原来的内联值） */
    let tagged: HTMLElement | null = null;
    let taggedPrev = "";

    /**
     * 双击窗口内先给这个盒子关掉「双击缩放」。单靠第二次 touchend 的
     * preventDefault 在部分 WebView 上压不住 zoom——页面一旦被放大，浮层就按
     * 放大前的坐标画歪了。touch-action 在 touchstart 时求值，所以第一次点按里
     * 打上标记，第二次点按那一次手势就已经看到它了。300ms 后自动还原。
     */
    const tag = (el: HTMLElement): void => {
      if (tagged === el) return;
      untag();
      tagged = el;
      taggedPrev = el.style.touchAction;
      el.style.touchAction = "manipulation";
    };
    const untag = (): void => {
      if (!tagged) return;
      tagged.style.touchAction = taggedPrev;
      tagged = null;
      taggedPrev = "";
    };

    const clearPending = (): void => {
      if (timer) { window.clearTimeout(timer); timer = 0; }
      pending = null;
      untag();
    };

    /** 双击窗口到点：补发被按住的那次 click（原生 click 出去过就不补，免得跳两次） */
    const settle = (): void => {
      if (timer) { window.clearTimeout(timer); timer = 0; }
      const p = pending;
      pending = null;
      untag();
      if (!p || sawNativeClick || !p.el.isConnected) return;
      p.el.dispatchEvent(new MouseEvent("click", {
        bubbles: true, cancelable: true, composed: true, view: window,
        clientX: p.x, clientY: p.y,
      }));
    };

    const insideBox = (node: EventTarget | null): boolean =>
      node instanceof Node && !!boxRef.current && boxRef.current.contains(node);

    const onTouchStart = (e: TouchEvent): void => {
      if (!isPhoneMode()) return;
      if (e.touches.length > 1) multi = true;
      pressAt = Date.now();
    };

    const onTouchEnd = (e: TouchEvent): void => {
      if (!isPhoneMode()) return;
      const held = Date.now() - pressAt;
      const wasMulti = multi;
      multi = false;
      if (wasMulti || e.touches.length > 0) { lastTap = null; return; }
      const t = e.changedTouches[0];
      if (!t) return;

      // 浮层开着：浮层内是选词 / 滚浮层，什么都不做；浮层外这一下只用来关它，
      // 并且把 click 吞掉——否则"关浮层的这一下"会顺手把底下的行点开
      if (openRef.current) {
        if (!insideBox(e.target)) {
          e.preventDefault();
          lastTap = null;
          closePeek();
        }
        return;
      }

      // 长按 = 选词 / 上下文菜单，不当点按算
      if (held > PRESS_MAX_MS) { lastTap = null; return; }

      const el = findClipped(e.target);
      const now = Date.now();
      const second = !!lastTap && !!el
        && now - lastTap.t <= DOUBLE_GAP_MS
        && Math.abs(t.clientX - lastTap.x) <= DOUBLE_SLOP_PX
        && Math.abs(t.clientY - lastTap.y) <= DOUBLE_SLOP_PX;

      if (second && el) {
        // 第二次点按：吞掉它，既不触发 click 也不触发浏览器的双击缩放
        e.preventDefault();
        lastTap = null; // 不重置的话，这段窗口会一直挂到下一次点按，把单击误判成第二击
        clearPending();
        const text = readFullText(el);
        if (text) openPeek(text, anchorOf(el));
        return;
      }

      // 不是第二击：上一次按住的那次 click 立刻兑现（若已到点则早已补发）
      if (lastTap) settle();

      // 落在普通文本上：什么也不做，双击判定重置
      if (!el) { lastTap = null; return; }

      tag(el);
      timer = window.setTimeout(settle, DOUBLE_GAP_MS);
      lastTap = { t: now, x: t.clientX, y: t.clientY };

      // 这里还是能点出动作的地方（行 / 卡片）：先把这次 click 按住——否则第一次
      // 点按就把页面跳走了，根本等不到第二次点按（见文件头说明）
      if (isClickable(el)) {
        e.preventDefault();
        sawNativeClick = false;
        pending = { el: e.target instanceof HTMLElement ? e.target : el, x: t.clientX, y: t.clientY };
      }
    };

    /** 兜底：万一 touchend 那一路没接住（例如外接鼠标双击），dblclick 再兜一次 */
    const onDblClick = (e: MouseEvent): void => {
      if (!isPhoneMode() || openRef.current) return;
      const el = findClipped(e.target);
      if (!el) return;
      const text = readFullText(el);
      if (text) openPeek(text, anchorOf(el));
    };

    const onClickCapture = (): void => { sawNativeClick = true; };

    /** 滚动 / 旋转后锚点已经跑位，直接收起（浮层内部的滚动不算） */
    const onScroll = (e: Event): void => {
      if (!openRef.current || insideBox(e.target)) return;
      closePeek();
    };
    const onResize = (): void => { if (openRef.current) closePeek(); };
    const onKeyDown = (e: KeyboardEvent): void => { if (e.key === "Escape" && openRef.current) closePeek(); };

    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    document.addEventListener("dblclick", onDblClick, true);
    document.addEventListener("click", onClickCapture, true);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("touchstart", onTouchStart, { capture: true });
      document.removeEventListener("touchend", onTouchEnd, { capture: true });
      document.removeEventListener("dblclick", onDblClick, true);
      document.removeEventListener("click", onClickCapture, true);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("keydown", onKeyDown);
      clearPending();
    };
  }, [openPeek, closePeek]);

  // 宽度先按视口定死，浮层以 visibility:hidden 渲染一次量出真实高度，再算落点。
  // useLayoutEffect 在 paint 之前跑完，所以半成品位置永远不会被看见。
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(MAX_W_PX, Math.max(120, vw - EDGE_PX * 2));

  useLayoutEffect(() => {
    if (!peek) return;
    const box = boxRef.current;
    if (!box) return;
    const h = box.getBoundingClientRect().height;
    const a = peek.anchor;

    let side: "top" | "bottom" = "bottom";
    let top = a.bottom + GAP_PX;
    if (top + h > vh - EDGE_PX) {
      const above = a.top - GAP_PX - h;
      if (above >= EDGE_PX) { side = "top"; top = above; }
      else top = Math.max(EDGE_PX, vh - EDGE_PX - h);   // 上下都塞不下：贴视口，内部滚动
    }
    const left = Math.min(Math.max(EDGE_PX, a.left), Math.max(EDGE_PX, vw - EDGE_PX - width));
    // 箭头指向这段文本的水平中心，但夹在浮层内，免得戳出圆角
    const arrowX = Math.min(Math.max(a.cx - left, 16), Math.max(16, width - 16));
    setPlace({ left, top, width, side, arrowX });
  }, [peek, vw, vh, width]);

  if (!peek) return null;

  return createPortal(
    <div
      className={`text-peek-wrap${place?.side === "top" ? " is-above" : ""}`}
      style={{
        position: "fixed",
        left: place?.left ?? 0,
        top: place?.top ?? -9999,
        width,
        zIndex: Z_PEEK,
        visibility: place ? "visible" : "hidden",
      }}
    >
      <span className="text-peek-arrow" style={{ left: (place?.arrowX ?? 16) - 5 }} />
      <div ref={boxRef} className="text-peek" role="tooltip" style={{ maxHeight: vh - EDGE_PX * 2 }}>
        <span className="text-peek-body">{peek.text}</span>
      </div>
    </div>,
    document.body,
  );
}

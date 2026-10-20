import { Btn, SearchField } from "@onethu/gui";
/**
 * 添加组件抽屉（霖 2026-10-11 重做；尺寸档位版）。
 *
 * 对齐 HyperOS「添加小组件」的观感（参考 miuix 的 OverlayBottomSheet：从底部滑入、支持拖拽关闭）：
 *   · 恒为页面一半高，且**避让底栏**（不遮住导航栏）；
 *   · 出/入场动画 + 下拉手柄（下滑关闭）；
 *   · 总览是两列网格卡片，卡片标题在左上角、卡身是该组件的**预览**；
 *   · 点卡片 → 展开铺满抽屉：标题在左上角、简介在其下、**横向滑动的档位列表**、下方一个「添加」；
 *   · 添加后落库并收回抽屉；
 *   · 返回分层：展开态返回 → 回到总览；总览返回 → 收回抽屉。
 *
 * **尺寸档位（霖 2026-10-11 定稿）**：展开态的预览不再是单张图，而是横向滑动的档位列表，
 * 每个档位按自己的占格比例渲染；滑到哪一档，「添加」就加哪一档。
 *
 * **改大小复用同一个抽屉**：`mode === "resize"` 时直接展开到该组件、自动选中当前档位，
 * 底部按钮换成「修改大小」，确认后替换该位置组件的尺寸（让位由重排算法负责）。
 *
 * 「示例数据」口径说明：卡片预览优先用页面已发布的**真实卡体**（缩放显示），
 * 没有卡体时用统一的示例骨架（标题 + 两行占位 + 数值条），保证每张卡都"看起来有内容"。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlayBack } from "../state/navStack.js";
import { sizeTiersOf, tierIndexOf, type WidgetDef, type WidgetSize } from "../state/widgetMeta.js";
import type { WidgetRenderer } from "./WidgetHost.js";
import { WidgetPreviewBody, WidgetSizeList, tierAt } from "./WidgetSizes.js";
import { PreviewDataProvider } from "./PreviewData.js";
import { haptic } from "../lib/haptics.js";
import { t as i18n } from "../i18n/index.js";


const CLOSE_MS = 200;
/** 下滑关闭阈值：超过抽屉高度的 1/4 或速度够快就关。 */
const DRAG_CLOSE_PX = 96;
/** 常用组：与旧「右键添加」列表一致（便笺在最前，用户点名不能丢）。 */
const QUICK_IDS = ["custom:note", "text-title", "text-label", "divider"] as const;

/** 单张预览（总览卡片与自由控制组件的展开态用它）。 */
function WidgetPreview({ def, renderer, scale }: { def: WidgetDef; renderer?: WidgetRenderer; scale: number }): ReactNode {
  return (
    <div className="add-preview-box">
      <div
        className="add-preview-inner"
        style={{
          /* 居中显示：先平移到中心（-50%），再按比例缩放，缩放原点也是中心 */
          transform: "translate(-50%, -50%) scale(" + String(scale) + ")",
          width: String(Math.round(100 / scale)) + "%",
        }}
      >
        <WidgetPreviewBody def={def} renderer={renderer} tier={def.defaultSize} />
      </div>
    </div>
  );
}

/** 目录之外的特殊组件（文件夹 / OnePage 钉板），与目录组件同屏同搜索。 */
export interface BoardAddExtra {
  id: string;
  title: string;
  description: string;
  pick: () => void;
}

export function BoardAddDrawer({
  open,
  defs,
  renderers,
  extras = [],
  mode = "add",
  target = null,
  onAdd,
  onResize,
  onClose,
}: {
  open: boolean;
  defs: readonly WidgetDef[];
  renderers: Record<string, WidgetRenderer>;
  /** 目录外的特殊组件（文件夹 / OnePage 入口）：同一张网格、同一个搜索框。 */
  extras?: readonly BoardAddExtra[];
  /** add = 添加组件；resize = 「改变大小」复用本抽屉。 */
  mode?: "add" | "resize";
  /** resize 模式的目标：组件目录 id 与它当前的尺寸（据此自动选中档位）。 */
  target?: { defId: string; size: WidgetSize } | null;
  onAdd: (def: WidgetDef, size: WidgetSize) => void;
  onResize?: (def: WidgetDef, size: WidgetSize) => void;
  onClose: () => void;
}): ReactNode {
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  /** 组件搜索（右键空白与「＋」共用本抽屉，一视同仁）。 */
  const [query, setQuery] = useState("");
  /** 展开态选中的档位下标（滑动或点选都会更新）。 */
  const [tierIndex, setTierIndex] = useState(0);
  const [dragY, setDragY] = useState(0);
  /** 抽屉拉开到高位（拖过一半高度）后保持；再往下拖可以收回半高或关掉。 */
  const [tall, setTall] = useState(false);
  const dragRef = useRef<{ y: number; h: number; dy: number } | null>(null);
  /** 确认键的按下点（判定"滑动结束在按钮上"）与一次性闸门（指针路径与 click 路径只生效一次）。 */
  const pressRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const firedRef = useRef(false);

  /* 收回：先把展开态里标题/预览的矩形记下来，再切回总览——总览会用它们做**反向 FLIP**
     （不然收回就是"啪"地一下，霖 2026-10-11：展开有动画、收回没有）。 */
  const flyRef = useRef<{ name: DOMRect; box: DOMRect } | null>(null);
  const backRef = useRef<{ id: string; name: DOMRect; box: DOMRect } | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const collapse = (): void => {
    const head = headRef.current;
    const box = boxRef.current;
    if (expanded && head && box) {
      backRef.current = { id: expanded, name: head.getBoundingClientRect(), box: box.getBoundingClientRect() };
    }
    setExpanded(null);
  };

  const targetId = target?.defId ?? "";
  const targetW = target?.size.w ?? 0;
  const targetH = target?.size.h ?? 0;

  /* 打开时决定落在哪一屏：resize 直接展开到目标组件并选中当前档位；add 回到总览。 */
  useEffect(() => {
    if (!open) return;
    if (mode === "resize" && targetId) {
      const def = defs.find((d) => d.id === targetId);
      setExpanded(targetId);
      setTierIndex(def ? tierIndexOf(def, { w: targetW, h: targetH }) : 0);
      return;
    }
    setExpanded(null);
    setQuery("");
  }, [open, mode, targetId, targetW, targetH, defs]);

  /* 预览卡里「网络学堂搜索」的 autoFocus 输入框会在挂载瞬间把网格滚到它那里
     （然后才被上面的失焦兜住）——打开总览时把滚动位置拨回顶部。 */
  useEffect(() => {
    if (!open || mode !== "add") return;
    const reset = (): void => { if (gridRef.current) gridRef.current.scrollTop = 0; };
    const raf = requestAnimationFrame(reset);
    const t = window.setTimeout(reset, 180);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [open, mode]);

  /* 返回分层：先登记总览（底层），再登记展开态（上层）——后登记的在上，返回先命中它。
     resize 模式没有总览：整层返回都直接收回抽屉，否则会退到一张无关的组件网格。 */
  useOverlayBack("board-add", shown && !(mode === "add" && expanded), onClose);
  useOverlayBack("board-add-detail", shown && mode === "add" && !!expanded, collapse);

  /* 抽屉打开期间**锁住页面滚动**：抽屉是 fixed，但手势会穿透去滚后面的页面
     （霖 2026-10-11：按着抽屉上下滑，整个画面跟着位移）。 */
  useEffect(() => {
    if (!shown) return;
    document.documentElement.classList.add("is-sheet-open");
    return () => document.documentElement.classList.remove("is-sheet-open");
  }, [shown]);

  useEffect(() => {
    if (open) {
      setShown(true);
      setLeaving(false);
      return;
    }
    if (!shown) return;
    /* 关：先播退场再摘节点（否则会"啪"地消失）。 */
    setExpanded(null);
    setLeaving(true);
    setTall(false);
    const t = window.setTimeout(() => {
      setShown(false);
      setLeaving(false);
      setDragY(0);
    }, CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [open, shown]);

  /* FLIP：展开时让标题与预览**从卡片的位置飞过去**（HyperOS 那种"展开"观感）。
     标准做法：量出起点（卡片里那个元素的矩形）→ 把终态元素先摆到起点 → 强制回流 → 清掉 transform，
     于是它平滑滑到自己的位置。 */
  useLayoutEffect(() => {
    const from = flyRef.current;
    flyRef.current = null;
    const wrap = detailRef.current;
    if (!from || !wrap) return;
    const fly = (el: HTMLElement | null, start: DOMRect): void => {
      if (!el || start.width <= 0) return;
      const to = el.getBoundingClientRect();
      if (to.width <= 0) return;
      const s = Math.min(1, start.width / to.width);
      el.style.transformOrigin = "top left";
      el.style.transform = "translate(" + String(start.left - to.left) + "px, " + String(start.top - to.top) + "px) scale(" + String(s) + ")";
      void el.offsetWidth;
      wrap.classList.add("is-flying");
      el.style.transform = "";
    };
    fly(headRef.current, from.name);
    fly(boxRef.current, from.box);
    const t = window.setTimeout(() => wrap.classList.remove("is-flying"), 320);
    return () => window.clearTimeout(t);
  }, [expanded]);

  /* 收回的反向 FLIP：卡片从展开态里那两块的位置飞回自己的格子（与展开对称）。 */
  useLayoutEffect(() => {
    const from = backRef.current;
    backRef.current = null;
    if (expanded !== null || !from) return;
    const card = document.querySelector<HTMLElement>('[data-widget-option="' + from.id + '"]');
    if (!card) return;
    const flyBack = (el: HTMLElement | null, start: DOMRect): void => {
      if (!el) return;
      const to = el.getBoundingClientRect();
      if (to.width <= 0 || start.width <= 0) return;
      const s = Math.min(1, start.width / to.width);
      el.style.transformOrigin = "top left";
      el.style.transition = "none";
      el.style.transform =
        "translate(" + String(start.left - to.left) + "px, " + String(start.top - to.top) + "px) scale(" + String(s) + ")";
      void el.offsetWidth;
      el.style.transition = "transform var(--dur-3) var(--ease-spring)";
      el.style.transform = "";
    };
    flyBack(card.querySelector<HTMLElement>(".add-card-name"), from.name);
    flyBack(card.querySelector<HTMLElement>(".add-preview-box"), from.box);
  }, [expanded]);

  /* 预览区必须**不可交互**（霖 2026-10-11：打开「添加组件」时输入法自己弹出来）。
     真因：抽屉的预览渲染的是真实卡体，其中「网络学堂搜索」带 `autoFocus` 输入框，
     抽屉一挂载它就拿到焦点，安卓随即弹出输入法（实测 activeElement 落在 .add-drawer 内、mInputShown=true）。
     预览是缩略图，输入框与按钮都不该能聚焦；这里同时做「挂载后失焦」与「获得焦点即失焦」两道。 */
  useEffect(() => {
    const root = drawerRef.current;
    if (!root || !shown) return;
    /* 只做**一次**批量处理：一个复合选择器扫一遍，比"逐预览盒再各自 querySelectorAll"便宜得多
       （抽屉里是 51 个真实卡体预览）。
       曾经这里挂了 MutationObserver 兜住"异步挂载的输入框"，但卡体里的数据 hook 会持续重渲染，
       每次 DOM 变动都触发全量重扫 → 整个界面卡顿、轻滑即抽搐（霖 2026-10-12 现场）。
       晚挂载的输入框改由下面那条 O(1) 的 focusin 兜底负责失焦。 */
    const els = root.querySelectorAll<HTMLElement>(
      ".add-preview-box input, .add-preview-box textarea, .add-preview-box select, .add-preview-box [contenteditable='true']," +
      ".widget-size-box input, .widget-size-box textarea, .widget-size-box select, .widget-size-box [contenteditable='true']",
    );
    for (const el of Array.from(els)) {
      el.tabIndex = -1;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.disabled = true;
      if (el.hasAttribute("contenteditable")) el.setAttribute("contenteditable", "false");
    }
    const active = document.activeElement as HTMLElement | null;
    if (active && active.closest && active.closest(".add-preview-box, .widget-size-box")) active.blur();
  }, [shown, expanded]);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest && t.closest(".add-preview-box, .widget-size-box")) t.blur();
    };
    document.addEventListener("focusin", onFocusIn, true);
    return () => document.removeEventListener("focusin", onFocusIn, true);
  }, []);

  /* 抽屉底部为 OH 悬浮岛让位（霖 2026-10-11：「聊点什么吧」正好完全挡住确认按钮）。
     量出胶囊与抽屉底部的重叠高度写进 --dock-clearance，CSS 用 padding-bottom 吃掉它；
     入场动画与胶囊自身动画期间各补量一次，避免量到动画中间态。 */
  useEffect(() => {
    const root = drawerRef.current;
    if (!root || !shown) return;
    const measure = (): void => {
      const dock = document.querySelector<HTMLElement>(".dock-island");
      if (!dock) {
        root.style.setProperty("--dock-clearance", "0px");
        return;
      }
      const d = dock.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      const overlap = r.bottom - d.top;
      root.style.setProperty("--dock-clearance", overlap > 0 ? String(Math.ceil(overlap) + 8) + "px" : "0px");
    };
    measure();
    const t1 = window.setTimeout(measure, 80);
    const t2 = window.setTimeout(measure, 380);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [shown, expanded, mode]);

  if (!shown) return null;

  const def = expanded ? defs.find((d) => d.id === expanded) ?? null : null;
  const tiers = def ? sizeTiersOf(def) : [];
  const chosen = tierAt(tiers, tierIndex);
  /* 目录组件与特殊组件同一套搜索：标题 / id / 说明都能命中。 */
  const q = query.trim().toLowerCase();
  const matches = (s: string): boolean => !q || s.toLowerCase().includes(q);
  const shownDefs = defs.filter((d) => matches(d.title + " " + d.id + " " + d.description));
  const shownExtras = extras.filter((x) => matches(x.title + " " + x.description));
  /* 常用按 QUICK_IDS 的顺序排（便笺第一——用户点名不能丢），其余保留目录顺序。 */
  const quickDefs = QUICK_IDS
    .map((id) => shownDefs.find((d) => d.id === id))
    .filter((d): d is WidgetDef => Boolean(d));
  const restDefs = shownDefs.filter((d) => !(QUICK_IDS as readonly string[]).includes(d.id));
  /** 确认（添加 / 修改大小）：指针路径与 click 路径共用，400ms 内只生效一次。 */
  const activate = (fromPointer: boolean): void => {
    if (!def || firedRef.current) return;
    firedRef.current = true;
    window.setTimeout(() => { firedRef.current = false; }, 400);
    /* 触屏路径要 preventDefault 掉那次 click（避免二次生效），而全局触感委托
       （lib/haptics.ts 的 installGlobalHaptics）正挂在 click 上——于是这里补一档与 .btn 相同的
       轻触反馈；鼠标路径照旧交给全局委托，不重复。 */
    if (fromPointer) haptic("tick");
    if (mode === "resize") onResize?.(def, chosen);
    else onAdd(def, chosen);
  };

  const onHandleDown = (e: React.PointerEvent): void => {
    const h = drawerRef.current?.getBoundingClientRect().height ?? 0;
    dragRef.current = { y: e.clientY, h, dy: 0 };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 有窗口监听兜底 */ }
  };
  const onHandleMove = (e: React.PointerEvent): void => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    d.dy = dy;
    /* 往下拖先跟手（超过阈值就关），往上拖把抽屉拉高——不再只有“往下拖会关”一条方向。 */
    setDragY(Math.max(0, dy));
    const next = Math.max(260, Math.min(Math.round(window.innerHeight * 0.92), Math.round(d.h - dy)));
    drawerRef.current?.style.setProperty("--sheet-h", next + "px");
    setTall(next > window.innerHeight * 0.62);
  };
  const onHandleUp = (): void => {
    const d = dragRef.current;
    dragRef.current = null;
    const dy = d?.dy ?? 0;
    drawerRef.current?.style.removeProperty("--sheet-h");
    setDragY(0);
    if (dy > DRAG_CLOSE_PX) {
      setTall(false);
      onClose();
    }
  };

  /** 一张组件缩略图卡：点击展开档位，展开时从卡片位置飞过去。 */
  const renderCard = (d: WidgetDef): ReactNode => (
    <button
      key={d.id}
      type="button"
      className="add-card"
      data-widget-option={d.id}
      onClick={(e) => {
        const card = e.currentTarget as HTMLElement;
        const name = card.querySelector(".add-card-name");
        const box = card.querySelector(".add-preview-box");
        if (name && box) flyRef.current = { name: name.getBoundingClientRect(), box: box.getBoundingClientRect() };
        setTierIndex(tierIndexOf(d, d.defaultSize));
        setExpanded(d.id);
      }}
    >
      <span className="add-card-name">{d.title}</span>
      <WidgetPreview def={d} renderer={renderers[d.id]} scale={0.5} />
    </button>
  );

  /* portal 到 body：外壳里若有 transform/will-change 祖先，`position: fixed` 会退化成相对该祖先定位，
     页面一滚抽屉就跟着滚（霖 2026-10-11：上滑时"页面跟着动 + 抽屉多移一截"）。 */
  return createPortal(
    /* 预览数据层：抽屉里渲染的都是真组件，这里把示例数据写进数据缓存，
       预览不再现爬数据、也不会把真实数字当示例展示（详见 components/PreviewData.tsx）。 */
    <PreviewDataProvider>
    <>
      {/* 遮罩：点抽屉外收回；编辑抽屉和确认按钮高于常驻导航，避免手机底栏拦住提交。 */}
      <div className="add-drawer-mask" data-add-mask="1" onClick={onClose} />
    <div
      className={"add-drawer" + (leaving ? " is-out" : "") + (def ? " is-detail" : "") + (tall ? " is-tall" : "")}
      role="dialog"
      aria-label={mode === "resize" ? "改变大小" : "添加组件"}
      data-add-drawer="1"
      data-add-mode={mode}
      ref={drawerRef}
    >
      {/* 内层承担**拖拽位移**，外层承担**入场动画**：两者分开，动画就不会覆盖拖拽的 transform
          （霖 2026-10-11：动画播放期间拖动会被忽略，动画一结束才生效，看起来是"突然瞬移"）。 */}
      <div
        className="add-drawer-inner"
        style={dragY > 0 ? { transform: "translateY(" + String(dragY) + "px)", transition: "none" } : undefined}
      >
      <div
        className="add-drawer-grip"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
      >
        <span className="add-drawer-grip-bar" />
      </div>

      {def ? (
        /* 展开态：标题在左上角、简介在其下、档位列表居中、底部一个「添加」/「修改大小」。 */
        <div className="add-detail" data-add-detail={def.id} ref={detailRef}>
          <div className="add-detail-head" ref={headRef}>
            <span className="add-detail-kicker">{mode === "resize" ? "改变大小" : "添加组件"}</span>
            <span className="add-detail-name">{def.title}</span>
            <span className="add-detail-desc">{def.description}</span>
          </div>
          <div className="add-detail-body" ref={boxRef}>
            {tiers.length ? (
              <WidgetSizeList
                def={def}
                tiers={tiers}
                index={tierIndex}
                renderer={renderers[def.id]}
                onSelect={setTierIndex}
              />
            ) : (
              <div className="add-detail-free">
                <div className="add-detail-preview">
                  <WidgetPreview def={def} renderer={renderers[def.id]} scale={1} />
                </div>
                <span className="add-detail-hint">{i18n("auto.components.BoardAddDrawer.1")}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-primary add-detail-add"
            data-add-confirm={def.id}
            data-add-action={mode === "resize" ? "resize" : "add"}
            /* 确认键**在抬手时就生效**（触屏），不等浏览器的 click：
               真机上点一次没反应、点第二次才生效（霖 2026-10-12），
               而 CDP 里直接派发 click 是好的 —— 说明丢的是"真手指那一次 click"这条链路。
               指针路径与 click 路径共用一次性闸门，正常情况只会生效一次。 */
            onPointerDown={(e) => { pressRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; }}
            onPointerUp={(e) => {
              const p = pressRef.current;
              pressRef.current = null;
              if (!p || p.id !== e.pointerId) return;
              if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) return;   // 滑动结束在按钮上不算点按
              if (e.pointerType === "mouse") return;                          // 鼠标交给 click
              e.preventDefault();
              activate(true);
            }}
            onPointerCancel={() => { pressRef.current = null; }}
            onClick={() => activate(false)}
          >
            {mode === "resize" ? "修改大小" : "添加"}
          </button>
        </div>
      ) : (
        <div className="add-overview">
          <div className="add-overview-head">
            <span className="add-overview-title">{i18n("auto.components.BoardAddDrawer.2")}</span>
            <Btn variant="outline" onClick={onClose}>{i18n("auto.components.BoardAddDrawer.3")}</Btn>
          </div>
          <SearchField value={query} onChange={setQuery} placeholder={i18n("auto.components.BoardAddDrawer.4")} aria-label={i18n("auto.components.BoardAddDrawer.4")} />
          <div className="add-scroll" ref={gridRef}>
            {quickDefs.length ? (
              <section className="add-section" data-add-section="quick">
                <div className="add-section-title">{i18n("auto.components.BoardAddDrawer.5")}</div>
                <div className="add-grid">{quickDefs.map(renderCard)}</div>
              </section>
            ) : null}
            {shownExtras.length ? (
              <section className="add-section" data-add-section="onepage">
                <div className="add-section-title">{i18n("auto.components.BoardAddDrawer.6")}</div>
                <div className="free-add-list">
                  {shownExtras.map((x) => (
                    <Btn key={x.id} variant="ghost" size="sm" className="hs-detail-row" data-widget-option={x.id} titleAttr={x.description} onClick={x.pick}>
                      {x.title}
                    </Btn>
                  ))}
                </div>
              </section>
            ) : null}
            {restDefs.length ? (
              <section className="add-section" data-add-section="all">
                <div className="add-section-title">{i18n("auto.components.BoardAddDrawer.7")}</div>
                <div className="add-grid">{restDefs.map(renderCard)}</div>
              </section>
            ) : null}
            {!shownDefs.length && !shownExtras.length ? <div className="hs-op-hint">{i18n("auto.components.BoardAddDrawer.8")}</div> : null}
          </div>
        </div>
      )}
      </div>
    </div>
    </>
    </PreviewDataProvider>,
    document.body,
  );
}

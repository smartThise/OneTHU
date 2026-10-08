/**
 * 侧栏拖拽排位内核（霖 2026-10-05 三轮反馈后的定稿）。
 *
 * 前两轮的致命点，这里的写法就是为它们定的：
 * ① **拖拽期间一次 React 渲染都不做**。上一版让"预览"走 React 重排（临时偏好 → setState）：
 *    跨档时那一行的 key 从 m-x 变 d-x，**节点被重建** → is-dragging 特效丢失、transform 写到已分离的
 *    旧节点上（表现为"卡住不动 / 不跟手"）；落点又按重排后的**活几何**算，与自己的重排形成反馈环 →
 *    "在最后两格来回跳"。现在让位空隙**用 transform 表达**：React 一动不动。
 * ② **落点用拖拽开始时冻结的几何**（slots 快照）算 → 序号不可能抖动；也顺带修掉
 *    "向下突然位移一截、之后每次下滑再突变一个固定距离"（旧公式里 curTy 与被重建节点不一致的累积误差）。
 *
 * 其余口径：触屏不参与（手机是底栏、没有侧边栏）；只有落位那一下动（FLIP，走 --dur-2/--ease-spring）；
 * 拖到「已折叠收藏夹」上即折叠；Esc 取消；键盘 Alt+↑/↓ 等价路径。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "../lib/haptics.js";
import { prefersReducedMotion } from "../lib/motion.js";

const DRAG_THRESHOLD_PX = 8;

/** 调试面（默认关）：localStorage["onethu.debug.drag"]="1" 时，拖拽期间把内部量写到 window.__navDrag。
 *  为什么留它：让位/落点涉及"冻结几何 + 锚点 + 容器让位"三件事，出问题时只看 DOM 猜不出是哪一层错了。 */
function dragDebug(): boolean {
  try {
    return localStorage.getItem("onethu.debug.drag") === "1";
  } catch {
    return false;
  }
}
/** 容器滚动偏移（收藏夹段是限高滚动容器：滚动位置会让"视觉位/布局位"不同源） */
function s0ScrollTop(): number {
  return document.querySelector<HTMLElement>(".nav-folders-scroll")?.scrollTop ?? 0;
}

function putDebug(v: Record<string, unknown>): void {
  if (!dragDebug()) return;
  (window as unknown as Record<string, unknown>).__navDrag = v;
}

/** 冻结的一行几何（拖拽开始时快照） */
interface Slot {
  id: string;
  el: HTMLElement;
  top: number;
  height: number;
  shift: number;
}

/** 让位序列里的一个元素（行、分类标签、分隔线……都要一起走，否则会压字） */
interface ShiftEl {
  el: HTMLElement;
  top: number;
  height: number;
  shift: number;
}

interface DragState {
  id: string;
  scope: string;
  el: HTMLElement;
  startY: number;
  grabOffset: number;
  curTy: number;
  active: boolean;
  lastIndex: number;
  /** 最近一次的**序列**边界位（落档判归属用它；lastIndex 是行数，量纲不同） */
  lastBi: number;
  overFold: boolean;
  slots: Slot[];
  seq: ShiftEl[];
  /** 起点：让位序列里排在被拖行之前的元素个数（= 它的原位置） */
  origin: number;
  /** 「更多」组在让位序列里的起点（-1 = 没展开/没有）：落档就是拿它比 */
  moreFrom: number;
  /** 头部锚点个数（今日恒在最上）：让位边界不得越过它，锚点自身也不让位 */
  anchorFloor: number;
  gap: number;
  /** 拖拽期间挂「关过渡」开关的容器（.nav） */
  navEl: HTMLElement | null;
}

export interface NavDragApi {
  /** 拖拽进行中（空分类标签的浮现由 .nav.is-dragging 类驱动，不依赖渲染） */
  dragging: boolean;
  rowProps: (id: string, scope?: string, o?: { anchor?: boolean; cat?: string }) => {
    "data-nav-id": string;
    "data-nav-scope": string;
    "data-nav-anchor"?: string;
    "data-nav-cat"?: string;
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
    onClickCapture: (e: React.MouseEvent<HTMLElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  };
  captureTops: () => void;
  playFlip: (excludeId?: string) => void;
}

function peerEls(scope: string, skip: HTMLElement | null): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-nav-id][data-nav-scope="' + scope + '"]')].filter(
    (el) => el !== skip && el.offsetParent !== null,
  );
}

/** FLIP 的覆盖面必须与让位的覆盖面**一致**：只记 [data-nav-id] 会漏掉分类标签与容器，
 *  松手时它们瞬间弹回、而行还在播动画——正是霖 2026-10-05 报的「突变回原位再播放一次」。 */
function flipTargets(): HTMLElement[] {
  const set = new Set<HTMLElement>();
  for (const el of document.querySelectorAll<HTMLElement>(".nav > *, .nav [data-nav-id]")) set.add(el);
  return [...set];
}

export function useNavDrag(opts: {
  onDrop: (id: string, index: number, scope: string, tier: 'pin' | 'more') => void;
  onCancel: () => void;
  onFoldDrop: (id: string) => void;
}): NavDragApi {
  const [dragging, setDragging] = useState(false);
  const st = useRef<DragState | null>(null);
  const cb = useRef(opts);
  cb.current = opts;
  const swallowClick = useRef(false);
  const swallowTimer = useRef<number | undefined>(undefined);
  /** 武装「吞点击」：拖拽结束后浏览器不一定补 click（手势被接管），所以自带 700ms 解除，
      否则下一次正常点击会被白白吃掉。 */
  const armSwallow = useCallback((): void => {
    swallowClick.current = true;
    if (swallowTimer.current !== undefined) window.clearTimeout(swallowTimer.current);
    swallowTimer.current = window.setTimeout(() => {
      swallowClick.current = false;
      swallowTimer.current = undefined;
    }, 700);
  }, []);
  const tops = useRef(new Map<HTMLElement, number>());
  /* 按 id 的备份基准：跨档放下时那一行的 key 变了（JSX 里两档是两个 map 表达式，
     不是同一个 child 数组），React 会**卸载重建**节点 → 上面那张以元素为键的表里没有它 →
     没有 FLIP 基准 → 表现为"放下瞬间跳到位"（霖 2026-10-05）。这里按 id 兜一层。 */
  const topsById = useRef(new Map<string, number>());
  /** 上一次落位的被拖项 id：跨档时它会被重建，按 id 兜基准 */
  const lastDragId = useRef<string | null>(null);

  /** 让位：**边界及其之后的全部元素**向下让出 gap（含分类标签/分隔线，所以不会压字）。
      边界由指针位置决定（指针下第一个"中线在指针之下"的元素），而不是由序号反推。 */
  const applyGapFrom = useCallback((s: DragState, boundary: number): void => {
    /* **只动"起点 → 落点"之间的元素**：
       · 向下拖（boundary > origin）：区间内各项上移一格，正好填掉被拖项的原位（否则原位会留一块空白）；
       · 向上拖（boundary < origin）：区间内各项下移一格，在落点腾出位置；
       · 锚点（今日）永不让位——否则预览动了、放下又跳回第一位（霖 2026-10-05 反馈 2）。 */
    const lo = Math.min(s.origin, boundary);
    const hi = Math.max(s.origin, boundary);
    const step = boundary < s.origin ? s.gap : -s.gap;
    s.seq.forEach((it, i) => {
      const inRange = i >= lo && i < hi;
      const want = !inRange || it.el.hasAttribute("data-nav-anchor") ? 0 : step;
      if (it.shift === want) return;
      it.shift = want;
      it.el.style.transform = want === 0 ? "" : "translateY(" + want + "px)";
    });
  }, []);

  /** 记一次 FLIP 基准：让位序列用「冻结布局位 + 目标位移」，被拖项用当前视觉位。
      落位与"落点=折叠"两条路径共用。 */
  const primeFlip = useCallback((s: DragState, all = false): void => {
    tops.current = new Map();
    topsById.current = new Map();
    for (const it of s.seq) tops.current.set(it.el, it.top + it.shift);
    if (s.el) {
      const visual = s.el.getBoundingClientRect().top;
      tops.current.set(s.el, visual);
      topsById.current.set(s.id, visual);
    }
    /* all=true：把**让位序列之外**的元素也纳入基准（新建收藏夹 / 已折叠收藏夹 / 设置 这些
       不是行、也不在让位序列里）。插入或折叠会让它们整体上下移一格，此前没有基准 → 直接跳
       （霖 2026-10-06 报的"低下的内容是直接跳上去的"）。 */
    if (all) {
      for (const el of flipTargets()) {
        if (tops.current.has(el)) continue;
        const top = el.getBoundingClientRect().top;
        tops.current.set(el, top);
        if (el.dataset.navId) topsById.current.set(el.dataset.navId, top);
      }
    }
    lastDragId.current = s.id;
  }, []);

  const clearVisuals = useCallback((s: DragState, instant = false): void => {
    s.el.classList.remove("is-dragging");
    s.el.style.transform = "";
    s.el.style.zIndex = "";
    for (const slot of s.slots) {
      slot.el.style.transform = "";
      slot.shift = 0;
    }
    /* 落位要**瞬时**撤位移：给 .nav 挂一帧 is-settling（CSS 里 transition: none），
       而不是往每个元素写内联 transition——内联值只有在被 FLIP 到的元素上才会被还原，
       没被 FLIP 到的元素会永久失去过渡（霖 2026-10-06「拖拽时没有布局改变动画」）。 */
    if (instant) s.navEl?.classList.add("is-settling");
    for (const it of s.seq) {
      it.el.style.transform = "";
      it.shift = 0;
    }
    /* 撤掉让位位移**之后**才恢复过渡：顺序反了会把「清除」本身播成一段动画 */
    s.navEl?.classList.remove("is-dragging-nav");
    for (const el of document.querySelectorAll(".nav-label.is-revealed")) el.classList.remove("is-revealed");
    document.querySelector("[data-fold-drop].is-drop-target")?.classList.remove("is-drop-target");
    putDebug({ done: true });
  }, []);

  const endDrag = useCallback(
    (commit: boolean): void => {
      const s = st.current;
      st.current = null;
      if (!s) return;
      setDragging(false);
      if (!s.active) {
        clearVisuals(s);
        return; // 没越阈值：当普通点击处理
      }
      if (commit && s.overFold) {
        /* 落点=折叠：**先记 FLIP 基准**再瞬时撤位移。
           折叠会让展开列表少一行，剩下的行要补间上去；此前这里既没记基准、
           折叠改的又是 foldedRoots（不在 Layout 的 FLIP 依赖里）→ 观感是"瞬间向上平移"
           （霖 2026-10-06）。 */
        primeFlip(s, true);
        clearVisuals(s, true);
        ack();
        cb.current.onFoldDrop(s.id);
        return;
      }
      if (!commit) {
        clearVisuals(s);
        cb.current.onCancel();
        return;
      }
      /* 落位：先按**视觉位置**记一次 FLIP 基准（含让位位移与拖拽位移），再撤掉全部临时 transform，
         然后调用方 setState 重排，Layout 的 layout effect 里 playFlip 把行补间就位。 */
      /* 落位基准 = **冻结的布局位 + 目标位移**（不是"当前视觉位"）：
         预览让位现在**带动画**，视觉位可能停在中间值上，拿它当基准就会出现
         "放下先跳到中间值再补间"（霖 2026-10-06）。被拖项没有过渡，取当前视觉位即可。 */
      primeFlip(s, true); // 插入同样会推动下面的元素（新建/已折叠/设置），一并纳入基准
      /* 兜底钳制（反馈 4）：落点永远不得越过锚点（今日恒在最上）。
         指针路径靠 anchorFloor 钳制边界、键盘路径此前完全没有钳制，这里统一兜住，
         以后再加新的落点来源也不会绕开这条。 */
      const anchorCount = s.seq.filter((it) => it.el.hasAttribute("data-nav-anchor")).length;
      const index = Math.max(s.lastIndex < 0 ? 0 : s.lastIndex, anchorCount);
      /* 落档 = 边界归属，且**两边必须同一量纲**：moreFrom 与 lastBi 都是"让位序列里的位置"。
         踩过的坑（霖反馈 1）：先前拿 lastIndex（**行数**，最大≈14）去比 moreFrom（**序列位置**，
         含标签/开关，实测 15）→ 永远判成 pin，表现为"拖到更多里又弹回常驻"。 */
      const tier: "pin" | "more" = s.moreFrom >= 0 && s.lastBi >= s.moreFrom ? "more" : "pin";
      clearVisuals(s, true); // 落位：位移要**瞬时**撤掉（否则它自己会再播一段）
      ack();
      cb.current.onDrop(s.id, index, s.scope, tier);
    },
    [clearVisuals, primeFlip],
  );

  /** 拖拽中的逐帧处理（window 层与行上事件共用）：跟手、折叠落点、边界与让位。
      抽出来是因为**不能再靠指针捕获**（捕获会把 click 重定向到行，内层按钮点不动），
      移动必须由 window 层兜住。 */
  const trackMove = useCallback(
    (clientY: number, pointerId?: number): void => {
      const s = st.current;
      if (!s) return;
          if (!s.active) {
            if (Math.abs(clientY - s.startY) < DRAG_THRESHOLD_PX) return;
            s.active = true;
            armSwallow();
            /* 越过阈值才取指针捕获：拖到窗口外也不丢 pointerup；此时 click 本来要被吞掉 */
            if (pointerId !== undefined) {
              try {
                s.el.setPointerCapture(pointerId);
              } catch {
                /* 个别 WebView 不支持：window 层的 pointermove/pointerup 已经兜住 */
              }
            }
            s.el.classList.add("is-dragging"); // 只挂类：拖拽期间 React 一动不动，节点不会被重建
            /* 拖拽期间关掉行/标签的 transform 过渡：让位必须**瞬时**生效。
               否则预览是「动画过去」的（滞后、错位），松手时 FLIP 的基准还会取到动画中间值
               ——表现为「预览已到位、松手又弹回去再播一次」（霖 2026-10-05）。 */
            s.navEl?.classList.add("is-dragging-nav");
            s.slots = peerEls(s.scope, s.el).map((row) => {
              const r = row.getBoundingClientRect();
              return { id: row.dataset.navId ?? "", el: row, top: r.top, height: r.height, shift: 0 };
            });
            /* 让位序列 = **.nav 的直接子元素**（行 / 分类标签 / 分隔线 / 整个「收藏夹」容器）：
               只挪同作用域的行会压字（霖反馈 1）；而"容器整体当一个元素"保证让位边界
               永远不会落在容器内部——那正是"多一条缝 + 一对重叠"的来源（霖反馈 2 的残留）。 */
            /* 让位序列**按作用域取**：
               · 侧栏条目（nav）：.nav 的**直接子元素**——每个容器（「收藏夹」段）整体算一个，
                 让位边界永不落进容器内部（那会漏缝）；「更多」区已平铺，同属直接子元素。
               · 收藏夹（favs）：组内各夹行互为兄弟（都在 .nav-folders-scroll 里），
                 直接在容器内互让；容器自身高度不变，故不需要外部让位。 */
            const allVisible = (
              s.scope === "favs"
                ? [...document.querySelectorAll<HTMLElement>('[data-nav-id][data-nav-scope="favs"]')]
                : [...document.querySelectorAll<HTMLElement>(".nav > *")]
            ).filter((el) => el.offsetParent !== null);
            s.seq = allVisible
              .filter((el) => el !== s.el)
              .map((el) => {
                const r = el.getBoundingClientRect();
                return { el, top: r.top, height: r.height, shift: 0 };
              });
            /* 起点：让位序列里排在被拖行之前的元素数（seq 已排除被拖行） */
            s.origin = (() => {
              const mine = allVisible.indexOf(s.el);
              if (mine < 0) return 0;
              return s.seq.filter((it) => allVisible.indexOf(it.el) < mine).length;
            })();
            /* 头部锚点个数（今日恒在最上）：让位边界不得越过 */
            const firstNonAnchor = s.seq.findIndex((it) => !it.el.hasAttribute("data-nav-anchor"));
            s.anchorFloor = firstNonAnchor < 0 ? 0 : firstNonAnchor;
            /* 「更多」组在序列里的起点：落档用它判（边界落在它之后 → 落进「更多」） */
            s.moreFrom = s.seq.findIndex((it) => it.el.hasAttribute("data-more"));
            /* 反馈 3：只让**被拖项自己所属**的那个空分类标签浮现（此前是所有空分类都浮现） */
            const cat = s.el.getAttribute("data-nav-cat");
            if (cat) document.querySelector('.nav-label[data-nav-cat="' + cat + '"]')?.classList.add("is-revealed");
            setDragging(true);
          }
      if (!s.active) return;
          /* 1:1 跟手：拖拽期间没有任何重排，布局顶稳定 */
          const rect = s.el.getBoundingClientRect();
          const layoutTop = rect.top - s.curTy;
          const ty = clientY - s.grabOffset - layoutTop;
          s.el.style.transform = "translateY(" + ty + "px)";
          s.curTy = ty;

          /* 折叠落点 = **「已折叠收藏夹」那一行**（它自己带 data-fold-drop），
             展开时整块折叠组区域也算落点。此前查的是第一处 .nav-folded-toggle，
             区块顺序改成「固定 → 更多 → 收藏夹」后那一处变成了「更多」按钮 →
             拖到已折叠组上不被识别（霖 2026-10-06）。 */
          const foldRow = document.querySelector<HTMLElement>("[data-fold-drop]");
          const foldBody = document.querySelector<HTMLElement>(".nav-folded-body");
          let overFold = false;
          for (const zone of [foldRow, foldBody]) {
            if (!zone) continue;
            const zb = zone.getBoundingClientRect();
            if (clientY >= zb.top && clientY <= zb.bottom) {
              overFold = true;
              break;
            }
          }
          foldRow?.classList.toggle("is-drop-target", overFold);
          s.overFold = overFold;

          /* 边界：让位序列里第一个"中线在指针之下"的元素（冻结几何 → 不抖） */
          let bi = s.seq.length;
          for (let i = 0; i < s.seq.length; i++) {
            const it = s.seq[i]!;
            if (it.top >= clientY) {
            /* 判据用**行的顶**（不是行中线）：被拖项是画在指针处的（中心跟手），
               只有"按行的顶"数出来的空洞才与它视觉所在的那一格一致 → 松手时 dy≈0；
               若按中线判，指针落在某行中心时空洞会高整整一格（实测 dy=32px），
               松手后 FLIP 再补回一格 —— 观感就是"放下突变 + 再重播一次动画"
               （霖 2026-10-06 报的收藏夹拖拽重播）。 */
              bi = i;
              break;
            }
          }
          /* 落库序号：边界之前有多少**同作用域的行**（与让位位置天然一致） */
          if (s.anchorFloor > 0 && bi < s.anchorFloor) bi = s.anchorFloor; // 锚点之下才允许插入
          const boundaryEl = bi < s.seq.length ? s.seq[bi]!.el : null;
          const idx = boundaryEl
            ? s.slots.filter((sl) => (sl.el.compareDocumentPosition(boundaryEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).length
            : s.slots.length;
          s.lastIndex = idx;
          s.lastBi = bi;
          applyGapFrom(s, bi);
        putDebug({ id: s.id, scope: s.scope, origin: s.origin, anchorFloor: s.anchorFloor, moreFrom: s.moreFrom, bi, idx, seqLen: s.seq.length });
    },
    [applyGapFrom],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && st.current) {
        e.preventDefault();
        endDrag(false);
      }
    };
    const onUp = (): void => {
      if (st.current) endDrag(true);
    };
    /* 移动跟踪放 window 层：不再依赖指针停留在行上（也不靠指针捕获，见 onPointerDown 的说明）。
       未开始拖拽时是一次早退，代价可忽略。 */
    const onMove2 = (e: PointerEvent): void => {
      if (!st.current) return;
      trackMove(e.clientY, e.pointerId);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointermove", onMove2);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onMove2);
    };
  }, [endDrag, trackMove]);

  const captureTops = useCallback((): void => {
    const m = new Map<HTMLElement, number>();
    const byId = new Map<string, number>();
    for (const el of flipTargets()) {
      const top = el.getBoundingClientRect().top;
      m.set(el, top);
      if (el.dataset.navId) byId.set(el.dataset.navId, top);
    }
    tops.current = m;
    topsById.current = byId;
  }, []);

  const playFlip = useCallback((excludeId?: string): void => {
    if (prefersReducedMotion()) return;
    for (const el of flipTargets()) {
      if (excludeId !== undefined && el.dataset.navId === excludeId) continue;
      const before =
        tops.current.get(el) ??
        (lastDragId.current !== null && el.dataset.navId === lastDragId.current ? topsById.current.get(lastDragId.current) : undefined);
      if (before === undefined) continue;
      const now = el.getBoundingClientRect().top;
      const dy = before - now;
      /* 调试面：把被拖项的基准/新位/差值写出来（onethu.debug.drag=1 才写），
         用于定位"落位突变"这类只能靠读数分辨的问题。 */
      if (el.dataset.navId === lastDragId.current) putDebug({ flipId: el.dataset.navId, before, now, dy, scrollTop: s0ScrollTop() });
      if (Math.abs(dy) < 1) continue;
      el.style.transform = "translateY(" + dy + "px)";
      requestAnimationFrame(() => {
        el.style.transform = "";
        /* 同一帧内摘掉 is-settling：过渡恢复，元素从 dy 补间回 0 */
        document.querySelector(".nav.is-settling")?.classList.remove("is-settling");
      });
    }
    tops.current = new Map();
    topsById.current = new Map();
  }, []);

  const rowProps = useCallback(
    (id: string, scope = "nav", o?: { anchor?: boolean; cat?: string }) => ({
      "data-nav-id": id,
      "data-nav-scope": scope,
      ...(o?.anchor ? { "data-nav-anchor": "1" } : {}),
      ...(o?.cat ? { "data-nav-cat": o.cat } : {}),
      onPointerDown: (e: React.PointerEvent<HTMLElement>): void => {
        if (e.pointerType === "touch") return; // 触屏不参与排位
        if (e.button !== 0) return;
        /* 锚点（今日）恒在最上、不参与排位：不开始拖拽，也不让位（霖 2026-10-05 反馈 2） */
        if ((e.currentTarget as HTMLElement).closest("[data-nav-anchor]")) return;
        const el = (e.currentTarget.closest("[data-nav-id]") ?? e.currentTarget) as HTMLElement;
        const b = el.getBoundingClientRect();
        /* 被拖项的占位高度 = 行高 + **所在容器的实测行间距**（不写死）。
           踩过的坑：写死 +1 在 .nav（row-gap: 1px）上对，在 .nav-folders-scroll
           （row-gap: normal = 0）上每格多挪 1px → 移动收藏夹时累加错位（霖 2026-10-05）。 */
        const parent = el.parentElement;
        const rg = parent ? parseFloat(getComputedStyle(parent).rowGap) : 0;
        st.current = {
          id,
          scope,
          el,
          startY: e.clientY,
          grabOffset: e.clientY - b.top,
          curTy: 0,
          active: false,
          lastIndex: -1,
          lastBi: -1,
          overFold: false,
          slots: [],
          seq: [],
          origin: 0,
          moreFrom: -1,
          anchorFloor: 0,
          gap: b.height + (Number.isFinite(rg) ? rg : 0),
          navEl: document.querySelector<HTMLElement>(".sidebar .nav, .drawer .nav"),
        };
        /* 这里**不能**取指针捕获：捕获会把随后的 click 的 target 重定向到本行，
           内层 <button> 的 onClick 就永远不触发（霖 2026-10-06「侧栏选项均无法点击」）。
           捕获改到越过拖拽阈值之后取——那时本来就要吞掉这次 click。 */
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>): void => {
        const s = st.current;
        if (!s || s.id !== id) return;
        trackMove(e.clientY, e.pointerId);

      },
      onPointerUp: (): void => endDrag(true),
      onPointerCancel: (): void => endDrag(false),
      onClickCapture: (e: React.MouseEvent<HTMLElement>): void => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLElement>): void => {
        if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        const rows = peerEls(scope, null);
        const me = rows.findIndex((r) => r.dataset.navId === id);
        const meRow = me < 0 ? undefined : rows[me];
        if (!meRow) return;
        const line = meRow.getBoundingClientRect().top + 1;
        const mine = rows.filter((r) => r.getBoundingClientRect().top < line).length;
        const anchorCount = rows.filter((r) => r.hasAttribute("data-nav-anchor")).length;
        const target = Math.max(mine + (e.key === "ArrowUp" ? -1 : 1), anchorCount);
        if (target > rows.length) return;
        /* 与指针路径同一口径：目标落在「更多」组里 → 落进「更多」 */
        const moreFromPeer = rows.findIndex((r) => r.hasAttribute("data-more"));
        const tier: "pin" | "more" = moreFromPeer >= 0 && target >= moreFromPeer ? "more" : "pin";
        ack();
        cb.current.onDrop(id, target, scope, tier);
      },
    }),
    [applyGapFrom, endDrag],
  );

  return { dragging, rowProps, captureTops, playFlip };
}

function ack(): void {
  try {
    haptic("tick");
  } catch {
    /* 触感不可用不影响交互 */
  }
}

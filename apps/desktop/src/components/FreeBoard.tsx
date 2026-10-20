import { useIsSimpleLike } from "../state/experienceMode.js";
/**
 * 自由图层白板（2026-10-13 定稿，霖：要可以互相重叠盖住的高级白板）。
 *
 * **一块板一份数据**（2026-10-15）：组件按 `{ boardId, orientation }` 参数化，读写的就是
 * BoardDoc 里那块板那个朝向（state/freeBoard.ts 的 px 层）。首页 = 系统板（HomeTab 显式传入），
 * OnePage = 用户板（OnePageSurface 传 activeBoardId）——**首页与 OnePage 从此是同一块画布**，
 * 「假白板」（4/8 列网格 + 编辑态）那条线整体退役。
 *
 * 交互（桌面直接摆放；手机竖屏按阅读顺序堆叠）：
 *   - 拖动：桌面按住组件非交互区域直接拖（4px 阈值）；固定组件不移动；
 *   - 缩放：选中后四角 + 右/下把手，自由拉（下限 120×64）；
 *   - 点选：浮出迷你条（置顶 / 折叠（便笺）/ 透明度 / 固定 / 删除），Delete 删、Esc 取消、方向键微调；
 *   - 图层：选中/拖动即浮到与自己重叠的那簇之上；数组序 = 图层序，后放的在上；
 *   - 右键 / 长按组件：七项菜单（选择条目 / 改变大小 / 编辑 / 固定 / 置顶 / 详情 / 删除）；
 *   - 右键空白 / 「＋」浮钮：添加组件（放在指针处）；（双击空白建便笺已按用户要求删除）
 *   - 双击便笺或文字：就地编辑（双击空白不再创建便笺）；画笔恒在最高图层（z 90），RGB 取色 + 撤销/清空。
 *
 * 组件体走 WidgetHost（与旧白板页同一套渲染语义：divider / 文字 / 跳转 / 原子入口 / 卡片 /
 * 自定义 + 降级壳），渲染器 = 白板自足实现 + 各页面发布的卡体 + 活数据三层合并
 * （列表类组件因此在任何页面都能显示真实内容，而不是离开来源页就变空壳）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { ActionSheet, Btn, BtnGroup, IconBtn } from "@onethu/gui";
/* 缩放控件用 OneGUI 的图标集（应用内那份 Icons.tsx 是待收编的旧集，新东西一律进库）——
   名字与下面 ./Icons.js 的同名导入会撞，故加 Og 前缀。 */
import { IconMinus as OgIconMinus, IconPlus as OgIconPlus } from "@onethu/gui";
import { createPortal } from "react-dom";
import {
  freeBoardOps,
  freeBoardSnapshot,
  HOME_BOARD_ID,
  HOME_ORIENTATION,
  MIN_H,
  MIN_W,
  subscribeFreeBoard,
  type FreeItem,
} from "../state/freeBoard.js";
import { ATOM_TEMPLATE_IDS, allWidgetDefs } from "../state/widgets.js";
import { defForSpec, isTierControlled, type WidgetDef, type WidgetSize } from "../state/widgetMeta.js";
import { planForItem } from "../state/widgetRender.js";
import { BOARD_TEMPLATES, templateItems, type BoardTemplate } from "../state/boardTemplates.js";
import { SNAP_DIST, snapMove, snapResize, type SnapGuide, type SnapHandle } from "../state/boardSnap.js";
import { useT } from "../i18n/index.js";
import { WidgetHost, type WidgetRenderer } from "./WidgetHost.js";
import { BoardAddDrawer } from "./BoardAddDrawer.js";
import { BoardItemPicker, type PickerItem } from "./BoardItemPicker.js";
import { BOARD_CARD_RENDERERS } from "./boardCards.js";
import { cardRendererKey, liveRenderers, subscribeLiveCards } from "../state/liveCards.js";
import { cardRenderers, subscribeTodayCards } from "../state/todayCards.js";
import { resolveAtom } from "../state/atoms.js";
import { atomRefFromKey } from "../state/favorites.js";
import { useApp } from "../state/context.js";
import { homeStarterItems } from "../state/boardCore.js";
import { activeBoard, cellFromRect, loadBoard, rectFromCell, type BoardDoc, type BoardItem, type Orientation } from "../state/board.js";
import { openOnePage } from "../state/onePage.js";
import { gestureOwner } from "../lib/gestureArena.js";
import { addToVault } from "../state/vault.js";
import { openWorkspace, explorerSnapshot, subscribeExplorer } from "../state/explorer.js";
import { FolderIcon } from "./Icons.js";
import { Card, Empty, NAV, PageHead } from "./Layout.js";
import { PEN_COLORS, penKeyOf, penSnapshot, strokesOf, subscribePen, undoStroke, clearStrokes } from "../state/boardPen.js";
import { sanitizeUserHtml, widgetById as userWidgetById } from "../state/userext.js";
import { BOARD_CANVAS_H, BoardPenLayer, BoardPenToolbar } from "./BoardPenLayer.js";
import { useContextMenu, type CtxItem } from "./ContextMenu.js";
import { useIsPhone, useSheetSnap } from "../state/phoneSheets.js";
import { PhoneSheetGrip, useSheetDrag } from "./explorer/PhoneSheet.js";
import { useLearnData } from "../state/data.js";
import { IconPen, IconPlus, IconTrash, IconX } from "./Icons.js";
import { fitTarget } from "../state/boardFit.js";
import {
  boardViewKey,
  boxSize,
  contentRect,
  stepZoom,
  subscribeView,
  toWorld,
  viewOf as readBoardView,
  worldDelta,
  zoomLabel,
  ZOOM_MAX,
  ZOOM_MIN,
  setView as setBoardView,
  type BoardView,
} from "../state/boardView.js";
import { t as i18n } from "../i18n/index.js";


const DRAG_THRESHOLD = 4;
/** 长按出菜单（与全站口径一致：ContextMenu 的 LONG_PRESS_MS 同为 500）。 */
const LONG_PRESS_MS = 500;
type Rect = { x: number; y: number; w: number; h: number };

/** 与数据层同口径的夹取（视觉必须等于落库：否则拖到画布外松手会"弹回去"）。 */
function clampRect(r: Rect): Rect {
  return {
    x: Math.max(0, Math.round(r.x)),
    y: Math.max(0, Math.round(r.y)),
    w: Math.max(MIN_W, Math.round(r.w)),
    h: Math.max(MIN_H, Math.round(r.h)),
  };
}

/**
 * px 矩形 → 板条目视图：WidgetHost / planForItem / 档位抽屉都吃 BoardItem，
 * cell 由 px 反算（4 列基准 + 基准瓦片），于是「档位提示」与画布上的真实大小对得上。
 */
function viewOf(item: FreeItem): BoardItem {
  return { id: item.id, spec: item.spec, cell: cellFromRect({ x: item.x, y: item.y, w: item.w, h: item.h }) };
}

/** 档位（格单位）→ px 尺寸：抽屉选的是档位，画布要的是像素。 */
function pxSizeOf(size: WidgetSize): { w: number; h: number } {
  const r = rectFromCell({ x: 0, y: 0, w: size.w, h: size.h });
  return { w: r.w, h: r.h };
}

/**
 * 三层渲染器合并：白板自足实现（BOARD_CARD_RENDERERS）→ 各页面发布的卡体 → 活数据。
 * （旧白板页的处理，2026-10-15 搬进自由画布：首页与 OnePage 共用同一份。）
 */
function mergeRenderers(): Record<string, WidgetRenderer> {
  return { ...BOARD_CARD_RENDERERS, ...cardRenderers(), ...liveRenderers() };
}

function useRenderers(): Record<string, WidgetRenderer> {
  const [renderers, setRenderers] = useState<Record<string, WidgetRenderer>>(mergeRenderers);
  useEffect(() => {
    const sync = (): void => setRenderers(mergeRenderers());
    const off1 = subscribeTodayCards(sync);
    const off2 = subscribeLiveCards(sync);
    return () => {
      off1();
      off2();
    };
  }, []);
  return renderers;
}

function useFreeBoard(boardId: string, orientation: Orientation): FreeItem[] {
  const snap = useCallback(() => freeBoardSnapshot(boardId, orientation), [boardId, orientation]);
  return useSyncExternalStore(subscribeFreeBoard, snap, snap).items;
}

/**
 * 单个组件体：spec → JSX。
 *
 * 自由层专属的「组合组件」（目录里查不到的：OnePage 入口 / 文件夹 / 用户生成）自己画，
 * 其余一律交给 WidgetHost —— 与旧白板页同一套渲染语义，降级壳与空态文案也一致。
 */
function ItemBody({ item, defs, renderers, onOpen, onFolderAdd, onProps }: {
  item: FreeItem;
  defs: readonly WidgetDef[];
  renderers: Record<string, WidgetRenderer>;
  onOpen: (item: BoardItem) => void;
  onFolderAdd?: () => void;
  onProps?: (props: Record<string, unknown> | undefined) => void;
}): ReactNode {
  const { navigate } = useApp();
  const spec = item.spec;
  /* OnePage 入口（组合组件之一）：把另一块 OnePage 钉在画布上，点击即打开 */
  if (spec.kind === "custom" && spec.id === "onepage") {
    const boardId = typeof spec.props?.boardId === "string" ? spec.props.boardId : "";
    const b = loadBoard().boards.find((x) => x.id === boardId);
    if (!b) {
      return (
        <div className="wg-empty" role="note">
          <span className="wg-empty-title">{i18n("auto.components.FreeBoard.1")}</span>
        </div>
      );
    }
    return (
      <button
        type="button"
        className="wg-entry"
        onClick={() => {
          openOnePage(b.id);
          navigate("board");
        }}
      >
        <span className="wg-entry-title">{b.name}</span>
        <span className="wg-entry-arrow" aria-hidden="true">›</span>
      </button>
    );
  }
  /* 文件夹组合组件：圆形 logo 网格，组织一级入口 / OnePage / 工作区 */
  if (spec.kind === "custom" && spec.id === "folder") {
    const entries = Array.isArray(spec.props?.entries)
      ? (spec.props.entries as Array<{ kind: string; page?: string; label?: string; params?: unknown; boardId?: string; wsId?: string }>)
      : [];
    const openEntry = (en: { kind: string; page?: string; boardId?: string; wsId?: string }): void => {
      if (en.kind === "page" && en.page) navigate(en.page as never);
      else if (en.kind === "onepage" && en.boardId) {
        openOnePage(en.boardId);
        navigate("board");
      } else if (en.kind === "ws" && en.wsId) openWorkspace(en.wsId);
    };
    const iconFor = (en: { kind: string; page?: string; boardId?: string }): ReactNode => {
      if (en.kind === "onepage" && en.boardId) {
        const b = loadBoard().boards.find((x) => x.id === en.boardId);
        return <FolderIcon name={b?.icon ?? "star"} width={18} height={18} />;
      }
      if (en.kind === "ws") return <FolderIcon name="folder" width={18} height={18} />;
      if (en.kind === "page") {
        const n = NAV.find((x) => x.page === (en.page as never));
        if (n) {
          const I = n.icon as (p: { width?: number; height?: number }) => ReactNode;
          return <I width={18} height={18} />;
        }
      }
      return <FolderIcon name="fist" width={18} height={18} />;
    };
    const labelFor = (en: { kind: string; page?: string; label?: string; boardId?: string; wsId?: string }): string => {
      if (en.label) return en.label;
      if (en.kind === "onepage" && en.boardId) return loadBoard().boards.find((x) => x.id === en.boardId)?.name ?? "OnePage";
      if (en.kind === "ws" && en.wsId) return explorerSnapshot().workspaces.find((w) => w.id === en.wsId)?.name ?? "工作区";
      if (en.kind === "page") return NAV.find((x) => x.page === (en.page as never))?.label ?? String(en.page);
      return "?";
    };
    return (
      <div className="free-folder">
        <div className="free-folder-grid">
          {entries.map((en, i) => (
            <button
              key={String(i) + (en.page ?? en.boardId ?? en.wsId ?? "")}
              type="button"
              className="free-folder-cell"
              title={labelFor(en)}
              onClick={() => openEntry(en)}
              onContextMenu={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const next = entries.filter((_, j) => j !== i);
                if (onProps) onProps({ ...spec.props, entries: next });
              }}
            >
              <span className="free-folder-ball">{iconFor(en)}</span>
              <span className="free-folder-label">{labelFor(en)}</span>
            </button>
          ))}
          <button
            type="button"
            className="free-folder-cell is-add"
            title={i18n("auto.components.FreeBoard.2")}
            onClick={(ev) => {
              ev.stopPropagation();
              onFolderAdd?.();
            }}
          >
            <span className="free-folder-ball is-add">＋</span>
            <span className="free-folder-label">{i18n("auto.components.FreeBoard.3")}</span>
          </button>
        </div>
      </div>
    );
  }
  /* 用户生成组件（OH 元工具创建）：无色 tint 底 + 净化后的 HTML 片段 */
  if (spec.kind === "custom" && spec.id.startsWith("usergen:")) {
    const uid = spec.id.slice("usergen:".length);
    const w = userWidgetById(uid);
    if (!w) {
      return (
        <div className="wg-empty" role="note">
          <span className="wg-empty-title">{i18n("auto.components.FreeBoard.4")}</span>
        </div>
      );
    }
    return (
      <div
        className="free-usergen"
        // 净化器已剥 script/事件属性/javascript: 链接（state/userext.ts sanitizeUserHtml）
        dangerouslySetInnerHTML={{ __html: sanitizeUserHtml(w.html) }}
      />
    );
  }
  /* 其余（分隔线 / 文字 / 跳转 / 原子入口 / 卡片 / 目录里的自定义组件）走统一宿主 */
  return <WidgetHost item={viewOf(item)} defs={defs} onOpen={onOpen} renderers={renderers} />;
}

/** 「选择条目」子层：只在真要挑具体项时才挂载——顺带才去取网络学堂数据，首页不受牵连。 */
function TemplateItemPicker({ item, onPick, onClose }: {
  item: FreeItem;
  onPick: (props: Record<string, unknown>) => void;
  onClose: () => void;
}): ReactNode {
  const learn = useLearnData();
  const items: PickerItem[] = useMemo(() => {
    if (item.spec.kind !== "custom") return [];
    const data = learn.data;
    if (item.spec.id === "learn-file") {
      const byCourse = new Map((data?.courses ?? []).map((c) => [c.id, c.name]));
      return [...(data?.files ?? [])]
        .sort((a, b) => String(b.uploadTime).localeCompare(String(a.uploadTime)))
        .map((f) => ({
          key: f.courseId + ":" + f.id,
          label: f.title || "课件 " + f.id,
          sub: (byCourse.get(f.courseId) ?? "") + " · " + String(f.uploadTime).slice(0, 10),
          props: { courseId: f.courseId, itemId: f.id, title: f.title },
        }));
    }
    return [];
  }, [item, learn.data]);
  const currentKey = item.spec.kind === "custom"
    ? String(item.spec.props?.courseId ?? "") + ":" + String(item.spec.props?.itemId ?? "")
    : undefined;
  return (
    <BoardItemPicker
      open
      title={i18n("auto.components.FreeBoard.5")}
      searchHint="搜索课程或文件名"
      items={items}
      currentKey={currentKey}
      onPick={onPick}
      onClose={onClose}
    />
  );
}

/**
 * 自由画布。`chrome` 给了就同时渲染页头（标题 + 页面菜单）——那是 OnePage 页面的形态；
 * 首页不传（所有首页内容都属于这块画布）。
 */
export function FreeBoard({ boardId = HOME_BOARD_ID, orientation = HOME_ORIENTATION, chrome }: {
  boardId?: string;
  orientation?: Orientation;
  chrome?: { title: string };
} = {}): ReactNode {
  const tr = useT();
  const ops = useMemo(() => freeBoardOps(boardId, orientation), [boardId, orientation]);
  const items = useFreeBoard(boardId, orientation);
  /* 事件回调（窗口级键盘、浮层菜单）要读到最新的条目：state 在闭包里会过期，故用 ref 镜像。 */
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const { navigate } = useApp();
  const menu = useContextMenu();
  const defs = useMemo(() => allWidgetDefs(), []);
  const renderers = useRenderers();
  const hostRef = useRef<HTMLDivElement | null>(null);
  /* ── 无限画布的视口（2026-10-15 模型纠正）──
     画布自创建起就没有边界：内容在世界坐标里，这里只管"看哪一块"。视图按「板+朝向」记，
     存在 onethu.boardview.v1（视图不是文档，见 state/boardView.ts 的口径）。 */
  const phoneUi = useIsPhone();
  /** 横屏手机（宽 > 高，且是手机）：直接按电脑画布来，不堆叠。 */
  const [landscape, setLandscape] = useState<boolean>(() => typeof window !== "undefined" && window.innerWidth > window.innerHeight);
  useEffect(() => {
    const on = (): void => setLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const phonePortrait = phoneUi && !landscape;
  /* 手机竖屏的缩放单独一份（自由摆放默认 300%，不能把电脑首页也跟着放大）；横屏与电脑共用视图。 */
  const viewKey = boardViewKey(boardId, orientation) + (phonePortrait ? "|phone" : "");
  const view = useSyncExternalStore(subscribeView, () => readBoardView(viewKey), () => readBoardView(viewKey));
  const viewRef = useRef<BoardView>(view);
  viewRef.current = view;
  /** 视口尺寸 = **滚动端口**（外层可滚容器）的可见尺寸。
      ⚠️ 必须是端口而不是画布自己：画布盒子会跟着内容/倍率长，拿它当"视口"就是正反馈 ——
      放大一次盒子变大、"视口"跟着变大、缩回去盒子再也不缩（真机实测：250% 回到 100% 后
      minW 卡在 2704px，留一大片空滚）。端口尺寸只随窗口变，没有这条路。 */
  const [port, setPort] = useState({ w: 0, h: 0 });
  const compact = useIsSimpleLike();
  const [toolsVisible, setToolsVisible] = useState(false);
  /* 手机竖屏默认阅读顺序（堆叠）；打开「自由摆放」切回真画布，可拖动/缩放（仅完整模式：compact 下不出现）。 */
  const PHONE_CANVAS_KEY = "onethu.board.phoneCanvas.v1";
  const [phoneCanvas, setPhoneCanvas] = useState<boolean>(() => {
    try { return localStorage.getItem(PHONE_CANVAS_KEY) === "1"; } catch { return false; }
  });
  const togglePhoneCanvas = useCallback((): void => {
    setPhoneCanvas((prev) => {
      const next = !prev;
      try { localStorage.setItem(PHONE_CANVAS_KEY, next ? "1" : "0"); } catch { /* 配额满：仅本次生效 */ }
      if (next) {
        setZoom(5);
        window.setTimeout(() => sayRef.current("自由摆放：拖动卡片，点选后拉角点调大小"), 30);
      } else {
        sayRef.current("已回到阅读顺序");
      }
      return next;
    });
  }, []);
  const sayRef = useRef<(text: string) => void>(() => undefined);
  /** 持久化恢复自由摆放时视图可能还是旧的 100%：首进补到 300%。 */
  const zoomBooted = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [penOn, setPenOn] = useState(false);
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0]);
  /** 就地编辑中的条目（便笺 / 文字组件）。 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [folderPicker, setFolderPicker] = useState<{ itemId: string } | null>(null);
  /** 右键空白记住的落点：与「＋」共用同一个组件选择器，只有落点不同。 */
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null);
  /* ── 从旧白板页搬过来的三件能力 ── */
  /** 档位抽屉：addOpen = 添加组件；resizeFor 非空 = 「改变大小」。 */
  const [addOpen, setAddOpen] = useState(false);
  const [resizeFor, setResizeFor] = useState<{ id: string; defId: string; size: WidgetSize } | null>(null);
  /** 模板选择（空板引导之外的第二条入口）。 */
  const [tplOpen, setTplOpen] = useState(false);
  /** 「选择条目」的目标条目 id（模板组件用）。 */
  const [pickFor, setPickFor] = useState<string | null>(null);
  /** 一次性提示（「详情」与添加失败的原因）。 */
  const [note, setNote] = useState<string | null>(null);
  const wsSnap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => setToolsVisible(!!hostRef.current?.getClientRects().length));
    return () => cancelAnimationFrame(raf);
  }, [wsSnap.activeId, boardId]);
  /* 笔迹变化要跟着重渲染（快照本身不用取：下面按笔键直接读） */
  useSyncExternalStore(subscribePen, penSnapshot, penSnapshot);
  const penKey = penKeyOf(boardId, orientation);
  const penStrokes = strokesOf(penKey);

  /** 拖动/缩放的**进行时**覆盖（不落库，松手才 commit——localStorage 经不起每帧写） */
  const [live, setLive] = useState<{ id: string; rect: Rect } | null>(null);
  /** 拖动/缩放期间的吸附参考线（世界坐标；松手即清）。 */
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const liveRef = useRef(live);
  liveRef.current = live;

  const rectOf = (it: FreeItem): Rect =>
    live && live.id === it.id ? live.rect : { x: it.x, y: it.y, w: it.w, h: it.h };

  /* ── 手机竖屏：自由画布**叠成一列**（2026-10-16 用户口径「大量页面内容在竖屏下被截断」）──
     条目活在桌面世界坐标里（实测这块板内容宽 1094px），390 宽的竖屏上大半在屏幕外、还互相压。
     这里只改**渲染坐标**：按阅读顺序（先 y 后 x）从 0 起单列铺开，宽度吃满端口、高度沿用条目
     自己存的高度，间距 12；**存下来的摆位一个字节不动**——横屏与桌面照旧是那块自由画布。
     桌面与手机共用同一块世界坐标；手机竖屏只是把渲染排成阅读顺序，选中后在浮条里上下移/增减高。 */
  const stack = phonePortrait && orientation === "portrait" && !penOn && !phoneCanvas;
  const needsPenCanvas = !stack && (penOn || penStrokes.length > 0);
  // Both layouts share stored world geometry; phone browsing projects a reading order.
  const stackTop = 0;
  const stackRects = useMemo(() => {
    if (!stack) return null;
    const w = Math.max(240, Math.round(port.w || (typeof window === "undefined" ? 360 : window.innerWidth)));
    const ordered = [...items].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const map = new Map<string, Rect>();
    let y = stackTop;
    for (const it of ordered) {
      const h = Math.max(72, Math.round(it.spec.kind === "custom" && it.spec.id === "services" ? Math.max(340, it.h) : it.h));
      map.set(it.id, { x: 0, y, w, h });
      y += h + 12;
    }
    return { map, box: { w, h: Math.max(0, y - 12) + 24 } };
  }, [stack, items, port.w, stackTop]);

  // A viewport-relative 100% is distinct from the user's zoom. Capture authored
  // width once per board so dragging/resizing never changes scale mid-gesture.
  const reference = useRef<{key: string; width: number} | null>(null);
  if (reference.current?.key !== viewKey && items.length) {
    const bounds = contentRect(items);
    reference.current = {key: viewKey, width: Math.max(1104, bounds ? bounds.x + bounds.w : 0)};
  }
  const baseScale = port.w > 0 ? Math.min(1, port.w / ((reference.current?.width ?? 1104) + 8)) : 1;
  const displayScale = stack ? 1 : baseScale * view.z;
  const scaleRef = useRef(displayScale);
  scaleRef.current = displayScale;

  const say = useCallback((text: string): void => {
    setNote(text);
    window.setTimeout(() => setNote(null), 1800);
  }, []);

  sayRef.current = say;

  /* 按内容拟合 v3（2026-10-15）：旧白板有、新画布一直缺的能力 —— 用户报「不稳定，很多时候还会截断」。
     量体目标 = 条目盒的**直接子元素**（CSS `.free-item > :first-child { overflow:auto }` 就是它，
     card/custom 类外面还多套了一层 .wg-card，也就是它）——它的 scrollHeight 才是内容的自然高。
     谁触发重量（两路都要，单靠一路必漏）：
       ① ResizeObserver 盯住条目盒与卡体 —— 盖窗口缩放、面板显隐（隐藏面板 h=0，显出来那次会回调）、换档位；
       ② MutationObserver 盯住画布子树 —— 盖"盒子没变、内容变了"：课表/名单/余额异步回来、列表多一行。
          这一路是 「有时好有时坏」的真原因：ResizeObserver 只在**盒子尺寸**变化时回调，scrollHeight 变了
          它不响，所以第一版只能靠挂载那一次量到静止态。
     两路都用 rAF 合并，一秒内多次变化只量一次。口径：只长不缩（避免抖动与来回写盘）、差值 ≤2px 不动、
     folded 跳过（折叠态本来更小，不该被撑开）、写入口 `ops.fitHeight` 不置 manual（拟合是程序行为，
     不是用户动作）也不动 cell（契约层只随用户动作同步）。 */
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const cardOf = (el: HTMLElement): HTMLElement | null => {
      const wg = el.querySelector<HTMLElement>(":scope > .wg-card");
      if (wg) return wg;
      const first = el.querySelector(":scope > :not(.free-toolbar):not(.free-handle)");
      return first instanceof HTMLElement ? first : null;
    };
    const fits = new Map<string, number>(); // 上一次拟合值，防同一数值反复写盘
    const measure = (): void => {
      for (const it of items) {
        if (it.folded || (it.spec.kind === "custom" && it.spec.id === "homework")) continue;
        const el = host.querySelector<HTMLElement>('[data-item-id="' + it.id + '"]');
        const card = el && cardOf(el);
        if (!el || !card) continue;
        const contentH = card.scrollHeight; // 内容的自然高（卡片自己就是滚动体，见 CSS）
        const target = fitTarget(it.h, contentH, { manual: it.manual, fitted: it.fitted });
        if (target === null) continue;
        if (fits.get(it.id) === Math.round(target)) continue; // 已经为这个高度拟合过
        fits.set(it.id, Math.round(target));
        ops.fitHeight(it.id, target);
      }
    };
    let raf = 0;
    const schedule = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    measure();
    const ro = new ResizeObserver(schedule);
    for (const el of host.querySelectorAll<HTMLElement>("[data-item-id]")) {
      ro.observe(el);
      const card = cardOf(el);
      if (card) ro.observe(card);
    }
    const mo = new MutationObserver(schedule);
    mo.observe(host, { childList: true, subtree: true, characterData: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [items, ops]);

  /* 视口尺寸（盒子/适配用）。**普通滚轮不抢**：滚动容器就是无限画布的"平移" ——
     用户第二轮点名「出了内容框就被截断，我们要的是没有那个隐形的 frame」：
     一旦画布接管滚动，"盒子外面"就又成了一个会切东西的地方。只有捏合/⌘+滚轮要拦。 */
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const el = host.closest<HTMLElement>(".explorer-panel") ?? host.parentElement ?? host;
    const measure = (): void => {
      if (!el.getClientRects().length) return; // hidden tabs retain their last usable viewport
      const hostRect = host.getBoundingClientRect();
      const parentRect = el.getBoundingClientRect();
      const hostLeft = hostRect.left - parentRect.left;
      // The flowing panel grows with the canvas. Feeding its height back into
      // boxSize would add the home header on every ResizeObserver callback.
      const next = {
        w: Math.max(240, el.clientWidth - Math.max(0, hostLeft) * 2),
        h: Math.max(0, window.innerHeight - Math.max(0, hostRect.top - parentRect.top)),
      };
      setPort((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    /* **必须原生非被动监听**：React 的 onWheel 挂在根上且是被动的，preventDefault() 不生效，
       捏合会一边缩放一边把页面滚走。 */
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return; // 普通滚轮 / 两指滑 → 交给滚动容器
      e.preventDefault();
      setZoomRef.current(viewRef.current.z * Math.exp(-e.deltaY * 0.01));
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      host.removeEventListener("wheel", onWheel);
    };
  }, []);

  /* 盒子尺寸 = **永远盖住内容**（2026-10-15「不裁切」不变量，唯一实现处见 state/boardView.boxSize）。
     盒子跟着内容长、缩放一起算 —— 于是"内容落在盒子外面"在数学上不可能：
     不需要任何截断补救，也不需要用户学"拖空白处平移"，滚动条自然顶上。 */
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    /* 堆叠形态（手机竖屏）：盒子按**堆叠后**的几何算，否则 minWidth 仍是桌面内容的 1094px
       —— 那正是"竖屏横向溢出"残留的那一条。 */
    const box = stackRects ? stackRects.box : boxSize(items.map(it => live?.id === it.id ? { ...it, ...live.rect } : it), displayScale, { ...port, h: Math.max(port.h, needsPenCanvas ? BOARD_CANVAS_H : 0) }, 0);
    el.style.minWidth = box.w + "px";
    el.style.minHeight = box.h + "px";
  }, [items, live, displayScale, port.w, port.h, stackRects, needsPenCanvas]);

  /* 缩放（按钮 / 捏合 / 键盘共用）：落盘后把**滚动位置按同比例挪一下**，
     视线不会因为"内容整体缩小"而漂到别处（不这么做，缩完总得手动找回来）。 */
  const setZoom = useCallback((z: number): void => {
    const before = viewRef.current.z;
    const next = Math.min(ZOOM_MAX, Math.max(0.4, Number.isFinite(z) ? z : 1));
    if (next === before) return;
    setBoardView(viewKey, { z: next });
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const anchorX = Math.max(0, Math.min(r.width, window.innerWidth / 2 - r.left));
    const anchorY = Math.max(0, window.innerHeight / 2 - r.top);
    const ratio = next / (before > 0 ? before : 1);
    requestAnimationFrame(() => window.scrollBy({left: anchorX * (ratio - 1), top: anchorY * (ratio - 1), behavior: "instant"}));
  }, [viewKey]);
  const setZoomRef = useRef(setZoom);
  setZoomRef.current = setZoom;
  const zoomBy = useCallback((dir: number): void => setZoomRef.current(stepZoom(viewRef.current.z, dir)), []);
  const resetView = useCallback((): void => {
    setZoomRef.current(1);
  }, []);
  useEffect(() => {
    if (zoomBooted.current) return;
    zoomBooted.current = true;
    if (phonePortrait && phoneCanvas && viewRef.current.z < 4.5) setZoomRef.current(5);
  }, [phonePortrait, phoneCanvas]);

  useCanvasProbeImpl(viewKey, hostRef); // 临时探针（仅 dev）：定时上报，见函数头注释

  /* 键盘：Delete 删除选中、Esc 取消、方向键 8px 微调（输入框内不劫持） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!hostRef.current?.getClientRects().length) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;
      /* 画布缩放（无边记同款手感）：⌘0 回到内容、⌘= / ⌘- 缩放 */
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "0" || e.key === "=" || e.key === "+" || e.key === "-" || e.key === "_")) {
        e.preventDefault();
        if (e.key === "0") resetView();
        else zoomBy(e.key === "=" || e.key === "+" ? 1 : -1);
        return;
      }

      if (e.key === "Escape") {
        setSelected(null);
        setEditingId(null);
        return;
      }
      if (!selected) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        ops.remove(selected);
        setSelected(null);
        return;
      }
      const it = itemsRef.current.find((x) => x.id === selected);
      if (!it || it.pinned) return;
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8],
      };
      const d = delta[e.key];
      if (!d) return;
      e.preventDefault();
      if (e.shiftKey) ops.resize(selected, {x: it.x, y: it.y, w: Math.max(MIN_W, it.w + d[0]), h: Math.max(MIN_H, it.h + d[1])});
      else ops.move(selected, it.x + d[0], it.y + d[1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, ops]);

  /* 选中失焦：点画布空白、页面其它位置、或组件里的可交互内容都退出选中。
     选中的把手/浮条必须随手一点就收起来；
     组件本体仍交给它自己的选择/拖动管线（beginPointer），浮条与把手自己不清。 */
  useEffect(() => {
    if (!selected) return;
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".free-toolbar, .free-handle")) return;
      const item = target.closest(".free-item");
      if (item && hostRef.current?.contains(item)) {
        if (!target.closest('button, a, input, select, textarea, [role="button"], [role="tab"], .hw-carousel')) return;
      }
      setSelected(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [selected]);

  /** 条目右键 / 长按菜单（旧白板页的 openItemMenu，2026-10-15 搬到自由画布）。 */
  const openItemMenu = useCallback((item: FreeItem, x: number, y: number): void => {
    const view = viewOf(item);
    const plan = planForItem(view, defs);
    const def = defForSpec(item.spec, defs);
    const list: CtxItem[] = [];
    /* 模板组件（课程文件条目等）：选择显示哪一条具体项 */
    if (item.spec.kind === "custom" && ATOM_TEMPLATE_IDS.includes("custom:" + item.spec.id)) {
      const picked = !!item.spec.props && Object.keys(item.spec.props).length > 0;
      list.push({ key: "pick", label: picked ? "更换条目" : "选择条目", onSelect: () => setPickFor(item.id) });
    }
    /* 尺寸入口分两路：挡位控制 → 复用添加抽屉选档位；自由控制 → 选中出把手。 */
    if (def && isTierControlled(def)) {
      const defId = def.id;
      list.push({ key: "resize", label: tr("board.menu.resize"), onSelect: () => { setSelected(null); setResizeFor({ id: item.id, defId, size: plan.size }); } });
    } else {
      list.push({ key: "resize", label: tr("board.menu.freeResize"), onSelect: () => setSelected(item.id) });
    }
    if (def && def.editableProps && def.editableProps.length) {
      list.push({ key: "edit", label: tr("board.menu.edit"), onSelect: () => setEditingId(item.id) });
    }
    list.push({ key: "pin", label: item.pinned ? "取消固定" : "固定", onSelect: () => ops.pin(item.id) });
    list.push({ key: "front", label: tr("board.menu.front"), onSelect: () => ops.raise(item.id) });
    list.push({
      key: "vault",
      label: tr("board.menu.vault"),
      onSelect: () => {
        const r = addToVault({
          type: "board-item",
          title: plan.title || def?.title || "白板组件",
          sub: def?.description,
          board: { boardId, itemId: item.id },
          source: "白板",
        });
        say(r.ok ? tr("board.vault.ok") : r.reason === "duplicate" ? tr("board.vault.duplicate") : tr("board.vault.failed"));
      },
    });
    list.push({ key: "info", label: tr("board.menu.detail"), onSelect: () => say(def ? def.description : tr("board.unknownWidget")) });
    list.push({ key: "remove", label: tr("board.menu.remove"), danger: true, onSelect: () => { ops.remove(item.id); setSelected(null); } });
    menu.open({ x, y, title: plan.title, items: list });
  }, [boardId, defs, menu, ops, say, phoneUi]);

  /** 拖动/缩放共用指针管线：按下 → 窗口 move（直接写 live）→ up 落库；长按不动则出菜单。 */
  const beginPointer = (
    e: React.PointerEvent,
    id: string,
    mode: "move" | "se" | "ne" | "sw" | "nw" | "e" | "s",
  ): void => {
    if (penOn || stack || e.button !== 0) return;
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* Window listeners still track the gesture. */ }
    const it = itemsRef.current.find((x) => x.id === id);
    if (!it) return;
    e.stopPropagation();
    /* Only non-interactive bodies/handles enter this path. Capture keeps pen/touch
       gestures alive outside the item; the threshold suppresses drag-generated clicks. */
    setSelected(id);
    const sx = e.clientX;
    const sy = e.clientY;
    let armed = false;
    let longFired = false;
    let timer: number | null = null;
    /* 固定的组件：位置锁定（挡拖动/缩放），但仍可长按出菜单取消固定——否则就锁死了。 */
    if (it.pinned && mode === "move") {
      timer = window.setTimeout(() => openItemMenu(it, sx, sy), LONG_PRESS_MS);
      const onUpPinned = (): void => {
        window.removeEventListener("pointerup", onUpPinned);
        window.removeEventListener("pointercancel", onUpPinned);
        if (timer !== null) window.clearTimeout(timer);
      };
      window.addEventListener("pointerup", onUpPinned);
      window.addEventListener("pointercancel", onUpPinned);
      return;
    }
    /* 长按不动 = 出快捷菜单（与全站长按口径一致）；一旦位移超过阈值就收回菜单并转成拖动。 */
    timer = window.setTimeout(() => {
      if (gestureOwner() === "vault-drag") return;
      longFired = true;
      openItemMenu(it, sx, sy);
    }, LONG_PRESS_MS);
    /* 拖动即浮到与自己重叠的那簇之上（不惊动无关组件的图层序） */
    ops.raise(id);
    const orig: Rect = { x: it.x, y: it.y, w: it.w, h: it.h };
    const m: string = mode; // string 别名：避免 TS 对字面量联合做过强收窄
    const onMove = (ev: PointerEvent): void => {
      if (gestureOwner() === "vault-drag") return;
      const raw = { x: ev.clientX - sx, y: ev.clientY - sy };
      /* 手指走的是屏幕，条目活在世界上：位移要除以倍率（放大 2 倍时拖 100px = 世界 50px）。 */
      const moved = worldDelta(scaleRef.current, raw.x, raw.y);
      const dx = moved.x;
      const dy = moved.y;
      if (!armed) {
        if (Math.hypot(raw.x, raw.y) < DRAG_THRESHOLD) return; // 阈值按**屏幕**位移判（手感与倍率无关）
        armed = true;
        if (timer !== null) window.clearTimeout(timer);
        if (longFired) menu.close();
        /* 拖拽武装后吞掉本次手势派生的 click（capture 相位，先于一切目标）：
           否则拖完松手会误触组件内的按钮/链接。 */
        window.addEventListener("click", killClick, true);
      }
      /* Alt（macOS 上是 Option）= **临时关闭吸附**：要像素级位置时按住它拖。
         每帧都读 ev.altKey，所以拖到一半按下/松开也立即生效，不用重新起手。 */
      const free = ev.altKey;
      /* 吸附半径按**屏幕**给：换算到世界坐标要除以倍率，放大/缩小时手感一致。
         候选是除自己之外的所有磁贴（允许重叠的板子上它们就是"已有的边界线"）。 */
      const snapLimit = SNAP_DIST / (scaleRef.current || 1);
      const others = free ? [] : itemsRef.current
        .filter((o) => o.id !== id)
        .map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
      if (m === "move") {
        /* 跟手的矩形也要夹（与 clampRect/落库同口径）：拖出画布时视觉停在边界上，
           松手才不会"弹回去"——数据层的 x/y 夹取见 boardCore.withRect 的坐标口径。 */
        const raw = clampRect({ ...orig, x: orig.x + dx, y: orig.y + dy });
        /* 先夹再吸、吸完再夹：吸附结果可能贴到画布边，最终视觉必须等于落库值。 */
        const snapped = free ? { rect: raw, guides: [] as SnapGuide[] } : snapMove(raw, others, snapLimit);
        const next = { id, rect: clampRect(snapped.rect) };
        liveRef.current = next; setLive(next);
        setGuides(snapped.guides);
      } else {
        let { x, y, w, h } = orig;
        const west = m === "nw" || m === "sw" || m === "w";
        const north = m === "nw" || m === "ne" || m === "n";
        if (m === "se" || m === "ne" || m === "e" || west) w = orig.w + (west ? -dx : dx);
        if (m === "se" || m === "sw" || m === "s" || north) h = orig.h + (north ? -dy : dy);
        w = Math.max(MIN_W, w);
        h = Math.max(MIN_H, h);
        if (west) x = orig.x + orig.w - w;
        if (north) y = orig.y + orig.h - h;
        /* 缩放只吸**正在拖的那条边**（西/北把手吸左边时右边保持不动）。 */
        const box = { x: Math.max(0, x), y: Math.max(0, y), w, h };
        const snapped = free
          ? { rect: box, guides: [] as SnapGuide[] }
          : snapResize(box, others, m as SnapHandle, { limit: snapLimit, minW: MIN_W, minH: MIN_H });
        const next = { id, rect: clampRect(snapped.rect) };
        liveRef.current = next; setLive(next);
        setGuides(snapped.guides);
      }
    };
    const killClick = (ev: MouseEvent): void => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (timer !== null) window.clearTimeout(timer);
      /* click 在 pointerup 之后派发：延迟一拍再摘抑制器 */
      window.setTimeout(() => window.removeEventListener("click", killClick, true), 0);
      const cur = liveRef.current;
      if (cur && cur.id === id) {
        const r = clampRect(cur.rect);
        if (mode === "move") ops.move(id, r.x, r.y);
        else ops.resize(id, r);
      }
      liveRef.current = null; setLive(null); setGuides([]);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  /** 新条目的落点：右键/＋记下的位置优先，否则放在现有内容下方。 */
  const dropAt = (): { x: number; y: number } => {
    if (addAt) return addAt;
    return { x: 24, y: items.reduce((m, it) => Math.max(m, it.y + it.h), 80) + 24 };
  };

  const applyTemplate = (tpl: BoardTemplate): void => {
    /* 模板给的是格单位排版，落到自由画布上要映成 px（rectFromCell 同一套换算）。 */
    const next: BoardItem[] = tpl.id === "tpl-home" ? homeStarterItems() : templateItems(tpl).map((it) => {
      const rect = rectFromCell(it.cell);
      return { id: it.id, spec: it.spec, cell: it.cell, rect, manual: true };
    });
    if (freeBoardOps(boardId, orientation).replace(next)) {
      setTplOpen(false);
      setAddAt(null);
      setSelected(null);
      say(tr("board.template.applied", { name: tpl.name }));
    }
  };

  /** 屏幕点 → **世界点**（落点、双击加便笺、右键加组件都用它，缩放/平移后仍然指得准）。 */
  const canvasPos = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = hostRef.current?.getBoundingClientRect();
    if (!r) return { x: 40, y: 300 };
    return toWorld(scaleRef.current, clientX - r.left, clientY - r.top);
  };

  /** 组件的「打开」语义（与旧白板页一致）：跳转页 / 原子入口。 */
  const onOpen = (boardItem: BoardItem): void => {
    const spec = boardItem.spec;
    if (spec.kind === "nav") {
      navigate(spec.page as never, spec.params as never);
      return;
    }
    if (spec.kind === "atom-link") {
      const ref = atomRefFromKey(spec.ref);
      const view = ref ? resolveAtom(ref) : null;
      if (!view) {
        say(tr("board.link.invalid"));
        return;
      }
      view.open(navigate);
    }
  };

  const pickItem = pickFor ? itemsRef.current.find((x) => x.id === pickFor) : undefined;
  const resizeDef = useMemo(
    () => (resizeFor ? defs.find((d) => d.id === resizeFor.defId) ?? null : null),
    [resizeFor, defs],
  );

  return (
    <div
      className={"freeboard-wrap" + (phoneUi && (phoneCanvas || landscape) ? " phone-canvas" : "")}
      data-coach="home-canvas"
    >
      {chrome ? (
        <PageHead
          title={chrome.title}
          meta="直接拖动卡片摆放，选中后拉角点调整大小；底部工具栏可调整画布比例"
          menu={[
            { key: "add-widget", label: tr("board.menu.addWidget"), onSelect: () => setAddOpen(true) },
            { key: "apply-tpl", label: tr("board.menu.templates"), onSelect: () => setTplOpen(true) },
            ...(phonePortrait && orientation === "portrait" && !compact
              ? [{ key: "phone-canvas", label: phoneCanvas ? "阅读顺序" : "自由摆放", onSelect: togglePhoneCanvas }]
              : []),
            { key: "pen", label: penOn ? "画笔：关" : "画笔：开", onSelect: () => setPenOn((v) => !v) },
            /* 「所有 OnePage」：删掉旧白板页之后，这里是列表页在 UI 里的入口（另一条通路是 OneGO） */
            { key: "all-boards", label: tr("board.menu.allBoards"), onSelect: () => navigate("boards") },
          ]}
        />
      ) : (
        <div className="workbench-board-head">
          <div>
            <h2>{i18n("auto.components.FreeBoard.6")}</h2>
            <span>{stack ? "阅读顺序：点右侧「自由摆放」可拖动、缩放" : "拖动卡片摆放，选中后拖动边角调整大小"}</span>
          </div>
          <div className="workbench-board-actions">
            {phonePortrait && orientation === "portrait" && !compact ? (
              <Btn variant="outline" size="sm" aria-pressed={phoneCanvas} onClick={togglePhoneCanvas}>
                {phoneCanvas ? "阅读顺序" : "自由摆放"}
              </Btn>
            ) : null}
            <Btn variant="ghost" onClick={() => setTplOpen(true)}>{i18n("auto.components.FreeBoard.7")}</Btn>
          </div>
        </div>
      )}
      {chrome && items.length === 0 ? (
        <Card>
          <Empty text="这块白板还是空的。可以从模板开始，或从「＋」添加一个组件。" />
          {/* 空板引导：三套预制排版，点一下就有东西可看 */}
          <div className="board-tpl-row">
            {BOARD_TEMPLATES.map((tpl) => (
              <Btn key={tpl.id} variant="outline" data-template={tpl.id} onClick={() => applyTemplate(tpl)}>
                {tpl.name}
              </Btn>
            ))}
          </div>
        </Card>
      ) : null}
      <div
        className={"freeboard" + (chrome ? " is-page" : "")}
        ref={hostRef}
        onPointerDown={(e) => {
          /* 画布空白（含世界层）按下 = 取消选中；组件自身的按下不走这里。 */
          if (!(e.target as HTMLElement).closest(".free-item")) setSelected(null);
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest(".free-item")) return;
          e.preventDefault();
          e.stopPropagation();
          /* 右键空白与「＋」同一个组件选择器（缩略图 + 搜索）；右键记住落点。 */
          setAddAt(canvasPos(e.clientX, e.clientY));
          setAddOpen(true);
        }}
      >
        <div
          className="freeboard-world"
          style={{ "--board-z": displayScale } as CSSProperties}
        >
        {/* ── 世界层（2026-10-15 无限画布）──
            条目与笔迹都活在**世界坐标**里，这一层只负责"看哪一块"：translate(x,y) + scale(z)。
            把 contentRect 当边界是**反模型**的写法（那正是旧盒子模型的老路），这里只做变换。 */}

          {/* 吸附参考线：拖动/缩放期间才出现，画在世界坐标里（跟着缩放走）。
              线盖住「正在拖的边 + 被对齐的那条边」的跨度，用户能看懂是谁跟谁对齐了。 */}
          {guides.map((g, i) => (
            <div
              key={"guide." + i}
              className="free-guide"
              aria-hidden="true"
              style={g.axis === "x"
                ? { left: g.pos, top: g.from, width: 1, height: Math.max(1, g.to - g.from) }
                : { top: g.pos, left: g.from, height: 1, width: Math.max(1, g.to - g.from) }}
            />
          ))}

          {items.map((it) => {
            const r = stackRects?.map.get(it.id) ?? rectOf(it);
            /* 档位排版钩子：CSS 是**无作用域**的 [data-size=...] 选择器（抽屉预览与画布同一条规则），
               所以自由画布上的条目也要带上它——统计卡/入口行的分档排版才不会只在抽屉里生效。 */
            const plan = planForItem(viewOf(it), defs);
            const isSel = selected === it.id;
            const isNote = it.spec.kind === "custom" && it.spec.id === "note";
            const isText = it.spec.kind === "text";
            const editingNow = editingId === it.id && (isNote || isText);
            return (
              <div
                key={it.id}
                data-item-id={it.id}
                data-vault-catch={JSON.stringify({type:"board-item",title:plan.title,board:{boardId,itemId:it.id},source:"白板"})}
                data-widget={it.spec.kind === "custom" ? it.spec.id : it.spec.kind}
                data-item={it.spec.kind}
                data-note-tone={isNote && it.spec.kind === "custom" ? String(it.spec.props?.tone ?? "yellow") : undefined}
                data-size={plan.size.w + "x" + plan.size.h}
                data-manual={it.manual ? "1" : undefined}
                data-fitted={it.fitted ? "1" : undefined}
                data-folded={it.folded ? "1" : undefined}
                className={"free-item" + (isNote ? " is-note" : "") + (isSel ? " is-selected" : "") + (penOn ? " is-penlocked" : "") + (live && live.id === it.id ? " is-live" : "") + (it.pinned ? " is-pinned" : "")}
                style={{ left: r.x, top: r.y, width: r.w, height: r.h, opacity: it.opacity ?? 1 }}
                onPointerDown={(e) => {
                  if (penOn || editingNow) return;
                  const target = e.target as HTMLElement;
                  if (target.closest(".free-handle, .free-toolbar, textarea, input, select, button, a, [role=button], [role=tab], .hw-carousel")) return;
                  /* 手机竖屏是阅读顺序投影（坐标被重排），点一下只负责选中；拖动/缩放只在桌面世界坐标里。 */
                  if (stack) { e.stopPropagation(); setSelected(it.id); return; }
                  beginPointer(e, it.id, "move");
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (isNote || isText) {
                    setSelected(it.id);
                    setEditingId(it.id);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (penOn) return;
                  setSelected(it.id);
                  ops.bringToFront(it.id);
                  openItemMenu(it, e.clientX, e.clientY);
                }}
              >
                {/* 折叠态：只留标题条（toolbar 的「展开」还原） */}
                {it.folded ? (
                  <div className="free-folded" title={i18n("auto.components.FreeBoard.8")}>
                    <span className="free-note-dot" aria-hidden="true" />
                    <span>{i18n("auto.components.FreeBoard.9")}</span>
                  </div>
                ) : (
                <>
                {/* 便笺与文字：内容可就地编辑（双击进入） */}
                {editingNow ? (
                  <textarea
                    className="free-note-editor"
                    aria-label={isNote ? "便笺内容" : "文字内容"}
                    onChange={(e) => ops.props(it.id, { text: e.currentTarget.value })}
                    autoFocus
                    defaultValue={isNote
                      ? (it.spec.kind === "custom" && typeof it.spec.props?.text === "string" ? it.spec.props.text : "")
                      : (it.spec.kind === "text" ? it.spec.text : "")}
                    onBlur={(e) => {
                      const text = e.target.value;
                      if (it.spec.kind === "custom") ops.props(it.id, { ...it.spec.props, text });
                      else ops.props(it.id, { text });
                      setEditingId(null);
                    }}
                  />
                ) : (
                  <ItemBody
                    item={it}
                    defs={defs}
                    renderers={renderers}
                    onOpen={onOpen}
                    onFolderAdd={() => setFolderPicker({ itemId: it.id })}
                    onProps={(props) => ops.props(it.id, props)}
                  />
                )}
                </>
                )}

                {/* 选中浮条：置顶 / 折叠（便笺）/ 透明度 / 固定 / 删除 */}
                {isSel && !penOn ? (
                  <div className="free-toolbar" onPointerDown={(e) => e.stopPropagation()}>
                    {phoneUi ? <>
                      {[-1, 1].map(dir => <button key={dir} type="button" title={dir < 0 ? "上移" : "下移"} onClick={() => {
                        const sorted = [...itemsRef.current].sort((a, b) => a.y - b.y || a.x - b.x);
                        const at = sorted.findIndex(x => x.id === it.id); const other = sorted[at + dir];
                        if (!other || it.pinned || other.pinned) return;
                        ops.move(it.id, other.x, other.y); ops.move(other.id, it.x, it.y);
                      }}>{dir < 0 ? "↑" : "↓"}</button>)}
                      <Btn variant="ghost" titleAttr={tr("board.toolbar.growTitle")} onClick={() => ops.resize(it.id, {x: it.x, y: it.y, w: it.w, h: it.h + 48})}>{tr("board.toolbar.grow")}</Btn>
                      <Btn variant="ghost" titleAttr={tr("board.toolbar.shrinkTitle")} onClick={() => ops.resize(it.id, {x: it.x, y: it.y, w: it.w, h: Math.max(MIN_H, it.h - 48)})}>{tr("board.toolbar.shrink")}</Btn>
                    </> : null}
                    {isNote || isText ? <button type="button" title={i18n("auto.components.FreeBoard.10")} onClick={() => setEditingId(it.id)}>{i18n("auto.components.FreeBoard.10")}</button> : null}
                    <button type="button" title={i18n("auto.components.FreeBoard.11")} onClick={() => ops.raise(it.id)}>⤒</button>
                    {isNote ? (
                      <button
                        type="button"
                        title={it.folded ? "展开" : "折叠"}
                        className="free-note-toggle"
                        onClick={() => ops.fold(it.id, !it.folded)}
                      >
                        {it.folded ? " 展开" : "折叠"}
                      </button>
                    ) : null}
                    <button type="button" title={i18n("auto.components.FreeBoard.12")} onClick={() => {
                      const steps = [1, .75, .5, .3]; const at = steps.indexOf(it.opacity ?? 1);
                      ops.opacity(it.id, steps[(at + 1) % steps.length] ?? 1);
                    }}>{Math.round((it.opacity ?? 1) * 100)}%</button>
                    <button type="button" title={it.pinned ? "取消固定" : "固定位置"} className={"free-op free-pin" + (it.pinned ? " is-on" : "")} onClick={() => ops.pin(it.id)}>{it.pinned ? "解锁" : "固定"}</button>
                    <button type="button" title={i18n("auto.components.FreeBoard.13")} className="is-danger" onClick={() => { ops.remove(it.id); setSelected(null); }}>
                      <IconTrash width={13} height={13} />
                    </button>
                  </div>
                ) : null}

                {/* 把手：四角 + 右/下（选中才出现；固定的组件不出把手） */}
                {isSel && !penOn && !it.pinned && !stack
                  ? (["nw", "ne", "sw", "se", "e", "s"] as const).map((h) => (
                      <span
                        key={h}
                        role="button" aria-label={"调整大小 " + h}
                        className={"free-handle fh-" + h}
                        onPointerDown={(ev) => beginPointer(ev, it.id, h)}
                      />
                    ))
                  : null}
              </div>
            );
          })}

        </div>

        {/* 画笔层：恒在最高层（组件盖不住）；开启时接管指针绘画。
            笔迹按「板 id + 朝向」分键（penKeyOf），所以每块 OnePage 各画各的。
            **在世界层之外**：笔迹是"玻璃上的记号"，尺寸固定、与内容无关（2026-10-13 用户点名），
            所以它不跟着缩放走 —— 归一化坐标（0..1000）也就永远稳定，不会因为改内容而拉伸重映射。 */}
        {needsPenCanvas ? (
          <BoardPenLayer
            boardId={boardId}
            orientation={orientation}
            penOn={penOn}
            color={penColor}
          />
        ) : null}

        {toolsVisible && !compact ? createPortal(<div className={"board-viewport-tools" + (penOn ? " is-pen-open" : "")} role="toolbar" aria-label={i18n("auto.components.FreeBoard.14")}>
          <Btn size="sm" data-coach="home-add" icon={<IconPlus />} onClick={() => { setAddAt(null); setAddOpen(true); }}>{i18n("auto.components.FreeBoard.15")}</Btn>
          {stack ? null : <>
            <span className="board-tool-divider" />
            <IconBtn label={i18n("auto.components.FreeBoard.16")} icon={<OgIconMinus />} disabled={view.z <= ZOOM_MIN} onClick={() => zoomBy(-1)} />
            <Btn size="sm" variant="ghost" titleAttr={tr("board.zoom.reset")} onClick={resetView}>{zoomLabel(view.z)}</Btn>
            <IconBtn label={i18n("auto.components.FreeBoard.17")} icon={<OgIconPlus />} disabled={view.z >= ZOOM_MAX} onClick={() => zoomBy(1)} />
            <Btn size="sm" icon={<IconPen />} selected={penOn} aria-pressed={penOn} onClick={() => {setPenOn(v => !v); setSelected(null);}}>{i18n("auto.components.FreeBoard.18")}</Btn>
          </>}
          {penOn ? (
            <div className="free-pen-panel">
              <BoardPenToolbar
                color={penColor}
                onColor={setPenColor}
                onUndo={() => undoStroke(penKey)}
                onClear={() => clearStrokes(penKey)}
                canUndo={penStrokes.length > 0}
              />
            </div>
          ) : null}
        </div>, document.body) : null}

      </div>

      {/* 文件夹入口选择器：一级功能 / OnePage / 工作区 */}
      {folderPicker && !compact
        ? createPortal(
            <div className="hs-more-mask" onClick={() => setFolderPicker(null)}>
              <div className="hs-more" role="dialog" aria-label={i18n("auto.components.FreeBoard.2")} onClick={(e) => e.stopPropagation()}>
                <div className="hs-more-head">
                  <span>{i18n("auto.components.FreeBoard.19")}</span>
                  <button type="button" className="hs-close" aria-label={i18n("auto.components.FreeBoard.20")} onClick={() => setFolderPicker(null)}>
                    <IconX width={14} height={14} />
                  </button>
                </div>
                {(() => {
                  const target = itemsRef.current.find((x) => x.id === folderPicker.itemId);
                  if (!target || target.spec.kind !== "custom") return null;
                  const entries = Array.isArray(target.spec.props?.entries)
                    ? (target.spec.props?.entries as Array<{ kind: string; page?: string; label?: string; boardId?: string; wsId?: string }>)
                    : [];
                  const baseProps = target.spec.props as Record<string, unknown> | undefined;
                  const append = (en: { kind: string; page?: string; label?: string; boardId?: string; wsId?: string }): void => {
                    ops.props(folderPicker.itemId, { ...baseProps, entries: [...entries, en] });
                  };
                  return (
                    <div className="free-add-list">
                      <div className="hs-detail-group-name">{i18n("auto.components.FreeBoard.21")}</div>
                      {NAV.map((n) => (
                        <button
                          key={n.page}
                          type="button"
                          className="hs-detail-row"
                          onClick={() => append({ kind: "page", page: n.page, label: n.label })}
                        >
                          <span>{n.label}</span>
                        </button>
                      ))}
                      <div className="hs-detail-group-name">OnePage</div>
                      {loadBoard()
                        .boards.filter((b) => b.kind === "user")
                        .map((b) => (
                          <button key={b.id} type="button" className="hs-detail-row" onClick={() => append({ kind: "onepage", boardId: b.id, label: b.name })}>
                            <span>{b.name}</span>
                          </button>
                        ))}
                      <div className="hs-detail-group-name">{i18n("auto.components.FreeBoard.22")}</div>
                      {wsSnap.workspaces.length === 0 ? (
                        <div className="hs-op-hint">{i18n("auto.components.FreeBoard.23")}</div>
                      ) : (
                        wsSnap.workspaces.map((w) => (
                          <button key={w.id} type="button" className="hs-detail-row" onClick={() => append({ kind: "ws", wsId: w.id, label: w.name })}>
                            <span>{w.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* 套用模板（空板引导之外的第二条入口，同一份纯逻辑） */}
      <ActionSheet
        open={tplOpen}
        title={i18n("auto.components.FreeBoard.24")}
        items={BOARD_TEMPLATES.map((tpl) => ({
          id: tpl.id,
          label: tpl.name + " · " + tpl.description,
          onSelect: () => applyTemplate(tpl),
        }))}
        onClose={() => setTplOpen(false)}
      />

      {/* 添加组件抽屉：常驻渲染（自己管退场动画）；「改变大小」复用同一个抽屉（自动选中当前档位） */}
      <BoardAddDrawer
        open={!compact && (addOpen || !!resizeFor || !!resizeDef)}
        defs={defs}
        renderers={renderers}
        mode={resizeFor ? "resize" : "add"}
        target={resizeFor ? { defId: resizeFor.defId, size: resizeFor.size } : null}
        extras={[
          {
            id: "extra-folder",
            title: i18n("auto.components.FreeBoard.p1"),
            description: "圆形 logo 网格：收纳一级入口、OnePage 与工作区",
            pick: () => {
              const at = dropAt();
              ops.add({ kind: "custom", id: "folder", props: { title: i18n("auto.components.FreeBoard.p2"), entries: [] } }, at.x, at.y, 180, 180);
              setAddOpen(false);
              setAddAt(null);
            },
          },
          ...loadBoard().boards.filter((b) => b.kind !== "system").map((b) => ({
            id: "extra-onepage-" + b.id,
            title: b.name,
            description: "把这块 OnePage 钉到画布上（点击即打开）",
            pick: () => {
              const at = dropAt();
              ops.add({ kind: "custom", id: "onepage", props: { boardId: b.id } }, at.x, at.y, 150, 84);
              setAddOpen(false);
              setAddAt(null);
            },
          })),
        ]}
        onAdd={(d, size) => {
          const at = dropAt();
          const key = JSON.stringify(d.spec);
          if (itemsRef.current.some((it) => JSON.stringify(it.spec) === key)) {
            say(tr("board.add.duplicate"));
            return;
          }
          const px = pxSizeOf(size);
          const spec = d.spec.kind === "custom"
            ? { kind: "custom" as const, id: d.spec.id, props: d.spec.props }
            : JSON.parse(JSON.stringify(d.spec));
          ops.add(spec, at.x, at.y, px.w, px.h);
          say(tr("board.add.done", { title: d.title, w: size.w, h: size.h }));
          setAddOpen(false);
          setAddAt(null);
        }}
        onResize={(_d, size) => {
          if (!resizeFor) return;
          const cur = itemsRef.current.find((it) => it.id === resizeFor.id);
          if (!cur) return;
          const px = pxSizeOf(size);
          ops.resize(resizeFor.id, { x: cur.x, y: cur.y, w: px.w, h: px.h });
          setResizeFor(null);
          say(tr("board.resize.done", { w: size.w, h: size.h }));
        }}
        onClose={() => {
          setAddOpen(false);
          setResizeFor(null);
        }}
      />

      {/* 「选择条目」：模板组件（课程文件等）选一条具体项，定位参数写进 spec.props */}
      {pickItem ? (
        <TemplateItemPicker
          item={pickItem}
          onPick={(props) => {
            ops.props(pickItem.id, props);
            setPickFor(null);
            say(tr("board.select.done"));
          }}
          onClose={() => setPickFor(null)}
        />
      ) : null}

      {note ? <div className="board-note" role="status">{note}</div> : null}
    </div>
  );
}

/**
 * OnePage 页面壳：页头 + 自由画布（+ 手机档的底部抽屉）。
 *
 * 取代已退役的 pages/BoardPage.tsx —— 页面 id 仍是 `board`（深链 #/board/<板 id> 照旧），
 * 画布换成与首页同一块自由白板；「所有 OnePage」入口在页头菜单里（另一条通路是 OneGO）。
 */
/** 临时几何探针（仅 dev，2026-10-15，取证后删）：无限画布的"不裁切"要看**真 app** 的数字。
 *  每 3s 报一条（只在**自己这块画布可见**时）：面板/画布/盒子的最小尺寸、内容外接框、
 *  世界层倍率、缩放条上的百分比、逐条目"盒子高 vs 卡体内容高"（!!CUT 即内容被切）。 */
function useCanvasProbeImpl(_boardKey: string, hostRef: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return; // 生产不跑
    const report = (): void => {
      const host = hostRef.current;
      if (!host) return;
      const panel = host.closest<HTMLElement>(".explorer-panel");
      if (!panel || panel.getBoundingClientRect().height < 2) return; // 隐藏标签页：不报（每块画布各挂一条，只报可见的）
      const pcs = getComputedStyle(panel);
      const cs = getComputedStyle(host);
      const world = host.querySelector<HTMLElement>(".freeboard-world");
      const bar = document.querySelector<HTMLElement>(".board-zoombar");
      const items = Array.from(host.querySelectorAll<HTMLElement>(".free-item"));
      const rows = items.map((it) => {
        const r = it.getBoundingClientRect();
        const inner = it.querySelector<HTMLElement>(".wg-card") ?? it.firstElementChild;
        const ish = inner ? inner.scrollHeight : 0;
        const ih = inner ? Math.round(inner.getBoundingClientRect().height) : 0;
        const flags = (it.dataset.manual === "1" ? "M" : "") + (it.dataset.fitted === "1" ? "C" : "") + (it.dataset.folded === "1" ? "F" : "");
        return `${it.dataset.itemId ?? "?"}[${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} card=${ih}/${ish}${flags ? " " + flags : ""}${ish > ih + 2 ? "!!CUT" : ""}]`;
      });
      /* 不裁切不变量的**现场判据**：内容最右下角（含倍率）必须落在盒子里；
         盒子比视口高 → 面板必须能滚到（sh > ch）。 */
      /* **视觉**外接框（getBoundingClientRect 含 transform）：不裁切说的是"屏幕上看到的
         东西都在盒子里"，所以必须用量出来的 rect，不能用 offsetLeft（它看不见缩放）。 */
      const hr = host.getBoundingClientRect();
      const maxRight = items.reduce((m, it) => { const r = it.getBoundingClientRect(); return Math.max(m, r.right - hr.left); }, 0);
      const maxBottom = items.reduce((m, it) => { const r = it.getBoundingClientRect(); return Math.max(m, r.bottom - hr.top); }, 0);
      const inner = host.querySelector<HTMLElement>(".freeboard-world") ?? host;
      const line = [
        "[canvas]",
        `key=${_boardKey}`,
        `win=${innerWidth}x${innerHeight}`,
        `panel[h=${Math.round(panel.getBoundingClientRect().height)} ch=${panel.clientHeight} sh=${panel.scrollHeight} oy=${pcs.overflowY} cls="${panel.className}"]`,
        `canvas[h=${Math.round(host.getBoundingClientRect().height)} w=${Math.round(host.getBoundingClientRect().width)} minH="${cs.minHeight}" minW="${cs.minWidth}" ov=${cs.overflow}]`,
        `contentVis=[${Math.round(maxRight)},${Math.round(maxBottom)}] box=${host.clientWidth}x${host.clientHeight} boxOK=${maxRight <= host.clientWidth + 1 && maxBottom <= host.clientHeight + 1}`,
        world ? `world="${world.style.getPropertyValue("--board-z")}"` : "world=null",
        `zoom="${bar?.textContent?.trim() ?? "?"}" fab=${document.querySelectorAll(".free-fab").length}`,
        `items=${items.length}`,
        `boxes=[${rows.join(" ")}]`,
        `worldLayer=${inner === host ? "-" : "yes"}`,
      ].join(" ");
      void import("@tauri-apps/api/core").then((m) => m.invoke("log_debug", { line: new Date().toISOString() + " | " + line })).catch(() => undefined);
    };
    const iv = window.setInterval(report, 3000);
    report();
    /* 一次性**缩放自检**（仅 dev，取证后与探针一起删）：缩放这条路上我没法用鼠标点，
       就在真 app 里走一遍真代码：50% → 量数字 → 还原 100%。
       验的是：世界层真的缩放、盒子跟着重算（minH 变小）、内容仍在盒子里（boxOK）、
       缩放条上的百分比跟着变。 */
    if (!zoomSelfTested && new URLSearchParams(window.location.search).has("board-zoom-selftest")) {
      zoomSelfTested = true;
      const mark = (tag: string): void => {
        const host = hostRef.current;
        if (!host) return;
        const cs = getComputedStyle(host);
        const bar = document.querySelector<HTMLElement>(".board-zoombar");
        const hr = host.getBoundingClientRect();
        const maxRight = Array.from(host.querySelectorAll<HTMLElement>(".free-item")).reduce((m, it) => Math.max(m, it.getBoundingClientRect().right - hr.left), 0);
        const maxBottom = Array.from(host.querySelectorAll<HTMLElement>(".free-item")).reduce((m, it) => Math.max(m, it.getBoundingClientRect().bottom - hr.top), 0);
        const line = `[zoom-selftest] ${tag} z=${host.querySelector<HTMLElement>(".freeboard-world")?.style.getPropertyValue("--board-z") ?? "?"} label=${bar?.textContent?.trim() ?? "?"} minH="${cs.minHeight}" minW="${cs.minWidth}" vis=[${Math.round(maxRight)},${Math.round(maxBottom)}] box=${host.clientWidth}x${host.clientHeight} boxOK=${maxRight <= host.clientWidth + 1 && maxBottom <= host.clientHeight + 1}`;
        void import("@tauri-apps/api/core").then((m) => m.invoke("log_debug", { line: new Date().toISOString() + " | " + line })).catch(() => undefined);
      };
      window.setTimeout(() => {
        mark("before");
        setBoardView(_boardKey, { z: 2.5 });
        window.setTimeout(() => {
          mark("at250");
          setBoardView(_boardKey, { z: 1 });
          window.setTimeout(() => mark("restored"), 600);
        }, 700);
      }, 2500);
    }
    return () => window.clearInterval(iv);
  }, [_boardKey, hostRef]);
}
/** 自检只跑一次（模块级，跨重渲染） */
let zoomSelfTested = false;

export function OnePageSurface(): ReactNode {
  const [doc, setDoc] = useState<BoardDoc>(() => loadBoard());
  /* OneGO / 收藏星 / 星标在别处改了板文档 → 重读（否则刚新建的 OnePage 打不开） */
  useEffect(() => {
    const on = (): void => setDoc(loadBoard());
    window.addEventListener("onethu.boards.changed", on);
    return () => window.removeEventListener("onethu.boards.changed", on);
  }, []);
  const board = activeBoard(doc);
  /* 朝向按设备：平板横竖屏各有一套布局（与旧白板页同一口径；缺 landscape 时回落 portrait）。 */
  const [portrait] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(orientation: portrait)").matches : true,
  );
  const orientation: Orientation = portrait ? "portrait" : "landscape";
  const phoneUi = useIsPhone();
  const mobSnap = useSheetSnap("onepage");
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const sheet = useSheetDrag(sheetRef, { id: "onepage" });

  const body: ReactNode = board
    ? <FreeBoard boardId={board.id} orientation={orientation} chrome={{ title: board.name }} />
    : (
      <Card>
        <Empty text="这块 OnePage 已经不存在了。" />
      </Card>
    );
  if (!phoneUi) return body;
  return (
    <div
      ref={sheetRef}
      className={
        "onepage-sheet" +
        (sheet.dragging ? " is-mob-drag" : mobSnap === "full" ? " is-mob-full" : " is-mob-half")
      }
      style={sheet.dragH != null ? { height: `${sheet.dragH}px` } : undefined}
    >
      <PhoneSheetGrip label={i18n("auto.components.FreeBoard.25")} gripProps={sheet.gripProps} />
      <div className="onepage-sheet-body">{body}</div>
    </div>
  );
}

import { ensureNoOverlap } from "./boardReflow.js";
import { FIT_DEAD_ZONE } from "./boardFit.js";
/**
 * 白板文档核心（纯逻辑 + 依赖注入，不依赖任何视图模块）。
 *
 * 与 state/board.ts 的分工：本文件管「模型 / 解析 / 单元格换算 / 迁移与读写（依赖注入）」，
 * 能被 node 护栏直接加载并真实测试；board.ts 负责把今日页的布局、排序与卡片注册表接进来。
 * 这样拆是硬约束使然：注册表 import 了 .tsx 图标，而 node 不能剥离 JSX。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §3 / §6.1。
 */
export const BOARD_KEY = "onethu.board.v1";
export const SYSTEM_BOARD_ID = "board.today";
/** 基准列数：手机 4 列（PC 宽窗按 §6.1 折算为 8 列，即 1 基准单位 = 2 列）。 */
/** 窄屏（手机）列数：基准单位就是它，文档里的 x/w 都以此为单位。 */
export const BOARD_COLS = 4;
/** 宽屏（平板 / PC 宽窗）列数：同一份文档在宽屏上占满需要 8 个基准单位。 */
export const BOARD_COLS_WIDE = 8;
/** 宽窄屏分界（px）：与仓库既有断点一致（§2.8.2 的 PC 阈值）。 */
export const BOARD_WIDE_MIN = 840;

/**
 * 视口宽度 → 列数（霖 2026-10-11：按宽窄屏适配，不是按平台；为安卓平板而来）。
 *
 * 口径：**基准单位不变**（1 单位 = 手机 1 列）。所以手机 4 列占满、平板 8 列占满，
 * 同一份文档两种宽度都读得通——手机上 `w=4` 是整宽，平板上是半宽、一行能放两张。
 */
export function colsForWidth(width: number): number {
  return width >= BOARD_WIDE_MIN ? BOARD_COLS_WIDE : BOARD_COLS;
}
/**
 * 基准瓦片高（px）：**格单位的高度含义**（1 行 = TILE_H），格↔px 迁移按它换算。
 * 旧网格画布（.board-canvas 的 grid-auto-rows）2026-10-15 已随白板页退役，
 * 现在它只服务迁移与契约空间（配套 TILE_W 见下），不再与任何 CSS 成对。
 */
export const TILE_H = 88;
/** 行间距（与 CSS gap 一致）。 */
export const TILE_GAP = 8;

/** main 栏占 3 基准单位、rail 占 1：与今日页现状的两栏比例同构。 */
export const MAIN_W = 3;

/* ── px 自由图层（2026-10-15）──────────────────────────────────────────────
   一块板（首页系统板 / 用户 OnePage）只有**一份**数据：BoardItem。
   cell 是网格语义（插件/OH 的 ext.onePage 契约读的就是它，见 plugins/facade.ts），
   rect 是可选的 px 矩形——自由图层（components/FreeBoard.tsx）按 px 摆放，允许重叠。
   两者靠下面这对换算保持同步：拖动/缩放写 rect 时同时把 cell 派生回去（withRect），
   于是「自由画布」与「网格契约」不会各说各话（这正是之前两套数据不同源的病根）。 */

/**
 * 迁移基准画布内宽（px）。格→px 必须有一个**与视口无关**的确定宽度：否则同一条目
 * 在手机/平板会算出不同 px，一旦落盘布局就随窗口漂移。取「4 基准列满铺」为参考画布。
 */
export const BOARD_PAD = 8;
/** 基准瓦片宽（px）：与 TILE_H 同口径，4 个基准单位 + 3 道间距 + 两侧内边距 = 参考画布宽。 */
export const TILE_W = 90;
export const CANVAS_REF_W = BOARD_PAD * 2 + TILE_W * BOARD_COLS + TILE_GAP * (BOARD_COLS - 1);
/** 自由层的缩放下限（与 state/freeBoard.ts 的 MIN_W / MIN_H 同口径）。 */
export const RECT_MIN_W = 120;
export const RECT_MIN_H = 64;
/** 脏数据上限（旧键/手写 JSON 的防御）：只夹下限不够——`w=99999` 会渲染成占满屏的大件。 */
export const RECT_MAX_W = 1600;
export const RECT_MAX_H = 4000;

export type Orientation = "portrait" | "landscape";

export type WidgetSpec =
  | { kind: "atom-link"; ref: string }
  | { kind: "nav"; page: string; params?: unknown; label?: string }
  | { kind: "card"; card: string }
  | { kind: "text"; text: string; variant: "label" | "title" }
  | { kind: "divider" }
  | { kind: "custom"; id: string; props?: Record<string, unknown> };

export interface BoardCell { x: number; y: number; w: number; h: number }

/** px 矩形（自由图层）：x/y 取画布左上角原点，w/h 是像素。 */
export interface BoardRect { x: number; y: number; w: number; h: number }

export interface BoardItem {
  /** 用户手动设过尺寸：拟合（按内容自动调高矮）必须**让着它** —— 只补排版税级的缺口，别跟用户打架。 */
  manual?: boolean;
  /** 这个高度是**程序按内容拟合**出来的：内容再变（课表回来、名单多一行）继续由拟合负责，
      不受 `manual` 的缺口限制。用户一旦自己拖动/缩放（`withRect`）就交回控制权 —— 清掉它。 */
  fitted?: boolean;
  id: string;
  spec: WidgetSpec;
  cell: BoardCell;
  /** px 矩形（可选）：缺省即「没在这个板子上自由摆过」，渲染时由 cell 迁移（rectOf）。 */
  rect?: BoardRect;
  collapsed?: boolean;
  pinned?: boolean;
  /** 自由图层的折叠态（便笺收起成标题条）与透明度四档之一。 */
  folded?: boolean;
  opacity?: number;
  props?: Record<string, unknown>;
}

export interface Board {
  id: string;
  name: string;
  icon: string;
  kind: "system" | "user";
  /** 按朝向各存一份；landscape 缺省时由 portrait 回落（§6.1）。 */
  cells: Partial<Record<Orientation, BoardItem[]>>;
}

export interface BoardDoc {
  homeLayoutVersion?: number;
  v: 1;
  boards: Board[];
  activeBoardId: string;
  /** 今日页的排序模式（auto / manual），随文档一起走。 */
  order: unknown;
}

export interface LayoutLike { id: string; col: "main" | "rail" | "off"; collapsed: boolean }

/** 应用侧注入的依赖：注册表与持久化。核心因此可以被 node 护栏真实驱动。 */
export interface BoardDeps {
  knownIds: readonly string[];
  loadLayoutItems: (o: Orientation) => LayoutLike[] | null;
  resolveLayout: (saved: LayoutLike[] | null) => LayoutLike[];
  loadOrder: () => unknown;
  saveOrder: (s: unknown) => void;
  storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void };
}

/** 空板常量：系统板缺失时的渲染兜底（正常路径不会走到）。 */
export const EMPTY_BOARD: Board = { id: "", name: "", icon: "", kind: "user", cells: {} };

export function isOrientation(x: unknown): x is Orientation {
  return x === "portrait" || x === "landscape";
}

export function isCell(x: unknown): x is BoardCell {
  const c = x as BoardCell | null;
  return !!c && [c.x, c.y, c.w, c.h].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) && c.w >= 1;
}

export function isItem(x: unknown): x is BoardItem {
  const it = x as BoardItem | null;
  return !!it && typeof it.id === "string" && typeof it.spec === "object" && it.spec !== null && isCell(it.cell);
}

/** px 矩形的合法判据：只要求「是个真矩形」（尺寸为正、数都是有限数）。
    缩放下限（RECT_MIN_*）是**写入**时的夹取口径，不能拿它判合法性——
    格→px 迁移出来的单格矩形（90×88）本身就比下限小，那是合法的旧布局。 */
export function isRect(x: unknown): x is BoardRect {
  const r = x as BoardRect | null;
  return !!r && [r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && Number.isFinite(n)) && r.w > 0 && r.h > 0;
}

/* ── 格 ↔ px 双向迁移 ─────────────────────────────────────────────────────
   正向（格→px）用于「从没自由摆过的条目」首次上自由画布；反向（px→格）用于把用户的
   px 拖动/缩放**派生**回网格契约。两者必须互为逆运算——护栏逐格验证往返相等。 */

/** 列起点（px）：x=0 贴左内边距，每个基准单位 = 瓦片宽 + 一道间距。 */
export function pxFromCol(x: number): number {
  return BOARD_PAD + x * (TILE_W + TILE_GAP);
}

/** 列跨度（px）：w 个单位 = w 个瓦片 + (w-1) 道间距（单个单位不留空档）。 */
export function pxFromSpan(w: number, tile: number, gap: number): number {
  return w * tile + Math.max(0, w - 1) * gap;
}

/** 格 → px 矩形（迁移正方向）。 */
export function rectFromCell(cell: BoardCell): BoardRect {
  const w = Math.max(1, Math.round(cell.w));
  const h = Math.max(1, Math.round(cell.h));
  return {
    x: pxFromCol(Math.max(0, cell.x)),
    y: Math.max(0, cell.y) * (TILE_H + TILE_GAP),
    w: pxFromSpan(w, TILE_W, TILE_GAP),
    h: pxFromSpan(h, TILE_H, TILE_GAP),
  };
}

/** px 矩形 → 格（迁移反方向）：四舍五入到最近的格，再夹进列内（宽不得越界）。 */
export function cellFromRect(rect: BoardRect, cols: number = BOARD_COLS): BoardCell {
  const limit = Math.max(1, Math.round(cols));
  const w = Math.min(limit, Math.max(1, Math.round((rect.w + TILE_GAP) / (TILE_W + TILE_GAP))));
  const h = Math.max(1, Math.round((rect.h + TILE_GAP) / (TILE_H + TILE_GAP)));
  const x = Math.max(0, Math.round((rect.x - BOARD_PAD) / (TILE_W + TILE_GAP)));
  return { x: Math.max(0, Math.min(x, limit - w)), y: Math.max(0, Math.round(rect.y / (TILE_H + TILE_GAP))), w, h };
}

/**
 * 取条目的 px 矩形：**只算不写**——没自由摆过的条目每次渲染都由格迁移，
 * 用户真的拖过一次才落 rect（存储里不会平白多出一堆 px 快照）。
 */
export function rectOf(item: BoardItem): BoardRect {
  return item.rect ?? rectFromCell(item.cell);
}

/**
 * 把 px 矩形写回条目：rect 记 px，cell 同步派生（插件/OH 契约读 cell，必须一致）。
 *
 * 坐标口径：**x/y 一并夹到 ≥ 0**。自由画布的原点在左上角，条目被拖到画布外就"不见了"，
 * 而 cell 那边看着一切正常（cellFromRect 会把负坐标夹成 0），排查起来极难——所以写入层
 * 直接不许负坐标落地（拖动在视觉上也按同口径夹住，见 FreeBoard 的 live 矩形）。
 *
 * cell 派生走 **4 列基准**（BOARD_COLS），与活网格在宽屏的 8 列（colsForWidth）无关：
 * BoardPage 退役后 cell 的唯一消费者是插件/OH 的 ext.onePage 契约，那套坐标一直是基准单位。
 */
export function withRect(item: BoardItem, rect: BoardRect, cols: number = BOARD_COLS): BoardItem {
  const fixed: BoardRect = {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    w: Math.max(RECT_MIN_W, Math.round(rect.w)),
    h: Math.max(RECT_MIN_H, Math.round(rect.h)),
  };
  /* 用户接管尺寸：记 `manual`，并**清掉 `fitted`** —— 拟合把高度当自己的责任，用户一动手就该交权，
     否则下次内容变长又会自动撑开，跟用户的意图打架。 */
  return { ...item, rect: fixed, cell: cellFromRect(fixed, cols), manual: true, fitted: undefined };
}

/** 由 px 矩形直接造一个板条目（迁移/新增共用；cell 同步派生，见 withRect 的坐标口径）。 */
export function pxBoardItem(
  id: string,
  spec: WidgetSpec,
  rect: BoardRect,
  extra?: { folded?: boolean; opacity?: number },
  cols: number = BOARD_COLS,
): BoardItem {
  const base: BoardItem = { id, spec, cell: cellFromRect(rect, cols) };
  if (extra?.folded) base.folded = true;
  if (typeof extra?.opacity === "number") base.opacity = extra.opacity;
  return withRect(base, rect, cols);
}

/**
 * 非法 rect **只回落成「没存过」**（丢给 rectOf 走格迁移），不让整份文档作废：
 * rect 是显示层的派生字段，坏一个不该连累用户全部内容。cell 仍按 isItem 严格校验。
 */
function cleanItem(it: BoardItem): BoardItem {
  const bad = it.rect !== undefined && !isRect(it.rect);
  const opacity = typeof it.opacity === "number" && Number.isFinite(it.opacity) ? Math.min(1, Math.max(0.25, it.opacity)) : undefined;
  if (!bad && opacity === it.opacity && (it.folded === undefined || it.folded === true)) return it;
  const out: BoardItem = { ...it, folded: it.folded === true ? true : undefined };
  if (bad) delete out.rect;
  else if (it.rect) out.rect = { ...it.rect };
  out.opacity = opacity;
  return out;
}

/** 解析：任何一处不合法都回落 null（由调用方决定默认值），绝不半信半疑地渲染。 */
export function parseBoard(raw: string | null): BoardDoc | null {
  if (!raw) return null;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  const d = obj as BoardDoc | null;
  if (!d || d.v !== 1 || !Array.isArray(d.boards) || d.boards.length === 0) return null;
  for (const b of d.boards) {
    if (!b || typeof b.id !== "string" || typeof b.name !== "string" || (b.kind !== "system" && b.kind !== "user")) return null;
    if (!b.cells || typeof b.cells !== "object") return null;
    for (const key of Object.keys(b.cells)) {
      if (!isOrientation(key)) return null;
      const list = (b.cells as Record<string, unknown>)[key];
      if (!Array.isArray(list) || !list.every(isItem)) return null;
    }
  }
  if (typeof d.activeBoardId !== "string") return null;
  if (!d.boards.some((b) => b.id === d.activeBoardId)) return null;
  if (!d.order || typeof d.order !== "object") return null;
  /* 校验通过后再做一次**派生字段**清理（rect / opacity / folded）：不改语义，
     只把非法 rect 丢成「没存过」（回落格迁移），避免一个坏 px 矩形让整份文档作废。 */
  const boards: Board[] = d.boards.map((b) => {
    const cells: Board["cells"] = {};
    for (const o of Object.keys(b.cells) as Orientation[]) cells[o] = (b.cells[o] ?? []).map(cleanItem);
    return { ...b, cells };
  });
  return { ...d, boards };
}

/** 今日页布局 → 单元格（main 占左 3 单位、rail 占右 1 单位；y = 栏内序）。 */
export function layoutToCells(items: readonly LayoutLike[]): BoardItem[] {
  const main = items.filter((i) => i.col === "main");
  const rail = items.filter((i) => i.col === "rail");
  const out: BoardItem[] = [];
  main.forEach((i, y) => out.push({ id: "today." + i.id, spec: { kind: "custom", id: i.id }, cell: { x: 0, y, w: MAIN_W, h: 1 }, collapsed: i.collapsed }));
  rail.forEach((i, y) => out.push({ id: "today." + i.id, spec: { kind: "custom", id: i.id }, cell: { x: MAIN_W, y, w: BOARD_COLS - MAIN_W, h: 1 }, collapsed: i.collapsed }));
  return out;
}

/** 单元格 → 今日页布局（含 off：knownIds 里存在但不在板上的卡，保持既有下游语义）。 */
export function cellsToLayout(items: readonly BoardItem[], knownIds: readonly string[]): LayoutLike[] {
  const seen = new Set<string>();
  const out: LayoutLike[] = [];
  for (const it of items) {
    if (it.spec.kind !== "custom") continue;
    const id = it.spec.id;
    seen.add(id);
    out.push({ id, col: it.cell.x >= MAIN_W ? "rail" : "main", collapsed: it.collapsed === true });
  }
  for (const id of knownIds) {
    if (!seen.has(id)) out.push({ id, col: "off", collapsed: false });
  }
  return out;
}

/** 取某朝向的单元格；缺省回落到 portrait（§6.1 的比例映射在实现前先做直通）。 */
export function cellsOf(board: Board, o: Orientation): BoardItem[] {
  return board.cells[o] ?? board.cells.portrait ?? [];
}

/** 由现状生成系统板。**迁移必须读真实存储的布局**（按朝向各一份），否则会抹掉用户自定义。 */
export function buildSystemBoard(deps: BoardDeps): Board {
  const cells: Board["cells"] = {};
  for (const o of ["portrait", "landscape"] as const) {
    cells[o] = layoutToCells(deps.resolveLayout(deps.loadLayoutItems(o)));
  }
  return { id: SYSTEM_BOARD_ID, name: "首页", icon: "today", kind: "system", cells };
}

export function defaultBoardDoc(deps: BoardDeps): BoardDoc {
  const board = buildSystemBoard(deps);
  const fresh = deps.loadLayoutItems("portrait") == null && deps.loadLayoutItems("landscape") == null;
  if (fresh) for (const o of ["portrait", "landscape"] as const) board.cells[o] = homeStarterItems();
  const doc: BoardDoc = { v: 1, boards: [board], activeBoardId: board.id, order: deps.loadOrder(), homeLayoutVersion: fresh ? 2 : undefined };
  return migrateHomeCanvas(doc);
}

/* ── 首屏起步排版（2026-10-19）──────────────────────────────────────────────
   四列基准：264 宽 + 16 间距 = 280 一档，整宽 1104（与 services 同口径）。

   版式对着「信息密度优先」的首页截图：顶部一级功能区整条通栏，下面四列各自成
   短卡片瀑布——左列是窄统计卡，右边三列是等宽的中卡，最后一行四张矮卡收口。
   所有相邻边界都落在同一条线上（间距统一 16），既好看也是吸附功能的样板。

   id 保持稳定（home.clock / home.services …）：删除记录按 id 记，改动排版不能
   让用户删掉的卡片复活。 */
const STARTER_COL = 264;
const STARTER_GAP = 16;
const starterCol = (i: number): number => i * (STARTER_COL + STARTER_GAP);

/** Stable IDs and explicit revision make deletion permanent after the one-time migration. */
export function homeStarterItems(): BoardItem[] {
  const [c0, c1, c2, c3] = [starterCol(0), starterCol(1), starterCol(2), starterCol(3)];
  return [
    /* 顶部整宽：一级功能区（待办 / 课程 / 日程 … 九个入口） */
    pxBoardItem("home.services", {kind: "custom", id: "services"}, {x: 0, y: 0, w: 1104, h: 176}),
    /* 第一行：概览 · 时钟 · 日期 · 天气 */
    pxBoardItem("home.overview", {kind: "custom", id: "today-overview"}, {x: c0, y: 192, w: STARTER_COL, h: 176}),
    pxBoardItem("home.clock", {kind: "custom", id: "clock"}, {x: c1, y: 192, w: STARTER_COL, h: 200}),
    pxBoardItem("home.date", {kind: "custom", id: "date"}, {x: c2, y: 192, w: STARTER_COL, h: 200}),
    pxBoardItem("home.weather", {kind: "custom", id: "weather"}, {x: c3, y: 192, w: STARTER_COL, h: 200}),
    /* 左列中段：校园卡 + 今日待办（两段短卡把左列填到与右侧大卡同底） */
    pxBoardItem("home.balanceStrip", {kind: "custom", id: "balance-strip"}, {x: c0, y: 384, w: STARTER_COL, h: 140}),
    pxBoardItem("home.tasks", {kind: "custom", id: "homework"}, {x: c0, y: 540, w: STARTER_COL, h: 250}),
    /* 第二行：下一节课 · 今日预约 · 今日课程 */
    pxBoardItem("home.nextClass", {kind: "custom", id: "next-class"}, {x: c1, y: 408, w: STARTER_COL, h: 250}),
    pxBoardItem("home.resv", {kind: "custom", id: "resv"}, {x: c2, y: 408, w: STARTER_COL, h: 250}),
    pxBoardItem("home.classes", {kind: "custom", id: "classes"}, {x: c3, y: 408, w: STARTER_COL, h: 250}),
    /* 收口行：校园卡余额 · 订阅新闻 · 全部作业（四张矮卡同底） */
    pxBoardItem("home.balance", {kind: "custom", id: "cardEntry"}, {x: c1, y: 674, w: STARTER_COL, h: 116}),
    pxBoardItem("home.news", {kind: "custom", id: "news"}, {x: c2, y: 674, w: STARTER_COL, h: 116}),
    pxBoardItem("home.assignments", {kind: "custom", id: "learn-assignments"}, {x: c3, y: 674, w: STARTER_COL, h: 116}),
  ];
}

/**
 * 2026-10 之前的「头部三件」（时钟 / 问候 / 一级功能区）。
 *
 * 只给 migrateHomeCanvas 用：老文档（homeLayoutVersion < 2）当年缺的是这三块固定
 *  chrome，补回它们才能让老用户的画布跟升级前一致。**不跟着新排版变**——否则老用户
 * 一升级就多出三张当年并不存在的卡片。
 */
function legacyHeadItems(): BoardItem[] {
  return [
    pxBoardItem("home.clock", {kind: "custom", id: "clock"}, {x: 0, y: 0, w: 280, h: 132}),
    pxBoardItem("home.greeting", {kind: "text", text: "把今天，安排好。", variant: "title"}, {x: 304, y: 0, w: 800, h: 132}),
    pxBoardItem("home.services", {kind: "custom", id: "services"}, {x: 0, y: 156, w: 1104, h: 196}),
  ];
}

export function migrateHomeCanvas(doc: BoardDoc): BoardDoc {
  if ((doc.homeLayoutVersion ?? 0) >= 2) return doc;
  return {...doc, homeLayoutVersion: 2, boards: doc.boards.map(board => {
    if (board.id !== SYSTEM_BOARD_ID) return board;
    const cells = {...board.cells};
    for (const o of Object.keys(cells) as Orientation[]) {
      const items = cells[o] ?? [];
      // Previously chrome was outside the document. Make room without losing any authored cards.
      const head = legacyHeadItems().filter(seed => !items.some(it => it.spec.kind === "custom" && seed.spec.kind === "custom" && it.spec.id === seed.spec.id));
      const shifted = items.map(it => {
        const r = rectOf(it);
        return {...it, rect: {...r, y: r.y + 376}, cell: cellFromRect({...r, y: r.y + 376})};
      });
      cells[o] = [...head, ...shifted];
    }
    return {...board, cells};
  })};
}

/* ══════════════════════════════════════════════════════════════════════════
   写入口的唯一不变量：**落库的文档里，格子不许重叠**。

   这条原来挂在白板页的 `apply()` 上（「无论哪个操作漏了让位，写进去的文档都不会重叠」），
   2026-10-15 白板页退役时被一起带走了 —— 而插件/OH 的 `ext.onePage*`（facade 直写 cell）、
   OneGO、收藏落点、自由画布四条路都还在往里写，于是"叠在一起的卡片"又回来了
   （oh-wire 的对抗性验证反例①）。

   现在把漏斗放在**持久化本身**（saveBoard / 载入修复），而不是每个写操作各记一次：
   谁写都得过这道闸，将来新增写路径也不会漏。口径：
     · 只修 `cell`（契约层坐标），**不碰 `rect`** —— 重叠在自由画布上是特性（用户点名要的
       「可以互相覆盖」），画布位置由 rect 决定（rectOf 优先 rect），拆格子不会挪动视觉；
     · 不可变：没有重叠时返回**同一引用**（调用方据此判断"要不要真写盘"）；
     · 载入即修复一次并落盘（历史/手写脏数据不能永远叠着）；文档没坏时零副作用。
   ══════════════════════════════════════════════════════════════════════════ */

/** 文档级重叠修复：逐板逐朝向把重叠的格子拆开（只动 cell）。无变化返回原引用。 */
export function repairOverlaps(doc: BoardDoc): BoardDoc {
  let touched = false;
  const boards: Board[] = doc.boards.map((b) => {
    let cells = b.cells;
    for (const o of Object.keys(b.cells) as Orientation[]) {
      const list = b.cells[o] ?? [];
      if (list.length < 2) continue;
      const safe = ensureNoOverlap(list);
      if (!safe.some((it, i) => !sameCell(it.cell, list[i]?.cell))) continue;
      if (cells === b.cells) cells = { ...b.cells };
      cells[o] = safe;
      touched = true;
    }
    return cells === b.cells ? b : { ...b, cells };
  });
  return touched ? { ...doc, boards } : doc;
}

/**
 * 网格残留清零（2026-10-15 用户点名：「旧的今日假白板的数据从来没有消失过」）。
 *
 * 旧假白板（BoardPage 的四/八列网格）留下的 `cell` **不该再决定屏幕上任何位置**：
 * 只要条目没有 px `rect`，就把它**落进自由层** —— 接在现有内容下方（左对齐、沿用网格派生的
 * **尺寸**，只换位置），并顺手用 `withRect` 把 `cell` 按新 rect 反算回去。自此 `cell` 只是
 * 「插件/OH 契约层的镜像」，不再是布局来源；网格坐标再深也只影响契约读数，不影响视觉。
 *
 * 同一次里把**系统板的旧名「今日」改成「首页」**：`defaultBoardDoc` 的默认名只对新文档生效，
 * 老文档的 name 必须迁移（否则首页标题/OnePage 页头永远显示旧名）。
 *
 * 幂等：全部条目都有 rect 且名字已对 → 返回**同一引用**（调用方据此决定不写盘）。
 */
export function purgeGridResidue(doc: BoardDoc): BoardDoc {
  let changed = false;
  const boards: Board[] = doc.boards.map((b) => {
    const renamed = b.kind === "system" && b.name === "今日";
    let cells = b.cells;
    let cellsChanged = false;
    for (const o of Object.keys(b.cells) as Orientation[]) {
      const list = b.cells[o] ?? [];
      if (!list.some((it) => !it.rect)) continue; // 全都有 px：这一档不欠账
      let bottom = 0;
      for (const it of list) if (it.rect) bottom = Math.max(bottom, it.rect.y + it.rect.h);
      let cursor = bottom > 0 ? bottom + TILE_GAP : 0;
      const fixed = list.map((it) => {
        if (it.rect) return it;
        const size = rectFromCell(it.cell); // 网格只贡献"多大"，不再贡献"在哪"
        const r: BoardRect = { x: BOARD_PAD, y: cursor, w: size.w, h: size.h };
        cursor += size.h + TILE_GAP;
        /* ⚠️ 这里**故意不用 withRect**：那条路会把 cell 按新 rect 反算，
           而 cell 是插件/OH 的**契约层**（`ext.onePageAddItem` 写它、`ext.onePageItems` 读它，
           口径是"写什么读回什么"）。给视觉补 px 却改写契约坐标，会让插件下次读到自己没写过的格子
           （oh-wire 的不重叠守栏当场抓到三条反例：契约口径、只写 cell 的路、落库与预览一致）。
           所以：只补 `rect`（视觉），**cell 原样保留**、`manual` 也不置（见下）；
           用户一旦拖动/缩放，仍走 withRect 把两边同步回一致 —— 那一刻的"用户意图"才是权威。 */
        /* ⚠️ 不要置 manual：manual 的语义是"**用户**定过尺寸，别再按内容拟合"，
           而这尺寸是我们按网格算的。置了它，条目就永远停在网格派生的高度上 ——
           卡片内容一高就被切（用户截图实测「截断」正是这么来的）。留空 = 允许画布按内容拟合。 */
        return { ...it, rect: r };
      });
      if (!cellsChanged) {
        cells = { ...b.cells };
        cellsChanged = true;
      }
      cells[o] = fixed;
    }
    if (!renamed && !cellsChanged) return b;
    changed = true;
    return renamed ? { ...b, name: "首页", cells } : { ...b, cells };
  });
  return changed ? { ...doc, boards } : doc;
}

function sameCell(a: BoardCell, b: BoardCell | undefined): boolean {
  return !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** 读文档：缺失或损坏 → 迁移一份并落盘；已在但带重叠 → 修一次并落盘；否则**原样返回**（幂等）。 */
export function loadBoard(deps: BoardDeps): BoardDoc {
  const store = deps.storage ?? globalThis.localStorage;
  const parsed = parseBoard(store?.getItem(BOARD_KEY) ?? null);
  if (!parsed) {
    const fresh = defaultBoardDoc(deps);
    saveBoard(fresh, deps);
    return fresh;
  }
  const safe = repairOverlaps(migrateHomeCanvas(purgeGridResidue(parsed)));
  if (safe !== parsed) saveBoard(safe, deps);
  return safe;
}

export function saveBoard(doc: BoardDoc, deps: BoardDeps): void {
  try {
    /* 唯一写入口：任何来源（页面 / 自由画布 / 插件 / OH / OneGO）都过这道不变量 */
    const safe = repairOverlaps(purgeGridResidue(doc));
    (deps.storage ?? globalThis.localStorage)?.setItem(BOARD_KEY, JSON.stringify(safe));
    if (safe.order && typeof safe.order === "object") deps.saveOrder(safe.order);
  } catch {
    /* 存储失败（配额/隐私模式）：保持内存态可用，由调用方决定是否提示 */
  }
}

export function systemBoard(doc: BoardDoc): Board | null {
  return doc.boards.find((b) => b.kind === "system") ?? null;
}

/**
 * 当前应渲染的板：优先 activeBoardId 指向的那块（用户在收藏夹列表里选的就是它），
 * 缺了才回落到系统板。写死 systemBoard 会让用户板永远打不开（本轮实测踩过）。
 */
export function activeBoard(doc: BoardDoc): Board | null {
  return doc.boards.find((b) => b.id === doc.activeBoardId) ?? systemBoard(doc);
}

/* ══════════════════════════════════════════════════════════════════════════
   自由图层（px）条目操作 —— 纯函数，落库与 UI 手势共用同一套口径。

   为什么这些也放在 core：白板页（BoardPage）退役后，自由画布是**唯一的**编辑面，
   「拖一下改什么」必须能被 node 护栏逐条驱动（视图只负责把指针换算成这里的调用）。
   列表操作返回 null = 本次没有实质变化（调用方据此跳过写盘）。
   ══════════════════════════════════════════════════════════════════════════ */

/** 自由画布上的一个条目（渲染模型）：px 矩形 + spec + 自由层两个字段。 */
export interface BoardPxItem {
  id: string;
  spec: WidgetSpec;
  x: number;
  y: number;
  w: number;
  h: number;
  folded?: boolean;
  opacity?: number;
  /** 位置锁定（自由画布上=挡拖动/缩放；面板上的「钉」） */
  pinned?: boolean;
  /** 用户手动定过尺寸（拖动/四角缩放写过 rect）——「按内容拟合」必须**让着它**（只补排版税级的缺口） */
  manual?: boolean;
  /** 高度由程序按内容拟合（见 BoardItem.fitted） */
  fitted?: boolean;
}

export function rectHit(a: BoardRect, b: BoardRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function toPxItem(item: BoardItem): BoardPxItem {
  const r = rectOf(item);
  const spec = item.spec.kind === "custom" && item.props
    ? { ...item.spec, props: { ...item.spec.props, ...item.props } } : item.spec;
  const out: BoardPxItem = { id: item.id, spec, x: r.x, y: r.y, w: r.w, h: r.h };
  if (item.folded === true) out.folded = true;
  if (typeof item.opacity === "number") out.opacity = item.opacity;
  if (item.pinned === true) out.pinned = true;
  if (item.manual === true) out.manual = true;
  if (item.fitted === true) out.fitted = true;
  return out;
}

export function toPxItems(items: readonly BoardItem[]): BoardPxItem[] {
  return items.map(toPxItem);
}

function sameRect(a: BoardRect, b: BoardRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** 改一条：未命中或改完没变 → null（UI 不必重渲染，也不写盘）。 */
function patchPx(items: readonly BoardItem[], id: string, patch: (it: BoardItem) => BoardItem): BoardItem[] | null {
  const i = items.findIndex((x) => x.id === id);
  const it = i < 0 ? undefined : items[i];
  if (!it) return null;
  const next = patch(it);
  if (next === it) return null;
  const out = items.slice();
  out[i] = next;
  return out;
}

/** 移动：x/y 夹到 ≥ 0（画布外看不见，见 withRect 的坐标口径）。 */
export function movePx(items: readonly BoardItem[], id: string, x: number, y: number, cols: number = BOARD_COLS): BoardItem[] | null {
  return patchPx(items, id, (it) => {
    const r = rectOf(it);
    const nx = Math.max(0, Math.round(x));
    const ny = Math.max(0, Math.round(y));
    if (nx === r.x && ny === r.y) return it;
    return withRect(it, { ...r, x: nx, y: ny }, cols);
  });
}

/** 缩放：宽高夹到下限（120×64），x/y 夹到 ≥ 0——与 BoardPage 的四边把手同一套算术结论。 */
export function resizePx(items: readonly BoardItem[], id: string, rect: BoardRect, cols: number = BOARD_COLS): BoardItem[] | null {
  return patchPx(items, id, (it) => {
    const r = rectOf(it);
    const next = withRect(it, { ...r, ...rect }, cols);
    return next.rect && sameRect(next.rect, r) ? it : next;
  });
}

/**
 * **按内容拟合**（2026-10-15 补：旧白板有、新画布一直缺 —— 用户报「不稳定，很多时候还会截断」）：
 * 只把高度长到需要值（只长不缩，避开抖动）。**不置 `manual`**（那是"用户定过尺寸"的语义，
 * 拟合是程序行为，置了它下次内容再长就没人管了）、**置 `fitted`**（声明这份高度由拟合负责，
 * 下一次内容再长还归它管，见 FitOpts）、**不动 `cell`**（契约层坐标只由用户动作同步）。
 */
export function fitHeightPx(items: readonly BoardItem[], id: string, h: number): BoardItem[] | null {
  return patchPx(items, id, (it) => {
    const r = rectOf(it);
    const want = Math.max(RECT_MIN_H, Math.round(h));
    if (want <= r.h + FIT_DEAD_ZONE) return it;
    return { ...it, rect: { ...r, h: want }, fitted: true };
  });
}

/** 折叠（便笺收起）：只是显示态，不动几何。 */
export function foldPx(items: readonly BoardItem[], id: string, folded: boolean): BoardItem[] | null {
  return patchPx(items, id, (it) => ((it.folded === true) === folded ? it : { ...it, folded: folded || undefined }));
}

/** 透明度四档（1 / 0.75 / 0.5 / 0.3；夹到 0.25~1）。 */
export function opacityPx(items: readonly BoardItem[], id: string, opacity: number): BoardItem[] | null {
  const v = Math.min(1, Math.max(0.25, opacity));
  return patchPx(items, id, (it) => (it.opacity === v ? it : { ...it, opacity: v }));
}

/**
 * 改写条目内容/属性：文字组件写 `spec.text`（内容就取自那里），其余写 `spec.props`。
 * 口径与 grid 时代的 boardEdit.setItemProps 一致——文字、文件夹入口、模板选择器共用这一条。
 */
export function propsPx(items: readonly BoardItem[], id: string, props: Record<string, unknown> | undefined): BoardItem[] | null {
  return patchPx(items, id, (it) => {
    const spec: WidgetSpec = it.spec.kind === "custom"
      ? { ...it.spec, props: { ...it.spec.props, ...it.props, ...props } }
      : it.spec.kind === "text" && typeof props?.text === "string" ? { ...it.spec, text: props.text } : it.spec;
    return { ...it, spec, props: { ...it.props, ...props } };
  });
}

/** 固定（位置锁定）：自由画布上=挡拖动/缩放，右键菜单仍可取消固定（否则就锁死了）。 */
export function pinPx(items: readonly BoardItem[], id: string): BoardItem[] | null {
  return patchPx(items, id, (it) => ({ ...it, pinned: !it.pinned }));
}

export function removePx(items: readonly BoardItem[], id: string): BoardItem[] | null {
  if (!items.some((it) => it.id === id)) return null;
  return items.filter((it) => it.id !== id);
}

/** 置顶（无条件挪到数组末尾 = 最上层）。 */
export function bringToFrontPx(items: readonly BoardItem[], id: string): BoardItem[] | null {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0 || i === items.length - 1) return null;
  const out = items.slice();
  const it = out.splice(i, 1)[0];
  if (!it) return null;
  out.push(it);
  return out;
}

/**
 * 聪明图层调整：只升到**与自己重叠的那一簇**的最高层之上，无关组件的图层序完全不动
 * （霖 2026-10-13 定案；没有重叠时什么都不发生）。
 */
export function raiseAboveOverlappingPx(items: readonly BoardItem[], id: string): BoardItem[] | null {
  const i = items.findIndex((x) => x.id === id);
  const me = i < 0 ? undefined : items[i];
  if (!me) return null;
  const mine = rectOf(me);
  let target = i;
  for (let j = i + 1; j < items.length; j += 1) {
    const other = items[j];
    if (other && rectHit(mine, rectOf(other))) target = j;
  }
  if (target === i) return null;
  const out = items.slice();
  const it = out.splice(i, 1)[0];
  if (!it) return null;
  /* 移除 i 后原 target 处的元素前移一位；插到 target 位 = 紧贴它上方 */
  out.splice(target, 0, it);
  return out;
}

/** 追加一条（放最上层）：调用方给 id 与 px 矩形。 */
export function appendPx(items: readonly BoardItem[], id: string, spec: WidgetSpec, rect: BoardRect, extra?: { folded?: boolean; opacity?: number }, cols: number = BOARD_COLS): BoardItem[] {
  return [...items, pxBoardItem(id, spec, rect, extra, cols)];
}

/* ── 旧「首页自由板」键（onethu.freeboard.home.v1）的兼容读取与并入 ─────────
   老用户的首页摆位全在那个键里，不能丢；而系统板里同 spec 的条目正是当年被
   seedFromLegacyOnce 复制过去的那批——两条都留着就是双份，所以按 spec 去重。 */

/** 旧键的条目模型（与 BoardPxItem 同形，单独一份是为了不被后续改名牵连）。 */
function legacyNum(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

/**
 * 解析旧键：脏数据当没有；**x/y 也夹到 ≥ 0**——旧实现没夹，负坐标的条目
 * 一进新画布就是「东西不见了」而 cell 侧一切正常（最难查的一类）。
 */
export function parseLegacyFreeBoard(raw: string | null): BoardPxItem[] {
  if (!raw) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return [];
  }
  const d = obj as { v?: unknown; items?: unknown } | null;
  if (!d || d.v !== 1 || !Array.isArray(d.items)) return [];
  const out: BoardPxItem[] = [];
  for (const raw2 of d.items) {
    const r = raw2 as Partial<BoardPxItem> | null;
    if (!r || typeof r.id !== "string" || !r.id || !r.spec || typeof r.spec !== "object") continue;
    const px: BoardPxItem = {
      id: r.id,
      spec: r.spec as WidgetSpec,
      x: Math.max(0, Math.round(legacyNum(r.x, 20))),
      y: Math.max(0, Math.round(legacyNum(r.y, 20))),
      w: Math.min(RECT_MAX_W, Math.max(RECT_MIN_W, Math.round(legacyNum(r.w, 240)))),
      h: Math.min(RECT_MAX_H, Math.max(RECT_MIN_H, Math.round(legacyNum(r.h, 120)))),
    };
    if (r.folded === true) px.folded = true;
    if (typeof r.opacity === "number" && Number.isFinite(r.opacity)) px.opacity = Math.min(1, Math.max(0.25, r.opacity));
    out.push(px);
  }
  return out;
}

/**
 * 旧键条目 → 系统板条目列表：旧布局是首页画布的**事实来源**，放前面（原图层序）。
 *
 * 两条过滤：
 *   ① 同 spec 的网格条目让位——它们在旧实现里正是被 seedFromLegacyOnce 复制到自由板的那批，
 *      两条都留就是双份；
 *   ② 旧「今日」页的网格陈迹（`layoutToCells` 造出来的 `today.<卡片>` 条目）整条剔除：
 *      它们是那个页面的卡片布局，不是首页画布上的东西。留着的话，用户在自由画布上
 *      删掉的卡片会"复活"——「白板接入」不该顺带改写首页。
 *      （旧自由板键为空时走不到这里：那种情况下网格条目按格迁移成 px，就是老样子。）
 */
export function mergeLegacyPx(legacy: readonly BoardPxItem[], existing: readonly BoardItem[], cols: number = BOARD_COLS): BoardItem[] {
  const seen = new Set(legacy.map((it) => JSON.stringify(it.spec)));
  const taken = new Set<string>();
  const out: BoardItem[] = [];
  for (const it of legacy) {
    let id = it.id;
    while (taken.has(id)) id = id + "*";
    taken.add(id);
    out.push(pxBoardItem(id, it.spec, { x: it.x, y: it.y, w: it.w, h: it.h }, { folded: it.folded, opacity: it.opacity }, cols));
  }
  for (const it of existing) {
    if (taken.has(it.id) || seen.has(JSON.stringify(it.spec)) || it.id.startsWith("today.")) continue;
    taken.add(it.id);
    out.push(it);
  }
  return out;
}

/* 取数触发点 v11（临时）：boardCore 被大量非组件模块引用，改它必定整页 reload —— 取证后删。 */

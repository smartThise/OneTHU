/**
 * 自由图层白板（px 层，2026-10-15 并入板文档）：**一块板的 px 布局 = BoardDoc 里那块板**。
 *
 * 历史：这个模块原来自己占一个键（onethu.freeboard.home.v1），于是「首页画布」与
 * 「OnePage 白板页」是两套完全不同源的数据（用户点名要删的"假白板"就出在这里）。
 * 现在它只做三件事：
 *   ① 把某个板 × 某朝向上的 BoardItem[] 投影成渲染模型（rect 缺省由格迁移，rectOf）；
 *   ② 把 UI 的手势换算成 boardCore 里的纯函数调用，再落回同一个文档（saveBoard + 广播）；
 *   ③ 首次读首页时把**旧键**的老摆位一次性并进系统板（老用户的画布不能变样）。
 *
 * 纯逻辑（改哪一条、夹取、图层序、迁移合并）全在 state/boardCore.ts —— node 护栏直接驱动。
 * 本文件只负责「读哪块板 / 写回哪块板 / 什么时候算变了」。
 *
 * **写 rect 的同时会派生 cell**（boardCore.withRect）：cell 是插件/OH 的 `ext.onePage` 契约
 * （`plugins/facade.ts` 直接读写 `cell.{x,y,w,h}`），所以自由画布上摆过的东西，插件那边看到的
 * 坐标也是对的——两套坐标从此不会各说各话（这正是之前"两套数据不同源"的病根）。
 */
import { RECT_MIN_H, RECT_MIN_W, SYSTEM_BOARD_ID, appendPx, bringToFrontPx, cellsOf, fitHeightPx, foldPx, homeStarterItems, mergeLegacyPx, movePx, opacityPx, parseLegacyFreeBoard, pinPx, propsPx, raiseAboveOverlappingPx, removePx, resizePx, systemBoard, toPxItems, type BoardDoc, type BoardItem, type BoardPxItem, type BoardRect, type Orientation, type WidgetSpec } from "./boardCore.js";
import { replaceCells } from "./boardEdit.js";
import { BOARD_KEY, loadBoard, saveBoard } from "./board.js";
import { notifyBoardsChanged } from "./onePage.js";

export type FreeItem = BoardPxItem;
/** 渲染快照（useSyncExternalStore 的载荷）。 */
export interface FreeBoardDoc {
  v: 1;
  items: FreeItem[];
}

/** 旧「首页自由板」键：只读一次，之后就归板文档了（键本身留着，回退版本还认它）。 */
const LEGACY_KEY = "onethu.freeboard.home.v1";
const LEGACY_MERGED_KEY = "onethu.freeboard.merged.v1";

/** 缩放下限（与 boardCore 的 RECT_MIN_* 同源；FreeBoard 拖动时也要用）。 */
export const MIN_W = RECT_MIN_W;
export const MIN_H = RECT_MIN_H;

export const HOME_BOARD_ID = SYSTEM_BOARD_ID;
/** 首页自由画布是**一块**画布（不分朝向）——与既有行为一致，取基准朝向 portrait。 */
export const HOME_ORIENTATION: Orientation = "portrait";

function readRaw(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function readFlag(key: string): boolean {
  return readRaw(key) === "1";
}

function writeFlag(key: string): void {
  try {
    globalThis.localStorage?.setItem(key, "1");
  } catch {
    /* 隐私模式：下次进来再试，最多重复合并一次（合并按 spec 去重，不会长出双份） */
  }
}

/* ── 文档读取：按原始字符串缓存，外部写入（别的模块 dispatch 的事件）也能立刻看到 ── */
let lastRaw: string | null | undefined;
let lastDoc: BoardDoc | null = null;
let legacyChecked = false;

/**
 * 一次性把旧键的首页摆位并进系统板。
 *
 * 判据两条（都要满足才动手）：没并过（标志位）、旧键里真有东西。合并按 spec 去重——
 * 系统板里同 spec 的条目正是当年被 seed 复制过去的那批，两条都留就是双份；旧键里没有的
 * （例如「收藏到首页」落下的原子）原样接在后面。
 *
 * 2026-10-15 移除原第二条判据"板文档里没有任何 px 条目 → 否则视为已并"：
 * boardCore.purgeGridResidue 会在**每次 load/save** 把"只有网格、没有 px"的条目补成 px 条目，
 * 于是这条防御判据会把**从未合并过的**用户误判成"已并"→ 老自由板的摆位永远进不来（守栏实测
 * 场景 dup/idem 全红）。合并本身按 spec 去重、天然幂等，所以以标志位为唯一判据是安全的：
 * 隐私模式下标志位写失败最多重复合并一次，不会长长两份。
 */
export function migrateLegacyHomeOnce(): boolean {
  if (readFlag(LEGACY_MERGED_KEY)) return false;
  const doc = loadBoard();
  const sys = systemBoard(doc);
  if (!sys) return false;
  const legacy = parseLegacyFreeBoard(readRaw(LEGACY_KEY));
  writeFlag(LEGACY_MERGED_KEY);
  if (legacy.length === 0) return false;
  const merged = mergeLegacyPx(legacy, cellsOf(sys, HOME_ORIENTATION));
  saveBoard(replaceCells(doc, HOME_BOARD_ID, HOME_ORIENTATION, merged));
  notifyBoardsChanged();
  return true;
}

function loadDoc(): BoardDoc {
  if (!legacyChecked) {
    legacyChecked = true;
    migrateLegacyHomeOnce();
  }
  const raw = readRaw(BOARD_KEY);
  if (raw !== lastRaw || !lastDoc) {
    lastDoc = loadBoard();
    lastRaw = raw;
  }
  return lastDoc;
}

/** 某板某朝向的条目（只读镜像；没有这块板 → 空）。 */
export function boardItemsOf(boardId: string = HOME_BOARD_ID, orientation: Orientation = HOME_ORIENTATION): BoardItem[] {
  const doc = loadDoc();
  const b = doc.boards.find((x) => x.id === boardId);
  return b ? cellsOf(b, orientation) : [];
}

/* ── 渲染快照（同一版本内必须返回同一引用，否则 useSyncExternalStore 会无限重渲染）── */
const snaps = new Map<string, { src: readonly BoardItem[]; doc: FreeBoardDoc }>();
const listeners = new Set<() => void>();
let wired = false;

function emit(): void {
  listeners.forEach((f) => f());
}

/** 外部改了板文档（OneGO / 收藏落点 / OH 工具 / 插件）→ 让订阅读者重取快照。 */
function wire(): void {
  if (wired) return;
  wired = true;
  try {
    globalThis.addEventListener?.("onethu.boards.changed", () => emit());
  } catch {
    /* 非浏览器环境（node 护栏）：没有事件源也无妨 */
  }
}

export function subscribeFreeBoard(f: () => void): () => void {
  wire();
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export function freeBoardSnapshot(boardId: string = HOME_BOARD_ID, orientation: Orientation = HOME_ORIENTATION): FreeBoardDoc {
  const src = boardItemsOf(boardId, orientation);
  const key = boardId + "|" + orientation;
  const hit = snaps.get(key);
  if (hit && hit.src === src) return hit.doc;
  const doc: FreeBoardDoc = { v: 1, items: toPxItems(src) };
  snaps.set(key, { src, doc });
  return doc;
}

/* ── 写回 ───────────────────────────────────────────────────────────────── */

/** 唯一写入口：纯函数改出新的条目列表 → 落回该板该朝向 → 广播（null = 无实质变化，不写盘）。 */
export function commitPx(boardId: string, orientation: Orientation, next: BoardItem[] | null): boolean {
  if (!next) return false;
  const doc = loadDoc();
  if (!doc.boards.some((b) => b.id === boardId)) return false;
  saveBoard(replaceCells(doc, boardId, orientation, next));
  notifyBoardsChanged();
  emit();
  return true;
}

/**
 * 恢复默认首页布局（设置 →「恢复默认布局」）。
 *
 * 2026-10-19 修：旧实现只清 `lib/homeCards` 的**网格布局键**（LAYOUT_KEY / layoutKey(朝向) /
 * DEFAULTS_KEY），可首页画布早就只认板文档里的 px 条目（`onethu.board.v1`）——那些键一个都不读，
 * 于是按钮点了、提示也弹了，画面纹丝不动。这里直接把系统板的两个朝向换回 `homeStarterItems()`。
 *
 * 只动系统板（首页）；用户自建的 OnePage 板原样保留。返回恢复后的条目数（设置页可据此反馈）。
 */
export function resetHomeBoard(): number {
  const doc = loadBoard();
  const seed = homeStarterItems();
  /* 两个朝向各拿一份独立副本：条目是不可变更新，但共享同一批对象会让后续任何就地改写串场。 */
  const clone = (): BoardItem[] => seed.map((it) => {
    const copy: BoardItem = { ...it, cell: { ...it.cell } };
    if (it.rect) copy.rect = { ...it.rect };
    return copy;
  });
  const boards = doc.boards.map((b) => (b.id === HOME_BOARD_ID
    ? { ...b, cells: { portrait: clone(), landscape: clone() } }
    : b));
  saveBoard({ ...doc, homeLayoutVersion: 2, boards });
  notifyBoardsChanged();
  emit();
  return seed.length;
}

function editPx(boardId: string, orientation: Orientation, fn: (items: readonly BoardItem[]) => BoardItem[] | null): boolean {
  return commitPx(boardId, orientation, fn(boardItemsOf(boardId, orientation)));
}

const newId = (prefix: string): string => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** 一块板的自由层操作句柄：视图只跟它打交道（boardId/orientation 在闭包里定死）。 */
export function freeBoardOps(boardId: string = HOME_BOARD_ID, orientation: Orientation = HOME_ORIENTATION) {
  return {
    boardId,
    orientation,
    items: (): BoardItem[] => boardItemsOf(boardId, orientation),
    snapshot: (): FreeBoardDoc => freeBoardSnapshot(boardId, orientation),
    add: (spec: WidgetSpec, x: number, y: number, w = 260, h = 140): string => {
      const id = newId("f.");
      commitPx(boardId, orientation, appendPx(boardItemsOf(boardId, orientation), id, spec, { x, y, w, h }));
      return id;
    },
    addNote: (x: number, y: number): string => {
      const id = newId("f.");
      commitPx(boardId, orientation, appendPx(boardItemsOf(boardId, orientation), id, { kind: "custom", id: "note" }, { x, y, w: 220, h: 160 }));
      return id;
    },
    move: (id: string, x: number, y: number): void => {
      editPx(boardId, orientation, (items) => movePx(items, id, x, y));
    },
    resize: (id: string, rect: BoardRect): void => {
      editPx(boardId, orientation, (items) => resizePx(items, id, rect));
    },
    /** 按内容拟合（只长高；与用户拖动区分：这条不置 manual） */
    fitHeight: (id: string, h: number): void => {
      editPx(boardId, orientation, (items) => fitHeightPx(items, id, h));
    },
    fold: (id: string, folded: boolean): void => {
      editPx(boardId, orientation, (items) => foldPx(items, id, folded));
    },
    opacity: (id: string, value: number): void => {
      editPx(boardId, orientation, (items) => opacityPx(items, id, value));
    },
    props: (id: string, props: Record<string, unknown> | undefined): void => {
      editPx(boardId, orientation, (items) => propsPx(items, id, props));
    },
    pin: (id: string): void => {
      editPx(boardId, orientation, (items) => pinPx(items, id));
    },
    /** 整块替换（套用模板）：给的就是完整条目列表，不做合并。 */
    replace: (next: BoardItem[]): boolean => commitPx(boardId, orientation, next),
    remove: (id: string): void => {
      editPx(boardId, orientation, (items) => removePx(items, id));
    },
    bringToFront: (id: string): void => {
      editPx(boardId, orientation, (items) => bringToFrontPx(items, id));
    },
    raise: (id: string): void => {
      editPx(boardId, orientation, (items) => raiseAboveOverlappingPx(items, id));
    },
  };
}

export type FreeBoardOps = ReturnType<typeof freeBoardOps>;

/* ── 旧调用面（首页系统板）：插件 facade 等外部只用这几个，语义不变 ────────── */
export function addItem(spec: WidgetSpec, x: number, y: number, w = 260, h = 140): string {
  return freeBoardOps().add(spec, x, y, w, h);
}

export function addNote(x: number, y: number): string {
  return freeBoardOps().addNote(x, y);
}

export function removeItem(id: string): void {
  freeBoardOps().remove(id);
}

export function moveItem(id: string, x: number, y: number): void {
  freeBoardOps().move(id, x, y);
}

export function sizeItem(id: string, w: number, h: number, x?: number, y?: number): void {
  const cur = freeBoardOps().items().find((it) => it.id === id);
  if (!cur) return;
  const r = { x: x ?? cur.rect?.x ?? 0, y: y ?? cur.rect?.y ?? 0, w, h };
  freeBoardOps().resize(id, r);
}

export function bringToFront(id: string): void {
  freeBoardOps().bringToFront(id);
}

export function raiseAboveOverlapping(id: string): void {
  freeBoardOps().raise(id);
}

export function setItemFolded(id: string, folded: boolean): void {
  freeBoardOps().fold(id, folded);
}

export function setItemOpacity(id: string, opacity: number): void {
  freeBoardOps().opacity(id, opacity);
}

export function updateItemProps(id: string, props: Record<string, unknown> | undefined): void {
  freeBoardOps().props(id, props);
}

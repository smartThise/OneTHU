/**
 * A3 长按菜单（移动端对应 PC 右键）。
 *
 * 为什么收成一件：全站长按菜单只有一套交互——长按判定（500ms / 位移 10px）、
 * 以按点为锚的四边夹紧定位、Esc/↑↓/Enter 键盘可达、「长按后不误触发跳转」的点击抑制。
 * 各页面各写一遍必然分叉（有的是 600ms，有的松手还会跳页）。所以这里只做两件事：
 *   · `ContextMenuLayer` 挂在 Shell 顶层，负责渲染菜单（portal 到 body + fixed）；
 *   · `useContextMenu()` 给调用点一个 `open({ x, y, title, items })`；另有
 *     `openPanel({ x, y, title, panel })`——打开即进面板（E8 霖 2026-10-04 的「一步展开」裁定）。
 * 长按区有两个入口，判定核心共用同一份：
 *   · `useLongPressZone({ selector, onLongPress })`：装在**列表容器**上，按事件委托找手指
 *     底下那一项（列表都是 map 出来的，逐项挂 Hook 写不出来），命中项带 `data-*` 供宿主取数；
 *     该入口同时接 **PC 右键**（`contextmenu`，P 批霖 2026-10-05）：同一 selector、同一回调；
 *   · `useLongPress(onLongPress)`：列表项**本身就是组件**时用（收藏夹长卡/方卡、文件行）。
 *
 * 菜单项只调用既有数据层（`state/hwIgnore`、`state/hwRemind`、`state/favs`、THOS 常用、
 * `lib/clients` 下载），本组件不持有任何存储。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { useOverlayBack } from "../state/navStack.js";
import { createPortal } from "react-dom";
import { CollectModal } from "./Collect.js";
import { IconStar } from "./Icons.js";
import { haptic } from "../lib/haptics.js";
import { prefersReducedMotion } from "../lib/motion.js";
import type { AtomRef } from "../state/favorites.js";

/** 长按判定口径（与施工图 A3 一致）：按住 500ms 触发；位移超过 10px 即取消 */
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_MOVE = 10;
/** 菜单与视口四边的夹紧边距（px） */
export const MENU_MARGIN = 8;
/** D9：选项逐个浮现的步进；霖 2026-10-01 #3 把整段弹出动画加快，步进从 36ms 收到 24ms */
export const CTX_STAGGER_MS = 24;
/** 长按落进这些容器一律不接管：浏览器要在这里起选区与复制菜单。
 *  霖 2026-10-02 #2 全站禁止选中后，正文类（.rich / pre / code …）不再能选，
 *  继续让路只会让那里「既选不了也没菜单」，所以只剩真正还能选的地方：输入框与
 *  显式标了 .selectable 的段落。 */
export const TEXT_ZONES = ".selectable, input, textarea";
/** 全局「可收藏」标记（霖 2026-09-30 #4）：元素挂 `data-ctx-atom='{"kind":..,"key":..}'`
 *  就有长按 → 收藏菜单，页面不必自己写长按。配合 `data-ctx-title` 给菜单标题。 */
export const ATOM_ATTR = "data-ctx-atom";
/** 已自带长按区的容器标记：全局兜底层见到它就完全让路，避免两套同时触发 */
export const ZONE_ATTR = "data-ctx-zone";
/** 触发器标记（霖 2026-10-02 #6）：顶栏「···」这类按钮自己负责开关菜单，
 *  「点外面即关」要放行它，否则它那次 pointerdown 会先把菜单关掉再让 click 重开一遍。 */
export const TRIGGER_ATTR = "data-ctx-trigger";
/** D9 液团初值：面板从按点上一个 48px 的小团（正圆）长到最终尺寸 */
export const CTX_BLOB_SIZE = 48;
/** E8（b29）：`openPanel()` 合成的唯一 item key（不是用户可见文案，只用于把面板挂进 items） */
const PANEL_ITEM_KEY = "panel";

export interface CtxItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** 危险动作（忽略）：走语义红 */
  danger?: boolean;
  /** 条件不可用（如刷新中）：置灰且点了不生效；PC 页头按钮同步 disabled */
  disabled?: boolean;
  /** 展开面板（提醒档位）：进入后菜单内容换成它；面板内选完自行调用 close() */
  panel?: (close: () => void) => ReactNode;
  onSelect?: () => void;
}

export interface CtxRequest {
  /** 触发点（视口坐标）：长按的按点 */
  x: number;
  y: number;
  title?: string;
  items: CtxItem[];
  /** E8（b29 霖 2026-10-04 裁定）：打开即进入该 key 的 panel——「一步展开」，跳过单项菜单。
   *  由 `openPanel()` 内部使用；`open()` 直接传也可，行为一致。缺省仍是先出 items。 */
  initial?: string;
  /** 「这次是手指长按」→ 菜单优先向左上弹（避开手指）；否则按鼠标右键的习惯向右下弹。
   *  **在 openMenu 打开那一刻定死并随请求带走**（调用方不必传）：一次手势会有两条路径各开
   *  一次菜单（JS 长按计时器 + Android 补发的 contextmenu），方向必须在第二次仍然一致，
   *  否则菜单会从左上翻到右下、盖在手指底下（霖 2026-10-07 真机复验）。 */
  hold?: boolean;
}

/** E8：面板态请求体（`openPanel` 的入参）。panel 的签名与 `CtxItem.panel` 相同——面板内的
 *  按钮自行调用 `close()` 关闭。 */
export interface CtxPanelRequest {
  /** 触发点（视口坐标） */
  x: number;
  y: number;
  title?: string;
  panel: (close: () => void) => ReactNode;
}

interface CtxApi {
  open: (r: CtxRequest) => void;
  /** E8（b29 霖裁定）：点入口直接进面板，不经单项菜单。请求体见 `CtxPanelRequest`。 */
  openPanel: (r: CtxPanelRequest) => void;
  /** 霖 2026-10-02 #6：顶栏「···」按第二下要关掉已经开着的菜单 */
  close: () => void;
  isOpen: () => boolean;
}

const NOOP: CtxApi = { open: () => undefined, openPanel: () => undefined, close: () => undefined, isOpen: () => false };
const Ctx = createContext<CtxApi | null>(null);

/** 调用点入口。没有 Provider（页面被单独渲染）时退化为不打开，不抛错。 */
export function useContextMenu(): CtxApi {
  return useContext(Ctx) ?? NOOP;
}

/**
 * 是否放行原生右键菜单：选区非空且锚点不在 `user-select: none` 的区域。
 * 用**计算样式**当唯一事实（不写死一串容器类名）：按钮/图标/芯片是 `user-select: none`，
 * 公告/通知正文与技术详情默认可选；将来新增可选文本容器自动跟随。
 * 这就是 A3「可选文本区域保留原生菜单」的口径——否则公告文字没法复制。
 */
export function hasTextSelection(): boolean {
  if (typeof window === "undefined") return false;
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return false;
  const node = sel.anchorNode;
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return !!el && getComputedStyle(el).getPropertyValue("user-select") !== "none";
}

/* ══════════ 长按后的一次性点击抑制 ══════════
   长按抬手后浏览器仍会补一个 click（500ms 按住不动通常仍算点按），不拦就会「菜单弹出的
   同时卡片也跳转」。必须在 **document 捕获阶段**拦：React 把委托挂在根容器上，挂在目标
   元素上的监听器晚于它，那时 stopPropagation 已经来不及。
   只吞「落在长按那个元素里」的 click——菜单挂在 body 上，不在它里面，菜单项照常可点。 */
let swallowArmed = false;
let swallowTimer: ReturnType<typeof setTimeout> | undefined;
let swallowOrigin: HTMLElement | null = null;

function onSwallowClick(e: MouseEvent): void {
  if (!swallowOrigin || !(e.target instanceof Node) || !swallowOrigin.contains(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
  disarmSwallow();
}

function disarmSwallow(): void {
  if (swallowTimer !== undefined) {
    clearTimeout(swallowTimer);
    swallowTimer = undefined;
  }
  if (!swallowArmed) return;
  swallowArmed = false;
  swallowOrigin = null;
  document.removeEventListener("click", onSwallowClick, true);
}

/** 装一次「吞点击」：浏览器没补 click（手势被接管/取消）时 1s 后自行撤销 */
function armSwallow(origin: HTMLElement): void {
  disarmSwallow();
  swallowArmed = true;
  swallowOrigin = origin;
  document.addEventListener("click", onSwallowClick, true);
  swallowTimer = setTimeout(disarmSwallow, 1000);
}

/* ══════════ 两级按压反馈（霖 2026-10-01 #5） ══════════
   轻点：按下缩到 0.97、抬手弹回 1；长按：先缩到 0.97，菜单呼出瞬间放大到 1.1 突出
   「选中的目标」，并给目标以外的元素盖一层毛玻璃遮罩。
   全程只动 transform（不改尺寸、不触发布局，变大后压在邻居上是预期效果）。
   遮罩挂 body、盖住整屏（含顶栏与底栏），在目标处用 evenodd 挖一个洞：目标放大到 1.1 之后
   正好填满这个洞，所以洞里看到的还是目标自己。反过来把遮罩塞进目标的层叠上下文、再把目标
   抬上来（z-index 高于遮罩）只能遮住页面内容区——顶栏 30 / 底栏 60 是另外两个定位层，
   抬不上来也遮不住（真机实测过）。 */
export const PRESS_ATTR = "data-ctx-press";
/** 长按时目标放大到的倍数；挖洞的尺寸按它算（不是按当前 getBoundingClientRect——那一瞬间
    还在从 0.97 往 1.1 过渡，量到的偏小，洞会切到目标自己的边） */
export const HOLD_SCALE = 1.1;
/** 同一手势会被多路长按入口看到（单项 `useLongPress` / 长按区 / 全局兜底层）。判定重复入口的
 *  口径：两次 `begin` 间隔 ≤40ms 视为同一次 touchstart（真机上两个手势之间不可能这么快）。
 *  重复的那一路不震、不弹菜单、不重播放大动画，但仍然记 `held`——否则它抬手时会把另一路的高亮/遮罩收掉。
 *
 *  长按触感（霖 2026-10-02 第四批 #1「连振两下」→ 2026-10-02 复看「长按手感恢复」）：
 *  真机取证（`dumpsys vibrator_manager`）一次长按原本是两条——43ms 的
 *  `CLICK(MEDIUM)`（WebView 识别到长按后系统自己给的 `HapticFeedbackConstants.LONG_PRESS`）
 *  + 221ms 的本仓 `ui_haptic_tick(longPress)`。JS 侧压掉系统那条的唯一办法是
 *  `touchstart.preventDefault()`，会连带废掉 click（不能走）。所以改成**在宿主侧关掉 WebView
 *  这一层的触感反馈**（Kotlin `ui_web_haptics_off`，只影响 View.performHapticFeedback，
 *  我们自己的 hapticTick 直接走 Vibrator 服务不受影响），这样本仓那条就恢复了、且只有一条。
 *  两头必须同时成立：只关一头 = 又变成两声或一声都没有（护栏 tools/context-menu-test.mjs 比对）。 */
const HOLD_DUP_BEGIN_MS = 40;
let lastHoldBeginAt = -1e9;

const nowMs = (): number => (typeof performance === "undefined" ? Date.now() : performance.now());
/** 长按呼出菜单的时间戳：菜单定位据此判断「这次是手指（向左上弹）还是鼠标右键（向右下弹）」 */
const HOLD_ORIGIN_MS = 800;
let holdAt = 0;
/** 最近一次「手指按下」的按点与时刻（长按可用的元素上才会记）。
 *  Android 的长按会**补发一次 contextmenu**：如果那条路径比 JS 的 500ms 计时器先到
 *  （或计时器被 touchcancel 掐掉），只看 pressHold 的 holdAt 会把这次手势判成鼠标右键，
 *  菜单就弹到右下、盖在手指底下（霖 2026-10-07 复验）。坐标 + 时间的双重条件保证
 *  鼠标右键不会被误判（不在同一个按点附近）。 */
let lastTouch: { x: number; y: number; t: number } | null = null;
const BLUR_CLASS = "ctx-blur";
let pressedEl: HTMLElement | null = null;
let blurLayer: HTMLElement | null = null;
/** 遮罩存在期间挂在 <html> 上的标记：OH 悬浮坞靠它把自己压到毛玻璃之下
    （霖 2026-10-02：悬浮坞也要进模糊，平时仍是 9991/9992，不被这条影响） */
const BLUR_ROOT_CLASS = "ctx-blur-on";

/** 按下：轻微缩小（轻点与长按共用这一级） */
export function pressDown(el: HTMLElement): void {
  if (pressedEl && pressedEl !== el) clearPress();
  pressedEl = el;
  el.setAttribute(PRESS_ATTR, "tap");
}

/** 遮罩退场动画时长：`clearPress` 等它播完再摘节点（与 CSS 的 .ctx-blur.is-out 对齐）。
 *  霖 2026-10-02 批次 6：时长收回 200ms（曲线仍是慢入快出的 standard-accelerate）。 */
const BLUR_OUT_MS = 200;
/** 菜单离场动画时长（与 CSS 的 .ctx-menu.is-out 对齐）：霖 2026-10-02 第四批 #2 */
const MENU_OUT_MS = 180;
/** 抬手后「归位」态保留时长（霖 2026-10-02 复看）：与 CSS 里 scale 过渡的最长一条
 *  （hold 态 `--dur-2` = 220ms）对齐并留一点余量。到点才摘 `data-ctx-press`——
 *  提前摘会把 transition 一起摘掉，缩放就变成突变。护栏比对这两个数。 */
const PRESS_REST_MS = 240;

/** 遮罩节点：出场用 `ctx-blur-in`、退场换 `ctx-blur-out`——animation 名一变就会重播，
    所以同一个节点能反复进出场，不会「退到一半又长按」时卡在 0 模糊上。 */
function ensureBlur(): HTMLElement {
  if (blurLayer && blurLayer.isConnected) {
    blurLayer.classList.remove("is-out");
    return blurLayer;
  }
  blurLayer = document.createElement("div");
  blurLayer.className = BLUR_CLASS;
  document.body.appendChild(blurLayer);
  document.documentElement.classList.add(BLUR_ROOT_CLASS);
  return blurLayer;
}

/** 长按触发：放大到 1.1 突出目标 + 其余元素上毛玻璃（全屏遮罩 + 目标处挖洞） */
export function pressHold(el: HTMLElement): void {
  if (pressedEl && pressedEl !== el) clearPress();
  pressedEl = el;
  holdAt = typeof performance === "undefined" ? Date.now() : performance.now();
  el.setAttribute(PRESS_ATTR, "hold");
  const layer = ensureBlur();
  /* 中心点用当前矩形的（transform-origin 是中心，缩放不移动中心），
     尺寸用 offsetWidth/Height（不受 transform 影响）+ HOLD_SCALE → 洞 = 放大后的目标矩形。 */
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const hw = (el.offsetWidth * HOLD_SCALE) / 2;
  const hh = (el.offsetHeight * HOLD_SCALE) / 2;
  const x1 = Math.round(cx - hw);
  const y1 = Math.round(cy - hh);
  const x2 = Math.round(cx + hw);
  const y2 = Math.round(cy + hh);
  layer.style.clipPath = holeClip(x1, y1, x2, y2, holdRadius(el));
}

/** 目标自己的圆角（霖 2026-10-02 第四批 #5：圆角卡片挖出来却是个直角矩形，看起来像「放大了一个
 *  矩形元素」）。取计算值的首个半径即可（四角同值是这个 app 的常态），再按洞的短边夹一半。 */
function holdRadius(el: HTMLElement): number {
  const raw = getComputedStyle(el).borderTopLeftRadius || "0px";
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : 0;
}

/**
 * 遮罩的挖洞裁剪：**两条子路径**的 `path(evenodd, …)`——外圈整屏 + 内圈目标圆角矩形。
 *
 * 不能用单条 `polygon(evenodd, 四角, 洞四角)`：洞与外圈之间那两条斜连线会自交，
 * evenodd 把连线左侧那块三角形**清掉**了（霖 2026-10-02 第四批 #4 的实机现象：选「全部作业」
 * 时左半边以按钮左端为顶点的一大块三角是清晰的）。两条子路径不连线，就不会有这个洞。
 * 坐标用 px（层是 fixed inset:0，局部坐标即视口），所以视口变了要重算。
 */
export function holeClip(x1: number, y1: number, x2: number, y2: number, radius: number): string {
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  const rr = Math.max(0, Math.min(radius, w / 2, h / 2));
  const vw = typeof window === "undefined" ? 0 : window.innerWidth;
  const vh = typeof window === "undefined" ? 0 : window.innerHeight;
  const outer = "M0 0 H" + vw + " V" + vh + " H0 Z";
  if (rr < 1) return 'path(evenodd, "' + outer + " M" + x1 + " " + y1 + " H" + x2 + " V" + y2 + " H" + x1 + ' Z")';
  /* 顺时针四段弧：左上 → 右上 → 右下 → 左下 */
  const hole =
    "M" + (x1 + rr) + " " + y1 +
    " H" + (x2 - rr) + " A" + rr + " " + rr + " 0 0 1 " + x2 + " " + (y1 + rr) +
    " V" + (y2 - rr) + " A" + rr + " " + rr + " 0 0 1 " + (x2 - rr) + " " + y2 +
    " H" + (x1 + rr) + " A" + rr + " " + rr + " 0 0 1 " + x1 + " " + (y2 - rr) +
    " V" + (y1 + rr) + " A" + rr + " " + rr + " 0 0 1 " + (x1 + rr) + " " + y1 + " Z";
  return 'path(evenodd, "' + outer + " " + hole + '")';
}

/**
 * 这次呼出菜单的是不是手指长按（touch）？是 → 菜单优先向左上弹（霖 2026-10-01 #4：向下弹会被
 * 手指挡住）；鼠标右键 → 保持「向右下弹」的老习惯（跟 Windows 一致，鼠标没有遮挡问题）。
 *
 * **只读、不消费**（2026-10-07 改）：原实现读一次就把时间戳清掉，而一次手势会有两条路径各开
 * 一次菜单（JS 长按计时器 + Android 补发的 contextmenu）——第二次读到的必然是 false，菜单被
 * 重新定位到右下。现在方向在 openMenu 里定一次、随请求带走（CtxRequest.hold），这里只回答
 * 「是不是长按」。800ms 窗口是给「contextmenu 紧跟着长按到达」留的余量。
 */
export function isHoldOrigin(): boolean {
  return holdAt > 0 && nowMs() - holdAt <= HOLD_ORIGIN_MS;
}

/**
 * 这条 contextmenu 是不是手指长按补发的？判据 = 800ms 内有过手指按下，且按点就在附近
 * （容差 24px，覆盖长按期间的手指微动）。鼠标右键不满足（它不经过 createLongPress.begin）。
 */
export function isTouchContextMenu(x: number, y: number): boolean {
  if (!lastTouch) return false;
  return nowMs() - lastTouch.t <= HOLD_ORIGIN_MS && Math.hypot(x - lastTouch.x, y - lastTouch.y) <= 24;
}

/**
 * 收手/菜单关闭：两级都退回原大小并撤掉遮罩。
 * 传了元素就只清那一个（同一个触摸会被多个长按入口看到：单项 `useLongPress` 与全局兜底层
 * 都会收到这次 touchstart，谁都能清的话，先按下去的那个目标会在抬手时被另一路提前收回）。
 * 不传元素 = 无条件清（菜单卸载时的兜底）。
 */
export function clearPress(el?: HTMLElement): void {
  if (el && pressedEl !== el) return;
  /* 先归位再摘标记：rest 态的倍率是 1、过渡还在，元素平滑缩回原大小；
     动画播完才摘 `data-ctx-press`（期间若同一元素又被按下，态已不是 rest，这一刀不生效）。 */
  if (pressedEl) {
    const target = pressedEl;
    target.setAttribute(PRESS_ATTR, "rest");
    window.setTimeout(() => {
      if (target.getAttribute(PRESS_ATTR) === "rest") target.removeAttribute(PRESS_ATTR);
    }, PRESS_REST_MS);
  }
  pressedEl = null;
  const layer = blurLayer;
  blurLayer = null;
  if (!layer) return;
  /* 霖 2026-10-02 #4：遮罩退场也要有模糊半径渐变，所以先挂 .is-out 播完再摘，
     不再是 remove() 一帧消失。减弱动效下 CSS 里动画是 1ms，这里也就不必等。 */
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    layer.remove();
    document.documentElement.classList.remove(BLUR_ROOT_CLASS);
    return;
  }
  layer.classList.add("is-out");
  /* 标记等退场动画播完再摘：否则悬浮坞在遮罩还在淡出的半路就跳回最上层，会闪一下 */
  setTimeout(() => {
    layer.remove();
    document.documentElement.classList.remove(BLUR_ROOT_CLASS);
  }, BLUR_OUT_MS);
}

/* ══════════ 长按判定核心（两个入口共用这一份口径） ══════════ */

interface LongPressCtl {
  begin: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  cancel: () => void;
}

function createLongPress(fire: (x: number, y: number) => void, target?: () => HTMLElement | null): LongPressCtl {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sx = 0;
  let sy = 0;
  /** 长按已经呼出菜单：这一轮按压的目标要保持 1.1 与遮罩，直到菜单关闭 */
  let held = false;
  /** 这一路入口自己按下去的那个元素（没命中就是 null，抬手时不许清别人的） */
  let pressed: HTMLElement | null = null;
  const stop = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const cancel = (): void => {
    stop();
    /* 轻点（含滑动取消）：立刻退回原大小；已呼出菜单的那次按压不在这里收 */
    if (!held && pressed) clearPress(pressed);
  };
  return {
    begin(x, y) {
      stop();
      held = false;
      sx = x;
      sy = y;
      const t = nowMs();
      lastTouch = { x, y, t };
      const dupEntry = t - lastHoldBeginAt <= HOLD_DUP_BEGIN_MS;
      lastHoldBeginAt = t;
      const el = target?.() ?? null;
      pressed = el;
      if (el) pressDown(el);
      timer = setTimeout(() => {
        timer = undefined;
        held = true;
        if (dupEntry) return; // 同一手势的另一路入口：不震、不弹，但保持 held
        haptic("longPress"); // 触发瞬间先给触感（系统那条已在宿主侧关掉，见上方注释）
        const hitEl = target?.() ?? null;
        if (hitEl) pressHold(hitEl);
        fire(sx, sy);
      }, LONG_PRESS_MS);
    },
    move(x, y) {
      if (timer === undefined) return;
      /* 与滚动/轮播滑动区分：位移超过阈值即取消，抬手也不再触发 */
      if (Math.hypot(x - sx, y - sy) > LONG_PRESS_MOVE) cancel();
    },
    cancel,
  };
}

/** 手指底下这一项是不是「可选文本容器」（是则不接管，交给浏览器起选区） */
function inTextZone(t: EventTarget | null): boolean {
  return t instanceof Element && !!t.closest(TEXT_ZONES);
}

/** 按压缩放该作用在谁身上：手指底下最近的那个「离散控件」，找不到才退回长按宿主。
 *  霖 2026-10-02 #1：「待办」页的统计区 + 两个入口整块挂在一个 `data-ctx-atom` 上，
 *  以前整块一起缩、长按高亮也是一整块；菜单仍然归宿主（收藏的是整块），
 *  但缩放/高亮只给手指底下那一个按钮。 */
const PRESS_CTL_SEL = "button, a, [role='button'], input, select, label, summary";
function pressElOf(t: EventTarget | null, host: HTMLElement): HTMLElement {
  const start = t instanceof Element ? t : null;
  if (!start || !host.contains(start)) return host;
  let n: Element | null = start;
  while (n && n !== host) {
    if (n.matches(PRESS_CTL_SEL)) return n as HTMLElement;
    n = n.parentElement;
  }
  return host;
}

export interface ZoneOpts {
  /** 命中选择器：手指底下最近的这个元素就是长按目标（宿主在它上面挂 `data-*`） */
  selector: string;
  onLongPress: (el: HTMLElement, x: number, y: number) => void;
}

/** 长按区（装容器）：返回要挂到容器上的 ref */
export function useLongPressZone<T extends HTMLElement>(opts: ZoneOpts): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const cb = useRef(opts.onLongPress);
  cb.current = opts.onLongPress; // 每次渲染刷新，监听只装一次
  const selector = opts.selector;

  useEffect(() => {
    const zone = ref.current;
    if (!zone) return;
    /* 打上「这里已有长按区」：全局 data-ctx-atom 兜底层见到就不接管（一份手势，两个入口） */
    zone.setAttribute(ZONE_ATTR, "");
    let hit: HTMLElement | null = null;
    const ctl = createLongPress((x, y) => {
      const el = hit;
      hit = null;
      if (!el) return;
      armSwallow(el);
      cb.current(el, x, y);
    }, () => hit);
    const onStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) return; // 多指（缩放）不参与
      const t = e.touches[0];
      if (!t) return;
      const found = e.target instanceof Element ? e.target.closest<HTMLElement>(selector) : null;
      if (!found || !zone.contains(found) || inTextZone(e.target)) return;
      hit = found;
      ctl.begin(t.clientX, t.clientY);
    };
    const onMove = (e: TouchEvent): void => {
      const t = e.touches[0];
      if (t) ctl.move(t.clientX, t.clientY);
    };
    /* PC 右键（P 批，霖 2026-10-05）：与长按**同一条链路**——同一个命中 selector、同一个回调，
       只是坐标来自鼠标。不装「吞点击」：右键不产生 click，装了会误吞随后的左键。
       文本选区的放行在 Layout 的全局拦截里（唯一放行口），这里不再判一次。 */
    const onCtx = (e: MouseEvent): void => {
      const found = e.target instanceof Element ? e.target.closest<HTMLElement>(selector) : null;
      if (!found || !zone.contains(found) || inTextZone(e.target)) return;
      cb.current(found, e.clientX, e.clientY);
    };
    zone.addEventListener("touchstart", onStart, { passive: true });
    zone.addEventListener("touchmove", onMove, { passive: true });
    zone.addEventListener("touchend", ctl.cancel, { passive: true });
    zone.addEventListener("touchcancel", ctl.cancel, { passive: true });
    zone.addEventListener("contextmenu", onCtx);
    return () => {
      ctl.cancel();
      zone.removeAttribute(ZONE_ATTR);
      zone.removeEventListener("touchstart", onStart);
      zone.removeEventListener("touchmove", onMove);
      zone.removeEventListener("touchend", ctl.cancel);
      zone.removeEventListener("touchcancel", ctl.cancel);
      zone.removeEventListener("contextmenu", onCtx);
    };
  }, [selector]);

  return ref;
}

export interface LongPressHandlers {
  onTouchStart: (e: ReactTouchEvent<HTMLElement>) => void;
  onTouchMove: (e: ReactTouchEvent<HTMLElement>) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
}

/** 长按（装单项）：列表项自己就是组件时用；把返回的处理器摊在元素上 */
export function useLongPress(onLongPress: (x: number, y: number) => void): LongPressHandlers {
  const cb = useRef(onLongPress);
  cb.current = onLongPress;
  const el = useRef<HTMLElement | null>(null);
  const ctl = useRef<LongPressCtl | null>(null);
  ctl.current ??= createLongPress((x, y) => {
    if (el.current) armSwallow(el.current);
    cb.current(x, y);
  }, () => el.current);
  return useMemo<LongPressHandlers>(
    () => ({
      onTouchStart: (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        if (!t || inTextZone(e.target)) return;
        el.current = e.currentTarget;
        ctl.current?.begin(t.clientX, t.clientY);
      },
      onTouchMove: (e) => {
        const t = e.touches[0];
        if (t) ctl.current?.move(t.clientX, t.clientY);
      },
      onTouchEnd: () => ctl.current?.cancel(),
      onTouchCancel: () => ctl.current?.cancel(),
    }),
    [],
  );
}

/* ══════════ 菜单本体 ══════════ */

function CtxMenu({ req, leaving, onClose }: { req: CtxRequest; leaving: boolean; onClose: () => void }): ReactNode {
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** 位置 + 展开原点：都由实测矩形与「向左上」决策一起算出来（见下面的 useLayoutEffect） */
  const [geom, setGeom] = useState<{ left: number; top: number; originX: "left" | "right"; originY: "top" | "bottom" } | null>(null);
  /** 键盘高亮：null = 未经键盘（触屏不预亮第一项） */
  const [active, setActive] = useState<number | null>(null);
  /* E8（b29）：`req.initial` 让菜单打开即停在 panel 态（一步展开）；缺省为 null（先出 items）。 */
  const [panelKey, setPanelKey] = useState<string | null>(req.initial ?? null);
  const panel = req.items.find((i) => i.key === panelKey) ?? null;
  const close = useCallback(() => {
    clearPress();
    onClose();
  }, [onClose]);
  /* 系统要求减弱动态时直接显示：不加动画类，CSS 侧另有媒体查询兜底 */
  const still = prefersReducedMotion();
  /** D9 液团起点：把面板缩到按点上的一个小团，再把该团沿 back-out 曲线送到最终位置 */
  const [blob, setBlob] = useState<{ dx: number; dy: number; sx: number; sy: number; r0: number } | null>(null);
  /** 已落位的按点与当时的内容态：同一次手势的第二条路径沿用第一次的落位，不重量一次
   *  （量的时机落在入场动画的填充帧上会量到液团尺寸，见下面 useLayoutEffect 的注释） */
  const placedRef = useRef<{ x: number; y: number; panel: string | null } | null>(null);

  /* 以按点为锚：**长按（手指）优先向左上方弹**（霖 2026-10-01 #4）——菜单右下角贴按点，
     向下弹时菜单正好盖在手指底下；鼠标右键则保持向右下弹（Windows 习惯）。两个方向各自
     按放不下的那一边翻转，最后统一四边夹紧进视口。量不到尺寸前先隐藏，避免闪一帧。
     展开原点由这次决策决定（MD3 菜单的方向感来源，固定从中心放大是反例）。 */
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    /* 尺寸取**布局盒**（offsetWidth/offsetHeight），不取 getBoundingClientRect()：
       入场动画 ctx-bloom 的填充方式是 both；同一次手势的第二条路径（Android 为长按补发的
       contextmenu）会在第一条路径开动画后的**几毫秒内**再开一次菜单，那次布局效应跑在动画
       「尚未开始、backwards 填充生效」的时刻——getBoundingClientRect() 量到的是 0% 帧的液团
       尺寸（CTX_BLOB_SIZE 见方），于是 left = 按点 − 48px，菜单整体落到手指右下方
       （霖 2026-10-07 真机复验：按点 (206,298) 的落位变成 (158,250)）。offsetWidth/Height 不受
       transform 影响，两条路径量到同一个尺寸，落位因此幂等。 */
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!w || !h) return; /* 尚未排版（首帧极端情况）：保持隐藏，等下一帧 */
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    /* 同一次手势开第二次（内容态也相同）：沿用第一次的落位与液团，既避免重量，也避免把入场
       动画重启一遍。内容态变了（例如进入 panel）必须重新落位——面板高度与菜单不同。 */
    const last = placedRef.current;
    if (last && last.panel === panelKey && Math.abs(last.x - req.x) < 4 && Math.abs(last.y - req.y) < 4) return;
    placedRef.current = { x: req.x, y: req.y, panel: panelKey };
    /* 长按（手指）优先向左上；鼠标右键优先向右下（Windows 习惯，鼠标不会被自己挡住）。
       方向来自**请求本身**（打开那一刻定的，见 CtxRequest.hold）——这里不再现算：同一次手势开
       第二次（panel 态重排、Android 补发的 contextmenu）必须与第一次同向。 */
    const fromHold = req.hold === true;
    let left: number;
    let originX: "left" | "right";
    let top: number;
    let originY: "top" | "bottom";
    if (fromHold) {
      left = req.x - w;
      originX = "right";
      if (left < MENU_MARGIN) {
        left = req.x; /* 左边不够 → 向右开 */
        originX = "left";
      }
      top = req.y - h;
      originY = "bottom";
      if (top < MENU_MARGIN) {
        top = req.y; /* 上边不够 → 向下开 */
        originY = "top";
      }
    } else {
      left = req.x;
      originX = "left";
      if (left + w > vw - MENU_MARGIN) {
        left = req.x - w; /* 右边不够 → 翻到左边 */
        originX = "right";
      }
      top = req.y;
      originY = "top";
      if (top + h > vh - MENU_MARGIN) {
        top = req.y - h; /* 下边不够 → 翻到上边 */
        originY = "bottom";
      }
    }
    left = Math.max(MENU_MARGIN, Math.min(left, vw - w - MENU_MARGIN));
    top = Math.max(MENU_MARGIN, Math.min(top, vh - h - MENU_MARGIN));
    setGeom({ left, top, originX, originY });
    /* 液团 = 边长 CTX_BLOB_SIZE 的正圆，圆心在按点；transform-origin 就是按点那一角，
       所以位移要按「该角 → 液团对应角」算，缩放才会从那一角长出去（Liquid Morph 的 Blob B）。 */
    const bx = req.x - CTX_BLOB_SIZE / 2;
    const by = req.y - CTX_BLOB_SIZE / 2;
    setBlob({
      dx: (originX === "right" ? bx + CTX_BLOB_SIZE - (left + w) : bx - left),
      dy: (originY === "bottom" ? by + CTX_BLOB_SIZE - (top + h) : by - top),
      sx: CTX_BLOB_SIZE / w,
      sy: CTX_BLOB_SIZE / h,
      /* 圆角起点 = 面板半宽：液团在角上仍是正圆（与 liquid morph 的 maxRadius 同口径） */
      r0: Math.round(w / 2),
    });
  }, [req, panelKey]);

  /* 菜单卸载（选中 / 点外面 / Esc / 滚动）时收掉两级按压与毛玻璃遮罩 */
  useEffect(() => clearPress, []);

  /* 打开即聚焦菜单容器：读屏能念出「菜单」与项目，键盘事件也有了落点 */
  useEffect(() => {
    boxRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        /* 捕获阶段 + 阻断：页面自己也有 Esc（例如待办页的详情浮层），
           不阻断的话一次 Esc 会同时关掉菜单和它后面的东西 */
        e.stopPropagation();
        close();
        return;
      }
      /* 面板态（提醒档位）：↑↓ 在面板内的可点元素间移动焦点，Enter 交给元素自己 */
      if (panel) {
        /* 光标在输入框里时 ↑↓ 是它自己的（自定义分钟数），不抢 */
        if (typeof HTMLInputElement !== "undefined" && document.activeElement instanceof HTMLInputElement) return;
        const focusables = Array.from(boxRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input") ?? []);
        if (focusables.length === 0) return;
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const cur = focusables.indexOf(document.activeElement as HTMLElement);
        const step = e.key === "ArrowDown" ? 1 : -1;
        focusables[(cur + step + focusables.length) % focusables.length]?.focus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = req.items.length;
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((a) => ((a ?? -1) + step + n) % n);
        return;
      }
      if (e.key === "Enter") {
        const it = req.items[active ?? 0];
        if (!it) return;
        e.preventDefault();
        if (it.panel) {
          setPanelKey(it.key);
          return;
        }
        it.onSelect?.();
        close();
      }
    };
    /* 捕获阶段：菜单是浮层，Esc 必须先在它这里被处理掉（见上） */
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, close, panel, req]);

  /* 点外面即关（无遮罩：与微信一致，长按菜单是弹出层而不是模态）。
     霖 2026-10-02 #6：「···」这种**触发器**要放行——否则这条捕获期的 pointerdown 会先把
     菜单关掉，触发器自己的 click 再拿 isOpen() 就已经是 false，于是又开一遍（表现为
     「按第二下没关掉，而是重播一次展开」）。触发器自己负责切换。 */
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const box = boxRef.current;
      if (!(e.target instanceof Node)) return;
      if (e.target instanceof Element && e.target.closest("[" + TRIGGER_ATTR + "]")) return;
      if (box && !box.contains(e.target)) close();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [close]);

  /* 滚动即关：fixed 定位不随内容走，留着会指向空处（刚开的 150ms 内不动，避开惯性滚动） */
  useEffect(() => {
    const t0 = performance.now();
    const onScroll = (): void => {
      if (performance.now() - t0 > 150) close();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [close]);

  return createPortal(
    <div
      ref={boxRef}
      className={"ctx-menu" + (still || !blob ? " is-still" : "") + (leaving ? " is-out" : "")}
      role="menu"
      aria-label={req.title ?? "操作菜单"}
      tabIndex={-1}
      style={{
        left: geom?.left ?? req.x,
        top: geom?.top ?? req.y,
        visibility: geom ? undefined : "hidden",
        transformOrigin: geom ? geom.originX + " " + geom.originY : "left top",
        /* 步进只有一个事实源：CSS 用 calc(var(--ctx-i) * var(--ctx-stagger)) */
        "--ctx-stagger": CTX_STAGGER_MS + "ms",
        /* 液团起点（D9）：位移/缩放/起始圆角都由实测矩形算出，CSS 只负责沿途曲线 */
        "--ctx-dx": (blob?.dx ?? 0) + "px",
        "--ctx-dy": (blob?.dy ?? 0) + "px",
        "--ctx-sx": String(blob?.sx ?? 1),
        "--ctx-sy": String(blob?.sy ?? 1),
        "--ctx-r0": (blob?.r0 ?? 12) + "px",
      } as CSSProperties}
    >
      {req.title ? <div className="ctx-title">{req.title}</div> : null}
      {panel ? (
        <div className="ctx-panel">{panel.panel?.(close)}</div>
      ) : (
        req.items.map((it, i) => (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            /* 键盘走 ↑↓ + Enter（见上）；不给 Tab 焦点，避免 Enter 被按钮原生行为重复触发一次 */
            tabIndex={-1}
            className={"ctx-item" + (it.danger ? " is-danger" : "") + (it.disabled ? " is-disabled" : "") + (i === active ? " is-active" : "")}
            aria-disabled={it.disabled ? true : undefined}
            style={{ "--ctx-i": String(i) } as CSSProperties}
            onPointerEnter={() => setActive(i)}
            onClick={() => {
              if (it.disabled) return;
              if (it.panel) {
                setPanelKey(it.key);
                return;
              }
              it.onSelect?.();
              close();
            }}
          >
            {it.icon ? <span className="ctx-icon">{it.icon}</span> : null}
            <span className="ctx-label">{it.label}</span>
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}

/** 菜单层：挂在 Shell 顶层（页面都是它的子节点，长按菜单在任何页面都能开）。
 *  除了渲染菜单，它自己还兜住一层「可收藏元素」（`data-ctx-atom`）——霖 2026-09-30 #4：
 *  长按菜单此前只有作业卡片等少数宿主挂了，今日页卡片、汇总卡、通知、页面入口全都没反应。
 *  兜底层让「让某处能长按收藏」退化成加一个属性，判定仍只有 createLongPress 这一份。 */
export function ContextMenuLayer({ children }: { children: ReactNode }): ReactNode {
  const [req, setReq] = useState<CtxRequest | null>(null);
  const [collect, setCollect] = useState<AtomRef | null>(null);
  /* 霖 2026-10-02 #6：顶栏「···」要知道「现在菜单是不是开着」才能做切换。
     用 ref 记一份，api 保持引用稳定（顶栏的 useCallback 依赖它）。 */
  const openRef = useRef(false);
  /* 当前请求的镜像：同一次手势的第二条路径要沿用第一次定下的方向（见 CtxRequest.hold） */
  const reqRef = useRef<CtxRequest | null>(null);
  /* 霖 2026-10-02 第四批 #2：菜单离场也要有动画（长按菜单与「···」菜单同一个本体）。
     所以关闭不是立刻 setReq(null)，而是先挂 is-out 播完 MENU_OUT_MS 再摘；期间 req 留着
     （元素还在，动画才有对象），但 openRef 立刻变 false——「···」在这段时间按下去是「重开」，
     不是「再关一次」。 */
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openMenu = useCallback((r: CtxRequest) => {
    if (leaveTimer.current !== undefined) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = undefined;
    }
    /* 方向定一次、随请求带走：①pressHold 已跑（JS 长按计时器先到）②这条 contextmenu 是
       手指长按补发的（按点与时刻都对得上）③菜单已开着且本来就是手指长按开的（同一次手势的
       第二条路径）——三条任一成立即按手指处置，避免第二次打开把方向翻掉。 */
    const next: CtxRequest =
      r.hold !== undefined
        ? r
        : { ...r, hold: isHoldOrigin() || isTouchContextMenu(r.x, r.y) || (openRef.current && reqRef.current?.hold === true) };
    openRef.current = true;
    reqRef.current = next;
    setLeaving(false);
    setReq(next);
  }, []);
  /** E8（b29 霖裁定）：一步展开。合成一个「只有 panel 的 request」并把 `initial` 指向它，
   *  复用既有菜单本体（定位、D9 动画、Esc/返回键、点外面即关全部不变）。 */
  const openPanelMenu = useCallback(
    (r: CtxPanelRequest) => {
      openMenu({
        x: r.x,
        y: r.y,
        title: r.title,
        items: [{ key: PANEL_ITEM_KEY, label: r.title ?? "面板", panel: r.panel }],
        initial: PANEL_ITEM_KEY,
      });
    },
    [openMenu],
  );
  const closeMenu = useCallback(() => {
    openRef.current = false;
    setLeaving(true);
    if (leaveTimer.current !== undefined) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = undefined;
      setReq(null);
      reqRef.current = null;
      setLeaving(false);
    }, MENU_OUT_MS);
  }, []);
  useEffect(
    () => () => {
      if (leaveTimer.current !== undefined) clearTimeout(leaveTimer.current);
    },
    [],
  );
  const api = useMemo<CtxApi>(
    () => ({ open: openMenu, openPanel: openPanelMenu, close: closeMenu, isOpen: () => openRef.current }),
    [openMenu, openPanelMenu, closeMenu],
  );
  useEffect(() => {
    openRef.current = req !== null && !leaving;
  }, [req, leaving]);
  /* E1：二级菜单与它的收藏弹层各登记一层浮层——返回键先关收藏弹层，再关菜单 */
  useOverlayBack("ctx-menu", req !== null && !leaving, closeMenu);
  useOverlayBack("ctx-collect", collect !== null, () => setCollect(null));

  useEffect(() => {
    let hit: HTMLElement | null = null;
    /* 缩放/高亮给手指底下那个控件，菜单仍归原子宿主（霖 2026-10-02 #1） */
    let pressEl: HTMLElement | null = null;
    /** 打开原子宿主的收藏菜单（长按与 PC 右键共用一份，口径不会分叉） */
    const openAtomMenu = (el: HTMLElement, x: number, y: number, swallow: boolean): void => {
      const raw = el.getAttribute(ATOM_ATTR);
      if (!raw) return;
      let atom: AtomRef;
      try {
        atom = JSON.parse(raw) as AtomRef;
      } catch {
        return; /* 属性写错当没有，不要弹出空菜单 */
      }
      if (swallow) armSwallow(el);
      openMenu({
        x,
        y,
        title: el.getAttribute("data-ctx-title") ?? undefined,
        items: [{ key: "collect", label: "收藏", icon: <IconStar width={14} height={14} />, onSelect: () => setCollect(atom) }],
      });
    };
    const ctl = createLongPress((x, y) => {
      const el = hit;
      hit = null;
      pressEl = null;
      if (!el) return;
      openAtomMenu(el, x, y, true);
    }, () => pressEl);
    const find = (t: EventTarget | null): HTMLElement | null => {
      const start = t instanceof Element ? t : null;
      if (!start) return null;
      const el = start.closest<HTMLElement>("[" + ATOM_ATTR + "]");
      /* 页面自己挂了长按区（作业卡/服务卡/课程卡…）→ 完全归它，避免两套菜单同时弹 */
      if (!el || el.closest("[" + ZONE_ATTR + "]")) return null;
      return el;
    };
    const onStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (!t || inTextZone(e.target)) return;
      hit = find(e.target);
      pressEl = hit ? pressElOf(e.target, hit) : null;
      if (hit) ctl.begin(t.clientX, t.clientY);
    };
    const onMove = (e: TouchEvent): void => {
      const t = e.touches[0];
      if (t) ctl.move(t.clientX, t.clientY);
    };
    /* PC 右键（P 批）：与长按同一条判定（find 已排除页面自带长按区，避免两套菜单同弹），
       只是坐标来自鼠标；不装「吞点击」（右键不产生 click）。 */
    const onCtx = (e: MouseEvent): void => {
      if (inTextZone(e.target)) return;
      const el = find(e.target);
      if (el) openAtomMenu(el, e.clientX, e.clientY, false);
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", ctl.cancel, { passive: true });
    document.addEventListener("touchcancel", ctl.cancel, { passive: true });
    document.addEventListener("contextmenu", onCtx);
    return () => {
      ctl.cancel();
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", ctl.cancel);
      document.removeEventListener("touchcancel", ctl.cancel);
      document.removeEventListener("contextmenu", onCtx);
    };
  }, []);

  return (
    <Ctx.Provider value={api}>
      {children}
      {req ? <CtxMenu req={req} leaving={leaving} onClose={closeMenu} /> : null}
      {collect ? <CollectModal atom={collect} onClose={() => setCollect(null)} /> : null}
    </Ctx.Provider>
  );
}

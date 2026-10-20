/**
 * 全局「拖入暂存箱」交互层（Phase 1）。
 *
 * 任何元素只要带 `data-vault-catch`（JSON: VaultCatch）就能被拖：
 * - 鼠标与触屏：按住 400ms 拾取，先移动则交给排序/滚动；
 * - 触屏：长按 400ms 启动（避免和滚动/点击冲突），启动后 pointermove 阻止默认滚动。
 *
 * 拖动中在 body 上挂一个跟随指针的 ghost，并显示 [data-vault-drop] 目标；
 * 松手时命中目标 → addToVault + 吸入动画；未命中 → 回弹消失。
 */
import { GESTURE, claimGesture, releaseGesture } from "../../lib/gestureArena.js";
import { cacheRemoteFileToVault } from "../../lib/vaultRemote.js";
import { addToVault, type VaultCatch } from "../../state/vault.js";
import { ohAsk } from "../../plugins/ChatDock.js";
import { showToast } from "../../state/toast.js";
import { t as i18n } from "../../i18n/index.js";


export interface VaultDragState {
  active: boolean;
  hover: boolean;
  title: string;
  target?: "vault" | "oh";
}

let dragState: VaultDragState = { active: false, hover: false, title: "" };
const dragListeners = new Set<() => void>();
const emitDrag = (): void => dragListeners.forEach((f) => f());

export function subscribeVaultDrag(f: () => void): () => void {
  dragListeners.add(f);
  return () => dragListeners.delete(f);
}

export function vaultDragSnapshot(): VaultDragState {
  return dragState;
}

function setDrag(next: Partial<VaultDragState>): void {
  dragState = { ...dragState, ...next };
  emitDrag();
}

const GHOST_CLASS = "vault-drag-ghost";
const HOVER_CLASS = "is-vault-drop-hover";
const BODY_CLASS = "is-vault-dragging";

let ghost: HTMLDivElement | null = null;
let targetEl: HTMLElement | null = null;
/** 拾取后必须掐断浏览器原生 HTML5 拖拽：否则 pointercancel 会中断我们的投递。 */
const blockNativeDrag = (e: DragEvent): void => { e.preventDefault(); };
let pointerId = -1;
let startX = 0;
let startY = 0;
let moveHooked = false;

function dropTargetRect(el: HTMLElement): DOMRect {
  return el.getBoundingClientRect();
}

function hitDrop(x: number, y: number): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>("[data-vault-drop], [data-oh-drop]")) {
    const r = dropTargetRect(el);
    if (r.width && r.height && x >= r.left-20 && x <= r.right+20 && y >= r.top-20 && y <= r.bottom+20) return el;
  }
  return null;
}

function paint(x: number, y: number): void {
  if (!ghost) return;
  ghost.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -120%) scale(1.02)`;
  const hit = hitDrop(x, y);
  if (hit !== targetEl) {
    targetEl?.classList.remove(HOVER_CLASS);
    targetEl = hit;
    targetEl?.classList.add(HOVER_CLASS);
    setDrag({ hover: Boolean(targetEl), target: targetEl?.hasAttribute("data-oh-drop") ? "oh" : targetEl ? "vault" : undefined });
  }
}

function onMove(e: PointerEvent): void {
  if (e.pointerId !== pointerId) return;
  /* 触屏：拖动开始后必须阻止页面滚动；鼠标无副作用。 */
  if (e.pointerType !== "mouse" && e.cancelable) e.preventDefault();
  paint(e.clientX, e.clientY);
}

function endDrag(commit: boolean, x: number, y: number, cat: VaultCatch | null): void {
  const target = hitDrop(x, y);
  window.removeEventListener("pointermove", onMove, true);
  window.removeEventListener("pointerup", onUp, true);
  window.removeEventListener("pointercancel", onCancel, true);
  document.removeEventListener("dragstart", blockNativeDrag, true);
  document.body.classList.remove(BODY_CLASS);
  targetEl?.classList.remove(HOVER_CLASS);
  targetEl = null;
  if (ghost) {
    const g = ghost;
    g.style.transition = "transform .22s cubic-bezier(.2,.9,.2,1), opacity .18s ease";
    if (target) {
      const r = dropTargetRect(target);
      g.style.transform = `translate3d(${Math.round(r.left + r.width / 2)}px, ${Math.round(r.top + r.height / 2)}px, 0) translate(-50%, -50%) scale(.18)`;
      g.style.opacity = "0";
    } else {
      g.style.opacity = "0";
      g.style.transform += " scale(.94)";
    }
    window.setTimeout(() => g.remove(), 240);
    ghost = null;
  }
  const wasHover = Boolean(target);
  releaseGesture("vault-drag");
  setDrag({ active: false, hover: false, title: "" });
  if (!commit || !cat) return;
  if (!wasHover) {
    showToast(i18n("auto.components.vault.vaultDrag.msg1"));
    return;
  }
  if (target?.hasAttribute("data-oh-drop")) {
    ohAsk(`请帮我处理这个来自 OneTHU 的内容：${cat.title}\n${JSON.stringify({type:cat.type,atom:cat.atom,board:cat.board,text:cat.text,summary:cat.sub,payload:cat.payload})}`);
    return;
  }
  const r = addToVault(cat);
  if (r.ok) {
    if (cat.remote && r.item) {
      showToast(`已收进暂存箱：${cat.title}（正在缓存到云盘…）`);
      void cacheRemoteFileToVault(r.item.id, cat.remote, cat.title);
    } else {
      showToast(`已收进暂存箱：${cat.title}`);
    }
  }
  else if (r.reason === "duplicate") showToast(`暂存箱里已经有「${cat.title}」了`);
  else showToast(i18n("auto.components.vault.vaultDrag.msg2"));
}

function onUp(e: PointerEvent): void {
  if (e.pointerId !== pointerId) return;
  endDrag(true, e.clientX, e.clientY, pendingCat);
  pendingCat = null;
}

function onCancel(e: PointerEvent): void {
  if (e.pointerId !== pointerId) return;
  endDrag(false, startX, startY, null);
  pendingCat = null;
}

let pendingCat: VaultCatch | null = null;

/** 从一次 pointer 位置启动拖动（供内部/测试调用；任意元素走 data-vault-catch 自动接线）。 */
export function beginVaultDrag(cat: VaultCatch, x: number, y: number, id = -1): void {
  if (dragState.active || !claimGesture("vault-drag")) return;
  pointerId = id;
  startX = x;
  startY = y;
  pendingCat = cat;
  ghost = document.createElement("div");
  ghost.className = GHOST_CLASS;
  const badge = document.createElement("span");
  badge.className = "vault-drag-ghost-type";
  badge.textContent = cat.type === "atom" ? "对象" : cat.type === "file" ? "文件" : cat.type === "board-item" ? "组件" : "内容";
  const title = document.createElement("span");
  title.className = "vault-drag-ghost-title";
  title.textContent = cat.title;
  ghost.append(badge, title);
  document.body.appendChild(ghost);
  document.body.classList.add(BODY_CLASS);
  setDrag({ active: true, hover: false, title: cat.title });
  paint(x, y);
  window.addEventListener("pointermove", onMove, { capture: true });
  window.addEventListener("pointerup", onUp, { capture: true });
  window.addEventListener("pointercancel", onCancel, { capture: true });
  document.addEventListener("dragstart", blockNativeDrag, true);
  moveHooked = true;
}

/** 安装全局拖拽源识别（Layout 挂一次；返回清理）。 */
export function installVaultDragSources(): () => void {
  if (moveHooked) return () => undefined;
  moveHooked = true;
  let pending: { cat: VaultCatch; el: HTMLElement; x: number; y: number; pointerId: number; timer: number | null; armed: boolean } | null = null;

  const clear = (): void => {
    if (pending?.timer) window.clearTimeout(pending.timer);
    pending = null;
  };
  const arm = (): void => {
    if (!pending || pending.armed) return;
    pending.armed = true;
    beginVaultDrag(pending.cat, pending.x, pending.y, pending.pointerId);
    /* 拖动已经开始：吞掉这次元素自己的 click（否则松手会触发原按钮动作）。 */
    const el = pending.el;
    const swallow = (ev: Event): void => { ev.stopPropagation(); ev.preventDefault(); };
    el.addEventListener("click", swallow, { capture: true, once: true });
    const finish = (): void => { window.setTimeout(() => el.removeEventListener("click", swallow, true), 80); };
    window.addEventListener("pointerup", finish, {once:true});
  };

  const onDown = (e: PointerEvent): void => {
    lastPointerType = e.pointerType || "mouse";
    if (e.button !== undefined && e.button !== 0) return;
    if (dragState.active) return;
    const target = e.target as Element | null;
    let el = target?.closest<HTMLElement>("[data-vault-catch]") ?? null;
    let cat: VaultCatch | null = null;
    if (el) {
      const raw = el.getAttribute("data-vault-catch");
      if (raw) {
        try { cat = JSON.parse(raw) as VaultCatch; } catch { cat = null; }
      }
    }
    /* 兜底：设置行没有逐条挂 data-vault-catch（SettingsRow 不转发属性），
       但 markSettingsRows 已打 data-set-id；长按即可收进暂存箱，标题用于以后反查。 */
    if (!cat) {
      const row = target?.closest<HTMLElement>('[data-set-id^="row-"]') ?? null;
      if (row) {
        const title = (row.querySelector<HTMLElement>(".og-settings-row-title,.setting-title")?.textContent ?? "").trim();
        if (title) {
          el = row;
          cat = { type: "payload", title, sub: i18n("auto.components.vault.vaultDrag.p1"), payload: { settingTitle: title }, source: "设置" };
        }
      }
    }
    /* 兜底：旧协议 data-ctx-atom（全局长按菜单的前身）。 */
    if (!cat) {
      const atomEl = target?.closest<HTMLElement>("[data-ctx-atom]") ?? null;
      const raw = atomEl?.getAttribute("data-ctx-atom");
      if (atomEl && raw) {
        try {
          const a = JSON.parse(raw) as { kind?: string; key?: string; title?: string };
          if (a?.kind && a?.key) {
            el = atomEl;
            cat = { type: "atom", title: a.title || a.kind, atom: { kind: a.kind, key: a.key }, source: "页面元素" };
          }
        } catch { /* ignore */ }
      }
    }
    if (!el || !cat?.title || target?.closest("input, textarea, select, [contenteditable=true], .free-toolbar, .free-handle, .free-drag-handle")) return;
    clear();
    pending = { cat, el, x: e.clientX, y: e.clientY, pointerId: e.pointerId, timer: null, armed: false };
    pending.timer = window.setTimeout(arm, GESTURE.longPressMs);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!pending || e.pointerId !== pending.pointerId) return;
    if (pending.armed) return;
    const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
    /* 触摸端手指会抖：8px 太紧，长按还没到就被当滚动取消（手机上「长按没反应」的主因之一）。
       触摸放宽到 14px；鼠标仍是 8px。真正滑动 scrolling 仍会超过它。 */
    const slop = e.pointerType === "touch" ? 14 : GESTURE.longPressSlop;
    if (dist > slop) clear();
  };
  /** 安卓 WebView 长按会弹原生「复制/全选」菜单并取消指针：在可拖元素上直接吞掉 contextmenu。
      桌面右键菜单不在这里管（只有 touch 指针的 contextmenu 才吞）。 */
  let lastPointerType = "mouse";
  const onContextMenu = (e: MouseEvent): void => {
    if (lastPointerType !== "touch") return;
    const el = e.target as Element | null;
    if (el?.closest("[data-vault-catch]")) e.preventDefault();
  };
  const onUp = (): void => clear();
  const lockTouch = (e: TouchEvent): void => {if (dragState.active && e.cancelable) e.preventDefault();};
  const escape = (e: KeyboardEvent): void => {if(e.key === "Escape"){clear();if(dragState.active)endDrag(false,startX,startY,null);}};
  document.addEventListener("touchmove",lockTouch,{passive:false});
  document.addEventListener("contextmenu",onContextMenu,{capture:true});
  window.addEventListener("keydown",escape);
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onUp, true);
  document.addEventListener("pointercancel", onUp, true);
  return () => {
    clear();
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onUp, true);
    document.removeEventListener("pointercancel", onUp, true);
    document.removeEventListener("touchmove",lockTouch);
    document.removeEventListener("contextmenu",onContextMenu,{capture:true} as never);
    window.removeEventListener("keydown",escape);
    if(dragState.active)endDrag(false,startX,startY,null);
    moveHooked = false;
  };
}

/** 给任意元素生成 data 属性值（组件里展开用）。 */
export function vaultCatchAttr(cat: VaultCatch): string {
  return JSON.stringify(cat);
}

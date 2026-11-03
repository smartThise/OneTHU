import { claimGesture, gestureOwner, releaseGesture, GESTURE } from "./gestureArena.js";
let nextSwipeId = 0;
type Direction = -1 | 1;
type Axis = "x" | "y";

export interface WeekNavigation {
  step(direction: Direction, axis?: Axis): void;
  /** Called after React commits the destination week. */
  commit(): void;
  dispose(): void;
}

/** Touch follows the finger horizontally; desktop wheels page vertically.
 * One wheel burst includes its momentum and advances a single week. */
export function installWeekSwipe(host: HTMLElement, step: (direction: Direction) => void | false, desktopWheel = true): WeekNavigation {
  const owner = `schedule-week-swipe:${++nextSwipeId}`;
  const doc = host.ownerDocument, view = doc.defaultView;
  const content = host.querySelector<HTMLElement>(".schedule-week");
  const reduced = () => view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  let pointer: { id: number; x: number; y: number; at: number; horizontal: boolean } | null = null;
  let suppressClickUntil = 0, wheelAt = -Infinity, wheelY = 0, wheelStepped = false;
  let pending: { direction: Direction; axis: Axis; offset: number; snapshot: HTMLElement } | null = null;
  let animations: Animation[] = [], disposed = false;
  const now = () => performance.now();
  const transform = (axis: Axis, offset: number) => axis === "x" ? `translate3d(${offset}px,0,0)` : `translate3d(0,${offset}px,0)`;
  function finish() {
    const previous = animations; animations = [];
    for (const animation of previous) animation.cancel();
    pending?.snapshot.remove(); pending = null;
    if (content) content.style.transform = "";
    host.classList.remove("is-week-transitioning", "is-week-swiping");
  }
  function animate(element: HTMLElement, from: number, to: number, axis: Axis, duration: number): Animation {
    return element.animate([{ transform: transform(axis, from) }, { transform: transform(axis, to) }], {
      duration, easing: "cubic-bezier(0.22, 0.8, 0.24, 1)", fill: "both",
    });
  }
  function request(direction: Direction, axis: Axis = "y", offset = 0) {
    if (disposed || pending) return;
    finish();
    if (content && !reduced() && typeof content.animate === "function") {
      const snapshot = content.cloneNode(true) as HTMLElement;
      snapshot.classList.add("schedule-week-snapshot");
      snapshot.setAttribute("aria-hidden", "true");
      snapshot.setAttribute("inert", "");
      snapshot.removeAttribute("id");
      snapshot.querySelectorAll("[id], [data-vault-catch]").forEach((node) => { node.removeAttribute("id"); node.removeAttribute("data-vault-catch"); });
      snapshot.style.transform = transform(axis, offset);
      host.append(snapshot);
      pending = { direction, axis, offset, snapshot };
      host.classList.add("is-week-transitioning");
      // Keep the old week stationary until the destination DOM has committed.
      content.style.transform = transform(axis, direction * (axis === "x" ? host.clientWidth : host.clientHeight) + offset);
    }
    if (step(direction) === false) finish();
  }
  function commit() {
    if (!pending || !content) return;
    const { direction, axis, offset, snapshot } = pending;
    const distance = axis === "x" ? host.clientWidth : host.clientHeight;
    const duration = 340;
    animations = [animate(snapshot, offset, -direction * distance, axis, duration),
      animate(content, direction * distance + offset, 0, axis, duration)];
    const current = animations;
    void Promise.all(current.map((animation) => animation.finished)).then(() => {
      if (animations === current) finish();
    }).catch(() => undefined);
  }
  function reset() {
    const id = pointer?.id; pointer = null;
    releaseGesture(owner);
    if (id !== undefined && host.hasPointerCapture?.(id)) host.releasePointerCapture(id);
    host.classList.remove("is-week-swiping");
  }
  function settle() {
    const offset = content?.style.transform;
    reset();
    if (!content || !offset || pending) return;
    if (reduced() || typeof content.animate !== "function") { content.style.transform = ""; return; }
    const animation = content.animate([{ transform: offset }, { transform: transform("x", 0) }], {
      duration: 220, easing: "cubic-bezier(0.22, 0.8, 0.24, 1)", fill: "both",
    });
    animations = [animation]; const current = animations;
    void animation.finished.then(() => { if (animations === current) finish(); }).catch(() => undefined);
  }
  function down(event: PointerEvent) {
    if (!event.isPrimary) { settle(); return; }
    suppressClickUntil = 0;
    if (event.pointerType === "mouse" || event.button !== 0 || event.defaultPrevented || gestureOwner()) return;
    if ((event.target as Element | null)?.closest?.("button, a, input, select, textarea, [role='slider'], [contenteditable='true']")) return;
    finish();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, at: now(), horizontal: false };
  }
  function move(event: PointerEvent) {
    const current = pointer;
    if (!current || current.id !== event.pointerId) return;
    if (gestureOwner() && gestureOwner() !== owner) { reset(); return; }
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.horizontal) {
      if (now() - current.at >= GESTURE.longPressMs) { reset(); return; }
      if (Math.abs(dy) >= 10 && Math.abs(dy) >= Math.abs(dx) * 0.8) { reset(); return; }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.35) return;
      if (!claimGesture(owner)) { reset(); return; }
      current.horizontal = true;
      host.classList.add("is-week-swiping");
      try { host.setPointerCapture(event.pointerId); } catch { /* Implicit touch capture. */ }
    }
    if (content && !reduced()) content.style.transform = transform("x", Math.max(-host.clientWidth * 0.85, Math.min(host.clientWidth * 0.85, dx)));
    if (event.cancelable) event.preventDefault();
  }
  function up(event: PointerEvent) {
    const current = pointer;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    const canStep = current.horizontal && gestureOwner() === owner
      && Math.abs(dx) >= Math.max(48, Math.min(96, host.clientWidth * 0.12))
      && Math.abs(dx) >= Math.abs(dy) * 1.35;
    if (current.horizontal) suppressClickUntil = now() + 350;
    if (canStep) {
      const offset = Math.max(-host.clientWidth * 0.85, Math.min(host.clientWidth * 0.85, dx));
      reset(); request(dx < 0 ? 1 : -1, "x", offset);
    } else settle();
  }
  function cancel(event: PointerEvent) { if (pointer?.id === event.pointerId) settle(); }
  function lost(event: PointerEvent) { if (event.target === host) cancel(event); }
  function click(event: MouseEvent) {
    if (event.detail === 0 || now() >= suppressClickUntil) return;
    suppressClickUntil = 0; event.preventDefault(); event.stopImmediatePropagation();
  }
  function wheel(event: WheelEvent) {
    if (!desktopWheel || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented || pointer || gestureOwner()) return;
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || !event.deltaY) return;
    const time = now();
    if (time - wheelAt > 180) { wheelY = 0; wheelStepped = false; }
    wheelAt = time;
    event.preventDefault();
    if (wheelStepped || pending || animations.length) return;
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1;
    wheelY += event.deltaY * scale;
    if (Math.abs(wheelY) >= 48) {
      wheelStepped = true; request(wheelY > 0 ? 1 : -1, "y");
    }
  }
  const hide = () => { if (doc.hidden) { reset(); finish(); } };
  const blur = () => { reset(); finish(); };
  host.addEventListener("pointerdown", down);
  host.addEventListener("pointermove", move, { passive: false });
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", cancel);
  host.addEventListener("lostpointercapture", lost);
  host.addEventListener("click", click, true);
  host.addEventListener("wheel", wheel, { passive: false });
  view?.addEventListener("blur", blur);
  doc.addEventListener("visibilitychange", hide);
  return { step: request, commit, dispose() {
    disposed = true; reset(); finish();
    host.removeEventListener("pointerdown", down);
    host.removeEventListener("pointermove", move);
    host.removeEventListener("pointerup", up);
    host.removeEventListener("pointercancel", cancel);
    host.removeEventListener("lostpointercapture", lost);
    host.removeEventListener("click", click, true);
    host.removeEventListener("wheel", wheel);
    view?.removeEventListener("blur", blur);
    doc.removeEventListener("visibilitychange", hide);
  } };
}

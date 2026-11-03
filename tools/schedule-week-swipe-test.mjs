/** Exercise the production pointer handlers without account or network data. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
let owner = null;
const arena = {
  GESTURE: { longPressMs: 400 }, gestureOwner: () => owner,
  claimGesture(id) { if (owner && owner !== id) return false; owner = id; return true; },
  releaseGesture(id) { if (owner === id) owner = null; },
};
let clock = 0;
const source = readFileSync(new URL("../apps/desktop/src/lib/weekSwipe.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
new Function("exports", "require", "performance", compiled)(exports, () => arena, { now: () => clock });
function fixture(desktopWheel = true) {
  const listeners = new Map(), windowListeners = new Map(), classes = new Set(); const steps = [];
  const view = {
    addEventListener(type, fn) { if (!windowListeners.has(type)) windowListeners.set(type, new Set()); windowListeners.get(type).add(fn); },
    removeEventListener(type, fn) { windowListeners.get(type)?.delete(fn); },
  };
  const host = {
    clientWidth: 390, clientHeight: 720, capture: null, querySelector: () => null,
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
    ownerDocument: { defaultView: view, getSelection: () => null, addEventListener() {}, removeEventListener() {} },
    contains: node => node === host,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    setPointerCapture(id) { this.capture = id; }, hasPointerCapture(id) { return this.capture === id; },
    releasePointerCapture(id) { if (this.capture === id) this.capture = null; },
  };
  const navigation = exports.installWeekSwipe(host, dir => steps.push(dir), desktopWheel);
  const dispose = () => navigation.dispose();
  const dispatch = (outside, type, x = 200, y = 200, changes = {}) => {
    const event = { pointerId: 1, isPrimary: true, pointerType: "touch", button: 0, buttons: type === "pointerup" ? 0 : 1, detail: 1, clientX: x, clientY: y,
      target: { closest: () => null }, cancelable: true, defaultPrevented: false, blocked: false,
      composedPath() { return outside ? [this.target] : [this.target, host]; },
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.blocked = true; }, ...changes };
    for (const fn of (outside ? windowListeners : listeners).get(type) ?? []) { fn(event); if (event.blocked) break; }
    return event;
  };
  const emit = (...args) => dispatch(false, ...args), emitOutside = (...args) => dispatch(true, ...args);
  return { host, steps, emit, emitOutside, dispose, navigation };
}
const tests = [];
function test(name, run) { owner = null; clock = 0; run(); tests.push(name); console.log("PASS " + name); }
test("left and right swipes each step exactly one week", () => {
  const f = fixture();
  f.emit("pointerdown"); f.emit("pointermove", 110, 205); f.emit("pointerup", 90, 206);
  f.emit("pointerdown"); f.emit("pointermove", 280, 202); f.emit("pointerup", 310, 203);
  assert.deepEqual(f.steps, [1, -1]); assert.equal(owner, null); f.dispose();
});
test("a swipe consumes the following course click; the next tap is usable", () => {
  const f = fixture(); f.emit("pointerdown"); f.emit("pointermove", 110); f.emit("pointerup", 90);
  assert.equal(f.emit("click").blocked, true);
  f.emit("pointerdown"); f.emit("pointerup"); assert.equal(f.emit("click").blocked, false); f.dispose();
});
test("vertical scroll and taps do not flip weeks or prevent scrolling", () => {
  const f = fixture(); f.emit("pointerdown"); assert.equal(f.emit("pointermove", 205, 240).defaultPrevented, false);
  f.emit("pointermove", 90, 250); f.emit("pointerup", 90, 250);
  f.emit("pointerdown"); f.emit("pointerup"); assert.equal(f.emit("click").blocked, false);
  assert.deepEqual(f.steps, []); f.dispose();
});
test("a small horizontal movement does not turn the week", () => {
  const f = fixture(); f.emit("pointerdown"); f.emit("pointermove", 220, 201); f.emit("pointerup", 230, 201);
  assert.deepEqual(f.steps, []); f.dispose();
});
test("holding a card or dragging into the vault keeps its gesture", () => {
  const f = fixture(); f.emit("pointerdown"); clock = 450; f.emit("pointermove", 110); f.emit("pointerup", 90);
  f.emit("pointerdown"); arena.claimGesture("vault-drag"); f.emit("pointermove", 110); f.emit("pointerup", 90);
  assert.deepEqual(f.steps, []); assert.equal(owner, "vault-drag"); f.dispose(); arena.releaseGesture("vault-drag");
});
test("pinch, cancellation and modified mouse selection do not turn the week", () => {
  const f = fixture(); f.emit("pointerdown"); f.emit("pointermove", 110); f.emit("pointerdown", 180, 200, { pointerId: 2, isPrimary: false }); f.emit("pointerup", 90);
  f.emit("pointerdown"); f.emit("pointermove", 110); f.emit("pointercancel"); f.emit("pointerup", 90);
  f.emit("pointerdown", 200, 200, { pointerType: "mouse", shiftKey: true }); f.emit("pointermove", 100); f.emit("pointerup", 90);
  assert.deepEqual(f.steps, []); assert.equal(owner, null); f.dispose();
});
test("controls retain their input gestures and cleanup releases only its own gesture", () => {
  const f = fixture(); f.emit("pointerdown", 200, 200, { target: { closest: () => ({}) } }); f.emit("pointermove", 100); f.emit("pointerup", 90);
  assert.deepEqual(f.steps, []);
  const other = fixture(); f.emit("pointerdown"); f.emit("pointermove", 110); const active = owner;
  other.dispose(); assert.equal(owner, active); f.dispose(); assert.equal(owner, null);
});
test("desktop wheel down/up advances exactly once per burst, including momentum", () => {
  const f = fixture(); const wheel = dy => f.emit("wheel", 0, 0, { deltaX: 0, deltaY: dy, deltaMode: 0 });
  wheel(25); clock += 16; assert.equal(wheel(30).defaultPrevented, true);
  for (let i = 0; i < 30; i++) { clock += 16; wheel(20); }
  assert.deepEqual(f.steps, [1]);
  clock += 200; wheel(-80); assert.deepEqual(f.steps, [1, -1]); f.dispose();
});
test("horizontal trackpad scrolling, pinch and modifier keys retain native behavior", () => {
  const f = fixture();
  for (const changes of [{deltaX:80,deltaY:0}, {ctrlKey:true}, {metaKey:true}, {shiftKey:true}]) {
    assert.equal(f.emit("wheel", 0, 0, { deltaX: 0, deltaY: 90, deltaMode: 0, ...changes }).defaultPrevented, false);
  }
  assert.deepEqual(f.steps, []); f.dispose();
});
test("desktop mouse drags and selected text are completely left to the browser", () => {
  const f = fixture(), mouse = { pointerType: "mouse" };
  f.emit("pointerdown",200,200,mouse); assert.equal(f.emit("pointermove",90,200,mouse).defaultPrevented,false); f.emit("pointerup",90,200,mouse);
  assert.equal(f.emit("click").blocked,false); assert.deepEqual(f.steps,[]); assert.equal(owner,null); f.dispose();
});
test("line and page wheel deltas use the same direction and threshold", () => {
  const f=fixture(); f.emit("wheel",0,0,{deltaX:0,deltaY:3,deltaMode:1}); clock+=200;
  f.emit("wheel",0,0,{deltaX:0,deltaY:-1,deltaMode:2}); assert.deepEqual(f.steps,[1,-1]); f.dispose();
});
test("touch devices keep vertical wheel scrolling and horizontal touch swipes", () => {
  const f=fixture(false); assert.equal(f.emit("wheel",0,0,{deltaX:0,deltaY:100,deltaMode:0}).defaultPrevented,false);
  f.emit("pointerdown"); f.emit("pointermove",100); f.emit("pointerup",90); assert.deepEqual(f.steps,[1]); f.dispose();
});
test("a pending vault drag keeps wheel ownership", () => {
  const f=fixture(); arena.claimGesture("vault-drag"); assert.equal(f.emit("wheel",0,0,{deltaX:0,deltaY:100,deltaMode:0}).defaultPrevented,false);
  assert.deepEqual(f.steps,[]); f.dispose(); assert.equal(owner,"vault-drag");
});
test("buttons can request the same week transition and dispose prevents later changes", () => {
  const f=fixture(); f.navigation.step(1); f.navigation.commit(); assert.deepEqual(f.steps,[1]); f.dispose(); f.navigation.step(-1); assert.deepEqual(f.steps,[1]);
});
test("week animation keeps a noninteractive exit snapshot until destination commit", () => {
  const f = fixture(); f.dispose();
  const frames = [], snapshots = [];
  const animation = { finished: new Promise(() => {}), cancel() {} };
  const content = { style: {}, animate: (keyframes) => { frames.push(keyframes); return animation; },
    cloneNode() { const snapshot = { style: {}, classList: { add() {} }, setAttribute(name) { this[name] = true; }, removeAttribute() {}, querySelectorAll: () => [], remove() { this.removed = true; }, animate: this.animate }; snapshots.push(snapshot); return snapshot; } };
  f.host.querySelector=()=>content; f.host.append=()=>{};
  const nav=exports.installWeekSwipe(f.host,dir=>f.steps.push(dir));
  nav.step(1); assert.deepEqual(f.steps,[1]); assert.equal(frames.length,0);
  assert.equal(snapshots[0]['aria-hidden'],true); assert.equal(snapshots[0].inert,true);
  nav.commit(); assert.equal(frames.length,2);
  assert.equal(frames[0][1].transform,'translate3d(0,-720px,0)');
  assert.equal(frames[1][0].transform,'translate3d(0,720px,0)');
  assert.equal(frames[1][1].transform,'translate3d(0,0px,0)');
  nav.dispose(); assert.equal(snapshots[0].removed,true); assert.equal(content.style.transform,'');
});
test("touch drag follows the pointer and cancelled movement settles back", () => {
  const f=fixture(); f.dispose(); let lastFrames;
  const content={style:{},animate(frames){lastFrames=frames;return {finished:new Promise(()=>{}),cancel(){}};}};
  f.host.querySelector=()=>content;
  const nav=exports.installWeekSwipe(f.host,dir=>f.steps.push(dir));
  f.emit('pointerdown'); f.emit('pointermove',140,202);
  assert.equal(content.style.transform,'translate3d(-60px,0,0)');
  f.emit('pointercancel'); assert.equal(lastFrames[1].transform,'translate3d(0px,0,0)'); assert.deepEqual(f.steps,[]);nav.dispose();
});
console.log(`${tests.length} schedule navigation checks passed`);

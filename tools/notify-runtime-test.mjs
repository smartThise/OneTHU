/**
 * 通知运行时测试（依赖注入 + 假时钟）：触发时机与「关掉就撤干净」的语义。
 *
 * 运行时的价值全在「什么时候算一次」：漏触发 = 提醒停留在旧数据；触发过密 = 反复
 * 重排系统闹钟。故用假订阅 + 短防抖，把这两件事都钉住。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/notify-runtime-test.mjs
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

const { createNotifyRuntime } = await import("../apps/desktop/src/state/notifyRuntime.ts");
const { saveNotifySettings, loadScheduledFingerprints } = await import("../apps/desktop/src/state/notifySettings.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const T = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
// 课程日期必须相对当前时间生成：钉死日期一过 10:00，课程就掉出 7 天规划窗口（2026-09-21 时间炸弹实录）
const CLS_DATE = (() => { const d = new Date(Date.now() + 86_400_000); const p2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; })();
// DDL 同理（2026-09-25 实录：钉死的 2026-09-22 一过，② 的「计划含 DDL」就红了——
// 运行时按真实时钟算计划，这里注入的假时钟不参与，故截止时刻必须落在真实未来）
const DDL_AT = (() => { const d = new Date(Date.now() + 2 * 86_400_000); const p2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} 23:59:59`; })();
const hw = (id, deadline) => ({ id, title: "第三章习题", deadline, submitted: false, courseName: "数据结构" });

function harness({ hold = hw("h1", DDL_AT), failOn = null } = {}) {
  store.clear();
  const calls = [];
  const listeners = [];
  const errors = [];
  const pending = new Set();
  const invoke = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === failOn) throw new Error("backend down");
    if (cmd === "notify_pending") return { ok: true, ids: [...pending] };
    if (cmd === "notify_schedule") {
      for (const it of JSON.parse(args.items)) pending.add(it.id);
      return { ok: true };
    }
    if (cmd === "notify_cancel") {
      for (const id of JSON.parse(args.ids)) pending.delete(id);
      return { ok: true };
    }
    return { ok: true };
  };
  let nowValue = T(2026, 9, 21, 9, 0);
  return {
    calls, listeners, errors, pending,
    invoke,
    setNow: (ms) => { nowValue = ms; },
    collect: () => ({
      schedule: [{ date: CLS_DATE, startTime: "10:00", courseName: "数据结构", location: "六教6A215", category: "课程" }],
      homework: hold ? [hold] : [],
    }),
    subscribe: (fn) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    fire: () => { for (const fn of [...listeners]) fn(); },
    cmds: () => calls.map((c) => c[0]),
  };
}

/* ① 总开关关闭：撤干净，不排任何东西 */
{
  const h = harness();
  saveNotifySettings({ enabled: false });
  const rt = createNotifyRuntime({ invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe, tickMs: 999999 });
  const r = await rt.syncNow();
  eq("关闭时不排程", r.scheduled, 0);
  eq("关闭时不发 schedule", h.cmds().includes("notify_schedule"), false);
  eq("关闭时计划为空", rt.plan(), []);
  rt.stop();
}

/* ② 开启 + 有数据：排进计划（课程与 DDL 各一条） */
{
  const h = harness();
  saveNotifySettings({ enabled: true });
  const rt = createNotifyRuntime({ invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe, tickMs: 999999 });
  const r = await rt.syncNow();
  ok("开启后确实排了程", r.scheduled >= 2);
  eq("计划含课程", rt.plan().some((x) => x.kind === "class"), true);
  eq("计划含 DDL", rt.plan().some((x) => x.kind === "ddl"), true);
  rt.stop();
}

/* ③ 防抖：连续多次数据变化只重算一次 */
{
  const h = harness();
  saveNotifySettings({ enabled: true });
  const rt = createNotifyRuntime({ invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe, debounceMs: 30, tickMs: 999999 });
  await rt.syncNow();
  h.calls.length = 0;
  h.fire(); h.fire(); h.fire();
  await sleep(80);
  eq("三次变化只触发一轮对齐", h.cmds().filter((c) => c === "notify_schedule").length <= 1, true);
  eq("对齐只发生一次", h.cmds().filter((c) => c === "notify_pending").length, 1);
  rt.stop();
}

/* ④ stop 之后不再响应数据变化与定时 */
{
  const h = harness();
  saveNotifySettings({ enabled: true });
  const rt = createNotifyRuntime({ invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe, debounceMs: 10, tickMs: 999999 });
  await rt.syncNow();
  rt.stop();
  eq("stop 后订阅已解绑", h.listeners.length, 0);
  h.calls.length = 0;
  h.fire();
  await sleep(40);
  eq("stop 后不再产生调用", h.calls.length, 0);
}

/* ⑤ 数据变化导致计划变化 → 自动重排（无需手动） */
{
  const h = harness();
  saveNotifySettings({ enabled: true });
  const rt = createNotifyRuntime({ invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe, debounceMs: 20, tickMs: 999999 });
  await rt.syncNow();
  h.pending.clear();                      // 模拟原生侧丢失排程
  h.fire();
  await sleep(60);
  ok("变化后自动补排", h.cmds().includes("notify_schedule"));
  rt.stop();
}

/* ⑥ 投递失败：错误回报并上报，但不炸运行时；
 *  注意探活（notify_pending）失败是**故意吞掉**的——那只是优化手段，
 *  探不到就当作「原生没排过」重排一次（幂等覆盖），不该让整轮同步失败。 */
{
  const h = harness({ failOn: "notify_schedule" });
  saveNotifySettings({ enabled: true });
  const rt = createNotifyRuntime({
    invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe,
    tickMs: 999999, onError: (m) => h.errors.push(m),
  });
  const r = await rt.syncNow();
  eq("投递失败如实回报", [r.scheduled, typeof r.error === "string"], [0, true]);
  ok("错误已上报", h.errors.length >= 1);
  eq("失败不记指纹（下轮可重试）", Object.keys(loadScheduledFingerprints()).length, 0);
  rt.stop();
}
{
  const h = harness({ failOn: "notify_pending" });
  saveNotifySettings({ enabled: true });
  const rt = createNotifyRuntime({
    invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe,
    tickMs: 999999, onError: (m) => h.errors.push(m),
  });
  const r = await rt.syncNow();
  ok("探活失败不阻断投递", r.scheduled >= 2);
  eq("探活失败不报错", h.errors.length, 0);
  rt.stop();
}

/* ⑦ 非 Android：整条链静默跳过 */
{
  const h = harness();
  saveNotifySettings({ enabled: true });
  const rt = createNotifyRuntime({ invoke: h.invoke, backendAvailable: false, collect: h.collect, subscribe: h.subscribe, tickMs: 999999 });
  const r = await rt.syncNow();
  eq("非 Android 跳过", [r.scheduled, r.skipped], [0, "not-android"]);
  eq("非 Android 零调用", h.calls.length, 0);
  rt.stop();
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

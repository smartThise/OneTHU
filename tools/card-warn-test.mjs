/**
 * 校园卡余额预警护栏。
 *
 * 这个功能的三处容易出错的地方各钉一遍：
 *   [1] 判定（纯函数）：首次 / 冷却内 / 余额未变化 / 恢复 / 关掉 —— 算错会变成
 *       「每次刷新都弹一次」或「余额恢复了通知还挂着」；
 *   [2] 投递编排（假存储 + 假原生）：状态落盘、同 id 覆盖、恢复时撤回、投递失败如实记因；
 *   [3] 接线与原生链路：任何一次余额刷新都过判定、卡片排在「最近消费」之前、
 *       Kotlin 渠道与命令、Rust 命令与注册、桥接命令名 —— 少一处就是「设置能改但没反应」。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/card-warn-test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

const {
  CARD_WARN_CHANNEL,
  CARD_WARN_DEFAULTS,
  CARD_WARN_NOTIFY_ID,
  CARD_WARN_STATE_DEFAULT,
  CARD_WARN_TARGET,
  applyCardWarnChange,
  cardWarnReasonText,
  cardWarnStatusText,
  cardWarnText,
  evaluateCardWarn,
  loadCardWarnSettings,
  loadCardWarnState,
  observeCardBalance,
  saveCardWarnSettings,
  saveCardWarnState,
} = await import("../apps/desktop/src/state/cardWarn.ts");

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
let pass = 0;
const eq = (name, a, b) => {
  assert.deepEqual(a, b, name);
  pass++;
};
const ok = (name, cond) => {
  assert.ok(cond, name);
  pass++;
};

const DAY = 86_400_000;
const on = { ...CARD_WARN_DEFAULTS, enabled: true, threshold: 20 };
const warned = (balance, at) => ({ warnedBalance: balance, warnedAt: at, active: true, delivered: true, reason: "" });
const at = (bal, state, settings = on, now = 1_000_000_000_000) =>
  evaluateCardWarn({ balance: bal, now, settings, state });

/* ---------- [1] 判定 ---------- */

eq("默认设置：关、20 元、240 分钟（4 小时）、余额未变化不重复", CARD_WARN_DEFAULTS, {
  enabled: false,
  threshold: 20,
  cooldownMin: 240,
  skipUnchanged: true,
});

eq("首次低于预警线 → 发通知", [at(12.3, CARD_WARN_STATE_DEFAULT).action, at(12.3, CARD_WARN_STATE_DEFAULT).reason], ["notify", "first"]);
eq("等于预警线也提醒（口径是小于等于）", at(20, CARD_WARN_STATE_DEFAULT).action, "notify");
eq("高于预警线且从未提醒 → 什么都不做", [at(20.01, CARD_WARN_STATE_DEFAULT).action, at(20.01, CARD_WARN_STATE_DEFAULT).reason], ["none", "steady"]);
eq("恢复 → 撤回通知", [at(50, warned(12.3, 1_000_000_000_000)).action, at(50, warned(12.3, 1_000_000_000_000)).reason], [
  "dismiss",
  "recovered",
]);
eq("恢复后状态清空（下次再低要能立刻提醒）", at(50, warned(12.3, 1_000_000_000_000)).state, CARD_WARN_STATE_DEFAULT);

eq(
  "余额未再次变化 + 勾了「不重复」 → 冷却到点也不重发",
  at(12.3, warned(12.3, 1_000_000_000_000), on, 1_000_000_000_000 + 5 * DAY).reason,
  "unchanged",
);
eq(
  "「不重复提醒」开着时余额一变就立刻提醒（冷却不参与判定，不等冷却到点）",
  at(3.5, warned(12.3, 1_000_000_000_000), on, 1_000_000_000_000 + 5000).action,
  "notify",
);
eq(
  "余额未变化 + 未勾「不重复」 + 冷却未到 → 不重发",
  at(12.3, warned(12.3, 1_000_000_000_000), { ...on, skipUnchanged: false }, 1_000_000_000_000 + 60_000).reason,
  "cooldown",
);
eq(
  "余额未变化 + 未勾「不重复」 + 冷却已过 → 重发",
  at(12.3, warned(12.3, 1_000_000_000_000), { ...on, skipUnchanged: false }, 1_000_000_000_000 + 4 * 60 * 60_000 + 1).action,
  "notify",
);
eq(
  "关掉「不重复提醒」后走冷却：余额又降了 + 冷却已过 → 重发",
  at(3.5, warned(12.3, 1_000_000_000_000), { ...on, skipUnchanged: false }, 1_000_000_000_000 + 5 * 60 * 60_000).state.warnedBalance,
  3.5,
);
eq("冷却为 0 时仍受「余额未变化」约束", at(12.3, warned(12.3, 0), { ...on, cooldownMin: 0 }).reason, "unchanged");
eq("非有限余额不判定", at(Number.NaN, CARD_WARN_STATE_DEFAULT).action, "none");

eq("关掉预警且有通知挂着 → 撤回", [at(3, warned(3, 0), { ...on, enabled: false }).action, at(3, warned(3, 0), { ...on, enabled: false }).reason], [
  "dismiss",
  "off",
]);
eq("关掉预警且没有通知 → 不动作", at(3, CARD_WARN_STATE_DEFAULT, { ...on, enabled: false }).action, "none");

eq("通知文案（品牌名与内容之间留一个空格）", cardWarnText(12.3, 20), {
  title: "OneTHU 余额预警",
  body: "余额还剩 ¥12.30，已低于设置的 ¥20.00",
});

/* ---------- [2] 投递编排 ---------- */

const depsOf = (log, fail = false) => ({
  post: async (n) => {
    log.push(["post", n]);
    return fail ? { ok: false, reason: "notifications-denied" } : { ok: true };
  },
  dismiss: async (ids) => void log.push(["dismiss", ids]),
});

store.clear();
let log = [];
saveCardWarnSettings({ enabled: false });
eq("设置落盘后可读回", loadCardWarnSettings().threshold, 20);
saveCardWarnSettings({ enabled: true, threshold: 20, cooldownMin: 240 });
eq("未提醒时状态为空", loadCardWarnState(), CARD_WARN_STATE_DEFAULT);

const T0 = 1_700_000_000_000;
eq("首次观察 → 发一条", await observeCardBalance(12.3, { now: T0, deps: depsOf(log) }), "notify");
eq("投递载荷（稳定 id / 余额渠道 / 落点生活页校园卡）", log.map(([k, v]) => (k === "post" ? { ...v } : k)), [
  {
    id: CARD_WARN_NOTIFY_ID,
    title: "OneTHU 余额预警",
    body: "余额还剩 ¥12.30，已低于设置的 ¥20.00",
    channel: CARD_WARN_CHANNEL,
    target: CARD_WARN_TARGET,
  },
]);
eq("落点是生活页校园卡栏", CARD_WARN_TARGET, "life?lifeTab=card");
eq("状态记下已提醒与余额", loadCardWarnState(), warned(12.3, T0));

log = [];
eq("同一余额再观察（冷却内）→ 不重发", await observeCardBalance(12.3, { now: T0 + 1000, deps: depsOf(log) }), "none");
eq("确实一次原生调用都没有", log.length, 0);

log = [];
eq("余额回升 → 撤回通知", await observeCardBalance(88, { now: T0 + 2000, deps: depsOf(log) }), "dismiss");
eq("撤回的是同一条 id", log, [["dismiss", [CARD_WARN_NOTIFY_ID]]]);
eq("撤回后状态清空", loadCardWarnState(), CARD_WARN_STATE_DEFAULT);

log = [];
saveCardWarnState(warned(12.3, T0));
eq(
  "余额又降回去 + 冷却已过 → 再发一条（新数值）",
  await observeCardBalance(2, { now: T0 + 5 * 60 * 60_000, deps: depsOf(log) }),
  "notify",
);
eq("第二条文案带新余额", log[0][1].body, "余额还剩 ¥2.00，已低于设置的 ¥20.00");

store.clear();
saveCardWarnSettings({ enabled: true, threshold: 20, cooldownMin: 240 });
log = [];
await observeCardBalance(5, { now: T0, deps: depsOf(log, true) });
eq("投递失败要如实记录原因（卡片状态行据此说明）", [loadCardWarnState().delivered, loadCardWarnState().reason], [false, "notifications-denied"]);

store.clear();
saveCardWarnSettings({ enabled: false });
saveCardWarnState(warned(5, T0));
log = [];
eq("关掉预警后立即生效（无需等下一次刷新）", await applyCardWarnChange(null, { deps: depsOf(log) }), "dismiss");
eq("关掉时撤回通知并清空状态", [log, loadCardWarnState().active], [[["dismiss", [CARD_WARN_NOTIFY_ID]]], false]);

store.clear();
saveCardWarnSettings({ enabled: true, threshold: 20 });
saveCardWarnState(CARD_WARN_STATE_DEFAULT);
log = [];
eq("打开预警时已低于预警线 → 立刻提醒", await applyCardWarnChange(8, { now: T0, deps: depsOf(log) }), "notify");
saveCardWarnSettings({ threshold: 5 });
eq("把预警线调到余额之下（余额即恢复正常）→ 撤回", await applyCardWarnChange(8, { now: T0 + 10, deps: depsOf(log) }), "dismiss");

store.clear();
saveCardWarnSettings({ enabled: true, threshold: 20 });
saveCardWarnState(warned(8, T0));
eq("拿不到余额时不动状态", await applyCardWarnChange(null, { deps: depsOf([]) }), "none");
eq("状态还在（已提醒）", loadCardWarnState().active, true);

eq("状态行：未开启", cardWarnStatusText({ settings: { ...on, enabled: false }, state: CARD_WARN_STATE_DEFAULT, balance: 5, now: T0 }), "未开启：余额低于预警线时不会提醒");
eq("状态行：高于预警线", cardWarnStatusText({ settings: on, state: CARD_WARN_STATE_DEFAULT, balance: 30, now: T0 }), "当前余额 ¥30.00，高于预警线 ¥20.00");
eq("状态行：已提醒（未送达要写明原因，原因码要翻成人话）", cardWarnStatusText({
  settings: on,
  state: { warnedBalance: 5, warnedAt: T0, active: true, delivered: false, reason: "notifications-denied" },
  balance: 5,
  now: T0,
}), "提醒未送达：系统通知未授权，请在系统设置里允许本应用通知");
eq("状态行：未知原因码原样保留（不吞线索）", cardWarnReasonText("post-failed"), "post-failed");
ok("状态行：已送达给出时间与恢复条件", cardWarnStatusText({
  settings: on,
  state: { warnedBalance: 5, warnedAt: T0, active: true, delivered: true, reason: "" },
  balance: 5,
  now: T0 + 3 * 60 * 60_000,
}).includes("3 小时前"));

/* ---------- [3] 取数层接线 ---------- */

const data = read("apps/desktop/src/state/data.ts");
const cardSrc = data.slice(data.indexOf("export function useCard("), data.indexOf("/* ============ 今日预约", data.indexOf("export function useCard(")));
ok("useCard 里调用余额预警判定", /void observeCardBalance\(cardInfo\.balance\);/.test(cardSrc));
ok("判定点跟在缓存写入之后（拿到新余额才判定）", cardSrc.indexOf("cacheSet(cardKey, { info: cardInfo") < cardSrc.indexOf("observeCardBalance"));
ok("取数层引入 cardWarn", /import \{ observeCardBalance \} from "\.\/cardWarn\.js";/.test(data));

/* ---------- [4] 卡页 UI ---------- */

const tab = read("apps/desktop/src/pages/info/CardTab.tsx");
const warnAt = tab.indexOf("<BalanceWarnCard ");
const recentAt = tab.indexOf('<SectionHead title="最近消费"');
ok("卡页挂了余额预警卡", warnAt > 0);
ok("预警卡排在「最近消费」之前", warnAt < recentAt && recentAt > 0);
ok("预警卡在余额主卡之后", tab.indexOf('className="stats stats-hero"') < warnAt);
ok("设置项都在卡片里", /预警线/.test(tab) && /提醒冷却/.test(tab) && /不重复提醒/.test(tab) && /当余额未变化/.test(tab));
ok("预警线单位是元、冷却单位是分钟", /card-warn-unit">元</.test(tab) && /card-warn-unit">分钟</.test(tab));
ok("状态行渲染", /cardWarnStatusText\(\{ settings: s, state: st, balance, now: Date\.now\(\) \}\)/.test(tab));
ok("未开启预警时不显示状态行", /\{s\.enabled \? <div className="card-warn-status">/.test(tab));
ok("「不重复提醒」开着时冷却输入不可设置", /disabled=\{s\.skipUnchanged\}/.test(tab));
ok("置灰行的样式在位", /card-warn-field\.is-off/.test(read("apps/desktop/src/styles/global.css")));
ok("开关即存即用（改动立刻生效）", /setS\(saveCardWarnSettings\(p\)\);\s*\r?\n\s*void applyCardWarnChange\(balance\);/.test(tab));
ok("订阅状态变化重画", /subscribeCardWarn\(/.test(tab));

/* ---------- [5] 原生链路 ---------- */

const kt = read("apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/java/app/onethu/mobile/OnethuMobilePlugin.kt");
const notifyKt = read("apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/java/app/onethu/mobile/OnethuNotify.kt");
ok("Kotlin 新增校园卡余额渠道", /CH_BALANCE = "onethu_balance"/.test(notifyKt) && /Triple\(CH_BALANCE, "校园卡余额"/.test(notifyKt));
ok("渠道映射认 balance", /"balance" -> CH_BALANCE/.test(notifyKt));
ok("Kotlin 有撤回已展示通知的实现", /fun dismiss\(ctx: Context, id: String\): Boolean/.test(notifyKt) && /NotificationManagerCompat\.from\(ctx\)\.cancel\(notifId\(id\)\)/.test(notifyKt));
ok("Kotlin 命令 notifyPost / notifyDismiss", /fun notifyPost\(invoke: Invoke\)/.test(kt) && /fun notifyDismiss\(invoke: Invoke\)/.test(kt));
ok("参数类是 @InvokeArg（R8 会剥掉非注解类的字段）", /@InvokeArg\r?\nclass NotifyPostArgs/.test(kt) && /@InvokeArg\r?\nclass NotifyDismissArgs/.test(kt));
ok("notifyPost 缺权限时如实回报（不在刷新路径弹授权框）", /reason", "notifications-denied"/.test(kt));
ok("notifyPost 不写待投递库（排程对齐不会误撤它）", !/NotifyStore\.put\(ctx, args\.id/.test(kt));

const lib = read("apps/desktop/src-tauri/src/lib.rs");
ok("Rust 命令 notify_post（移动端走插件）", /run_mobile_plugin_async\(\s*"notifyPost"/.test(lib));
ok("Rust 命令 notify_dismiss（移动端走插件）", /run_mobile_plugin_async\("notifyDismiss"/.test(lib));
ok("命令已注册到 handler", /notify_post,notify_dismiss,/.test(lib));

const rs = read("apps/desktop/src-tauri/src/notify.rs");
ok("桌面后端有 post / dismiss 分支", /pub fn post\(id: &str, title: &str, body: &str/.test(rs) && /pub fn dismiss\(ids_json: &str\)/.test(rs));
ok("macOS 撤回走「已投递」通道", /removeDeliveredNotificationsWithIdentifiers/.test(read("apps/desktop/src-tauri/src/notify_macos.rs")));
ok("Windows 撤回按 (tag, group, AUMID) 定位", /RemoveGroupedTagWithId/.test(read("apps/desktop/src-tauri/src/notify_windows.rs")));

const bridge = read("apps/desktop/src/state/notifyBridge.ts");
ok("桥接用 notify_post / notify_dismiss 两个命令", /invoke<Record<string, unknown>>\("notify_post"/.test(bridge) && /invoke\("notify_dismiss"/.test(bridge));

const warn = read("apps/desktop/src/state/cardWarn.ts");
ok("通知 id 固定（同 id 重发即覆盖）", /CARD_WARN_NOTIFY_ID = "card-warn:balance";/.test(warn));
ok("状态与设置分开持久化", /onethu\.cardwarn\.v1/.test(warn) && /onethu\.cardwarn\.state\.v1/.test(warn));

const docs = read("docs/architecture.md");
ok("架构文档登记了这条功能与护栏", /tools\/card-warn-test\.mjs/.test(docs) && /余额预警/.test(docs));

console.log(`card-warn-test: ${pass} 项断言全部通过（判定 / 冷却 / 未变化 / 恢复 / 投递 / 接线 / 原生链路）`);

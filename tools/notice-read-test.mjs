/**
 * 通知「已读」护栏（R23，霖实测：点开过的通知有时仍是未读）。
 *
 * 根因：已读只有服务端 `sfyd` 一个来源，客户端从不置读；而 `beforeViewXs` 详情页此前
 * 只在「有附件」时才请求 → 无附件通知永远置不了读，有附件的也要等下次拉列表才反映
 * （所以「有时」）。
 *
 * [1] 本地覆盖模块行为：置读/幂等/并集/跨会话持久化/坏数据不崩
 * [2] 列表与详情页接线：未读分组走合并口径；详情页打开即置读且总是请求详情页
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* ---------- [1] 本地覆盖模块行为 ---------- */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

const mod = await import("../apps/desktop/src/lib/noticeRead.ts");

assert.equal(mod.isNoticeReadLocally("c1", "n1"), false, "初始不应有本地已读");
assert.equal(mod.noticeHasRead(undefined, "c1", "n1"), false, "服务端未读且本地未读 → 未读");
assert.equal(mod.noticeHasRead(true, "c1", "n1"), true, "服务端已读即为已读");

mod.markNoticeReadLocally("c1", "n1");
assert.equal(mod.isNoticeReadLocally("c1", "n1"), true, "打开后必须立即本地置读");
assert.equal(mod.noticeHasRead(false, "c1", "n1"), true, "本地置读覆盖服务端未读（服务端可能滞后）");
assert.equal(mod.isNoticeReadLocally("c1", "n2"), false, "不得波及其他通知");
assert.equal(mod.isNoticeReadLocally("c2", "n1"), false, "同一 id 在不同课程下互不影响（键含 courseId）");

mod.markNoticeReadLocally("c1", "n1"); // 幂等
const key = [...store.keys()].find((k) => k.includes("noticeRead"));
assert.ok(key, "必须落盘（跨会话保留）");
assert.equal(JSON.parse(store.get(key)).filter((k) => k === "c1::n1").length, 1, "重复置读必须幂等");

mod.markNoticeReadLocally("", "n9"); // 空参不写
assert.equal(mod.isNoticeReadLocally("", "n9"), false, "空 courseId 不得写入");

// 坏数据：新模块实例读坏存储必须按空处理，不抛
store.set(key, "{坏数据");
const mod2 = await import("../apps/desktop/src/lib/noticeRead.ts?bad=1");
assert.equal(mod2.isNoticeReadLocally("c1", "n1"), false, "损坏存储按空处理，不得抛错");

/* ---------- [2] 接线：列表 + 详情页 ---------- */
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const list = read("apps/desktop/src/pages/learn/NoticesPage.tsx");
assert.ok(list.includes("noticeHasRead") && list.includes("useNoticeReadVersion"),
  "通知列表的未读分组必须走「服务端 ∪ 本地」合并口径并订阅变更");
assert.ok(/unread: ns\.filter\(\(n\) => !hasRead\(n\)\)/.test(list),
  "未读分组必须用合并后的 hasRead 判定");

const detail = read("apps/desktop/src/pages/learn/NoticeDetailPage.tsx");
assert.ok(/markNoticeReadLocally\(n\.courseId, n\.id\)/.test(detail), "打开详情必须置读");
assert.ok(/noticeHasRead\(n\.hasRead, n\.courseId, n\.id\)/.test(detail), "详情页「未读」chip 必须走合并口径");
// 关键回归点：详情页请求不得再以「有附件」为前置（否则无附件通知永远置不了读）
assert.ok(!/if \(!n \|\| !n\.attachmentName \|\| attState !== "idle"\) return;/.test(detail),
  "详情页请求不得以「有附件」为前置条件（无附件通知也要置读）");
assert.ok(/n\.attachmentName \|\| att/.test(detail), "附件卡改为「声明有附件或解析出附件」才显示");

console.log("通知已读护栏：全部断言通过（本地覆盖行为 + 列表/详情页接线 + 无附件也置读）");

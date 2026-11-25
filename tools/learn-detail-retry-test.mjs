#!/usr/bin/env node
/** 作业/公告详情内的「登录状态没有建立」必须走全局重试恢复，而不是只重置局部 state。 */
import { readFile } from "node:fs/promises";
import { isSessionExpiredError } from "../apps/desktop/src/lib/sessionErrors.ts";

const fails = [];
const ok = (c, m) => { if (!c) { fails.push(m); } };
const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");
const [assignment, notice, data, reload, sessionErrors] = await Promise.all([
  read("apps/desktop/src/pages/learn/AssignmentDetailPage.tsx"),
  read("apps/desktop/src/pages/learn/NoticeDetailPage.tsx"),
  read("apps/desktop/src/state/data.ts"),
  read("apps/desktop/src/lib/reload.ts"),
  read("apps/desktop/src/lib/sessionErrors.ts"),
]);

ok(isSessionExpiredError(new Error("网络学堂的登录状态没有建立起来")), "识别详情里的登录状态缺失错误");
ok(isSessionExpiredError(new Error("网络学堂会话已失效")), "识别会话失效错误");
ok(!isSessionExpiredError(new Error("HTTP 500")), "普通服务器错误不触发重登");

ok(assignment.includes("withLearnRecovery(() => learn.getHomeworkDetail") && assignment.includes("withLearnRecovery(() => learn.getHomeworkPageDetail"), "作业说明/附件详情走统一恢复");
ok(notice.includes("withLearnRecovery(() => learn.getNotificationPageDetail"), "公告附件详情走统一恢复");
ok(data.includes("recoverLearnSessionForRetry()"), "learn 列表在弹横幅前主动走重试恢复");
ok(reload.includes("export async function withLearnRecovery") && reload.includes("export function recoverLearnSessionForRetry"), "共享恢复入口存在");
ok(reload.includes("learnRetryInflight"), "详情并发恢复单飞");
ok(sessionErrors.includes("登录状态没有建立"), "错误识别覆盖「登录状态没有建立起来」");

if (fails.length) {
  console.error("learn-detail-retry: " + fails.length + " 项失败");
  for (const f of fails) console.error(" ✗ " + f);
  process.exit(1);
}
console.log("learn-detail-retry: 全部通过");

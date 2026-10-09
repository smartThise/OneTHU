/**
 * OH 桥：IM 入站 → onethu.harness 的 chat 命令 → 回复原路发回。
 *
 * 首版按无后端主案（docs/im-cloud/00 §2.2）走「chat 命令零改动」路线：
 * 与 ChatDock 完全同一契约（callRust run {command:"chat"}，应答 {answer,error,confirm}），
 * 两段式确认直接映射为发送「确认/取消」二字——不新增任何 harness 方法。
 *
 * 单飞队列：OH 的 chat 是有状态的连续对话，并发 run 会互串；IM 侧把并发
 * 入站排队串行执行，超队直接以忙回执（用户体感=排队叫号）。
 */
import { callRust } from "../plugins/rust.js";
import { preflightMadModel } from "../state/madmodel.js";
import { logLine } from "../lib/clients.js";
import type { OhChatResult } from "./types.js";

const OH_ID = "onethu.harness";
/** 同时最多 1 个在跑、排队上限 4：防消息轰炸把 OH 顶满 */
const MAX_QUEUE = 4;

let queue: Array<{ input: string; done: (r: OhChatResult) => void }> = [];
let running = false;

function fmt(r: unknown): OhChatResult {
  const v = (r ?? {}) as OhChatResult;
  return {
    answer: typeof v.answer === "string" ? v.answer : undefined,
    error: typeof v.error === "string" ? v.error : undefined,
    confirm: v.confirm && typeof v.confirm === "object" ? v.confirm : null,
  };
}

async function runOne(input: string): Promise<OhChatResult> {
  // MadModel 免费档预检（与 loader 的 chat 闭包同款）：token 缺失时直接给出
  // 准确原因，而不是让 Rust 侧报「未配置 Key」误导排查。
  try {
    const warn = await preflightMadModel();
    if (warn) return { error: warn };
  } catch {
    /* 预检失败不拦路：交给 run 本身去报真实错误 */
  }
  try {
    const out = await callRust(OH_ID, "run", { command: "chat", input });
    return fmt(out);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const head = queue.shift();
      if (!head) return;
      const t0 = Date.now();
      const r = await runOne(head.input);
      void logLine(`[IM] OH chat 完成 ${Date.now() - t0}ms ${r.error ? `err=${r.error.slice(0, 80)}` : "ok"}`);
      head.done(r);
    }
  } finally {
    running = false;
  }
}

/** 发给 OH 并等待应答；忙时排队（超队立即以忙回执，不悬挂发送方） */
export function askOh(input: string): Promise<OhChatResult> {
  if (queue.length >= MAX_QUEUE) {
    return Promise.resolve({ answer: "上一条还在处理中，请稍候再发。" });
  }
  return new Promise<OhChatResult>((done) => {
    queue.push({ input, done });
    void pump();
  });
}

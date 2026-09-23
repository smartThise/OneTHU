/**
 * 开发者构建（__ONETHU_DEV__）专用的前端日志桥。
 *
 * 真机上用户看不到 webview 控制台，而 Rust 侧 log_debug / debug_log_export 能把
 * onethu-debug.log 一键转存系统下载（安卓同时镜像 logcat tag=onethu）。这里把
 * console.* 与未捕获异常灌进那条链，真机排障才有现场；同时留一份有界环形缓冲，
 * 供右上角开发者面板直接查看。
 *
 * 纪律：转发必须批量 + 限量 + 截断，失败后自行熔断——诊断通道绝不能反噬主流程
 * （刷盘拖死主线程，或 invoke 失败 → console.error → 再转发 的死循环）。
 * 本模块只在 installDevLogBridge() 被调用后才有副作用，而调用点在 main.tsx 的
 * `if (__ONETHU_DEV__)` 分支里：正式版整块被静态折叠，不会加载本模块。
 */

export interface DevLogEntry {
  /** 采集时刻（毫秒时间戳） */
  t: number;
  level: string;
  text: string;
}

const MAX_ENTRIES = 300; // 面板里保留的条数
const MAX_LINE = 400; // 单行截断长度
const MAX_PENDING = 120; // 待转发队列上限（超出丢最旧）
const FLUSH_MS = 1200; // 批量转发间隔
const MAX_PER_FLUSH = 20; // 单次最多转发行数
const MAX_FAILURES = 3; // 连续失败到阈值就熔断，不再尝试

const entries: DevLogEntry[] = [];
const pending: string[] = [];
let installed = false;
let timer: number | null = null;
let flushing = false;
let failures = 0;

function clip(text: string): string {
  return text.length > MAX_LINE ? text.slice(0, MAX_LINE) + "…(截断)" : text;
}

function render(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.name + ": " + value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

async function forward(body: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("log_debug", { line: body });
    failures = 0;
  } catch {
    failures += 1; // 诊断通道自身不可用时静默降级（连续失败即熔断）
  } finally {
    flushing = false;
  }
}

function flush(): void {
  timer = null;
  if (flushing || pending.length === 0) return;
  flushing = true;
  const batch = pending.splice(0, MAX_PER_FLUSH);
  void forward(batch.map((line) => "[FE] " + line).join("\n"));
}

function push(level: string, args: unknown[]): void {
  const text = clip(args.map(render).join(" "));
  entries.push({ t: Date.now(), level, text });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  if (failures >= MAX_FAILURES) return;
  // 自身产生的行不回灌：防 invoke 失败 → console.error → 再转发的死循环
  if (text.indexOf("[FE]") === 0 || text.indexOf("log_debug") >= 0) return;
  pending.push(level + " " + text);
  if (pending.length > MAX_PENDING) pending.splice(0, pending.length - MAX_PENDING);
  if (timer === null) timer = window.setTimeout(flush, FLUSH_MS);
}

/** 面板用：当前缓冲快照（副本，外部改不动内部） */
export function devLogEntries(): DevLogEntry[] {
  return entries.slice();
}

export function clearDevLog(): void {
  entries.length = 0;
}

/** 复制用：带时间戳的纯文本 */
export function devLogText(): string {
  return entries
    .map((e) => new Date(e.t).toLocaleTimeString() + " [" + e.level + "] " + e.text)
    .join("\n");
}

/** 装上 console / 异常钩子（幂等；只在开发者构建调用） */
export function installDevLogBridge(): void {
  if (installed) return;
  installed = true;
  const levels = ["log", "info", "warn", "error"] as const;
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      original(...args);
      try {
        push(level, args);
      } catch {
        /* 诊断自身出错不能影响业务 */
      }
    };
  }
  window.addEventListener("error", (e) => {
    push("error", ["未捕获异常: " + e.message + " @" + e.filename + ":" + e.lineno]);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as Error | undefined;
    push("error", ["未处理 Promise 拒绝: " + (reason?.message ?? String(e.reason))]);
  });
}

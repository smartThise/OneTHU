/**
 * 新移植 tab 通用三态件与错误分类（电子发票 / 银行代发 / 研究生收入 / 卫生成绩 /
 * 体测成绩 / 教学评估 / 校历 / 空教室 / 校园网 共用）。
 *
 * 铁律（本批移植 tab 一律遵守）：
 * - 空数据 = 友好文案 Empty，绝不显示为错误条；
 * - ServiceUnavailableError = 静态提示「该服务暂不可用（上游服务维护中）」+ 手动重试，
 *   绝不自动整页刷新；
 * - 登录态失效也只落静态提示 + 重试，绝不触发失登自愈（autoFullReload / backToLogin）——
 *   本批 tab 一律不调用 reload.ts / autoFullReload。
 */
import { ErrorNote, Empty, Card } from "../../components/Layout.js";
import { explainNetworkError } from "../../lib/transport.js";
import { logLine } from "../../lib/clients.js";

/** 页内错误落盘（与 DormTab logErr 同款，只写 /tmp/onethu-debug.log） */
export function logTabErr(tag: string, err: unknown): void {
  void logLine(
    "PAGE-ERR " + tag + " " + (err instanceof Error ? err.message : String(err)),
  ).catch(() => undefined);
  // 兜底铁律：宁可硬刷新也不让用户看见红条。20s 窗口内同一 tab 最多自动刷 2 次，
  // 第三次（持续性故障）才落红条，避免刷新死循环。
  // 例外（本文件头部的铁律）：登录态失效与上游维护是「正常状态/已知态」——
  // 只落静态提示 + 手动重试，绝不硬刷新（校园网与统一身份独立，未登录是常态）。
  if (isAuthExpired(err) || isServiceUnavailable(err)) return;
  hardReloadBailOut(tag);
}

/** 红条前自动硬刷新守卫：返回 true 表示已触发整页重载（调用方后续 setState 无意义） */
export function hardReloadBailOut(scope: string): boolean {
  try {
    const key = `onethu.bailout.${scope}`;
    const now = Date.now();
    let n = 0;
    let t = 0;
    try {
      const raw = JSON.parse(sessionStorage.getItem(key) ?? "{}") as { n?: number; t?: number };
      if (typeof raw.n === "number" && typeof raw.t === "number" && now - raw.t < 20000) {
        n = raw.n;
        t = raw.t;
      }
    } catch {}
    if (n < 2) {
      sessionStorage.setItem(key, JSON.stringify({ n: n + 1, t: now }));
      window.location.reload();
      return true;
    }
    sessionStorage.setItem(key, JSON.stringify({ n: 0, t: now }));
  } catch {}
  return false;
}

/** 上游维护/下线（core ServiceUnavailableError）：按类名+名称双保险识别 */
export function isServiceUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "ServiceUnavailableError" ||
    err.constructor?.name === "ServiceUnavailableError" ||
    /ServiceUnavailable/i.test(err.message)
  );
}

/** 登录态失效（AuthRequiredError 等）：本批 tab 不自愈，只提示 */
export function isAuthExpired(err: unknown): boolean {
  return err instanceof Error && (err.name === "AuthRequiredError" || /AuthRequired/i.test(err.message));
}

/** 错误 → 页内文案（静态，可重试；绝无自动刷新） */
export function tabErrorText(err: unknown): string {
  if (isAuthExpired(err)) return "登录状态已过期，请重新登录后重试。";
  return explainNetworkError(err);
}

/** 上游维护静态提示（ErrorNote 样式，文案固定 + 手动重试按钮） */
export function UnavailableNote({ onRetry }: { onRetry?: () => void }) {
  return <ErrorNote text="该服务暂不可用（上游服务维护中）" onRetry={onRetry} />;
}

/**
 * tab 统一错误落点：维护态（ServiceUnavailableError）用固定文案，其余用
 * explainNetworkError 文案；两者都是静态提示 + 手动重试，绝不自动整页刷新。
 * 注意 unavailable 是在 catch 时由 err 对象判定的布尔值——错误文案是字符串，
 * 不能再拿它做 instanceof 判定。
 */
export function TabError({
  unavailable,
  text,
  onRetry,
}: {
  unavailable: boolean;
  text: string | null;
  onRetry: () => void;
}) {
  if (unavailable) return <UnavailableNote onRetry={onRetry} />;
  return <ErrorNote text={text ?? ""} onRetry={onRetry} />;
}

/** 友好空态（非错误条） */
export function TabEmpty({ text }: { text: string }) {
  return (
    <Card>
      <Empty text={text} />
    </Card>
  );
}

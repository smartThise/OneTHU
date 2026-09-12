/**
 * 新移植 tab 通用三态件与错误分类（电子发票 / 银行代发 / 研究生收入 / 卫生成绩 /
 * 体测成绩 / 教学评估 / 校历 / 空教室 / 校园网 共用）。
 *
 * 铁律（本批移植 tab 一律遵守）：
 * - 空数据 = 友好文案 Empty，绝不显示为错误条；
 * - ServiceUnavailableError = 静态提示「该服务暂不可用（上游服务维护中）」+ 手动重试，
 *   绝不自动整页刷新；
 * - 登录态失效只落静态提示 + 重试，绝不整页刷新——但会触发 keepalive 探针，
 *   会话真死则 softRelogin 透明重建（用户点「重试」时踩的已是活会话）。
 */
import { ErrorNote, Empty, Card } from "../../components/Layout.js";
import { explainNetworkError } from "../../lib/transport.js";
import { logLine, session } from "../../lib/clients.js";

/** 页内错误落盘（与 DormTab logErr 同款，只写 /tmp/onethu-debug.log） */
export function logTabErr(tag: string, err: unknown): void {
  void logLine(
    "PAGE-ERR " + tag + " " + (err instanceof Error ? err.message : String(err)),
  ).catch(() => undefined);
  // 稳定性专项（2026-09-11）：硬刷新核弹退役——auth 失效/未知错误改为 keepalive
  // 探针判定（轻量 GET），会话真死才 softRelogin 透明重建；用户点「重试」时
  // 踩的已是活会话。上游维护是已知态（校网独立）；瞬时网络错误重建无益。
  if (isServiceUnavailable(err)) return;
  if (isTransientNetworkError(err)) return;
  void session.keepalive().catch(() => undefined);
}

/** 瞬时网络错误：传输层抛出的纯网络故障（超时/连不上/DNS），页面状态无恙，重试即愈 */
export function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // 词汇表与 clients.ts isNetworkError 同源（reqwest/invoke 原话），另补浏览器 fetch 措辞
  return /网络错误|timeout|timed? ?out|error sending request|connect|Failed to fetch|Network request failed/i.test(err.message);
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

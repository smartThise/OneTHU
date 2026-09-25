/**
 * 错误原文归一 + 「登录态没了」这类失败的识别（纯函数、零依赖，可直测）。
 *
 * 为什么单独成文件：正文图片、附件预览、相册保存这些**旁路**不经过数据页的错误提示链，
 * 需要自己识别「会话失效」后提示用户；而这段逻辑若留在 `transport.ts` 里，单测一 import
 * 就会把整个 `@onethu/core` 拖进来（Node 的类型剥离不支持 core 里的参数属性语法），
 * 于是识别逻辑一旦回归就测不到。
 */

/**
 * 任意形态的 err 归一成一句话。
 * 原生命令（fetch_binary / download_file）**直接抛字符串**，core 抛 Error，插件抛对象，
 * 以前这三类被各自 toString 成「未知网络错误」——真话被吞掉，排查只能靠猜。
 */
export function rawErrorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
    try {
      return JSON.stringify(err);
    } catch {
      /* 循环引用等：落到下面的兜底 */
    }
  }
  if (err === null || err === undefined) return "";
  return String(err);
}

/**
 * 是不是「登录态没了」这类失败。
 *
 * 原生 `fetch_binary` 拿回登录页时抛的是字符串 `会话已失效，需要重新登录`，core 的数据链
 * 抛的是 `SessionExpiredError`，两种都要认。旁路得自己识别后提示用户——否则用户只看到
 * 几个碎图，完全推不到「该重新登录了」。
 */
export function isSessionExpiredError(err: unknown): boolean {
  return /会话已失效|需要重新登录|未登录|SessionExpired/i.test(rawErrorText(err));
}

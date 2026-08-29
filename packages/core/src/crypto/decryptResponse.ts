/**
 * decryptResponse —— demo（AI选课分析系统/webvpn-poc/server.js）响应解码的纯函数移植。
 *
 * demo 原文（Node axios arraybuffer 版）：
 *   // 先试 utf-8，如果乱码试 gbk
 *   const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
 *   if (text.includes('…')) return new TextDecoder('gbk').decode(new Uint8Array(buf));
 *   return text;
 *
 * 注：demo 源文件里判定字符已丢失成空串（includes('') 恒为 true，等于"永远按 GBK 解"）。
 * 这里按其注释意图实现：检测 UTF-8 解码产生的替换字符 U+FFFD，命中再回落 GBK。
 *
 * 环境说明：Tauri 传输层 reqwest 已开 charset 特性，按 Content-Type 自动把 GBK 响应
 * 转码为 UTF-8 字符串；本函数供能拿到原始字节的调用方（Node / 浏览器）复用同一语义。
 */

const REPLACEMENT_CHAR = "\uFFFD";

export function decryptResponse(buf: Uint8Array): string {
  // 先试 utf-8，如果乱码试 gbk
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (text.includes(REPLACEMENT_CHAR)) {
    try {
      return new TextDecoder("gbk").decode(buf);
    } catch {
      // 运行时不支持 "gbk" 标签（极少见）时退回 utf-8 结果
      return text;
    }
  }
  return text;
}

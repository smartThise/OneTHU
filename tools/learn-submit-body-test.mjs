/**
 * 网络学堂提交请求体序列化护栏（R21c 真机定案）。
 *
 * 真因：learn 专线（learnHttp）全部请求走 nativeFetch，而 nativeFetch 的 body 类型
 * 只声明了 string | URLSearchParams——FormData 落到 `String(body)`，
 * 实际发出字面量 "[object FormData]" 且无 multipart Content-Type，
 * learn 的 Tomcat 回 400「Required String parameter 'xszyid' is not present」。
 *
 * 本测试是**行为测试**：直接喂 FormData 给共用序列化函数，断言 multipart 正文与
 * boundary 真的生成（不是源码文本断言）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { serializeFetchBody } from "../apps/desktop/src/lib/bodySerialize.ts";

/* ---------- [1] 无附件提交（作业正文 + isDeleted，正是 tjzy 的形态） ---------- */
const fd = new FormData();
fd.append("xszyid", "1234567");
fd.append("zynr", "作业正文");
fd.append("fileupload", "undefined");
fd.append("isDeleted", "0");
const s1 = await serializeFetchBody(fd);
assert.ok(s1.contentType?.startsWith("multipart/form-data; boundary="), "必须带 multipart boundary");
const boundary = s1.contentType.split("boundary=")[1];
assert.ok(s1.bodyStr, "无文件时应走文本通道");
for (const part of ['name="xszyid"', 'name="zynr"', 'name="fileupload"', 'name="isDeleted"']) {
  assert.ok(s1.bodyStr.includes(part), `multipart 正文缺字段 ${part}`);
  assert.ok(s1.bodyStr.includes(`--${boundary}`), "分片必须用同一个 boundary");
}
assert.ok(s1.bodyStr.includes("\r\n"), "multipart 必须用 CRLF");
assert.ok(s1.bodyStr.trimEnd().endsWith(`--${boundary}--`), "必须以结束 boundary 收尾");
assert.ok(!s1.bodyStr.includes("[object FormData]"), "绝不允许再把 FormData 字符串化发出");

/* ---------- [2] 带附件提交（文件走 base64 字节通道） ---------- */
const fd2 = new FormData();
fd2.append("xszyid", "7654321");
fd2.append("zynr", "");
fd2.append("fileupload", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "拍照.jpg", { type: "image/jpeg" }));
fd2.append("isDeleted", "0");
const s2 = await serializeFetchBody(fd2);
assert.ok(s2.contentType?.startsWith("multipart/form-data; boundary="), "带文件也必须带 boundary");
assert.ok(s2.bodyB64, "带文件必须走 base64 通道（字符串通道会损坏二进制）");
assert.equal(s2.bodyStr, null, "有文件时不得同时用文本通道");
const bin = Buffer.from(s2.bodyB64, "base64");
assert.ok(bin.includes(Buffer.from('filename="拍照.jpg"')), "文件 part 必须带文件名");
assert.ok(bin.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47])), "文件字节必须原样保留（PNG 头）");

/* ---------- [3] 其余类型不受影响 ---------- */
const s3 = await serializeFetchBody(new URLSearchParams({ a: "1" }));
assert.equal(s3.bodyStr, "a=1");
assert.equal(s3.contentType, "application/x-www-form-urlencoded;charset=UTF-8");
assert.equal((await serializeFetchBody("raw")).bodyStr, "raw");
assert.equal((await serializeFetchBody(null)).bodyStr, null);
const s4 = await serializeFetchBody(new Uint8Array([1, 2, 3]));
assert.equal(Buffer.from(s4.bodyB64, "base64").toString("hex"), "010203", "Uint8Array 走 base64 不损坏");

/* ---------- [4] 两个包装必须共用同一实现（不许再分叉） ---------- */
const transport = readFileSync(new URL("../apps/desktop/src/lib/transport.ts", import.meta.url), "utf8");
const nativeBody = transport.slice(transport.indexOf("export async function nativeFetch"), transport.indexOf("export async function tauriFetch"));
const tauriBody = transport.slice(transport.indexOf("export async function tauriFetch"), transport.indexOf("export async function tauriFetch") + 3000);
assert.ok(nativeBody.includes("serializeFetchBody(init.body)"), "nativeFetch 必须走共用序列化");
assert.ok(tauriBody.includes("serializeFetchBody(init.body)"), "tauriFetch 必须走共用序列化");
assert.ok(!/body_b64: null/.test(nativeBody), "nativeFetch 不得再把 body_b64 写死 null（文件上传会丢）");

/* ---------- [5] 提交失败提示不得把服务器错误页说成会话过期 ---------- */
const client = readFileSync(new URL("../packages/core/src/learn/client.ts", import.meta.url), "utf8");
const submit = client.slice(client.indexOf("async submitHomework"), client.indexOf("async getHomeworkDetail"));
assert.ok(client.includes("LEARN_LOGIN_PAGE_RE"), "必须有登录页特征判定");
// 只认行为、不认排版：dev3 把这条改成了花括号块（行为一致），行内正则别再卡格式
assert.ok(/if \(LEARN_LOGIN_PAGE_RE\.test\(res\)\)\s*(?:\{\s*)?throw new SessionExpiredError/.test(submit),
  "只有真登录页才抛会话失效");
assert.ok(submit.includes("服务器拒绝请求（HTTP"), "服务器错误页必须如实报 HTTP 状态");

console.log("learn-submit-body-test: 全部断言通过（multipart 真生成 + 文件字节不损 + 两包装共用 + 提示不误导）");

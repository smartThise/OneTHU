/**
 * 学习会话自证与重建的行为护栏（2026-09-23，#42）。
 *
 * 现场（issue #42）：网络学堂的详情 / 通知 / 作业一律回「会话已失效：会话已失效，
 * 需要重新登录（…）」，而其它数据还在出。这类入口的凭据检查落在 #withRelogin
 * 之外，会话一死它们连一次重建机会都没有——用户看到的第一个真相就是「已失效」。
 *
 * 本测试用假传输层直测行为（不是读源码断言）：
 *   [1] 会话活着：正常取到数据，不触发任何重建
 *   [2] 登录凭据只写在表单隐藏域（旧实现只认链接参数，会误判未登录）也要能取到
 *   [3] 会话死了：入口先自证 → 重建成功 → 本次调用照常返回数据（#42 的直接修复）
 *   [4] 重建也失败：抛「登录状态没有建立起来」，不谎报「已失效」
 *   [5] 并发多个入口一起撞上会话死：只重建一次（并发重链互相烧票据）
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/learn-session-recover-test.mjs
 */
import assert from "node:assert/strict";

const { LearnClient } = await import("../packages/core/src/learn/client.ts");

const LOGIN_SHELL =
  '<html><head><title>网络学堂</title></head><body><a href="/f/login">重新登录</a></body></html>';
const ALIVE_PAGE = '<html><body><form><input type="hidden" name="_csrf" value="TOK-FORM"></form></body></html>';
const LINK_PAGE = '<html><body><a href="/f/wlxt/index?x=1&_csrf=TOK-LINK">课程</a></body></html>';
const ATTACHMENT_PAGE =
  '<html><body><a class="ml-10" href="/b/wlxt/kcxx/xs/tzxx/xzfj?wjid=WJ123&amp;downloadUrl=%2Fb%2Ffile">附件一.pdf</a></body></html>';

/** 假传输层：alive=false 时课程页回登录壳（等价于「会话没建立起来」） */
function makeHttp(state, coursePage = ALIVE_PAGE) {
  const logs = [];
  return {
    logs,
    debug: (l) => logs.push(l),
    webVPNEncoder: undefined,
    lastFinalUrl: "https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/",
    text: async (url) => {
      logs.push(`GET ${url}`);
      if (/tzxx|xsxx|^.*detail/i.test(url) || /wjid|notice|tz/i.test(url)) {
        return state.alive ? ATTACHMENT_PAGE : LOGIN_SHELL;
      }
      return state.alive ? coursePage : LOGIN_SHELL;
    },
    json: async () => ({ result: "success" }),
  };
}

/* [1] 会话活着：正常取到数据，不触重建 */
{
  const state = { alive: true };
  const c = new LearnClient(makeHttp(state));
  let hooked = 0;
  c.reloginHook = async () => (hooked++, true);
  const d = await c.getNotificationPageDetail("course-1", "notice-1");
  assert.equal(d.attachment?.id, "WJ123", "[1] 会话活着应正常返回附件");
  assert.equal(hooked, 0, "[1] 会话活着不得触发重建");
}

/* [2] 登录凭据只写在表单隐藏域也要认（旧实现只认链接参数 _csrf=） */
{
  const state = { alive: true };
  const c = new LearnClient(makeHttp(state, ALIVE_PAGE));
  assert.equal(await c.resume(), true, "[2] 表单隐藏域里的凭据必须能取到（旧正则必漏）");
  const c2 = new LearnClient(makeHttp(state, LINK_PAGE));
  assert.equal(await c2.resume(), true, "[2] 链接参数形态也要能取到");
}

/* [3] 会话死了：入口先自证 → 重建成功 → 本次调用照常返回 */
{
  const state = { alive: false };
  const c = new LearnClient(makeHttp(state));
  let hooked = 0;
  c.reloginHook = async () => {
    hooked++;
    state.alive = true; // 重建成功
    return true;
  };
  const d = await c.getNotificationPageDetail("course-1", "notice-1");
  assert.equal(hooked, 1, "[3] 会话死了必须先尝试重建一次");
  assert.equal(d.attachment?.id, "WJ123", "[3] 重建成功则本次调用应正常返回，而不是报「会话已失效」");
}

/* [4] 重建也失败：抛「没有建立起来」，不谎报「已失效」 */
{
  const state = { alive: false };
  const c = new LearnClient(makeHttp(state));
  c.reloginHook = async () => false;
  await assert.rejects(
    () => c.getNotificationPageDetail("course-1", "notice-1"),
    (e) => {
      assert.match(e.message, /登录状态没有建立起来/, "[4] 文案必须是「没建立起来」");
      assert.doesNotMatch(e.message, /已失效/, "[4] 不得谎报「已失效」把用户赶去改密码");
      assert.doesNotMatch(e.message, /csrf|token|cookie/i, "[4] 文案不得出现实现术语");
      return true;
    },
  );
}

/* [5] 并发撞上会话死：只重建一次 */
{
  const state = { alive: false };
  const c = new LearnClient(makeHttp(state));
  let hooked = 0;
  c.reloginHook = async () => (hooked++, false);
  const rs = await Promise.allSettled([
    c.getNotificationPageDetail("course-1", "notice-1"),
    c.getNotificationPageDetail("course-1", "notice-2"),
    c.getAllHomework(["course-1"]),
  ]);
  assert.ok(rs.every((r) => r.status === "rejected"), "[5] 重建失败时各入口各自报错");
  assert.equal(hooked, 1, `[5] 并发只允许重建一次，实际 ${hooked} 次`);
}

console.log("learn-session-recover-test: 全部断言通过（自证 + 多形态凭据 + 重建成功/失败 + 并发去重）");

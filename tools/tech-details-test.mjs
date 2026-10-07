/**
 * 技术细节折叠护栏（§4.5 遗留）：正文说人话，状态码 / 原始报错 / 链接收进「详情」。
 *
 * 这里做三件事：
 *  ① 真跑一遍分类器——"HTTP 500 / TypeError / URL"要判成技术串，"网络不通""未读满 5 个"这些人话不能误判
 *     （把人话也藏进详情，等于把用户唯一能看懂的那行也拿走了）；
 *  ② 守实现：必须用原生 details（键盘可达、无脚本能开）、技术串要能选中复制；
 *  ③ 守覆盖面：错误态总闸 ErrorNote 走拆分渲染；页面里不许再把裸 HTTP 状态码直接抛给用户。
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const src = readFileSync("apps/desktop/src/components/Details.tsx", "utf8");
const layout = readFileSync("apps/desktop/src/components/Layout.tsx", "utf8");
const thubook = readFileSync("apps/desktop/src/pages/ThubookPage.tsx", "utf8");
const settings = readFileSync("apps/desktop/src/pages/Settings.tsx", "utf8");
const css = readFileSync("apps/desktop/src/styles/global.css", "utf8");

// ① 原生 details：键盘可达、无脚本能开、内容可选中
assert.ok(/<details className="tech-details">/.test(src) && /<summary>/.test(src), "折叠区要用原生 details/summary");
assert.ok(/\.tech-details > summary::before/.test(css), "折叠区要有可见的开合指示（::before 三角）");
assert.ok(/user-select: text/.test(css), "技术串要能选中复制，否则报错反馈不出去");

// ② 真跑分类器
const lit = src.match(/const TECH =\s*(\/[\s\S]*?\/i);/)?.[1];
assert.ok(lit, "没找到 TECH 正则，解析可能失效");
const TECH = eval(lit);
for (const s of ["HTTP 500", "手册页出错：HTTP 502", "TypeError: x is not a function", "https://cloud.tsinghua.edu.cn/api/v2.1", "fetch failed"]) {
  assert.ok(TECH.test(s), "该判成技术串却没有：" + s);
}
for (const s of ["网络不通，请稍后再试", "未读满 5 个", "密码不对，请重新输入", "已同步：云端共 2 个日程"]) {
  assert.ok(!TECH.test(s), "人话被误判成技术串：" + s);
}

// ③ 拆分规则：人话留在正文，尾巴进详情；不是技术串就整句照常显示
assert.ok(/const head = i > 0 \? text\.slice\(0, i\) : text;/.test(src), "要从冒号处拆开：前半句是人话");
assert.ok(/if \(tail !== "" && TECH\.test\(tail\)\)/.test(src), "只有尾巴真是技术串时才折叠");
assert.ok(/<Details label=\{label\}>\{tail\}<\/Details>/.test(src), "技术串要放进 Details 里");
assert.ok(/<span>\{text\}<\/span>/.test(src), "不是技术串时要整句照常显示（别把人话也藏了）");

// ④ 覆盖面
assert.ok(/<ErrorLine text=\{text\} \/>/.test(layout), "ErrorNote 必须走拆分渲染（所有页面的错误态都经过它）");
const humanHttp = [...thubook.matchAll(/暂时打不开，请稍后再试：HTTP/g)].length;
assert.equal(humanHttp, 2, "Thubook 两处 HTTP 报错都要写成「人话：HTTP <码>」，现在 " + humanHttp + " 处");
const httpMentions = [...thubook.matchAll(/HTTP/g)].length;
assert.equal(httpMentions, humanHttp, "Thubook 里还有裸 HTTP 状态码没包上人话（" + httpMentions + " 处 HTTP / " + humanHttp + " 处带人话）");
const settingsUses = [...settings.matchAll(/<ErrorLine /g)].length;
assert.ok(settingsUses >= 5, "设置页用拆分渲染的地方太少（" + settingsUses + " 处）");

console.log(
  "技术细节护栏：原生 details + 可复制 ✓ / 分类器 5 个技术串与 4 句人话分类正确 ✓ / " +
  "ErrorNote 总闸已接 ✓ / Thubook 2 处报错可拆分 ✓ / 设置页 " + settingsUses + " 处 ✓",
);

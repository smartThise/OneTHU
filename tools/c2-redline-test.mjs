/**
 * R20-C2 P3 护栏测试：学术红线（docs §32）可执行断言 + 关键前端纯函数单测。
 *
 * ⛔ 红线内容：
 *  1. 提交 API 不得进入插件宿主（LLM 工具循环 / onethu.call 门面）可达路径——
 *     apps/desktop/src/plugins/** 与插件清单文件不得出现 submitYkt / problem_apply 字样；
 *  2. 作答编辑器不得包含 AI 生成/补全类按钮文案（generate/续写/补全/一键完成）；
 *  3. 提交路径必须经过 confirmOk 用户确认对话框（代码结构断言）；
 *  4. core 的 submitYktProblemSubjective 仅由 state 层薄包装 + 编辑器面板引用，
 *     不得被 Rust 命令层 / 插件加载器 import。
 *  5. toSubmitHtml：公式 img.kfformula 序列化为官方形态（1px gif src + data-latex 保留）
 *     + custom_ueditor_cn_body 包裹；正文含 kfformula 时 buildYktProblemDoc 转 $…$。
 *
 * 纯 Node 零依赖（对齐 tools/ 既有测试风格），跑法：node tools/c2-redline-test.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ROOT = join(import.meta.dirname, "..");

/* ── 1. 插件宿主不可达提交 API ── */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|rs|json)$/.test(name)) out.push(p);
  }
  return out;
}
const pluginsDir = join(ROOT, "apps/desktop/src/plugins");
const pluginFiles = walk(pluginsDir);
const submitPat = /submitYkt|problem_apply|submitYktProblemSubjective/;
let leaked = pluginFiles.filter((f) => submitPat.test(readFileSync(f, "utf8")));
check("插件宿主（apps/desktop/src/plugins/**）不引用提交 API", leaked.length === 0, leaked.join(", "));
const rustPlugins = walk(join(ROOT, "apps/desktop/src-tauri/src")).filter((f) => submitPat.test(readFileSync(f, "utf8")));
check("Rust 层（src-tauri/src/**）不出现提交 API 字样", rustPlugins.length === 0, rustPlugins.join(", "));

/* ── 2. 编辑器无 AI 生成类入口（只查字符串字面量/JSX 文案，剥离注释避免「否定句」误报）── */
const editorPath = join(ROOT, "apps/desktop/src/components/exthw/YktSubjectiveEditor.tsx");
const editorRaw = readFileSync(editorPath, "utf8");
const editorSrc = editorRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const aiAfford = /一键完成|帮我做|生成答案|AI\s*作答|自动作答|续写|智能补全/;
check("作答编辑器无 AI 生成/补全类文案", !aiAfford.test(editorSrc));

/* ── 3. 提交路径必须经用户确认 ── */
const pagePath = join(ROOT, "apps/desktop/src/pages/learn/YktAssignmentDetailPage.tsx");
const pageSrc = readFileSync(pagePath, "utf8");
check("提交动作前有 confirmOk 用户确认对话框", /confirmOk\(/.test(pageSrc) && /确认提交第/.test(pageSrc));
check("提交成功后无乐观更新（走 setTick 重拉真实状态）", /onSubmitted=\{\(\) => setTick\(/.test(pageSrc));
// 唯一允许的 fetch：粘贴 data:URI 图片转 blob（本地内存操作）；任何网络 fetch 都是越线
check("编辑器无网络级 fetch（仅允许 data:URI 本地读取）", !/fetch\(\s*(?!src\b)/.test(editorSrc));
const statePath = join(ROOT, "apps/desktop/src/state/exthw.ts");
const stateSrc = readFileSync(statePath, "utf8");
check("state 层提交包装标注学术红线注释", stateSrc.includes("⛔ 学术红线（docs §32）"));

/* ── 4. toSubmitHtml 序列化（DOM 需要环境——Node 22+ 无 DOM，做静态结构断言）── */
check("toSubmitHtml 换官方 1px gif src", editorSrc.includes("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"));
check("toSubmitHtml 保留 data-latex", editorSrc.includes("data-latex"));
check("toSubmitHtml 包裹 custom_ueditor_cn_body", editorSrc.includes("custom_ueditor_cn_body"));
const bodyPath = join(ROOT, "apps/desktop/src/lib/yktBody.ts");
const bodySrc = readFileSync(bodyPath, "utf8");
check("buildYktProblemDoc 在 sanitize 前转换 kfformula → TeX", /convertKfformulaToTex\((opts\.html|.*html)/.test(bodySrc) && bodySrc.indexOf("convertKfformulaToTex") < bodySrc.indexOf("sanitizeForInlineDoc(body)"));

/* ── 5. 拍照上传（docs §32.1 需求）在编辑器在场 ── */
check("编辑器提供拍照上传（capture=environment）", editorSrc.includes('capture="environment"'));
check("编辑器图片走正文内联通道（uploadYktInlineImage）", editorSrc.includes("uploadYktInlineImage"));
check("编辑器不含附件通道 filelist 提交", !/attachments\s*:/.test(editorSrc));

/* ── 6. 真机 bug 回归护栏（2026-09-21 霖实测两条）──
 * BUG1 插入图片显示破损：CDN（阿里云 OSS）Referer 白名单放行空 Referer，
 *   而 WebView 来源 tauri.localhost 被 403（curl 实测：无 Referer 200 /
 *   tauri.localhost 403 / pro.yuketang.cn 200）→ 编辑器与提交态都必须补
 *   referrerpolicy="no-referrer"。
 * BUG2 点击高亮范围只有一行：Quill .ql-editor 是 height:100%，在只有 min-height
 *   的父级上不成立 → min-height 必须落在 .ql-editor 自身（.rich-editor 同款口径）。 */
check("BUG1：编辑器图片统一补 no-referrer（hardenImgs 钩子）", /hardenImgs/.test(editorSrc) && /referrerpolicy/.test(editorSrc));
check("BUG1：复用 yktBody.hardenYktImgs 同口径（不另造轮子）", editorSrc.includes("hardenYktImgs"));
check("BUG1：插入后立即补 referrerpolicy（不只靠 text-change）", /insertEmbed\(idx, "image"[\s\S]{0,400}referrerpolicy/.test(editorSrc));
check("BUG1：提交态也带 no-referrer（hardenYktImgs 作用于 toSubmitHtml）", /toSubmitHtml[\s\S]{0,900}hardenYktImgs\(/.test(editorSrc));
const cssSrc = readFileSync(join(ROOT, "apps/desktop/src/styles/global.css"), "utf8");
const yktEditorCss = cssSrc.slice(cssSrc.indexOf("/* ── R20-C2 P3：雨课堂主观题原生作答编辑器"));
check("BUG2：.ql-editor 自身有 min-height（可编辑区撑满视觉框）", /\.ykt-editor \.ql-editor \{[^}]*min-height/.test(yktEditorCss));
check("BUG2：容器不再单独承担 min-height（避免死区）", !/\.ykt-editor \.ql-container\.ql-snow \{[^}]*min-height/.test(yktEditorCss));

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

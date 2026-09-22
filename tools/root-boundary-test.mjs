/**
 * 根级渲染错误边界护栏（R24）。
 *
 * 教训：预览 Hook 顺序违规让**整棵应用树卸载** → 用户看到纯白窗口；`main.tsx` 当时只有
 * window.error/unhandledrejection 日志钩子（能记录、不能恢复），界面上没有任何提示。
 * 现在根级必须有边界：任何渲染期崩溃都变成可读卡片 + 重试/重新加载，而不是白屏。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/* [1] 根级边界存在且被真正挂在应用根上 */
const boundary = read("apps/desktop/src/components/RootErrorBoundary.tsx");
assert.ok(/export class RootErrorBoundary/.test(boundary), "必须有根级错误边界组件");
assert.ok(/static getDerivedStateFromError/.test(boundary), "根级边界要真的接管渲染错误");
assert.ok(/ROOT-BOUNDARY/.test(boundary), "根级崩溃要落日志（客户端排查用）");
assert.ok(boundary.includes("重新加载") && boundary.includes("重试"),
  "根级边界要给「重试」与「重新加载」两条恢复路径");
assert.ok(!/\/home\/lin|C:\\\\Users/.test(boundary), "不得写入本机路径");

const main = read("apps/desktop/src/main.tsx");
assert.ok(/<RootErrorBoundary>/.test(main) && /<\/RootErrorBoundary>/.test(main),
  "main.tsx 必须用根级边界包住应用");
assert.ok(/<RootErrorBoundary>[\s\S]*<App \/>[\s\S]*<\/RootErrorBoundary>/.test(main),
  "App 必须在根级边界内部（否则白屏兜不住）");

/* [2] 预览内容仍在自己的边界内，且 Windows 不再默认拒绝渲染 */
const fp = read("apps/desktop/src/components/FilePreview.tsx");
assert.ok(/class PreviewErrorBoundary/.test(fp), "预览内容必须有局部错误边界");
assert.ok(/<PreviewErrorBoundary onRetry=\{retry\}/.test(fp), "预览分支必须被局部边界包住");
assert.ok(!/winTryPreview/.test(fp), "Windows「暂不可用」门闸必须已移除（默认尝试渲染）");
assert.ok(/note=\{IS_WINDOWS_HOST \? WIN_PREVIEW_NOTE : undefined\}/.test(fp),
  "Windows 预览失败时要提示改用下载");

console.log("根级错误边界护栏：全部断言通过（根边界挂在 App 上 + 预览局部边界 + Windows 默认尝试渲染）");

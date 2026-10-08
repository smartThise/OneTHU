#!/usr/bin/env node
/**
 * 弹层卸载护栏（F1，霖 2026-10-02）。
 *
 * 现场 bug：选课页连开两个「课程评价」弹层并关闭后，除 OH 外整屏点不动。
 * 真机（DEV b12，<设备>）复现到的残留节点是一块**看不见的全屏拦截层**：
 *   `<div class="xk-mask">` 内联 `animation: m-fade-out … both`、计算 `opacity: 0`、
 *   但仍 `position: fixed; inset: 0; z-index: 1000; pointer-events: auto`。
 * 根因：`ReviewsModal` 是**受控弹层**（常驻挂载、关闭只把 `code` 置 null），
 *   却调用 `useExitPhase(onClose)` 没传第二个 `open` 参数——第一次关闭后 `closingRef` 永久为 true，
 *   第二次打开即以退场态渲染、✕ 被 `if (closingRef.current) return` 吃掉，于是谁也关不掉。
 *
 * 护栏钉住三件事（真机 elementFromPoint 由 DoD 的探针给）：
 *   ① 受控弹层必须把 `open` 传进 `useExitPhase`（点名 zhjwxk 的两处）；
 *   ② 退场中的遮罩不许吃点击（`maskOut` 必须含 `pointerEvents: "none"`）——
 *      万一没被卸载，也不至于把整屏堵死；
 *   ③ hook 自己要有逃生通道：`closing` 期间再点一次必须能立刻关（不许早退成死角）；
 *   ④ 反例：不许用「关闭时强制 reload」这类粗暴兜底。
 */
import { readFileSync, readdirSync } from "node:fs";

const HOOK = readFileSync("apps/desktop/src/lib/useExitPhase.ts", "utf8");
const COURSES = readFileSync("apps/desktop/src/pages/zhjwxk/Courses.tsx", "utf8");
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

/* ① 受控弹层传 open */
const tupleCalls = [...COURSES.matchAll(/const \[closing, requestClose\] = useExitPhase\(([^)]*)\)/g)].map((m) => m[1]);
ok(tupleCalls.length === 2, `选课页应有 2 处 useExitPhase 元组调用，实际 ${tupleCalls.length}`);
for (const args of tupleCalls) {
  ok(args.includes(","), `受控弹层漏传 open（只写了 ${args.trim()}）——关闭一次后关不掉、遮罩留屏`);
  ok(/code !== null/.test(args), `open 必须是「本弹层是否打开」的信号，当前是：${args.trim()}`);
}

/* ② 退场遮罩不吃点击（全仓同族 maskOut 一起查） */
const files = [];
for (const dir of ["apps/desktop/src/components", "apps/desktop/src/pages", "apps/desktop/src/pages/zhjwxk", "apps/desktop/src/pages/learn", "apps/desktop/src/pages/info"]) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && /\.tsx$/.test(e.name)) files.push(`${dir}/${e.name}`);
  }
}
let maskOutCount = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/const maskOut:\s*React\.CSSProperties\s*=\s*\{([\s\S]*?)\n\};/g)) {
    maskOutCount++;
    ok(/pointerEvents:\s*"none"/.test(m[1]), `${f.split("/").pop()} 的 maskOut 没有 pointerEvents: "none"（退场遮罩还在吃点击）`);
  }
}
ok(maskOutCount >= 4, `只找到 ${maskOutCount} 处 maskOut（预期 ≥4：公告/主题/页签/选课）`);

/* ③ hook 的逃生通道 */
ok(/if \(closingRef\.current\) \{[\s\S]{0,200}onCloseRef\.current\(\)/.test(HOOK),
  "useExitPhase 在 closing 期间仍然早退（会造成「关不掉的死角」）");
ok(/closingRef\.current = false/.test(HOOK) && /\[open\]/.test(HOOK),
  "useExitPhase 没有「重新打开时复位 closing」的分支（受控弹层第二次打开会以退场态渲染）");
ok(/window\.setTimeout\(\(\) => onCloseRef\.current\(\), EXIT_MS\)/.test(HOOK), "退场计时器没接到 EXIT_MS");
ok(/window\.clearTimeout\(timer\.current\)/.test(HOOK), "卸载时没有清退场计时器");

/* ④ 反例：粗暴兜底（只查本次修的那两个文件——别处（错误边界/设置页）的 reload 是有意为之） */
for (const f of ["apps/desktop/src/lib/useExitPhase.ts", "apps/desktop/src/pages/zhjwxk/Courses.tsx"]) {
  const src = readFileSync(f, "utf8");
  ok(!/location\.reload\(\)/.test(src), `${f.split("/").pop()} 里出现 location.reload() 粗暴兜底（F1 反例）`);
}

console.log(
  fails.length
    ? "弹层卸载护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : `弹层卸载护栏：受控弹层传 open（${tupleCalls.length} 处）+ 退场遮罩不吃点击（${maskOutCount} 处）+ hook 有逃生通道 ✓ 无强制 reload ✓`,
);
process.exit(fails.length ? 1 : 0);

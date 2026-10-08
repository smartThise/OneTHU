#!/usr/bin/env node
/**
 * G5 护栏：云盘配额（「我的」页服务列表里的「已用 / 总量」）。
 *
 * 由来（docs/ui-ux-polish-detailed.md §12 G5）：设计稿要写「已用 12GB / 100GB」，
 * 但 `SeafileRepo` 只有 id/name/mtime/size，没配额。Rust 侧其实已有 `seafile_account`
 * （/api2/account/info/ 的 usage/total），本护栏钉死「真数上屏 + 未绑定回落」：
 *   ① Rust 命令确实返回 usage/total，且仍在 invoke_handler 里注册（删了就静默变成 0）；
 *   ② 状态层加载有缓存、失败静默（不许把异常抛给页面，也不许重复请求）；
 *   ③ 前端只用共用字节格式化（lib/size.ts），云盘页与「我的」页不许各写一套；
 *   ④ 「我的」页有未绑定分支，且**不许写死任何配额数字**。
 *
 * 跑法：node tools/cloud-quota-test.mjs ｜ 退出码 0（通过）/ 1（违规）
 */
import { readFileSync } from "node:fs";

const RS = "apps/desktop/src-tauri/src/seafile.rs";
const LIB = "apps/desktop/src-tauri/src/lib.rs";
const STATE = "apps/desktop/src/state/seafile.ts";
const MINE = "apps/desktop/src/pages/Mine.tsx";
const CLOUD = "apps/desktop/src/pages/CloudPage.tsx";
const SIZE = "apps/desktop/src/lib/size.ts";

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};
const read = (p) => readFileSync(p, "utf8");

/* ① Rust：命令存在、字段在、仍注册 ---------------------------------------- */
const rs = read(RS);
ok(/pub struct SeafileAccount \{[\s\S]*?pub usage: i64,[\s\S]*?pub total: i64,/.test(rs), "SeafileAccount 没有 usage/total 字段");
ok(/pub async fn seafile_account\(token: String\)/.test(rs), "seafile.rs 里的 seafile_account 命令没了");
ok(
  /api2\/account\/info\//.test(rs) &&
    /v\.get\("usage"\)[\s\S]*?v\.get\("total"\)/.test(rs),
  "seafile_account 没有从 /api2/account/info/ 取 usage/total",
);
const lib = read(LIB);
ok(/seafile::seafile_account/.test(lib), "seafile_account 没有注册进 invoke_handler（前端调用会直接失败）");

/* ② 状态层：有缓存、失败静默 --------------------------------------------- */
const state = read(STATE);
ok(/export async function ensureSeafileAccount\(\): Promise<void>/.test(state), "状态层没有 ensureSeafileAccount（页面会自己发请求）");
ok(
  /if \(!cfg\?\.token \|\| account\) return;/.test(state),
  "ensureSeafileAccount 没有缓存短路（每次进「我的」都会再打一次账号接口）",
);
ok(
  /ensureSeafileAccount[\s\S]*?try \{[\s\S]*?refreshSeafileAccount\(\)[\s\S]*?\} catch \{/.test(state),
  "ensureSeafileAccount 没有吞掉失败（离线时「我的」页会报错）",
);

/* ③ 共用字节格式化 -------------------------------------------------------- */
const size = read(SIZE);
ok(/export function fmtSize\(/.test(size), "lib/size.ts 没有 fmtSize（共用格式化没了）");
ok(/from "\.\.\/lib\/size\.js"/.test(read(CLOUD)), "云盘页没有用共用 fmtSize");
ok(/from "\.\.\/lib\/size\.js"/.test(read(MINE)), "「我的」页没有用共用 fmtSize");
ok(!/function fmtSize/.test(read(CLOUD)) && !/function fmtSize/.test(read(MINE)), "页面里又自己写了一份 fmtSize（两处小数位会漂）");

/* ④ 页面：真数上屏 + 未绑定回落 + 不许写死数字 ---------------------------- */
const mine = read(MINE).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
ok(/useSeafile\(\)/.test(mine), "「我的」页没有读 state 层的云盘账号");
ok(/ensureSeafileAccount\(\)/.test(mine), "「我的」页没有触发云盘用量加载");
ok(
  /fmtSize\(seafile\.account\.usage\)[\s\S]{0,40}fmtSize\(seafile\.account\.total\)/.test(mine),
  "云盘副标题没有把 usage/total 真数上屏",
);
ok(/configured[\s\S]{0,240}未绑定/.test(mine), "云盘副标题没有「未绑定」回落分支");
ok(
  !/(已用|总量)\s*\d+(\.\d+)?\s*(B|KB|MB|GB|TB)/.test(mine) && !/\b\d+(\.\d+)?\s*GB\b/.test(mine),
  "「我的」页写死了配额数字（要显示真实值）",
);

if (fails.length) {
  console.error("云盘配额护栏 ✗");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("云盘配额护栏：Rust 命令与注册 + 状态层缓存/静默 + 共用 fmtSize + 真数上屏与未绑定回落 ✓");

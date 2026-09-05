/**
 * 一级课表页签检索兜底（NextTHUxk 2.0 回移）——parseXkTabGrid 结构金标准。
 * 行结构取自存档 限选_files/xkBks(1).vxkBksXkbBs.html gridData 14 列。
 * 运行：node --experimental-strip-types test/xktab.smoke.mjs
 */
import { parseXkTabGrid } from "../src/zhjwxk/xk-tab.ts";

const H = `<html><script>var gridData1 = [
 [ "<input type='radio' name='p_rx_id' value='2026-2027-1;BW3w0008;1;'>" ,"任选" ,"" ,"科摩罗语与科摩罗社会文化（1）" ,"BW3w0008" ,"1" ,"星期二19:30-21:05(1-16周)" ,"北外教师" ,"1" ,"<div title=''></div>" ,"" ,"否" ,"" ,"" ]
 ,["<input type='radio' name='p_rx_id' value='2026-2027-1;GPK12700951;0;'>" ,"任选" ,"" ,"环境流行病学" ,"GPK12700951" ,"" ,"星期三18:30-20:05(1-16周)" ,"北大教师" ,"2" ,"<div title=''></div>" ,"" ,"否" ,"" ,"" ]
 ];</script></html>`;

let n = 0, ok = 0;
const t = (name, cond) => { n++; if (cond) { ok++; console.log(`ok ${name}`); } else console.log(`FAIL ${name}`); };

const rows = parseXkTabGrid(H, "任选");
t("两行外校课全解析", rows.length === 2);
t("BW3w0008 radio 权威课序", rows[0]?.code === "BW3w0008" && rows[0]?.seq === "1");
t("空课序归 0 + partial", rows[1]?.code === "GPK12700951" && rows[1]?.seq === "0" && rows[1]?.partial === true);
t("attr/time/teacher/credits", rows[0]?.attr === "任选" && rows[0]?.time.includes("星期二") && rows[0]?.teacher === "北外教师" && rows[0]?.credits === 1);
t("本校行不误收（纯表头/无课号行被滤）", parseXkTabGrid("<script>var gridData=[\"表头\",\"行\"];</script>", "任选").length === 0);

console.log(`${n} 项: ${ok} 通过`);
if (ok !== n) process.exit(1);

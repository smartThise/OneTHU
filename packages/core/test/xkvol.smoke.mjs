/**
 * 志愿统计（NextTHUxk 2.0 院系定向回移）——解析与三段匹配金标准。
 * 行结构取自存档 志愿查询_files/xkBks.xkBksZytjb.html（BR 9 列 / Ty 6 列）。
 * 运行：node --experimental-strip-types test/xkvol.smoke.mjs
 */
import { parseVolRows, parseVolSportsRows, parsePagerInfo, deptCodeOf, normSeq, matchVolRow, buildVolIndex, matchVolIndexed, XK_DEPT_CODES } from "../src/zhjwxk/xk-vol.ts";

let n = 0, ok = 0;
const t = (name, cond) => { n++; if (cond) { ok++; console.log(`ok ${name}`); } else console.log(`FAIL ${name}`); };

const BR = `<script>var gridData1=[
 ["10720011","1","中国特色社会主义理论实践","070","100","83","(2)12,8,0","(2)5,3,2","(1)2,1,0"]
 ,["10780102","0","已满墓碑课","012","0","0","0","0","0"]
 ,["10780103","01","超载真信号","012","0","5","0","0","0"]
 ,["BW3w0008","1","科摩罗语","外校","30","10","0","0","0"]
];</script>`;
const rows = parseVolRows(BR);
t("正常行解析+归一键", !!rows["10720011_1"] && rows["10720011_1"].applied === 83);
t("墓碑行过滤（全零）", !rows["10780102_0"]);
t("超载行保留（0容量5报名）", !!rows["10780103_1"] && rows["10780103_1"].capacity === 0 && rows["10780103_1"].applied === 5);
t("前导零键归一（01→1）", !!rows["10780103_1"]);
t("开课系捕获（错页校验用）", rows["10720011_1"].department === "070");

const TY = `["10720001","01","体育足球","30","22","(3)10,8,4"]`;
const ty = parseVolSportsRows(TY);
t("Ty 6 列解析", !!ty["10720001_1"] && ty["10720001_1"].volSports === "(3)10,8,4");
t("Ty 墓碑同滤", parseVolSportsRows('["1","0","x","0","0","0"]').length === 0? false : parseVolSportsRows('["1","0","x","0","0","0"]')["1_0"] === undefined);

const PG = `<div>共 12 页，共 1,234 条</div>`;
t("分页信息", parsePagerInfo(PG).pages === 12 && parsePagerInfo(PG).total === 1234);

t("院系码精确", deptCodeOf("社科学院") === "070");
t("院系码双向 includes", deptCodeOf("清华大学社科学院") === "070" && deptCodeOf("计算机") === "024");
t("外校课自然 miss", deptCodeOf("北京外国语大学") === "");
t("normSeq 前导零", normSeq("01") === "1" && normSeq("") === "0");

// 三段匹配：原始键 → 归一键 → 逐行归一 → 单段回退；多段不盲配
const vm = { "10720011_1": { code: "10720011", seq: "1", capacity: 100, applied: 83 } };
t("①原始键", matchVolRow(vm, "10720011", "1").applied === 83);
t("②归一键（选课页 01 vs 志愿页 1）", matchVolRow(vm, "10720011", "01").applied === 83);
const multi = {
  "10720011_1": { code: "10720011", seq: "1", capacity: 100, applied: 83 },
  "10720011_2": { code: "10720011", seq: "2", capacity: 50, applied: 10 },
};
t("③多段对不上宁缺毋滥", matchVolRow(multi, "10720011", "3") === undefined);
t("③多段归一命中", matchVolRow(multi, "10720011", "02").applied === 10);
const single = { "A_5": { code: "A", seq: "5", capacity: 1, applied: 0 } };
t("③单段回退", matchVolRow(single, "A", "9") !== undefined);
const idx = buildVolIndex(multi);
t("索引版同语义", matchVolIndexed(idx, multi, "10720011", "02").applied === 10 && matchVolIndexed(idx, multi, "10720011", "3") === undefined);
t("院系码全量 85 项（存档下拉逐条对照）", Object.keys(XK_DEPT_CODES).length === 85);

console.log(`${n} 项: ${ok} 通过`);
if (ok !== n) process.exit(1);

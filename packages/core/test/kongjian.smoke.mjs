let passed = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log(`ok ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`not ok ${name}`, err?.message ?? err);
    process.exitCode = 1;
  }
}


import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseKongjianSpaces,
  parseKongjianPage,
  parseKongjianMy,
  buildPostBack,
  parseDatePostBackTarget,
} from "../src/info/kongjian.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
// GBK 示例已由 python 预转为 UTF-8 夹具（Node Buffer 不支持 gbk 解码）
const fix = (p) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), "utf8");

await t("公共空间：空间列表解析（54 项 + 中文）", async () => {
  const page = fix("kj_yuyue.html");
  const spaces = parseKongjianSpaces(page);
  assert.equal(spaces.length, 54);
  assert.ok(spaces.some((x) => x.name.includes("31号楼社区活动中心")));
  assert.ok(spaces.some((x) => x.name.includes("紫荆")));
});

await t("公共空间：整页解析（房间/日期/场次/回传域）", async () => {
  const page = fix("kj_yuyue.html");
  const p = parseKongjianPage(page);
  assert.ok(p.rooms.length > 3);
  assert.ok(p.rooms.some((x) => x.name === "B1钢琴房"));
  assert.equal(p.dates.length, 7);
  assert.ok(p.slots.length > 5);
  assert.ok(p.slots.every((x) => x.date && x.time && x.state));
  assert.ok(p.fields.__VIEWSTATE && p.fields.__VIEWSTATE.length > 50);
  assert.ok(p.info?.includes("B1钢琴房"));
});

await t("公共空间：回传体（EVENTTARGET + VIEWSTATE + 选中值）", async () => {
  const p = parseKongjianPage(fix("kj_yuyue.html"));
  const body = buildPostBack(p, "kj_yuyueCtrl1$RadioButtonList1", { "kj_yuyueCtrl1$RadioButtonList1": "3" });
  const params = new URLSearchParams(body);
  assert.equal(params.get("__EVENTTARGET"), "kj_yuyueCtrl1$RadioButtonList1");
  assert.ok((params.get("__VIEWSTATE") ?? "").length > 50);
  assert.equal(params.get("kj_yuyueCtrl1$RadioButtonList1"), "3");
  assert.ok(params.get("kj_yuyueCtrl1$RadioButtonList3"), "日期选中值缺失");
});

await t("公共空间：日期回传目标定位", async () => {
  const p = fix("kj_yuyue.html");
  const t2 = parseDatePostBackTarget(p, "2026-09-02");
  assert.equal(t2, "kj_yuyueCtrl1$RadioButtonList3$1");
});

await t("公共空间：我的预约解析（空列表/须知行过滤）", async () => {
  const p = parseKongjianMy(fix("kj_my.html"));
  assert.deepEqual(p, []);
});

await t("公共空间：可约行（未预约）构造确认页链接（%uXXXX）", async () => {
  const raw = fix("kj_yuyue.html").replace("已被预约", "未预约");
  const p = parseKongjianPage(raw);
  const free = p.slots.find((x) => x.state === "未预约" && x.bookUrl);
  assert.ok(free, "可约行应带 bookUrl");
  const url = free.bookUrl;
  assert.ok(url.includes("louhao_id=4"), "louhao_id");
  assert.ok(url.includes("id2=25"), "房间 id");
  assert.ok(url.includes("name1=31%u53f7"), "空间名转义");
  assert.ok(url.includes("d_time=") && url.includes("d_time1="), "起止时间");
  // 9:00 → 9:30
  assert.ok(/d_time=9%3A00&d_time1=9%3A30/.test(url), url);
});

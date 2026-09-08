/**
 * caldav 冒烟：① 离线单测（ICS 编解码/RRULE 展开/转义折行）② 联网实测
 * （CALUSER/CALPASS 环境变量存在时：发现→列日历→PUT→读回→解析→删除→复查）。
 * 运行：node --experimental-strip-types test/caldav.smoke.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* 与 venue.smoke 同轨：".js" 相对导入就地拷贝改写为 .ts（递归闭包）。 */
function stripTsModule(srcRel, outDir, done) {
  const srcUrl = new URL(srcRel, import.meta.url);
  const outRel = srcRel.slice("../src/".length);
  const outUrl = new URL(outDir + outRel, import.meta.url);
  if (done.has(outUrl.href)) return outUrl.href;
  done.add(outUrl.href);
  let text = readFileSync(srcUrl, "utf8");
  text = text.replace(/(from\s*["'])(\.[^"']*?)\.js(["'])/g, (_m, a, p, b) => {
    const depAbs = new URL(p + ".ts", srcUrl);
    const depRel = "../src/" + depAbs.pathname.split("/src/")[1];
    const depth = outRel.split("/").length - 1;
    const outDepRel = ("../".repeat(depth) || "./") + depRel.slice("../src/".length);
    stripTsModule(depRel, outDir, done);
    return a + outDepRel + b;
  });
  const outFile = fileURLToPath(outUrl);
  mkdirSync(outFile.slice(0, outFile.lastIndexOf("/")), { recursive: true });
  writeFileSync(outUrl, text);
  return outUrl.href;
}
mkdirSync(new URL("./.caldav-build/", import.meta.url), { recursive: true });
const doneSet = new Set();
stripTsModule("../src/caldav/client.ts", "./.caldav-build/", doneSet);
stripTsModule("../src/caldav/ics.ts", "./.caldav-build/", doneSet);
const caldav = await import(new URL("./.caldav-build/caldav/client.ts", import.meta.url).href);
const caldavIcs = await import(new URL("./.caldav-build/caldav/ics.ts", import.meta.url).href);

const { CalDavClient } = caldav;
const { parseIcs, serializeCalendar, expandEventSet, wallToEpoch, epochToWall, foldLine, escapeText, unescapeText, CAMPUS_TZ } = caldavIcs;
let failed = 0;
const ok = (cond, name) => { console.log(`${cond ? "✅" : "❌"} ${name}`); if (!cond) failed++; };

/* ---------- 1. 解析 Coremail 风格回读（含 VTIMEZONE/折行/TZID） ---------- */
const sample = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Mailtech Inc//Coremail Calendar V1//EN",
  "METHOD:PUBLISH",
  "BEGIN:VTIMEZONE",
  "TZID:Asia/Shanghai",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0800",
  "TZOFFSETTO:+0800",
  "DTSTART:19700101T000000",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Asia/Shanghai:20260914T083000",
  "DTEND;TZID=Asia/Shanghai:20260914T100000",
  "DTSTAMP:20260908T072949Z",
  "UID:onethu-test-1@onethu",
  `SUMMARY:${escapeText("数据结构;答疑,补课")}`,
  "LOCATION:六教6A101",
  "DESCRIPTION:很长".repeat(30),
  "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20261228T000000Z",
  "CATEGORIES:ONETHU-COURSE",
  "X-ONETHU-SRC:course",
  "BEGIN:VALARM",
  "TRIGGER:-PT15M",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");
const evs = parseIcs(sample);
ok(evs.length === 1, "解析出 1 个事件");
const ev = evs[0];
const startWall = epochToWall(CAMPUS_TZ, ev.start);
ok(startWall.y === 2026 && startWall.mo === 9 && startWall.d === 14 && startWall.h === 8, `DTSTART TZID 换算正确（得到 ${startWall.y}-${startWall.mo}-${startWall.d} ${startWall.h}:${startWall.mi}）`);
ok(ev.summary === "数据结构;答疑,补课", "转义往返无损");
ok(ev.rrule?.freq === "WEEKLY" && ev.rrule.byDay?.[0] === "MO" && ev.rrule.until !== undefined, "RRULE 解析");
ok(ev.categories?.[0] === "ONETHU-COURSE" && ev.onethuSource === "course", "CATEGORIES 与 X-ONETHU-SRC");

/* ---------- 2. 序列化 → 回读往返 ---------- */
const now = Date.UTC(2026, 8, 8, 8, 0, 0);
const ics = serializeCalendar([{ uid: "rt-1@onethu", summary: "往返;测试,事件", location: "四教", start: wallToEpoch(CAMPUS_TZ, { y: 2026, mo: 9, d: 15, h: 14, mi: 0, s: 0 }), end: wallToEpoch(CAMPUS_TZ, { y: 2026, mo: 9, d: 15, h: 15, mi: 40, s: 0 }), rrule: { freq: "WEEKLY", interval: 2, byDay: ["TU"] } }], now);
ok(ics.includes("\r\n") && !/(?<!\r)\n/.test(ics), "CRLF 行尾");
const rt = parseIcs(ics);
ok(rt.length === 1 && rt[0].summary === "往返;测试,事件" && rt[0].rrule?.interval === 2, "序列化→解析往返字段无损");
const rtWall = epochToWall(CAMPUS_TZ, rt[0].start);
ok(rtWall.h === 14 && rtWall.d === 15, "往返时间无损");

/* ---------- 3. 折行：75 字节边界、多字节不切断 ---------- */
const longLine = "SUMMARY:" + "你好世界".repeat(60);
const folded = foldLine(longLine);
ok(folded.length > 1, "长行被折行");
ok(folded.every((l) => new TextEncoder().encode(l).length <= 75), "每段 ≤75 字节");
ok(folded.join("") === longLine, "折行拼接无损");

/* ---------- 4. RRULE 展开：每周一次/双周/EXDATE/覆盖实例 ---------- */
const weekly = { uid: "w@o", summary: "每周", start: wallToEpoch(CAMPUS_TZ, { y: 2026, mo: 9, d: 14, h: 10, mi: 0, s: 0 }), end: wallToEpoch(CAMPUS_TZ, { y: 2026, mo: 9, d: 14, h: 11, mi: 30, s: 0 }), rrule: { freq: "WEEKLY", byDay: ["MO"] } };
const from = wallToEpoch(CAMPUS_TZ, { y: 2026, mo: 9, d: 1, h: 0, mi: 0, s: 0 });
const to = wallToEpoch(CAMPUS_TZ, { y: 2026, mo: 9, d: 30, h: 23, mi: 59, s: 59 });
ok(expandEventSet([weekly], from, to).length === 3, "9月周一（14/21/28）共 3 场");
const biweekly = { ...weekly, uid: "b@o", summary: "双周", rrule: { freq: "WEEKLY", interval: 2, byDay: ["MO"] } };
ok(expandEventSet([biweekly], from, to).length === 2, "双周周一 9月 2 场");
const skipped = { ...weekly, uid: "s@o", exdates: [wallToEpoch(CAMPUS_TZ, { y: 2026, mo: 9, d: 21, h: 10, mi: 0, s: 0 })] };
ok(expandEventSet([skipped], from, to).length === 2, "EXDATE 跳过后剩 2 场");
const override = { ...weekly, uid: "w@o", summary: "改期的单场", recurrenceId: wallToEpoch(CAMPUS_TZ, { y: 2026, mo: 9, d: 21, h: 10, mi: 0, s: 0 }), start: wallToEpoch(CAMPUS_TZ, { y: 2026, mo: 9, d: 22, h: 10, mi: 0, s: 0 }), end: wallToEpoch(CAMPUS_TZ, { y: 2026, mo: 9, d: 22, h: 11, mi: 30, s: 0 }) };
const mixed = expandEventSet([weekly, override], from, to);
ok(mixed.length === 3 && mixed.filter((o) => o.override).length === 1 && !mixed.some((o) => !o.override && epochToWall(CAMPUS_TZ, o.start).d === 21), "覆盖实例接管原场次（9/21 不重复）");

/* ---------- 5. 联网实测（可选） ---------- */
if (process.env.CALUSER && process.env.CALPASS) {
  console.log("\n—— 联网实测 ——");
  const client = new CalDavClient((url, init) => fetch(url, init), { email: process.env.CALUSER, authCode: process.env.CALPASS });
  const cal = await client.mainCalendar();
  ok(!!cal.url && /\/default\/?$/.test(cal.url), `主日历: ${cal.displayName} ${cal.url}`);
  const uid = `onethu-smoke-${Date.now()}@onethu`;
  const put = serializeCalendar([{ uid, summary: "冒烟测试事件（自动清理）", start: wallToEpoch(CAMPUS_TZ, { y: 2026, mo: 9, d: 20, h: 9, mi: 0, s: 0 }), end: wallToEpoch(CAMPUS_TZ, { y: 2026, mo: 9, d: 20, h: 10, mi: 0, s: 0 }) }]);
  await client.putIcs(uid, put);
  const metas = await client.listEvents();
  const mine = metas.find((m) => m.uid === uid);
  ok(!!mine, `PUT 后清单可见（资源=${mine?.href.split("/").pop()}）`);
  const icsBack = await client.getIcs(mine.href);
  const parsedBack = parseIcs(icsBack);
  ok(parsedBack.length === 1 && parsedBack[0].uid === uid, "服务器回读可解析");
  const bw = epochToWall(CAMPUS_TZ, parsedBack[0].start);
  ok(bw.d === 20 && bw.h === 9, `服务器往返时间正确（${bw.y}-${bw.mo}-${bw.d} ${bw.h}:${bw.mi}）`);
  await client.deleteEvent(mine.href);
  const after = await client.listEvents();
  ok(!after.some((m) => m.uid === uid), "DELETE 后清单已清");
} else {
  console.log("（跳过联网实测：未设置 CALUSER/CALPASS）");
}

console.log(failed === 0 ? "\n全部通过 ✅" : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);

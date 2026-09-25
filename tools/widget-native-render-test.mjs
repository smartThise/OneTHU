/**
 * R21 小组件新鲜度护栏（2026-09-21「上课了还显示还有 9 小时」）。
 *
 * 语义锚 = apps/desktop/src/state/widgetNativeRender.ts（Kotlin OnethuWidget.kt 按它实现）：
 * 快照带机器时间字段（at/until/rel/loc + counts/titleAt），原生重画时按当前时钟重算
 * 倒计时 / 正在上课 / 过期剔除 / 脚注计数 / 标题日期；30 分钟兜底自续 tick +
 * 翻转点精准闹钟保证重画发生。
 *
 * [1] nativeRow 逐条语义（未开始 / 正在上课 / 已下课 / 隔天残留 / DDL 过点）
 * [2] nativeRender 脚注与标题
 * [3] 快照构建侧真的写入了机器字段（契约两端同步）
 * [4] 源码守卫：Kotlin 侧关键实现与闹钟链在位（防两端漂移）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { nativeRow, nativeRender, leftText } = await import("../apps/desktop/src/state/widgetNativeRender.ts");
const { buildWidgetSnapshot } = await import("../apps/desktop/src/state/widgetSnapshot.ts");

const T = (y, mo, d, h, mi = 0, sec = 0) => new Date(y, mo - 1, d, h, mi, sec, 0).getTime();
const now = T(2026, 9, 21, 12, 0);   // 09-21 12:00

/* ---------- [1] nativeRow ---------- */

// 非时间性行：原样可见，不参与重算
{
  const r = nativeRow({ text: "洗衣机", sub: "空闲 3 台" }, now);
  assert.equal(r.visible, true);
  assert.equal(r.sub, "空闲 3 台");
}

// class：未开始 → 次行「地点 · 还有 X」
{
  const r = nativeRow({ text: "10:00 高数", rel: "class", at: T(2026, 9, 21, 14, 0), until: T(2026, 9, 21, 15, 40), loc: "六教6A215" }, now);
  assert.equal(r.visible, true);
  assert.equal(r.strong, false);
  assert.equal(r.sub, "六教6A215 · 还有 2 小时");
}

// class：正在上课 → 加粗 + 「正在上课 · 地点」
{
  const r = nativeRow({ text: "10:00 高数", rel: "class", at: T(2026, 9, 21, 11, 0), until: T(2026, 9, 21, 12, 40), loc: "六教6A215" }, now);
  assert.equal(r.visible, true);
  assert.equal(r.strong, true);
  assert.equal(r.sub, "正在上课 · 六教6A215");
}

// class：已下课 → 剔除
{
  const r = nativeRow({ text: "08:00 体育", rel: "class", at: T(2026, 9, 21, 8, 0), until: T(2026, 9, 21, 9, 40) }, now);
  assert.equal(r.visible, false);
}

// class：隔天残留（快照跨午夜还没重推）→ 剔除
{
  const r = nativeRow({ text: "10:00 高数", rel: "class", at: T(2026, 9, 20, 10, 0), until: T(2026, 9, 20, 11, 40) }, now);
  assert.equal(r.visible, false);
}

// ddl：未到 → 次行「今天/M/d HH:MM · 还有 X」；过点 → 剔除；6 小时内加粗
{
  const soon = nativeRow({ text: "DDL 习题", rel: "ddl", at: T(2026, 9, 21, 17, 0) }, now);
  assert.equal(soon.visible, true);
  assert.equal(soon.strong, true);
  assert.equal(soon.sub, "今天 17:00 · 还有 5 小时");

  const later = nativeRow({ text: "DDL 报告", rel: "ddl", at: T(2026, 9, 23, 23, 59) }, now);
  assert.equal(later.visible, true);
  assert.equal(later.strong, false);
  assert.equal(later.sub, "9/23 23:59 · 还有 2 天");   // 59.98h → round(2.499)=2 天（与构建侧同口径）

  const past = nativeRow({ text: "DDL 过期", rel: "ddl", at: T(2026, 9, 21, 9, 0) }, now);
  assert.equal(past.visible, false);
}

// leftText 口径与快照构建侧一致
assert.equal(leftText(T(2026, 9, 21, 12, 40) - now), "还有 40 分钟");
assert.equal(leftText(T(2026, 9, 21, 15, 5) - now), "还有 3 小时");

/* ---------- [2] nativeRender 脚注与标题 ---------- */

const rows = [
  { text: "08:00 体育", rel: "class", at: T(2026, 9, 21, 8, 0), until: T(2026, 9, 21, 9, 40) },   // 过期剔除
  { text: "14:00 高数", rel: "class", at: T(2026, 9, 21, 14, 0), until: T(2026, 9, 21, 15, 40), loc: "六教" },
  { text: "DDL 习题", rel: "ddl", at: T(2026, 9, 21, 17, 0) },
];
{
  const out = nativeRender({ rows, counts: { classes: 2, ddls: 1, more: 0, hadClass: true }, titleAt: T(2026, 9, 21, 8, 0), now });
  assert.equal(out.rows.length, 2);
  assert.equal(out.footer, "1 节课 · 1 个截止");
  assert.match(out.title, /^今天 9月21日$/);
}
{
  // 全部过点：快照当天且有课 → 「今天的课已上完」
  const out = nativeRender({ rows: [rows[0]], counts: { classes: 1, ddls: 0, more: 0, hadClass: true }, titleAt: T(2026, 9, 21, 8, 0), now: T(2026, 9, 21, 20, 0) });
  assert.equal(out.rows.length, 0);
  assert.equal(out.footer, "今天的课已上完");
}
{
  // 跨午夜后的旧快照：课行全剔 + hadClass 不再适用 → 「今天没有课与截止」
  const out = nativeRender({ rows: [rows[0]], counts: { classes: 1, ddls: 0, more: 0, hadClass: true }, titleAt: T(2026, 9, 21, 8, 0), now: T(2026, 9, 22, 0, 30) });
  assert.equal(out.rows.length, 0);
  assert.equal(out.footer, "今天没有课与截止");
}

/* ---------- [2b] 行数按卡片高度铺满 + 脚注「还有 N 项」（R25） ----------
 * 2026-09-25 用户实录：卡片拖大后能显示的行数远少于实际空间（旧实现按矮/中/高估行高并
 * 封顶 5 行），脚注又总写着快照里算死的「还有 2 项」，与卡片实际显示几条无关。 */

const many = [
  { text: "11:00 数据结构", rel: "class", at: T(2026, 9, 21, 11, 0), until: T(2026, 9, 21, 12, 40), loc: "六教" },   // 正在上
  { text: "14:00 高数", rel: "class", at: T(2026, 9, 21, 14, 0), until: T(2026, 9, 21, 15, 40), loc: "六教" },
  { text: "DDL 习题", rel: "ddl", at: T(2026, 9, 21, 17, 0) },
  { text: "DDL 报告", rel: "ddl", at: T(2026, 9, 23, 23, 59) },
];
const counts4 = { classes: 2, ddls: 2, more: 0, hadClass: true };

{
  // 卡片放得下全部 4 行：脚注只报显示出来的，不再多写「还有」
  const out = nativeRender({ rows: many, counts: counts4, titleAt: T(2026, 9, 21, 8, 0), now, maxRows: 4 });
  assert.equal(out.rows.length, 4);
  assert.equal(out.footer, "2 节课 · 2 个截止");
}
{
  // 卡片只放得下 1 行：显示 1 + 还有 3，两者之和 = 仍有效的条目总数（4）
  const out = nativeRender({ rows: many, counts: counts4, titleAt: T(2026, 9, 21, 8, 0), now, maxRows: 1 });
  assert.equal(out.rows.length, 1);
  assert.equal(out.footer, "1 节课 · 还有 3 项");
}
{
  // 快照都没装下的条目（counts.more）也要算进「还有」：显示 2 + 快照外 2
  const out = nativeRender({ rows: many.slice(0, 2), counts: { ...counts4, more: 2 }, titleAt: T(2026, 9, 21, 8, 0), now, maxRows: 2 });
  assert.equal(out.footer, "2 节课 · 还有 2 项");
}
{
  // 中间尺寸：显示 3（2 课 + 1 截止）→ 还有 1
  const out = nativeRender({ rows: many, counts: counts4, titleAt: T(2026, 9, 21, 8, 0), now, maxRows: 3 });
  assert.equal(out.footer, "2 节课 · 1 个截止 · 还有 1 项");
}
{
  // 过点的行不算「还有」：过期的那条既不上卡片也不进剩余数
  const expired = [...many, { text: "DDL 过期", rel: "ddl", at: T(2026, 9, 21, 9, 0) }];
  const out = nativeRender({ rows: expired, counts: { ...counts4, ddls: 3 }, titleAt: T(2026, 9, 21, 8, 0), now, maxRows: 2 });
  assert.equal(out.footer, "2 节课 · 还有 2 项");
}

/* ---------- [3] 快照构建侧写入机器字段 ---------- */

{
  const snap = buildWidgetSnapshot({
    schedule: [{ date: "2026-09-21", startTime: "14:00", endTime: "15:40", courseName: "高等数学", location: "六教6A215", category: "课程" }],
    homework: [{ id: "h1", title: "习题", deadline: "2026-09-21 23:59:59", submitted: false, courseName: "数据结构" }],
    remind: { default: 120, items: {} },
    now,
  });
  const cls = snap.rows.find((r) => r.rel === "class");
  assert.ok(cls, "class 行必须带 rel");
  assert.equal(cls.at, T(2026, 9, 21, 14, 0));
  assert.equal(cls.until, T(2026, 9, 21, 15, 40));
  assert.equal(cls.loc, "六教6A215");
  const ddl = snap.rows.find((r) => r.rel === "ddl");
  assert.ok(ddl, "ddl 行必须带 rel");
  assert.equal(ddl.at, T(2026, 9, 21, 23, 59, 59));
  assert.ok(snap.counts && snap.counts.hadClass === true, "counts.hadClass 必须在位");
  assert.ok(snap.titleAt === now, "titleAt 必须在位");
}

/* ---------- [4] 源码守卫：两端同步 ---------- */

const kt = readFileSync(new URL("../apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/java/app/onethu/mobile/OnethuWidget.kt", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/AndroidManifest.xml", import.meta.url), "utf8");

assert.ok(kt.includes("正在上课"), "Kotlin 侧必须有「正在上课」重算");
assert.ok(kt.includes("private fun leftText"), "Kotlin 侧必须有 leftText 镜像");
assert.ok(kt.includes("private fun dayKey"), "Kotlin 侧必须有 dayKey（隔天守卫）");
assert.ok(kt.includes("fun scheduleNextTick"), "Kotlin 侧必须有下一次重画排程");
assert.ok(kt.includes("object WidgetTicker") && kt.includes("OnethuWidgetTickReceiver"), "重画闹钟链必须在位");
assert.ok(kt.includes("setExactAndAllowWhileIdle") && kt.includes("setAndAllowWhileIdle"), "精确闹钟 + 降级路径必须在位");
assert.ok(kt.includes("INK_NIGHT") && kt.includes("isNight"), "Span 调色板必须随系统深色");
assert.ok(manifest.includes("OnethuWidgetTickReceiver"), "manifest 必须登记重画广播");

const nightColors = readFileSync(new URL("../apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/res/values-night/widget_colors.xml", import.meta.url), "utf8");
const nightBg = readFileSync(new URL("../apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/res/drawable-night/onethu_widget_bg.xml", import.meta.url), "utf8");
assert.ok(nightColors.includes("#E8EBF2"), "夜色文字色必须在位");
assert.ok(nightBg.includes("#151A24"), "夜色卡底必须在位");
assert.ok(!/--/.test(nightBg.replace(/<!--[\s\S]*?-->/g, "")), "XML 注释外不得有连续连字符（AAPT 解析失败实录）");

/* 页脚分流（2026-09-21 用户实录：洗衣机状态正常、底下多一行「今天没有课与截止」）：
 * 页脚重算只允许用于「今日」内容（带 counts），其余内容必须用它自带的 footer。 */
const kw = readFileSync(new URL("../apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/java/app/onethu/mobile/OnethuWidget.kt", import.meta.url), "utf8");
const footerFn = kw.slice(kw.indexOf("private fun footerOf("), kw.indexOf("private fun footerOf(") + 900);
assert.ok(/content\.optJSONObject\("counts"\)\s*\n?\s*\?: return content\.optString\("footer"\)/.test(footerFn.replace(/\s+/g, " ")) ||
  /\?: return content\.optString\("footer"\)/.test(footerFn),
  "非今日内容必须用自带的 footer（否则详情组件被套上今日空态文案）");

/* 行数铺满 + 剩余项数（R25，2026-09-25「行数远少于实际空间 / 总是还有 2 项」）：
 * 快照给足候选行、布局备足槽位、原生按真实高度算行数、脚注按「显示了几行 + 还有几项」数。 */
const snapSrc = readFileSync(new URL("../apps/desktop/src/state/widgetSnapshot.ts", import.meta.url), "utf8");
const layout = readFileSync(new URL("../apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/res/layout/onethu_widget.xml", import.meta.url), "utf8");

assert.ok(/export const WIDGET_MAX_ROWS = 20/.test(snapSrc), "快照必须给足候选行（WIDGET_MAX_ROWS），否则卡片拉大后没东西可填");
const slotIds = [...layout.matchAll(/@\+id\/onethu_widget_row(\d+)/g)].map((m) => Number(m[1]));
assert.equal(Math.max(...slotIds), 20, "布局必须备足 20 条槽位（RemoteViews 只能引用布局里已存在的 id）");
assert.equal(slotIds.length, 20, "槽位 id 不许重复或缺失");
assert.ok(kt.includes("private const val SLOT_IDS = 20"), "Kotlin 的槽位数必须与布局一致");
assert.ok(kt.includes("private fun fitRows(") && kt.includes("private fun lineHeightPx("), "行数必须按真实高度算（fitRows + lineHeightPx 逐行量文本）");
assert.ok(!kt.includes("listFit"), "旧的矮/中/高估算必须彻底移除（它把行数封顶在 5 行）");
assert.ok(
  /val hidden = \(visibleRel - \(shownClasses \+ shownDdls\)\) \+ counts\.optInt\("more", 0\)/.test(kt),
  "脚注的「还有 N 项」必须是「没显示的有效行 + 快照都没装下的条目」",
);
assert.ok(
  kt.includes("private fun footerOf(content: JSONObject, now: Long, shownClasses: Int, shownDdls: Int, visibleRel: Int)"),
  "footerOf 必须同时拿到「已显示的行数」与「全部有效行数」，否则算不出还有几项",
);

console.log("widget-native-render-test: 全部断言通过（nativeRow 7 态 + 脚注标题 3 态 + 铺满与剩余项数 5 态 + 快照契约 + 两端同步守卫）");

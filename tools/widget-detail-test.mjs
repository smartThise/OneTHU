/**
 * 「一个原子占满」时补什么细节（纯函数 + 注入数据）。
 *
 * 这一段的成败标准只有一条：**宁可少一行，也不要猜**。拿不到实时数据（用户没打开过洗衣机页）
 * 就老实不写，而不是编一个「空闲」写到桌面上——桌面上写错的数字比空着更糟。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/widget-detail-test.mjs
 */
const { atomDetail } = await import("../apps/desktop/src/state/widgetDetail.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

/** 固定「现在」：2026-09-21（周一）09:00 */
const NOW = new Date(2026, 8, 21, 9, 0, 0).getTime();

const base = {
  schedule: [
    { date: "2026-09-21", startTime: "10:00", courseName: "数据结构", location: "六教6A215" },
    { date: "2026-09-22", startTime: "08:00", courseName: "数据结构", location: "三教3104" },
    { date: "2026-09-23", startTime: "14:00", courseName: "数据结构", location: "六教6B201" },
    { date: "2026-09-24", startTime: "10:00", courseName: "数据结构", location: "六教6A215" },
    { date: "2026-09-21", startTime: "15:00", courseName: "线性代数", location: "三教3200" },
  ],
  homework: [
    { id: "h1", title: "第三章习题", deadline: "2026-09-21 23:59:59", submitted: false },
    { id: "h2", title: "第二章习题", deadline: "2026-09-18 23:59:59", submitted: true },
  ],
  readCache: () => null,
  now: NOW,
};

/* ① 课程：接下来几次课的时间地点（今天是上周一的那节，还应算进来） */
{
  const d = atomDetail({ kind: "course", key: "1~数据结构~张三~2025" }, { title: "数据结构" }, base);
  eq("课程：今天这节在最前", d.rows[0].text, "今天 10:00 六教6A215");
  eq("课程：带倒计时", d.rows[0].sub, "还有 1 小时");
  eq("课程：往后排", d.rows[1].text, "明天 08:00 三教3104");
  eq("课程：最多三行", d.rows.length, 3);
  eq("课程：脚注是待上次数", d.footer, "4 次待上");
  const other = atomDetail({ kind: "course", key: "2~线性代数~李四~2025" }, { title: "线性代数" }, base);
  eq("课程：只算自己那门", other.rows.length, 1);
  eq("课程：名字对不上时也给结论", atomDetail({ kind: "course", key: "3~不存在的课~~2025" }, { title: "x" }, base).footer, "近期没有安排");
}

/* ② 未交作业：截止时间 + 倒计时 + 未提交 */
{
  const d = atomDetail({ kind: "assignment", key: "1~h1~第三章习题~数据结构~2025" }, { title: "第三章习题" }, base);
  eq("作业：截止行", d.rows[0].text, "截止 今天 23:59");
  eq("作业：倒计时", d.rows[0].sub, "还有 15 小时");
  eq("作业：状态", d.footer, "未提交");
  const done = atomDetail({ kind: "assignment", key: "1~h2~第二章习题~数据结构~2025" }, { title: "第二章习题" }, base);
  eq("作业：已提交也把截止写清楚", done.rows[0].text, "截止 9/18 周五 23:59");
  eq("作业：已提交不给倒计时（别再催）", done.rows[0].sub, undefined);
  eq("作业：状态", done.footer, "已提交");
  const gone = atomDetail({ kind: "assignment", key: "1~h9~老作业~数据结构~2024" }, { title: "老作业" }, base);
  eq("作业：数据里已经没有这条，也不硬凑", gone.rows, []);
  eq("作业：脚注给出结论", gone.footer, "已提交或已过期");
}

/* ③ 其余原子：不硬凑（原子自己的说明已经够了；实时类原子见 widgetLive） */
{
  eq("新闻：无补充", atomDetail({ kind: "news", key: "n1~某新闻~信息门户" }, { title: "某新闻" }, base), null);
  eq("功能页：无补充", atomDetail({ kind: "page", key: "learn" }, { title: "网络学堂" }, base), null);
  eq("教室：本模块不掺和（占用情况由 widgetLive 抓取后解读）", atomDetail({ kind: "classroom-r", key: "六教~六教~6A215" }, { title: "6A215" }, base), null);
}

/* ④ 行数上限可注入（原生按占位决定能画几行） */
{
  const d = atomDetail({ kind: "course", key: "1~数据结构~张三~2025" }, { title: "数据结构" }, { ...base, maxRows: 1 });
  eq("maxRows=1 时只算一行", d.rows.length, 1);
  eq("maxRows 不影响脚注（脚注是总数）", d.footer, "4 次待上");
}

/* ⑤ 校园卡（widget/cardEntry）：余额大号加粗 + 最近流水（拉长显示更多）——
 * 2026-09-21 用户实录：这个原子的桌面组件此前只显示标题、不显示余额；补上后又太单薄
 * （「太丑太平铺」），所以这里是「余额 + 流水」两段式，样式字段要真的给到原生。 */
{
  const now = 1_760_000_000_000;
  const c = {
    amount: 123.4,
    at: now,
    cardId: "2025013332",
    status: "正常",
    transactions: [
      { name: "紫荆园食堂", amount: 12.5, at: now - 3600_000 },
      { name: "微信充值", amount: 100, at: now - 86400_000 },
    ],
  };
  const d = atomDetail({ kind: "widget", key: "cardEntry" }, { title: "校园卡余额" }, { ...base, now, card: c });
  eq("校园卡：首行是余额（不带「余额」二字，金额自己说话）", d.rows[0].text, "¥123.40");
  eq("校园卡：余额行加粗", d.rows[0].strong, true);
  eq("校园卡：余额行大号", d.rows[0].size, "lg");
  eq("校园卡：余额行副文带卡号与更新时间", /卡号 2025013332/.test(d.rows[0].sub), true);
  eq("校园卡：流水进第二行", d.rows[1].text, "紫荆园食堂");
  eq("校园卡：消费行用红色方向色", d.rows[1].color, "#e5484d");
  eq("校园卡：消费金额带负号", /−¥12\.50/.test(d.rows[1].sub), true);
  eq("校园卡：收入行用绿色方向色", d.rows[2].color, "#2e9e5b");
  eq("校园卡：收入金额带正号", /\+¥100\.00/.test(d.rows[2].sub), true);
  eq("校园卡：脚注给出笔数", d.footer, "最近 2 笔");

  const many = atomDetail(
    { kind: "widget", key: "cardEntry" },
    { title: "校园卡余额" },
    { ...base, now, card: { ...c, transactions: Array.from({ length: 20 }, (_, i) => ({ name: `商户${i}`, amount: 1, at: now - i * 1000 })) } },
  );
  eq("校园卡：行数受 maxRows 约束（原生按高度再裁）", many.rows.length, 4);
  eq("校园卡：行数上限时脚注按实际给出笔数", many.footer, "最近 3 笔");

  const noBal = atomDetail({ kind: "widget", key: "cardEntry" }, { title: "校园卡余额" }, base);
  eq("校园卡：没拉到数据时不猜数字", noBal.rows, []);
  eq("校园卡：没数据时如实提示", noBal.footer, "打开应用刷新余额");

  const nan = atomDetail(
    { kind: "widget", key: "cardEntry" },
    { title: "校园卡余额" },
    { ...base, card: { amount: Number.NaN } },
  );
  eq("校园卡：坏数字按「没拉到」处理", nan.footer, "打开应用刷新余额");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

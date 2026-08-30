/**
 * 今日（首页）—— 版式参考 thu-info-app 首页信息结构（公告→预约→日程→功能，
 * 只取语义；UI 仍用 OneTHU 设计系统）：
 *   左栏：最近日程（校历节点：开学/学期结束，升序前 5，取不到数据整卡隐藏）
 *         → 未提交作业；
 *   右栏：快捷入口（校园卡余额）→ 今日预约（座位+研讨间，无预约整卡不显示）
 *         → 今日课程 → 倒计时提醒（学校重要事项，info 门户 deadline 接口）
 *         → 订阅新闻（onethu.news.subs 来源优先，回退最新并注明；点击直达新闻详情）
 *         → 最近通知。
 * 全部行容器 maxWidth:100% + min-width:0 + 文本 ellipsis（窄窗口不横向溢出）。
 * 用 useApp().navigate(page, params) 轻路由；数据未加载的入口保持不可点并降透明度。
 */
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Card, Empty, ErrorNote, PageHead, SectionHead, SkeletonRows } from "../components/Layout.js";
import { IconBell, IconCard, IconChevron, IconIn, IconPen, IconRefresh } from "../components/Icons.js";
import { useApp } from "../state/context.js";
import { useCampusData, useCard, useTodayCalendar, useTodayDeadlines, useTodayNewsFeed, useTodayReservations } from "../state/data.js";
import { readSubs } from "./info/newsSearch.js";
import { openExternal } from "./info/openExternal.js";
import { parseLearnTime, type Homework, type ScheduleEntry } from "@onethu/core";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 本地日期 "YYYY-MM-DD"（与 core getSchedule 的 nq 同口径） */
function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "HH:mm" */
function hm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 日历天数差（d 的日期 - 今天；0=今天 1=明天），与时刻无关 */
function calDaysUntil(d: Date): number {
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((that - today) / 86400000);
}

/** 截止徽标：按日历天算（当天 23:59 截止显示「今天截止」而非「1 天后」） */
function deadlineChip(h: Homework): { text: string; cls: string } {
  const d = parseLearnTime(h.deadline);
  if (!d) return { text: "未知截止", cls: "chip-gray" };
  if (h.graded) return { text: "已批改", cls: "chip-blue" };
  if (h.submitted) return { text: "已提交", cls: "chip-green" };
  const days = calDaysUntil(d);
  if (d.getTime() < Date.now()) return { text: days === 0 ? "今天已截止" : `逾期 ${-days} 天`, cls: "chip-red" };
  if (days === 0) return { text: "今天截止", cls: "chip-red" };
  if (days === 1) return { text: "明天截止", cls: "chip-amber" };
  if (days <= 3) return { text: `${days} 天后截止`, cls: "chip-amber" };
  return { text: `${days} 天后截止`, cls: "chip-gray" };
}

/** 清华本科小节开始时间（与 Schedule 页一致） */
const SECTION_OF: Record<number, string> = {
  1: "08:00", 2: "08:55", 3: "09:55", 4: "10:50", 5: "11:45",
  6: "13:30", 7: "14:25", 8: "15:20", 9: "16:15", 10: "17:10",
  11: "18:05", 12: "19:20", 13: "20:15", 14: "21:10",
};

/** 整卡可点入口（LearnPage stat-link 同款结构）；disabled 时降透明度且不可点 */
function EntryCard({
  icon, num, label, onClick, disabled = false, dimLabel,
}: {
  icon: ReactNode;
  num: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  dimLabel?: string;
}) {
  return (
    <Card className="stat-card stat-click">
      <button
        className="stat-link"
        onClick={onClick}
        disabled={disabled}
        style={disabled ? { opacity: 0.55, cursor: "default" } : undefined}
        aria-label={dimLabel ?? label}
        title={disabled ? "数据加载后可用" : undefined}
      >
        {icon}
        <span className="stat-text">
          <span className="stat-num">{num}</span>
          <span className="stat-label">{dimLabel ?? label}</span>
        </span>
        {!disabled ? <IconChevron width={14} height={14} className="row-caret" /> : null}
      </button>
    </Card>
  );
}

/** 行点击通用包装：数据就绪才可点（keydown Enter 同触发，row-click 同款语义） */
function RowClick({
  onClick, disabled = false, children, style,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const handle = disabled ? undefined : onClick;
  return (
    <div
      className="row row-click"
      style={disabled ? { ...style, opacity: 0.55 } : style}
      role={handle ? "button" : undefined}
      tabIndex={handle ? 0 : undefined}
      onClick={handle}
      onKeyDown={handle ? (e) => e.key === "Enter" && handle() : undefined}
    >
      {children}
    </div>
  );
}

/* ---------- 倒计时提醒（thu-info-app 首页同位组件移植） ----------
 * 学校学期重要事项倒计时（选课/退课/推研/考试报名等），数据源 = info 门户
 * deadline 接口（core getDeadlines，djsbt/djskssj/djsjzsj/djsurl，与 thu-info-lib
 * getCrTimetable 同链）。时间窗与 thu-info home activeEvents 同口径：
 * now < 截止 且 now ≥ 开始-14 天；条目 = 名称 + 起止时间 + 未开始/进行中 + 剩余
 * 天数；点击打开事项通知链接（thu-info Linking.openURL(djsurl) 同语义）。 */

/** 起止毫秒值（"YYYY-MM-DD HH:mm" → epoch ms；解析失败 NaN 由调用方过滤） */
function deadlineMs(s: string | undefined): number {
  if (!s) return NaN;
  const t = new Date(s.includes(" ") ? s.replace(" ", "T") : s).getTime();
  return Number.isNaN(t) ? NaN : t;
}

/** 倒计时徽标：未开始=还有 N 天开始（当天=今天开始）；进行中=剩 N 天（当天=今天结束） */
function countdownChip(beginMs: number, endMs: number, now: Date): { text: string; cls: string } {
  if (now.getTime() < beginMs) {
    const days = calDaysUntil(new Date(beginMs));
    if (days <= 0) return { text: "今天开始", cls: "chip-red" };
    if (days <= 7) return { text: `未开始 · ${days} 天后`, cls: "chip-amber" };
    return { text: `未开始 · 还有 ${days} 天`, cls: "chip-gray" };
  }
  const days = Math.ceil((endMs - now.getTime()) / 86400000);
  if (days <= 1) return { text: "今天结束", cls: "chip-red" };
  return { text: `进行中 · 剩 ${days} 天`, cls: "chip-blue" };
}

/** 日程与提醒：校历节点（开学/学期结束）+ 学校重要事项（deadline 接口）合并成
 *  一条时间线，按日期升序；用户指令：倒计时提醒与最近日程合并为一卡，文字不截断。 */
function AgendaCard() {
  const { navigate } = useApp();
  const cal = useTodayCalendar();
  const { list: deadlineList, state: dlState } = useTodayDeadlines();
  const now = useMemo(() => new Date(), []);

  type AgendaRow = {
    key: string; date: Date; title: string; sub: string;
    chipText: string; chipCls: string; barCls?: string;
    onClick?: () => void;
  };

  const calRows: AgendaRow[] = useMemo(() => {
    if (cal.state !== "ready") return [];
    return (cal.nodes ?? []).slice(0, 6).map((n) => ({
      key: n.key,
      date: n.date,
      title: n.name,
      sub: `校历 · 星期${WEEKDAYS[n.date.getDay()]}`,
      chipText: n.daysUntil === 0 ? "今天" : `还有 ${n.daysUntil} 天`,
      chipCls: n.daysUntil <= 1 ? "chip-red" : n.daysUntil <= 7 ? "chip-amber" : "chip-gray",
      barCls: n.key.endsWith("-end") ? "var(--amber)" : undefined,
      onClick: () => navigate("schedule"),
    }));
  }, [cal.state, cal.nodes, navigate]);

  const dlRows: AgendaRow[] = useMemo(() => {
    if (dlState !== "ready") return [];
    return (deadlineList ?? [])
      .map((d) => ({ ...d, beginMs: deadlineMs(d.begin), endMs: deadlineMs(d.end) }))
      .filter((d) => Number.isFinite(d.beginMs) && Number.isFinite(d.endMs))
      .filter((d) => now.getTime() < d.endMs && now.getTime() >= d.beginMs - 14 * 86400000)
      .sort((a, b) => a.beginMs - b.beginMs)
      .map((d) => {
        const chip = countdownChip(d.beginMs, d.endMs, now);
        return {
          key: `dl-${d.title}-${d.begin}`,
          date: new Date(d.beginMs),
          title: d.title,
          sub: `重要事项 · ${(d.begin ?? "").slice(5, 16)} ~ ${(d.end ?? "").slice(5, 16)}`,
          chipText: chip.text,
          chipCls: chip.cls,
          barCls: "var(--border-strong)",
          onClick: d.url ? () => void openExternal(d.url!) : undefined,
        } as AgendaRow;
      });
  }, [deadlineList, dlState, now]);

  const rows = useMemo(() => {
    const merged = [...calRows, ...dlRows].sort((a, b) => a.date.getTime() - b.date.getTime());
    return merged.slice(0, 6);
  }, [calRows, dlRows]);

  // 两路都还没就绪 → 整卡不渲染；就绪但都为空 → 也隐藏（首页不留死卡）
  if (rows.length === 0 && (cal.state !== "ready" || dlState !== "ready")) return null;
  if (cal.state === "ready" && dlState === "ready" && rows.length === 0) return null;

  return (
    <>
      <SectionHead title="日程与提醒" aside="校历 · 学校重要事项" />
      <Card className="list">
        {rows.length === 0 ? (
          <Empty text="近期没有日程事项。" />
        ) : (
          rows.map((r, i) => (
            <RowClick key={r.key} style={{ animationDelay: `${i * 35}ms` }} onClick={r.onClick}>
              <div className="tl-time">{ymd(r.date).slice(5)}</div>
              <div className="tl-bar" style={r.barCls ? { background: r.barCls } : undefined} />
              <div className="tl-main">
                <div className="tl-title" style={{ whiteSpace: "normal", overflow: "visible", textOverflow: "unset", display: "block" }}>{r.title}</div>
                <div className="tl-sub" style={{ whiteSpace: "normal" }}>{r.sub}</div>
              </div>
              <span className={`chip ${r.chipCls}`}>
                <span className="dot" />
                {r.chipText}
              </span>
              {r.onClick ? <IconChevron className="row-caret" width={14} height={14} /> : null}
            </RowClick>
          ))
        )}
      </Card>
    </>
  )
}


export function TodayPage() {
  const { navigate } = useApp();
  const { data, state, error, reload } = useCampusData();
  // 校园卡余额（快捷入口展示用）：未加载完成前入口置灰不可点
  const card = useCard(1);
  // 今日预约（座位 + 研讨间）：加载中/无预约都不渲染整卡
  const resv = useTodayReservations();
  // 最近日程（校历节点）：取不到数据时整卡隐藏
  const cal = useTodayCalendar();
  // 订阅新闻（onethu.news.subs 来源优先，回退最新）：失败时整卡隐藏。
  // Today 页切走即卸载，回来自动重读 localStorage；storage 事件兜底跨标签同步。
  const [subs, setSubs] = useState<string[]>(() => readSubs());
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "onethu.news.subs") setSubs(readSubs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const news = useTodayNewsFeed(subs);
  const now = new Date();

  /** 未提交作业（首页作业区唯一口径：submitted===false，含已逾期，按截止升序） */
  const unsubmitted = useMemo(
    () =>
      (data?.homework ?? [])
        .filter((h) => !h.submitted)
        .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [data],
  );

  /** 今天的日程事件：有 date 按 date 精确匹配（数据窗口跨 3 周不会重复），
   *  无 date（demo）退回 dayOfWeek；按开始时间升序 */
  const todayEvents = useMemo<ScheduleEntry[]>(() => {
    const wd = now.getDay() === 0 ? 7 : now.getDay();
    const today = ymd(now);
    return (data?.schedule ?? [])
      .filter((s) => (s.date ? s.date === today : s.dayOfWeek === wd))
      .sort((a, b) => {
        const ta = a.startTime ?? SECTION_OF[a.startSection ?? 1] ?? "99:99";
        const tb = b.startTime ?? SECTION_OF[b.startSection ?? 1] ?? "99:99";
        return ta.localeCompare(tb);
      });
  }, [data]);

  /** 三日内截止（今明后三天内、且尚未过期） */
  const dueSoon = useMemo(
    () =>
      unsubmitted.filter((h) => {
        const d = parseLearnTime(h.deadline);
        return d && d.getTime() >= now.getTime() && calDaysUntil(d) <= 2;
      }).length,
    [unsubmitted],
  );

  const dataReady = !(state === "loading" && !data);
  const courseName = (courseId: string) => data?.courses.find((c) => c.id === courseId)?.name ?? "课程";

  return (
    <>
      <PageHead
        title="今日"
        meta={`${now.getMonth() + 1}月${now.getDate()}日 星期${WEEKDAYS[now.getDay()]}${data?.user ? ` · ${data.user.name}` : ""}`}
        actions={
          <button className="btn" onClick={() => void reload()} disabled={state === "loading"}>
            <IconRefresh width={14} height={14} />
            刷新
          </button>
        }
      />

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      <div className="stats">
        <EntryCard
          icon={<span className="stat-icon"><IconPen width={17} height={17} /></span>}
          num={dataReady ? unsubmitted.length : "–"}
          label="未交作业"
          dimLabel={dataReady ? "未交作业 · 查看全部" : "未交作业"}
          disabled={!dataReady}
          onClick={() => navigate("learn-assignments")}
        />
        <EntryCard
          icon={<span className="stat-icon amber"><IconBell width={17} height={17} /></span>}
          num={dataReady ? dueSoon : "–"}
          label="三日内截止"
          dimLabel={dataReady ? "三日内截止 · 查看全部" : "三日内截止"}
          disabled={!dataReady}
          onClick={() => navigate("learn-assignments")}
        />
        <EntryCard
          icon={<span className="stat-icon green"><IconIn width={17} height={17} /></span>}
          num={dataReady ? todayEvents.length : "–"}
          label="今日课程"
          dimLabel={dataReady ? "今日课程 · 查看课表" : "今日课程"}
          disabled={!dataReady}
          onClick={() => navigate("schedule")}
        />
      </div>

      <div className="today-grid" style={{ marginTop: 14 }}>
        <div>
          {/* 日程与提醒：校历节点 + 学校重要事项合并一卡 */}
          <AgendaCard />

          {/* 作业区：只显示未提交（已提交的不出现在首页） */}
          <SectionHead title="未提交作业" aside={`${unsubmitted.length} 条 · 点击查看详情`} />
          {state === "loading" && !data ? (
            <SkeletonRows rows={4} />
          ) : unsubmitted.length === 0 ? (
            <Card>
              <Empty text="没有未提交的作业，享受今天吧。" />
            </Card>
          ) : (
            <Card className="list">
              {unsubmitted.slice(0, 8).map((h, i) => {
                const chip = deadlineChip(h);
                return (
                  <RowClick
                    key={`${h.courseId}-${h.id}`}
                    style={{ animationDelay: `${i * 35}ms` }}
                    onClick={() => navigate("learn-assignment-detail", { courseId: h.courseId, itemId: h.id, from: "today" })}
                  >
                    <div className="row-when">
                      <b>{h.deadline.slice(5, 10)}</b>
                      <span>{h.deadline.slice(11, 16)} 截止</span>
                    </div>
                    <div className="row-main">
                      <div className="row-title">{h.title}</div>
                      <div className="row-sub">
                        {courseName(h.courseId)}
                      </div>
                    </div>
                    <span className={`chip ${chip.cls}`}>
                      <span className="dot" />
                      {chip.text}
                    </span>
                    <IconChevron className="row-caret" width={14} height={14} />
                  </RowClick>
                );
              })}
            </Card>
          )}
          <SectionHead title="最近通知" aside="点击查看详情" />
          <Card className="list">
            {(data?.notifications.length ?? 0) === 0 ? (
              <Empty text="暂无通知。" />
            ) : (
              data!.notifications.slice(0, 3).map((n, i) => (
                <RowClick key={i} onClick={() => navigate("learn-notice-detail", { courseId: n.courseId, itemId: n.id, from: "today" })}>
                  <div className="tl-time">{n.publishTime.slice(5, 10)}</div>
                  <div className="tl-bar" style={{ background: "var(--border-strong)" }} />
                  <div className="tl-main">
                    <div className="tl-title" style={{ whiteSpace: "normal" }}>{n.title}</div>
                    <div className="tl-sub">{n.publisher}</div>
                  </div>
                  <IconChevron className="row-caret" width={14} height={14} />
                </RowClick>
              ))
            )}
          </Card>

        </div>

        <div className="today-rail">
          {/* 快捷入口：只保留校园卡余额 */}
          <SectionHead title="快捷入口" />
          <div className="stats" style={{ marginTop: 0 }}>
            <EntryCard
              icon={<span className="stat-icon amber"><IconCard width={17} height={17} /></span>}
              num={card.data ? `¥${card.data.info.balance.toFixed(2)}` : "–"}
              label={card.data ? "校园卡余额" : "校园卡"}
              dimLabel={card.data ? "校园卡余额 · 生活页" : "校园卡（加载中）"}
              disabled={!card.data}
              onClick={() => navigate("life")}
            />
          </div>

          {/* 今日预约：座位 + 研讨间，按今天聚合；加载中/无预约整卡不渲染 */}
          {resv.state === "ready" && (resv.list?.length ?? 0) > 0 ? (
            <>
              <SectionHead title="今日预约" aside="座位 · 研讨间 · 点击管理" />
              <Card className="list">
                {(resv.list ?? []).map((r, i) => (
                  <RowClick key={r.key} style={{ animationDelay: `${i * 35}ms` }} onClick={() => navigate("reserve")}>
                    <div className="tl-time">{hm(r.start)}</div>
                    <div className="tl-bar" style={r.kind === "room" ? { background: "var(--green)" } : undefined} />
                    <div className="tl-main">
                      <div className="tl-title">{r.kind === "room" ? r.place || r.venue : r.venue}</div>
                      <div className="tl-sub">
                        {(
                          r.kind === "seat"
                            ? [r.place ? `座位 ${r.place}` : "", `${hm(r.start)} 签到`, r.note ?? ""]
                            : [r.start && r.end ? `${hm(r.start)}~${hm(r.end)}` : hm(r.start), r.venue, r.note ?? ""]
                        )
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <span className="chip chip-gray">{r.kind === "seat" ? "座位" : "研讨间"}</span>
                    <IconChevron className="row-caret" width={14} height={14} />
                  </RowClick>
                ))}
              </Card>
            </>
          ) : null}

          <SectionHead title="今日课程" aside="点击打开课表" />
          <Card className="list">
            {todayEvents.length === 0 ? (
              <Empty text="今天没有课。" />
            ) : (
              todayEvents.map((s, i) => (
                <RowClick key={`${s.date ?? "d"}-${i}-${s.courseName}`} style={{ animationDelay: `${i * 35}ms` }} onClick={() => navigate("schedule")}>
                  <div className="tl-time">{s.startTime ?? SECTION_OF[s.startSection ?? 1] ?? "—"}</div>
                  <div className="tl-bar" />
                  <div className="tl-main">
                    <div className="tl-title">{s.courseName}</div>
                    <div className="tl-sub">
                      {s.location}
                      {s.teacher ? ` · ${s.teacher}` : ""}
                    </div>
                  </div>
                  <IconChevron className="row-caret" width={14} height={14} />
                </RowClick>
              ))
            )}
          </Card>

          {/* 订阅新闻：onethu.news.subs 来源优先（服务端订阅取数），回退最新并注明；
              点击行经 LearnNav.infoNewsId 直达该条新闻详情 —— 失败/无数据整卡隐藏 */}
          {news.state === "ready" && (news.data?.list.length ?? 0) > 0 ? (
            <>
              <SectionHead
                title="订阅新闻"
                aside={
                  news.data!.from === "subs"
                    ? `已订阅 ${news.data!.subCount} 来源 · 最新 ${news.data!.list.length} 条`
                    : news.data!.subCount > 0
                      ? "订阅来源暂无新闻，显示最新"
                      : "未订阅来源，显示最新"
                }
              />
              <Card className="list">
                {news.data!.list.map((n, i) => (
                  <RowClick
                    key={n.xxid || i}
                    style={{ animationDelay: `${i * 35}ms` }}
                    onClick={() => navigate("info", { infoNewsId: n.xxid })}
                  >
                    <div className="tl-time">{n.date ? n.date.slice(5, 10) : "—"}</div>
                    <div className="tl-bar" style={{ background: "var(--border-strong)" }} />
                    <div className="tl-main">
                      <div className="tl-title" style={{ whiteSpace: "normal" }}>{n.name}</div>
                      <div className="tl-sub">{n.source || "校内通知"}</div>
                    </div>
                    <IconChevron className="row-caret" width={14} height={14} />
                  </RowClick>
                ))}
              </Card>
            </>
          ) : null}

        </div>
      </div>
    </>
  );
}

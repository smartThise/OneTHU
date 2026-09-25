/**
 * 待办聚合页 v2（UI/UX 改造 §2.2，按用户《待办页施工方案》实现）。
 *
 * 学习 tab（默认）：
 * - 上半：作业卡片流——中心当前卡 + 上下相邻卡缩放边缘的循环轮播；
 *   排序 = 未逾期按剩余天数升序，逾期垫底；旁听/忽略/已交/已批不进流；
 *   卡面 = 左上科目+作业名 / 左下来源与状态标签 / 右下 DDL 倒计时色梯度 /
 *   右上竖排 收藏·提醒·忽略；点击卡片 → 三态分流详情（openHomeworkRow）；
 * - 中部：左侧两项计数（动画数字）+ 右侧「全部作业 / 网络学堂」双入口；
 * - 底部：课程通知（未读红点 + 重要高亮 + 全部通知入口）；
 * 生活 tab：最近新闻 + 校园卡充值提醒（后续按用户规划补充）.
 *
 * 数据全部复用既有层：useLearnData / useExternalHomework / useIgnoredHw /
 * useCard / useTodayNewsFeed；本页零新取数。忽略走 hwIgnore，提醒走 hwRemind，
 * 收藏走原子收藏（仅网络学堂作业；外部作业无原子形态不显示星标）。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { parseLearnTime, SOURCE_NAMES } from "@onethu/core";
import { SegmentedOverflow, Card, Empty, PageHead } from "../components/Layout.js";
import { IconRefresh } from "../components/Icons.js";
import { CollectStar } from "../components/Collect.js";
import { HwRemindButton, semesterText, useLearnNavSemester } from "./learn/shared.js";
import { openHomeworkRow } from "../lib/homeworkEntry.js";
import { CONFIRM_IGNORE_HW, confirmDanger } from "../lib/confirm.js";
import { ignoreHw, useIgnoredHw } from "../state/hwIgnore.js";
import { toHomework, useExternalHomework } from "../state/exthw.js";
import { useApp } from "../state/context.js";
import { useCard, useLearnData, useTodayNewsFeed } from "../state/data.js";
import { enc } from "../state/atoms.js";
import { readSubs } from "./info/newsSearch.js";
import { NewsRows } from "../components/HomeWidgets.js";
import type { Homework } from "@onethu/core";

const READ_KEY = "onethu.tasks.readNotices.v1";

function readNoticeIds(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(READ_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function markNoticeRead(id: string): void {
  try {
    const s = readNoticeIds();
    s.add(id);
    const arr = [...s].slice(-200);
    globalThis.localStorage?.setItem(READ_KEY, JSON.stringify(arr));
  } catch {
    /* 静默 */
  }
}

/** DDL 倒计时：还剩天数 + 色档（紧急红 → 3 天琥珀 → 7 天蓝 → 平静灰） */
function ddlInfo(deadline: string): { days: number | null; overdue: boolean; label: string; cls: string } {
  const d = parseLearnTime(deadline);
  if (!d) return { days: null, overdue: false, label: "", cls: "task-ddl-gray" };
  const diff = d.getTime() - Date.now();
  if (diff < 0) return { days: 0, overdue: true, label: "已逾期", cls: "task-ddl-red" };
  const days = Math.ceil(diff / 86400000);
  const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  const md = String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  if (days <= 1) return { days, overdue: false, label: "1 天内 · " + hm, cls: "task-ddl-red" };
  if (days <= 3) return { days, overdue: false, label: "还剩 " + days + " 天", cls: "task-ddl-amber" };
  if (days <= 7) return { days, overdue: false, label: "还剩 " + days + " 天", cls: "task-ddl-blue" };
  return { days, overdue: false, label: "还剩 " + days + " 天", cls: "task-ddl-gray" };
}

/** 状态标签（来源 / 进度 / 未交 / 逾期） */
function hwTags(h: Homework): Array<{ text: string; cls: string }> {
  const tags: Array<{ text: string; cls: string }> = [];
  tags.push({ text: h.source ? SOURCE_NAMES[h.source] ?? "外部作业" : "网络学堂", cls: "task-tag-src" });
  if (h.externalProgress) tags.push({ text: "交了 " + h.externalProgress, cls: "task-tag" });
  if (!h.submitted && !h.graded) tags.push({ text: "未交", cls: "task-tag" });
  if (h.submitted && !h.graded) tags.push({ text: "已提交", cls: "task-tag-ok" });
  if (h.graded) tags.push({ text: "已批改", cls: "task-tag-ok" });
  if (ddlInfo(h.deadline).overdue && !h.submitted) tags.push({ text: "逾期", cls: "task-tag-red" });
  if (h.audited) tags.push({ text: "旁听", cls: "task-tag" });
  return tags;
}

/** 作业卡片流：循环轮播（上下滑动/点击相邻边缘切换；点击当前卡进详情） */
function HwCarousel({ items, courseNameOf, semesterId }: { items: Homework[]; courseNameOf: (id: string) => string; semesterId?: string }): ReactNode {
  const { navigate } = useApp();
  const [idx, setIdx] = useState(0);
  const touchY = useRef<number | null>(null);
  const n = items.length;
  useEffect(() => {
    setIdx((i) => (n === 0 ? 0 : Math.min(i, n - 1)));
  }, [n]);
  if (n === 0) {
    return (
      <div className="hw-carousel-empty">
        <Empty text="作业都交完了，痛快去玩吧。" />
        <div className="svc-actions">
          <button className="btn" onClick={() => navigate("learn-assignments")}>查看全部作业</button>
        </div>
      </div>
    );
  }
  const go = (delta: number): void => setIdx((i) => (i + delta + n) % n);
  const cur = items[idx]!;
  const off = (k: number): number => {
    let d = (k - idx) % n;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    return d;
  };
  // 注意：transform 首段必须是 translate(-50%,-50%) 完成居中锚定（.hw-card 的
  // left/top 是 50%），位移/缩放叠加在其后——漏掉首段卡片就会锚在容器中心点、
  // 只露出一个角（2026-09-25 真机实录）。
  const styleOf = (d: number): CSSProperties | undefined => {
    if (d === 0) return { transform: "translate(-50%, -50%)", opacity: 1, zIndex: 3 };
    if (d === -1) return { transform: "translate(-50%, -50%) translateY(-64%) scale(0.92)", opacity: 0.55, zIndex: 2 };
    if (d === 1) return { transform: "translate(-50%, -50%) translateY(64%) scale(0.92)", opacity: 0.55, zIndex: 2 };
    if (d === -2) return { transform: "translate(-50%, -50%) translateY(-112%) scale(0.84)", opacity: 0.22, zIndex: 1 };
    if (d === 2) return { transform: "translate(-50%, -50%) translateY(112%) scale(0.84)", opacity: 0.22, zIndex: 1 };
    return undefined;
  };
  return (
    <div
      className="hw-carousel"
      onTouchStart={(e) => {
        touchY.current = e.touches[0]?.clientY ?? null;
      }}
      onTouchEnd={(e) => {
        const y0 = touchY.current;
        touchY.current = null;
        if (y0 == null) return;
        const dy = (e.changedTouches[0]?.clientY ?? y0) - y0;
        if (dy < -40) go(1); // 上滑 = 下一条
        else if (dy > 40) go(-1);
      }}
    >
      {items.map((h, k) => {
        const d = off(k);
        if (Math.abs(d) > 2) return null;
        const info = ddlInfo(h.deadline);
        return (
          <div
            key={h.id}
            className={"hw-card" + (d === 0 ? " is-cur" : "")}
            style={styleOf(d)}
            onClick={() => {
              if (d === 0) openHomeworkRow(h, { navigate, from: "tasks", courseName: courseNameOf(h.courseId) });
              else go(d);
            }}
          >
            <div className="hw-card-main">
              <div className="hw-card-course">{h.source ? h.courseName ?? courseNameOf(h.courseId) : courseNameOf(h.courseId)}</div>
              <div className="hw-card-title">{h.title}</div>
              <div className="hw-card-tags">
                {hwTags(h).map((t, i) => (
                  <span key={i} className={"task-tag " + t.cls}>{t.text}</span>
                ))}
              </div>
            </div>
            <div className={"hw-card-ddl task-ddl " + info.cls}>
              <span className="hw-card-ddl-left">{info.label}</span>
              <span className="hw-card-ddl-date">{info.days != null ? (parseLearnTime(h.deadline) ? (() => { const dd = parseLearnTime(h.deadline)!; return String(dd.getMonth() + 1).padStart(2, "0") + "-" + String(dd.getDate()).padStart(2, "0"); })() : "") : ""}</span>
            </div>
            <div className="hw-card-actions" onClick={(e) => e.stopPropagation()}>
              {!h.source && semesterId ? (
                <CollectStar atom={{ kind: "assignment", key: enc(h.courseId, h.id, h.title, courseNameOf(h.courseId), semesterId) }} title="收藏作业" />
              ) : null}
              <HwRemindButton h={h} />
              <button
                className="hw-card-act"
                title="忽略这条作业"
                aria-label="忽略这条作业"
                onClick={async () => {
                  const ok = await confirmDanger(
                    `确定要忽略《${h.title}》吗？\n\n忽略后它不再出现在作业区与日程提醒中，可在「全部作业 → 已忽略」恢复。`,
                    CONFIRM_IGNORE_HW,
                  );
                  if (ok) ignoreHw(h.id, h.title);
                }}
              >
                忽
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TasksPage(): ReactNode {
  const { navigate } = useApp();
  useLearnNavSemester();
  const { data, state, reload } = useLearnData();
  const card = useCard(1);
  const ext = useExternalHomework();
  const ignored = useIgnoredHw();
  const [tab, setTab] = useState<"learn" | "life">("learn");
  const [subs, setSubs] = useState<string[]>(() => readSubs());
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === "onethu.news.subs") setSubs(readSubs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const news = useTodayNewsFeed(subs);
  const [readTick, setReadTick] = useState(0);

  const courseMap = useMemo(() => new Map((data?.courses ?? []).map((c) => [c.id, c.name])), [data]);
  const courseNameOf = (id: string): string => courseMap.get(id) ?? "课程";
  const extHw = useMemo(() => ext.items.map(toHomework), [ext.items]);

  // 卡片流全集：未交 + 未忽略 + 非旁听；未逾期按剩余天数升序，逾期垫底
  const flow = useMemo(() => {
    const live = [...(data?.homework ?? []), ...extHw]
      .filter((h) => !ignored.has(h.id) && !h.audited && !h.submitted && !h.graded);
    const withDays = live.map((h) => ({ h, d: ddlInfo(h.deadline) }));
    const notOver = withDays
      .filter((x) => !x.d.overdue)
      .sort((a, b) => (a.h.deadline.localeCompare(b.h.deadline)));
    const over = withDays.filter((x) => x.d.overdue).sort((a, b) => a.h.deadline.localeCompare(b.h.deadline));
    return [...notOver, ...over].map((x) => x.h);
  }, [data, extHw, ignored]);

  const dueSoon = flow.filter((h) => { const i = ddlInfo(h.deadline); return !i.overdue && i.days != null && i.days <= 3; }).length;
  const semesterId = tab === "learn" ? data?.semester.id : undefined;

  // 未读课程通知（本机已读表；点开即标已读）
  const notices = useMemo(() => (data?.notifications ?? []).slice(0, 5), [data]);
  void readTick;
  const readSet = readNoticeIds();
  const unread = notices.filter((n) => !readSet.has(n.id));
  const hasImportantUnread = unread.some((n) => n.important);
  const markRead = (id: string): void => {
    markNoticeRead(id);
    setReadTick((t) => t + 1);
  };

  const cardLow = (card.data?.info.balance ?? null) != null && (card.data?.info.balance ?? 0) < 20;

  return (
    <>
      <PageHead
        title="待办"
        meta={data ? semesterText(data.semester.id) : "今天该管的事"}
        actions={
          <>
            <button className="btn" onClick={() => void reload()} disabled={state === "loading"}>
              <IconRefresh width={14} height={14} />
              刷新
            </button>
          </>
        }
      />

      <SegmentedOverflow>
        <button role="tab" aria-selected={tab === "learn"} className={tab === "learn" ? "is-active" : ""} onClick={() => setTab("learn")}>学习</button>
        <button role="tab" aria-selected={tab === "life"} className={tab === "life" ? "is-active" : ""} onClick={() => setTab("life")}>生活</button>
      </SegmentedOverflow>

      {tab === "learn" ? (
        <div className="tasks-learn">
          {/* 上半：作业卡片流（约 1/2 视窗） */}
          <div className="tasks-flow-wrap">
            {state === "loading" && flow.length === 0 ? (
              <Card><Empty text="正在取作业…" /></Card>
      ) : (
              <HwCarousel items={flow} courseNameOf={courseNameOf} semesterId={semesterId} />
      )}
          </div>
          {/* 中部：计数 + 双入口（约 1/4） */}
          <div className="tasks-mid">
            <div className="tasks-stats">
              <div className="task-stat">
                <span className="task-stat-num" key={"n" + flow.length}>{flow.length}</span>
                <span className="task-stat-label">还剩作业（项）</span>
              </div>
              <div className="task-stat">
                <span className="task-stat-num task-stat-urgent" key={"s" + dueSoon}>{dueSoon}</span>
                <span className="task-stat-label">3 日内截止（项）</span>
              </div>
            </div>
            <div className="tasks-entries">
              <button className="task-entry" onClick={() => navigate("learn-assignments")}>全部作业 →</button>
              <button className="task-entry" onClick={() => navigate("learn")}>进入网络学堂 →</button>
            </div>
          </div>
          {/* 底部：课程通知（未读红点 + 重要高亮） */}
          <section className="tasks-notices">
            <div className="task-sec-head">
              <span className="task-sec-title">课程通知</span>
              {unread.length > 0 ? <span className="task-dot" aria-label={unread.length + " 条未读"} /> : null}
              {unread.length > 0 ? <span className="task-unread-hint">你有 {unread.length} 条未读通知</span> : null}
              {hasImportantUnread ? <span className="task-unread-important">有重要通知未读</span> : null}
              <button className="task-sec-more" onClick={() => navigate("learn-notices")}>全部通知 →</button>
            </div>
              {notices.length > 0 ? (
                <Card className="task-card">
                  {notices.map((n) => (
                    <button
                      key={n.id}
                      className="task-row"
                      onClick={() => {
                        markRead(n.id);
                        navigate("learn-notice-detail", { courseId: n.courseId, itemId: n.id, from: "tasks" });
                      }}
                    >
                      <span className="task-row-main">
                        <span className="task-row-name">
                          {!readSet.has(n.id) ? <span className="task-unread-dot" aria-hidden /> : null}
                          {n.title}
                        </span>
                        <span className="task-row-sub">{courseNameOf(n.courseId)} · {n.publisher}</span>
                      </span>
                      {n.important ? <span className="task-tag task-tag-red">重要</span> : null}
                    </button>
                  ))}
                </Card>
      ) : (
                <Card><Empty text="暂无课程通知。" /></Card>
      )}
          </section>
        </div>
      ) : (
        <div className="tasks-life">
          {cardLow ? (
            <Card className="task-card">
              <button className="task-row" onClick={() => navigate("life", { lifeTab: "card" })}>
                <span className="task-row-main">
                  <span className="task-row-name">校园卡余额不足</span>
                  <span className="task-row-sub">当前 ¥{card.data?.info.balance}，建议充值</span>
                </span>
                <span className="task-row-meta">去充值 →</span>
              </button>
            </Card>
      ) : null}
          <div className="task-sec-head">
            <span className="task-sec-title">最近新闻</span>
            <button className="task-sec-more" onClick={() => navigate("info", { infoTab: "news" })}>全部新闻 →</button>
          </div>
          {news.state === "ready" && (news.data?.list.length ?? 0) > 0 ? (
            <NewsRows feed={news.data!} navigate={navigate} />
      ) : (
            <Card><Empty text="新闻还在路上，稍后再来看看。" /></Card>
      )}
          <div className="task-life-note">行政类通知（报到、党团活动等）暂无稳定数据源，接入后补充到这里。</div>
        </div>
      )}
    </>
  );
}

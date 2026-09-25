/**
 * 待办聚合页 v2.1（UI/UX 改造 §2.2，按用户《待办页施工方案》+ 实机反馈迭代）。
 *
 * 学习 tab（默认，整页不滚动，各元素定高）：
 * - 作业卡片流：循环轮播，上下各露一张（下方卡必须露出标题区）；
 *   **拖拽实时跟手**（touchmove 期间禁过渡、按手指位移移动，松手过阈值翻页）；
 *   排序 = 未逾期按剩余天数升序、逾期垫底；旁听/忽略/已交/已批不进流；
 *   卡面 = 左上科目+作业名 / 左下动作排（收藏·提醒·忽略，图标化）+ 右下醒目 DDL；
 *   左缘 = 进度圆点轨（当前白点放大）；
 * - 中部：计数（pop 动画）+ 全部作业 / 网络学堂入口；
 * - 底部：课程通知提示条（未读数 + 重要未读 + 全部通知入口），不再列条目；
 * 生活 tab：最近新闻 + 校园卡充值提醒。
 *
 * 数据全复用既有层（useLearnData/exthw/hwIgnore/hwCard/news），零新取数。
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

/** 忽略图标（内联线性 SVG，1.6px 描边，与 Icons.tsx 同风格；仓库暂无现成 IconX） */
const IconIgnore = ({ size = 14 }: { size?: number }): ReactNode => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

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
    globalThis.localStorage?.setItem(READ_KEY, JSON.stringify([...s].slice(-200)));
  } catch {
    /* 静默 */
  }
}

/** DDL 解析：剩余天数 + 色档 + 展示文案（大数字 + 日期两行） */
function ddlInfo(deadline: string): { days: number | null; overdue: boolean; big: string; small: string; date: string; cls: string } {
  const d = parseLearnTime(deadline);
  if (!d) return { days: null, overdue: false, big: "—", small: "截止", date: "", cls: "task-ddl-gray" };
  const diff = d.getTime() - Date.now();
  const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  const md = String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  if (diff < 0) return { days: 0, overdue: true, big: "已逾期", small: "尽快处理", date: md + " " + hm, cls: "task-ddl-red" };
  const days = Math.ceil(diff / 86400000);
  if (days <= 1) return { days, overdue: false, big: "<1 天", small: "就要截止", date: md + " " + hm, cls: "task-ddl-red" };
  return { days, overdue: false, big: days + " 天", small: "还剩", date: md + " " + hm, cls: days <= 3 ? "task-ddl-amber" : days <= 7 ? "task-ddl-blue" : "task-ddl-gray" };
}

/** 状态标签 */
function hwTags(h: Homework): Array<{ text: string; cls: string }> {
  const tags: Array<{ text: string; cls: string }> = [];
  tags.push({ text: h.source ? SOURCE_NAMES[h.source] ?? "外部作业" : "网络学堂", cls: "task-tag-src" });
  if (h.externalProgress) tags.push({ text: "交了 " + h.externalProgress, cls: "task-tag" });
  if (ddlInfo(h.deadline).overdue) tags.push({ text: "逾期", cls: "task-tag-red" });
  return tags;
}

/** 卡片纵向位移（px）：0=居中；±1=上/下露出（STEP > 半卡高，保下方卡露出标题区）；拖拽时叠加 dragDelta 实时跟手 */
const STEP = 170;

function HwCarousel({ items, courseNameOf, semesterId }: { items: Homework[]; courseNameOf: (id: string) => string; semesterId?: string }): ReactNode {
  const { navigate } = useApp();
  const [idx, setIdx] = useState(0);
  const [drag, setDrag] = useState<number | null>(null); // 拖拽中的手指位移 px；null=未拖拽
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
  const off = (k: number): number => {
    let d = (k - idx) % n;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    return d;
  };
  // 只渲染中心 ±1（上下各一张）；dragDelta 叠加到所有可见卡实现实时跟手
  const styleOf = (d: number): CSSProperties => {
    const dragPx = drag == null ? 0 : drag;
    const base = d * STEP;
    const y = base + (d === 0 ? dragPx * 0.45 : dragPx);
    const scale = d === 0 ? 1 : 0.94;
    return { transform: "translate(-50%, -50%) translateY(" + y + "px) scale(" + scale + ")", opacity: d === 0 ? 1 : 0.6, zIndex: d === 0 ? 3 : 2, transition: drag == null ? undefined : "none" };
  };
  return (
    <div className="hw-carousel-row">
      {/* 左缘进度圆点轨：每项一个点，当前项白点放大（深色半透明底，亮暗主题都可读） */}
      <div className="hw-dots" aria-hidden>
        {items.map((_, k) => (
          <span key={k} className={"hw-dot" + (k === idx ? " is-cur" : "")} onClick={() => setIdx(k)} />
        ))}
      </div>
      <div
        className="hw-carousel"
        onTouchStart={(e) => {
          touchY.current = e.touches[0]?.clientY ?? null;
          setDrag(0);
        }}
        onTouchMove={(e) => {
          const y0 = touchY.current;
          if (y0 == null) return;
          const dy = (e.touches[0]?.clientY ?? y0) - y0;
          setDrag(dy);
        }}
        onTouchEnd={(e) => {
          const y0 = touchY.current;
          const dy = drag ?? 0;
          touchY.current = null;
          setDrag(null);
          if (y0 == null) return;
          const endY = e.changedTouches[0]?.clientY ?? y0;
          const total = endY - y0;
          if (total < -40) go(1);
          else if (total > 40) go(-1);
          void dy;
        }}
      >
        {items.map((h, k) => {
          const d = off(k);
          if (Math.abs(d) > 1) return null;
          const info = ddlInfo(h.deadline);
          return (
            <div
              key={h.id}
              className={"hw-card" + (d === 0 ? " is-cur" : "")}
              style={styleOf(d)}
              onClick={() => {
                if (drag == null && d === 0) openHomeworkRow(h, { navigate, from: "tasks", courseName: courseNameOf(h.courseId) });
                else if (d !== 0) go(d);
              }}
            >
              <div className="hw-card-head">
                <div className="hw-card-course">{h.source ? h.courseName ?? courseNameOf(h.courseId) : courseNameOf(h.courseId)}</div>
                {d === 0 ? (
                  <div className="hw-card-actions" onClick={(e) => e.stopPropagation()}>
                    {!h.source && semesterId ? <CollectStar atom={{ kind: "assignment", key: enc(h.courseId, h.id, h.title, courseNameOf(h.courseId), semesterId) }} title="收藏作业" /> : null}
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
                      <IconIgnore />
                    </button>
                  </div>
        ) : null}
              </div>
              <div className="hw-card-title">{h.title}</div>
              <div className="hw-card-foot">
                <div className="hw-card-tags">
                  {hwTags(h).map((t, i) => (
                    <span key={i} className={"task-tag " + t.cls}>{t.text}</span>
                  ))}
                </div>
                <div className={"hw-card-ddl " + info.cls}>
                  <span className="hw-card-ddl-big">{info.big}</span>
                  <span className="hw-card-ddl-sub">{info.small} · {info.date}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
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

  const flow = useMemo(() => {
    const live = [...(data?.homework ?? []), ...extHw]
      .filter((h) => !ignored.has(h.id) && !h.audited && !h.submitted && !h.graded);
    const withDays = live.map((h) => ({ h, d: ddlInfo(h.deadline) }));
    const notOver = withDays.filter((x) => !x.d.overdue).sort((a, b) => a.h.deadline.localeCompare(b.h.deadline));
    const over = withDays.filter((x) => x.d.overdue).sort((a, b) => a.h.deadline.localeCompare(b.h.deadline));
    return [...notOver, ...over].map((x) => x.h);
  }, [data, extHw, ignored]);

  const dueSoon = flow.filter((h) => { const i = ddlInfo(h.deadline); return !i.overdue && i.days != null && i.days <= 3; }).length;
  const semesterId = data?.semester.id;

  const notices = useMemo(() => (data?.notifications ?? []), [data]);
  void readTick;
  const readSet = readNoticeIds();
  const unread = notices.filter((n) => !readSet.has(n.id));
  const hasImportantUnread = unread.some((n) => n.important);
  const markReadAllVisible = (): void => {
    for (const n of unread.slice(0, 20)) markNoticeRead(n.id);
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
          {/* 作业卡片流（拖拽实时跟手） */}
          <div className="tasks-flow-wrap">
            {state === "loading" && flow.length === 0 ? (
              <Card><Empty text="正在取作业…" /></Card>
      ) : (
              <HwCarousel items={flow} courseNameOf={courseNameOf} semesterId={semesterId} />
      )}
          </div>
          {/* 计数 + 双入口 */}
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
          {/* 课程通知提示条（不再列条目） */}
          <div className={"notice-strip" + (unread.length > 0 ? " has-unread" : "")}>
            <span className="task-dot" style={{ visibility: unread.length > 0 ? "visible" : "hidden" }} />
            <span className="notice-strip-text">
              {unread.length > 0 ? (
                <>
                  课程通知：<b>{unread.length} 条未读</b>
                  {hasImportantUnread ? <span className="task-unread-important">重要未读</span> : null}
                </>
      ) : (
                <>课程通知：暂无未读</>
      )}
            </span>
            <button className="task-sec-more" onClick={() => { markReadAllVisible(); navigate("learn-notices"); }}>全部通知 →</button>
          </div>
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

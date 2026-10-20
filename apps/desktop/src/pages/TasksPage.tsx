import { Btn } from "@onethu/gui";
/**
 * 待办聚合页 v2.1（UI/UX 改造 §2.2，按用户《待办页施工方案》+ 实机反馈迭代）。
 *
 * 学习 tab（默认，整页不滚动，各元素定高）：
 * - 作业卡片流：循环轮播，上下各露一张（下方卡必须露出标题区）；
 *   **拖拽实时跟手**（Pointer Events + 指针捕获：手指移出卡片流后事件仍不丢，松手按速度做梯度惯性并吸附整卡）；
 *   排序 = 未逾期按剩余天数升序、逾期垫底；旁听/忽略/已交/已批不进流；
 *   卡面 = 左上科目+作业名 / 左下动作排（收藏·提醒·忽略，图标化）+ 右下醒目 DDL；
 *   左缘 = 进度圆点轨（当前白点放大）；
 * - 中部：计数（pop 动画）+ 全部作业 / 网络学堂入口；
 * - 底部：课程通知提示条（未读数 + 重要未读 + 全部通知入口），不再列条目；
 * 生活 tab：最近新闻 + 校园卡充值提醒。
 *
 * 数据全复用既有层（useLearnData/exthw/hwIgnore/hwCard/news），零新取数。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { SegmentedOverflow, Card, Empty, PageHead } from "../components/Layout.js";
import { IconRefresh } from "../components/Icons.js";
import { semesterText, useLearnNavSemester } from "./learn/shared.js";
import { openHomeworkRow } from "../lib/homeworkEntry.js";
import { useIgnoredHw } from "../state/hwIgnore.js";
import { extHwSourceName, toHomework, useExternalHomework } from "../state/exthw.js";
import { hwCourseGroups, hwCourseKey, hwCourseLabel } from "../lib/hwCourse.js";
import { useApp } from "../state/context.js";
import { useCard, useLearnData, useTodayNewsFeed } from "../state/data.js";
import { readSubs } from "./info/newsSearch.js";
import { noticeHasRead, useNoticeReadVersion } from "../lib/noticeRead.js";
import { NewsRows } from "../components/HomeWidgets.js";
import { useExpanded } from "../state/usePlatformLayout.js";
import { AssignmentDetailPage } from "./learn/AssignmentDetailPage.js";
import { YktAssignmentDetailPage } from "./learn/YktAssignmentDetailPage.js";
import { yktDetailParams } from "../lib/homeworkEntry.js";
import { prefersReducedMotion } from "../lib/motion.js";
import { pickHomeworkRoute } from "../lib/yktDetail.js";
import { activateSlot, type DetailSlot } from "../lib/detailSlots.js";
import type { Homework } from "@onethu/core";


export { HwCarousel } from "../components/HomeworkCarousel.js";
import { HwCarousel, ddlInfo, pendingHomework } from "../components/HomeworkCarousel.js";
import { t as i18n } from "../i18n/index.js";


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
  const readVersion = useNoticeReadVersion(); // 通知未读口径：全站共享的本地已读覆盖
  const [courseFilter, setCourseFilter] = useState<string>(""); // "" = 全部课程
  const wide = useExpanded(); // ≥840px（§2.8.1 expanded）：学习/生活 双栏同显

  const courseMap = useMemo(() => new Map((data?.courses ?? []).map((c) => [c.id, c.name])), [data]);
  const courseNameOf = (id: string): string => courseMap.get(id) ?? "课程";
  const extHw = useMemo(() => ext.items.map(toHomework), [ext.items]);

  const flowAll = useMemo(() => pendingHomework([...(data?.homework ?? []), ...extHw], ignored), [data, extHw, ignored]);

  // 按课程检索（作业流上方的下拉）：默认全部；候选只列**当前确实有未完成作业**的课程，
  // 免得选到一门已清空的课只看到空态。
  // 关键：候选从作业本身聚合，而不是从 data.courses 取——雨课堂等外部作业源的 courseId 是
  // 合成值 ext:yuketang，不在课程表里，按老写法它们的课永远进不了这份清单。
  // 聚合逻辑抽到 lib/hwCourse.ts 并带单测（tools/hw-course-test.mjs）：真机上雨课堂当前没有
  // 未完成作业，只能靠单测钉住「同源多课分开、空课程表也能列出外部源」这两条口径。
  const flowCourses = useMemo(() => hwCourseGroups(flowAll, courseMap, extHwSourceName), [flowAll, courseMap]);
  const flowExtSources = useMemo(
    () => [...new Set(flowCourses.map((c) => c.source).filter((s): s is NonNullable<typeof s> => !!s))],
    [flowCourses],
  );
  const flow = useMemo(
    () => (courseFilter ? flowAll.filter((h) => hwCourseKey(h) === courseFilter) : flowAll),
    [flowAll, courseFilter],
  );
  // 宽屏分栏右栏（§2.8.2）：默认「生活」，点卡片换成该作业详情——不点就是生活、点了就是详情、
  // 关掉回到生活。与计划书的「左列表/右详情」和主人要的「左学习/右生活」合成一体。
  const [pcSel, setPcSel] = useState<Homework | null>(null);
  const [pcFull, setPcFull] = useState(false); // 详情全屏：复用同一挂载实例，切换不重拉
  // 打开过的详情槽位：**保持挂载 = 天然缓存**（说明/作答/附件状态都不必重拉），上限 8 个。
  // 超过 TTL 的槽位再次激活时换 nonce 重建（等价于重拉一次），满足「5 分钟一刷新」；
  // 提交/撤回在详情组件内部完成，它会自己 invalidateLearnCache，右侧立刻是新状态。
  const [pcSlots, setPcSlots] = useState<Array<DetailSlot<Homework>>>([]);
  const pcActivate = (h: Homework): void => setPcSlots((list) => activateSlot(list, h, Date.now()));
  /** 这条作业有没有站内详情可内嵌（外部网页源没有） */
  const detailable = (h: Homework): boolean => {
    const route = pickHomeworkRoute(h);
    return route === "internal" || route === "ykt-native";
  };
  const pcPick = (h: Homework): void => {
    // 外部网页源没有站内详情（雨课堂参数不齐 / 作业网等）：宽屏也照旧走原分流
    if (!detailable(h)) {
      openHomeworkRow(h, { navigate, from: "tasks", courseName: hwCourseLabel(h, courseMap, extHwSourceName) });
      return;
    }
    pcActivate(h);
    setPcSel(h);
  };
  // 滚轮/拖拽换卡 → 右栏详情跟着换，不必再点一次（只在「已经在看详情」时跟随；
  // 没点过卡片时右栏仍然是生活，保持「不点就是生活」）
  const pcFollow = (h: Homework): void => {
    if (!detailable(h)) return;
    pcActivate(h);
    setPcSel(h);
  };
  /* 「展开 / 收起」是 position: static → fixed 的硬切换（列内 → 全屏浮层），
     inset/position 不可过渡，光靠 CSS 只能是"啪"一下——所以走 FLIP：
     切换前记住旧矩形，切换后用 WAAPI 从旧矩形补一段"长大 / 缩回"。
     用 WAAPI 而不是 CSS keyframes，是因为起点矩形只有运行时才知道。 */
  const detailRef = useRef<HTMLDivElement | null>(null);
  const morphFrom = useRef<{ rect: DOMRect; grow: boolean } | null>(null);
  const toggleFull = useCallback((next: boolean): void => {
    const el = detailRef.current;
    // 减弱动态效果时不动。CSS 那条 animation-duration: 1ms !important 管不到 WAAPI，必须自己判。
    if (el && !prefersReducedMotion()) {
      morphFrom.current = { rect: el.getBoundingClientRect(), grow: next };
    }
    setPcFull(next);
  }, []);
  useLayoutEffect(() => {
    const el = detailRef.current;
    const m = morphFrom.current;
    morphFrom.current = null;
    if (!el || !m || typeof el.animate !== "function") return;
    const now = el.getBoundingClientRect();
    if (!now.width || !now.height) return;
    el.animate(
      [
        {
          transformOrigin: "top left",
          transform:
            "translate(" + (m.rect.left - now.left) + "px, " + (m.rect.top - now.top) + "px)" +
            " scale(" + m.rect.width / now.width + ", " + m.rect.height / now.height + ")",
          opacity: m.grow ? 0.6 : 1,
        },
        { transformOrigin: "top left", transform: "none", opacity: 1 },
      ],
      // 400ms + MD3 emphasized：大容器变形用强调档，别跟小控件抢速度
      { duration: 400, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  }, [pcFull]);

  // 全屏详情：Esc 收起（与点「收起」同效）
  useEffect(() => {
    if (!pcFull) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") toggleFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pcFull, toggleFull]);

  const dueSoon = flow.filter((h) => { const i = ddlInfo(h.deadline); return !i.overdue && i.days != null && i.days <= 3; }).length;
  const semesterId = data?.semester.id;

  const notices = useMemo(() => (data?.notifications ?? []), [data]);
  // 未读口径与通知页/详情页完全一致：服务端 sfyd ∪ 本地已读覆盖（lib/noticeRead）。
  // 此前待办页另起了一套只按 id 记的私有 localStorage，与全站口径不一致，故
  // 会出现「别处 11 条未读、这里暂无未读」。
  void readVersion; // 仅订阅：本地置读后本页立刻重算（值本身不用）
  const unread = notices.filter((n) => !noticeHasRead(n.hasRead, n.courseId, n.id));
  const hasImportantUnread = unread.some((n) => n.important);

  const cardLow = (card.data?.info.balance ?? null) != null && (card.data?.info.balance ?? 0) < 20;

  // 横向滑动切换 学习/生活 tab：全程页面无横滑元素，横滑手势专用于此；
  // 防误触：位移 >60px 且 |dx| > 2|dy|（排除竖向滚动手势的横向漂移）。
  const horiz = useRef<{ x0: number; y0: number } | null>(null);
  const onHDown = (e: PointerEvent<HTMLDivElement>): void => {
    horiz.current = { x0: e.clientX, y0: e.clientY };
  };
  const onHUp = (e: PointerEvent<HTMLDivElement>): void => {
    const s = horiz.current;
    horiz.current = null;
    if (!s) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (wide) return; // 宽屏双栏同显，无需横滑切换
    if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy)) return;
    if (dx < 0 && tab === "learn") setTab("life");
    else if (dx > 0 && tab === "life") setTab("learn");
  };

  return (
    <>
      <PageHead
        title={i18n("auto.pages.TasksPage.1")}
        meta={data ? semesterText(data.semester.id) : "今天该管的事"}
        actions={
          <>
            <Btn variant="outline" onClick={() => void reload()} disabled={state === "loading"}><IconRefresh width={14} height={14} />{i18n("auto.pages.TasksPage.2")}</Btn>
          </>
        }
      />

      {!wide ? (
        <SegmentedOverflow>
          <button role="tab" aria-selected={tab === "learn"} className={tab === "learn" ? "is-active" : ""} onClick={() => setTab("learn")}>{i18n("auto.pages.TasksPage.3")}</button>
          <button role="tab" aria-selected={tab === "life"} className={tab === "life" ? "is-active" : ""} onClick={() => setTab("life")}>{i18n("auto.pages.TasksPage.4")}</button>
        </SegmentedOverflow>
      ) : null}

      <div className={"tasks-body" + (wide ? " is-wide" : "")} onPointerDown={onHDown} onPointerUp={onHUp}>
      <section className={"tasks-pane" + (wide || tab === "learn" ? "" : " is-hidden")}>
        <div className="tasks-pane-head">{i18n("auto.pages.TasksPage.3")}</div>
        {/* 元素出场（§3.6：「待办页元素错峰出场」此前延后到动效令牌落地）：
            只在这一层用一个 .stagger——筛选行 → 卡片流 → 统计/入口逐项上浮 26ms。
            不在子容器再套一层：父子同时进场会糊成一团，也不给卡片流内的卡加动画
            （那层是拖拽 transform 的地盘，动画叠上去会和手势抢属性）。 */}
        <div className="tasks-learn stagger">
          {/* 按课程检索：作业流上方，避免在几十条作业里翻找某一科 */}
          <div className="hw-filter">
            <select
              className="hw-filter-select"
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              aria-label={i18n("auto.pages.TasksPage.5")}
            >
              <option value="">{i18n("auto.pages.TasksPage.6")}{flowAll.length}）</option>
              {flowCourses.some((c) => !c.source) ? (
                <optgroup label={i18n("auto.pages.TasksPage.7")}>
                  {flowCourses.filter((c) => !c.source).map((c) => (
                    <option key={c.key} value={c.key}>{c.label}（{c.count}）</option>
                  ))}
                </optgroup>
              ) : null}
              {flowExtSources.map((src) => (
                <optgroup key={src} label={extHwSourceName(src)}>
                  {flowCourses.filter((c) => c.source === src).map((c) => (
                    <option key={c.key} value={c.key}>{c.label}（{c.count}）</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {courseFilter ? (
              <button className="hw-filter-clear" onClick={() => setCourseFilter("")}>{i18n("auto.pages.TasksPage.8")}</button>
            ) : null}
          </div>
          {/* 作业卡片流（拖拽实时跟手） */}
          <div className="tasks-flow-wrap">
            {state === "loading" && flow.length === 0 ? (
              <Card><Empty text="正在取作业…" /></Card>
      ) : (
              <HwCarousel
                items={flow}
                courseNameOf={courseNameOf}
                courseLabelOf={(h) => hwCourseLabel(h, courseMap, extHwSourceName)}
                semesterId={semesterId}
                onPick={wide ? pcPick : undefined}
                onFront={wide && pcSel ? pcFollow : undefined}
              />
      )}
          </div>
          {/* 计数 + 双入口 */}
          <div className="tasks-mid">
            <div className="tasks-stats">
              {/* 两项计数各自独立成卡（轻拟物：受光面 + 投影 + 内高光，按下内凹） */}
              <button className="task-stat" onClick={() => navigate("learn-assignments")}>
                <span className="task-stat-num" key={"n" + flow.length}>{flow.length}</span>
                <span className="task-stat-label">{i18n("auto.pages.TasksPage.9")}</span>
              </button>
              <button className="task-stat" onClick={() => navigate("learn-assignments")}>
                <span className="task-stat-num task-stat-urgent" key={"s" + dueSoon}>{dueSoon}</span>
                <span className="task-stat-label">{i18n("auto.pages.TasksPage.10")}</span>
              </button>
            </div>
            <div className="tasks-entries">
              <button className="task-entry" onClick={() => navigate("learn-assignments")}>{i18n("auto.pages.TasksPage.11")}</button>
              <button className="task-entry" onClick={() => navigate("learn")}>{i18n("auto.pages.TasksPage.12")}</button>
            </div>
          </div>
          {/* 课程通知提示条（不再列条目） */}
          <div className={"notice-strip" + (unread.length > 0 ? " has-unread" : "")}>
            <span className="task-dot" style={{ visibility: unread.length > 0 ? "visible" : "hidden" }} />
            <span className="notice-strip-text">
              {unread.length > 0 ? (
                <>
                  {i18n("auto.pages.TasksPage.13")}<b>{unread.length} {i18n("auto.pages.TasksPage.14")}</b>
                  {hasImportantUnread ? <span className="task-unread-important">{i18n("auto.pages.TasksPage.15")}</span> : null}
                </>
              ) : (
                <>{i18n("auto.pages.TasksPage.16")}</>
              )}
            </span>
            <button className="task-sec-more" onClick={() => navigate("learn-notices")}>{i18n("auto.pages.TasksPage.17")}</button>
          </div>
        </div>
      </section>
      <section className={"tasks-pane" + (wide || tab === "life" ? "" : " is-hidden")}>
        {wide && pcSel ? (
          <>
            <div className="tasks-pane-head">
              <span>{i18n("auto.pages.TasksPage.18")}</span>
              <span className="tasks-pane-acts">
                <button className="tasks-pane-close" onClick={() => toggleFull(!pcFull)}>
                  {pcFull ? "收起 ⤡" : "展开 ⤢"}
                </button>
                <button
                  className="tasks-pane-close"
                  onClick={() => {
                    setPcFull(false);
                    setPcSel(null);
                  }}
                >
                  {i18n("auto.pages.TasksPage.19")}</button>
              </span>
            </div>
            {/* 复用现有详情组件（§2.8.2：只改容器渲染，不改数据流与子组件）：
                页头由上面的分栏头接管，目标作业经 props 直给，不污染全局 navParams。
                每个访问过的作业各占一个槽位并保持挂载——换回旧卡不重拉，滚动位置也在。
                「展开」只切一个 class（同一个实例变成全屏浮层），所以展开/收起不重拉数据。 */}
            <div ref={detailRef} className={"tasks-detail tab-anim" + (pcFull ? " is-full" : "")}>
              {pcFull ? (
                <div className="tasks-detail-fullbar">
                  <span className="tasks-detail-fulltitle">{pcSel.title}</span>
                  <button className="tasks-pane-close" onClick={() => toggleFull(false)}>{i18n("auto.pages.TasksPage.20")}</button>
                </div>
              ) : null}
              {pcSlots.map((s) => (
                <div
                  key={s.h.id + "#" + s.nonce}
                  className={"tasks-detail-slot" + (s.h.id === pcSel.id ? "" : " is-hidden")}
                >
                  {pickHomeworkRoute(s.h) === "ykt-native" ? (
                    <YktAssignmentDetailPage
                      ykt={yktDetailParams(s.h, hwCourseLabel(s.h, courseMap, extHwSourceName), "tasks")}
                      from="tasks"
                    />
                  ) : (
                    <AssignmentDetailPage courseId={s.h.courseId} itemId={s.h.id} />
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
        <div className="tasks-pane-head">{i18n("auto.pages.TasksPage.4")}</div>
        <div className="tasks-life tab-anim" data-dir="prev">
          {cardLow ? (
            <Card className="task-card">
              <button className="task-row" onClick={() => navigate("life", { lifeTab: "card" })}>
                <span className="task-row-main">
                  <span className="task-row-name">{i18n("auto.pages.TasksPage.21")}</span>
                  <span className="task-row-sub">{i18n("auto.pages.TasksPage.22")}{card.data?.info.balance}{i18n("auto.pages.TasksPage.23")}</span>
                </span>
                <span className="task-row-meta">{i18n("auto.pages.TasksPage.24")}</span>
              </button>
            </Card>
      ) : null}
          <div className="task-sec-head">
            <span className="task-sec-title">{i18n("auto.pages.TasksPage.25")}</span>
            <button className="task-sec-more" onClick={() => navigate("info", { infoTab: "news" })}>{i18n("auto.pages.TasksPage.26")}</button>
          </div>
          {news.state === "ready" && (news.data?.list.length ?? 0) > 0 ? (
            <NewsRows feed={news.data!} navigate={navigate} />
      ) : (
            <Card><Empty text="新闻还在路上，稍后再来看看。" /></Card>
      )}
          <div className="task-life-note">{i18n("auto.pages.TasksPage.27")}</div>
        </div>
          </>
        )}
      </section>
      </div>
    </>
  );
}
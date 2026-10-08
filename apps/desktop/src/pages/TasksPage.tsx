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
import { IconBell, IconRefresh, IconStar, IconX } from "../components/Icons.js";
import { parseLearnTime, SOURCE_NAMES } from "@onethu/core";
import type { NewsItem } from "@onethu/core";
import { SegmentedOverflow, Card, Empty, PageHead } from "../components/Layout.js";
import { CollectModal, CollectStar } from "../components/Collect.js";
import { SearchSelect } from "../components/SearchSelect.js";
import { useContextMenu, useLongPressZone, type CtxItem } from "../components/ContextMenu.js";
import { HwRemindButton, HwRemindPop, semesterText, useLearnNavSemester } from "./learn/shared.js";
import { openHomeworkRow } from "../lib/homeworkEntry.js";
import { useSwipeTabs } from "../lib/useSwipeTabs.js";
import { CONFIRM_IGNORE_HW, confirmDanger } from "../lib/confirm.js";
import { ignoreHw, useIgnoredHw } from "../state/hwIgnore.js";
import { fmtRemindOffset, setHwReminder, useHwDefault, useHwReminder } from "../state/hwRemind.js";
import type { AtomRef } from "../state/favorites.js";
import { extHwSourceName, toHomework, useExternalHomework } from "../state/exthw.js";
import { hwCourseGroups, hwCourseKey, hwCourseLabel } from "../lib/hwCourse.js";
import { useApp } from "../state/context.js";
import { haptic } from "../lib/haptics.js";
import { useCard, useLearnData, useTodayNewsFeed } from "../state/data.js";
import { enc } from "../state/atoms.js";
import type { PageMenuItem } from "../state/pageChrome.js";
import { readSubs } from "./info/newsSearch.js";
import { noticeHasRead, useNoticeReadVersion } from "../lib/noticeRead.js";
import { NewsRows } from "../components/HomeWidgets.js";
import { NewsDetailDrawer, type NewsDetailState } from "../components/NewsDetailDrawer.js";
import { info } from "../lib/clients.js";
import { explainNetworkError } from "../lib/transport.js";
import { openExternal } from "./info/openExternal.js";
import { useExpanded } from "../state/usePlatformLayout.js";
import { AssignmentDetailPage } from "./learn/AssignmentDetailPage.js";
import { YktAssignmentDetailPage } from "./learn/YktAssignmentDetailPage.js";
import { yktDetailParams } from "../lib/homeworkEntry.js";
import { EASE_EMPHASIZED, prefersReducedMotion } from "../lib/motion.js";
import { pickHomeworkRoute } from "../lib/yktDetail.js";
import { activateSlot, normalizeWheelDelta, takeWheelStep, type DetailSlot } from "../lib/detailSlots.js";
import type { Homework } from "@onethu/core";


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
const STEP_DEFAULT = 170;

/** 忽略作业的二次确认：卡片动作钮与长按菜单共用同一段文案与 CONFIRM_IGNORE_HW 常量 */
async function ignoreWithConfirm(h: Homework): Promise<void> {
  const ok = await confirmDanger(
    `确定要忽略《${h.title}》吗？\n\n忽略后它不再出现在作业区与日程提醒中，可在「全部作业 → 已忽略」恢复。`,
    CONFIRM_IGNORE_HW,
  );
  if (ok) ignoreHw(h.id, h.title);
}

/** 菜单里的提醒档位面板：走订阅版取值（不是打开菜单那一刻的快照），
 *  否则「清除」之后高亮档位与清除按钮都还停在旧值上。 */
function HwRemindPanel({ h, close }: { h: Homework; close: () => void }): ReactNode {
  const cur = useHwReminder(h.id);
  const def = useHwDefault();
  return (
    <HwRemindPop
      value={cur}
      title={`作业截止前提醒（覆盖全局默认 ${fmtRemindOffset(def)}）`}
      allowClear
      onApply={(m) => {
        setHwReminder(h.id, m);
        if (m != null) close();
      }}
    />
  );
}

/** 作业卡片的长按菜单项（施工图 A3 矩阵第一行：忽略 / 提醒 / 收藏）。
 *  提醒复用卡片铃铛的 HwRemindPop（同一套档位与 setHwReminder），不另写一份预设。 */
function hwMenuItems(
  h: Homework,
  opts: { courseName: string; semesterId?: string; onCollect: (atom: AtomRef) => void },
): CtxItem[] {
  const items: CtxItem[] = [
    {
      key: "ignore",
      label: "忽略",
      danger: true,
      icon: <IconX width={14} height={14} />,
      onSelect: () => void ignoreWithConfirm(h),
    },
    {
      key: "remind",
      label: "提醒",
      icon: <IconBell width={14} height={14} />,
      panel: (close) => <HwRemindPanel h={h} close={close} />,
    },
  ];
  /* 与卡片上的星标同条件：外部源作业没有站内收藏项，不摆一个点了没反应的项 */
  if (!h.source && opts.semesterId) {
    items.push({
      key: "collect",
      label: "收藏",
      icon: <IconStar width={14} height={14} />,
      onSelect: () => opts.onCollect({ kind: "assignment", key: enc(h.courseId, h.id, h.title, opts.courseName, opts.semesterId) }),
    });
  }
  return items;
}

/** A1（霖 2026-10-05）：加载态骨架卡。
 *  几何**完全复用真实卡那条 class 链**（.hw-carousel-row > .hw-carousel > .hw-card），
 *  宽/高/位置/圆角/底色因此与随后的真实卡同源，切换时不会有横向跳动。
 *  指示点轨道放一枚占位点：真卡轨道的宽度只由「点宽 + 内边距」决定、与点的数量无关，
 *  少了它卡宽会差十几像素，所以这一枚是几何对齐的一部分。
 *  骨架条一律用百分比宽（窄屏不溢出），文案在卡内居中。 */
function HwSkeletonCard(): ReactNode {
  return (
    <div className="hw-carousel-row" aria-busy="true">
      <div className="hw-dots" aria-hidden>
        <span className="hw-dot is-cur" />
      </div>
      <div className="hw-carousel">
        <div className="hw-card is-skeleton">
          <div className="hw-card-head">
            <div className="skeleton" style={{ width: "44%", height: 18 }} />
          </div>
          <div className="skeleton" style={{ width: "72%", height: 12, marginTop: 10 }} />
          <div className="hw-skeleton-note">正在获取作业…</div>
          <div className="hw-card-foot">
            <div className="skeleton" style={{ width: "30%", height: 12 }} />
            <div className="skeleton" style={{ width: "26%", height: 22 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HwCarousel({ items, courseNameOf, courseLabelOf, semesterId, onPick, onFront }: { items: Homework[]; courseNameOf: (id: string) => string; courseLabelOf: (h: Homework) => string; semesterId?: string; onPick?: (h: Homework) => void; onFront?: (h: Homework) => void }): ReactNode {
  const { navigate } = useApp();
  // 位置真值放 ref，setPos 只做渲染镜像：逐帧补间时避免闭包读旧值
  const posRef = useRef(0);
  const [pos, setPos] = useState(0);
  const [dragging, setDragging] = useState(false); // 拖拽中 = 1:1 跟手（无补间）
  const touch = useRef<{ y0: number; pos0: number; lastY: number; lastT: number; v: number } | null>(null);
  const movedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const dragPidRef = useRef<number | null>(null); // 当前拖拽的 pointerId
  const capturedRef = useRef(false); // 是否已对该指针 setPointerCapture
  const n = items.length;
  // 卡片流几何自适应：容器高度由 CSS 给（clamp 到 100dvh 减去页头/筛选/计数/通知/底栏/OH 岛的预留），
  // 步距与卡高按实测高度放大 —— 屏幕越长卡片越大、能看到的邻卡越多，而不是在底部留一片空白。
  const menu = useContextMenu();
  /* 长按菜单里的「收藏」与卡片星标走同一条通路（CollectModal 的收藏夹多选），
     不是另写一份存储：弹层挂在轮播容器上，一处状态管所有卡。 */
  const [collectAtom, setCollectAtom] = useState<AtomRef | null>(null);
  /* A3 长按区：装在容器上按事件委托找手指底下那张卡（卡是 map 出来的，
     逐张挂 Hook 写不出来）；卡上的 data-hw-id 供这里回查作业对象。 */
  const shellRef = useLongPressZone<HTMLDivElement>({
    selector: ".hw-card",
    onLongPress: (el, x, y) => {
      const h = items.find((it) => it.id === el.dataset.hwId);
      if (!h) return;
      menu.open({
        x,
        y,
        title: h.title,
        items: hwMenuItems(h, { courseName: courseNameOf(h.courseId), semesterId, onCollect: setCollectAtom }),
      });
    },
  });
  const [geo, setGeo] = useState({ h: 300, step: STEP_DEFAULT });
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const apply = (): void => {
      const h = el.clientHeight;
      if (h <= 0) return;
      const step = Math.max(STEP_DEFAULT, Math.min(215, Math.round(h / 2.05)));
      setGeo((g) => (g.h === h && g.step === step ? g : { h, step }));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const setPosBoth = (v: number): void => {
    posRef.current = v;
    setPos(v);
  };
  useEffect(() => {
    if (n === 0) setPosBoth(0);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [n]);
  // 前台卡变化 → 轮盘式振动 tick（Android 原生 EFFECT_TICK = 青轴段落感；
  // WebView 的 navigator.vibrate 在部分机型不触发，原生命令优先，纯前端兜底）
  // 兜底吸附：拖拽结束后（含 touchend 丢失/被取消/松手在流外等一切路径），
  // 只要 pos 不在整卡上就自动补间对齐——绝不停在两张卡之间。
  useEffect(() => {
    if (dragging || rafRef.current != null) return; // 补间进行中不抢
    const frac = pos - Math.round(pos);
    if (Math.abs(frac) > 0.01) {
      const id = requestAnimationFrame(() => animateSnap());
      return () => cancelAnimationFrame(id);
    }
  }, [dragging, pos]);
  // 指针兜底：即便元素级事件丢失（捕获失败等），window 级 pointerup 也能收尾；幂等调用
  useEffect(() => {
    const onWinUp = (e: WindowEventMap["pointerup"]): void => finishDrag(e.clientY);
    window.addEventListener("pointerup", onWinUp);
    window.addEventListener("pointercancel", onWinUp);
    return () => {
      window.removeEventListener("pointerup", onWinUp);
      window.removeEventListener("pointercancel", onWinUp);
    };
  }, []);
  const curIdx = ((Math.round(pos) % n) + n) % n;
  const lastTick = useRef(curIdx);
  useEffect(() => {
    if (curIdx === lastTick.current) return;
    lastTick.current = curIdx;
    /* A2：触感的唯一入口是 lib/haptics.ts（降级链与「只记一次日志」都在那边），
       这里只管「换卡了要 tick 一下」。
       b29：这是老机型**唯一**放行的 tick 调用点（霖：只保留长按 + 作业瀑布流切卡），
       所以显式传 `legacyKeep`；同档位的普通按钮委托（installGlobalHaptics）不传，老机型静默。 */
    haptic("tick", { legacyKeep: true });
  }, [curIdx]);
  // 前台卡上报（宽屏右栏详情自动跟随）：只在**用户主动换卡**时报（拖拽/滚轮/点列），
  // 不在列表数据变化时报——否则「提交完作业、它从待办流里消失」的瞬间右栏会被抢走，
  // 用户看不到提交回执。数据侧同步由详情组件自己的失效逻辑负责。
  const onFrontRef = useRef(onFront);
  onFrontRef.current = onFront;
  const reportFront = (idx: number): void => {
    const h = n > 0 ? items[((idx % n) + n) % n] : undefined;
    if (h) onFrontRef.current?.(h);
  };
  // 滚轮/触控板：滚一格换一项。累积到阈值才动 + 时间锁，避免触控板细碎 delta 连翻好几张。
  const wheelAcc = useRef(0);
  const wheelLock = useRef(0);
  // 用原生非被动监听：React 的 onWheel 是被动监听，preventDefault 无效，
  // 结果「滚轮翻卡」会同时带动外层滚动。卡流自己吃掉滚轮，一格一项。
  const wheelRef = useRef<(e: WheelEvent) => void>(() => undefined);
  wheelRef.current = (e: WheelEvent): void => {
    if (n === 0) return;
    const now = performance.now();
    e.preventDefault();
    if (now < wheelLock.current) return; // 补间窗口内不再叠加
    // deltaMode: 0=像素、1=行、2=页；行/页折算成像素再累计
    const { acc, dir } = takeWheelStep(wheelAcc.current, normalizeWheelDelta(e.deltaY, e.deltaMode, geo.step));
    wheelAcc.current = acc;
    if (!dir) return; // 向下滚 = 下一条（与拖拽上滑前进同向）
    wheelLock.current = now + 240;
    const target = Math.round(posRef.current) + dir;
    animatePos(target, 300);
    reportFront(target);
  };
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent): void => wheelRef.current(e);
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, []);
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
  /** 逐帧补间：所有位置变化（吸附/点列/翻页）统一走这里。
   *  mode "inout"=普通起停；"out"=惯性阻尼（快起缓收，专配甩动）。 */
  const animatePos = (target: number, dur: number, mode: "inout" | "out" = "inout"): void => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const from = posRef.current;
    const dist = target - from;
    if (Math.abs(dist) < 0.001) {
      setPosBoth(target);
      return;
    }
    const t0 = performance.now();
    const ease = mode === "out"
      ? (t: number): number => 1 - Math.pow(1 - t, 3) // easeOutCubic：甩出去先快后慢
      : (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // easeInOutCubic
    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / dur);
      setPosBoth(from + dist * ease(t));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(step);
  };
  /** 吸附到最近整卡（兜底路径共用） */
  const animateSnap = (): void => animatePos(Math.round(posRef.current), 320);
  const go = (delta: number): void => animatePos(posRef.current + delta, 320);
  const gotoIdx = (k: number): void =>
    (() => {
      const c = ((posRef.current % n) + n) % n;
      let d = (k - c) % n;
      if (d > n / 2) d -= n;
      if (d < -n / 2) d += n;
      animatePos(posRef.current + d, Math.min(720, 260 + Math.abs(d) * 90)); // 步数越多时长略增
      reportFront(k);
    })();
  /** 拖拽收尾：惯性投射 + 吸附。pointerup / pointercancel / window 兜底共用（幂等）。 */
  const finishDrag = (endY: number): void => {
    const t = touch.current;
    touch.current = null;
    dragPidRef.current = null;
    capturedRef.current = false;
    setDragging(false);
    if (!t) return; // 已收尾过：直接返回，不打断正在跑的补间
    const dy = endY - t.y0; // 手指净位移（上滑为负）
    // 梯度惯性：按松手速度做投射（速度 × 150ms 阻尼视野），再吸附到最近整卡。
    const v = Math.abs(t.v) > 3 ? 3 * Math.sign(t.v) : t.v; // 限幅，防极端甩出十几张
    const projSteps = -(v * 150) / geo.step;
    const target = Math.round(posRef.current + projSteps);
    const dist = Math.abs(target - posRef.current);
    // 有惯性=快起缓收（easeOut）；无惯性=普通吸附（inout）。时长随距离增长。
    const flinging = Math.abs(v) > 0.45;
    animatePos(target, Math.min(760, 300 + dist * 70), flinging ? "out" : "inout");
    reportFront(target);
  };
  // 用 Pointer Events 而非 Touch Events：实测本机 WebView 在手指移出卡片流后
  // 会直接掐断 touch 事件流（touchend/touchcancel 都收不到，实测 end=0/cancel=0），
  // 于是 dragging 永远为真、卡片停在两张之间。指针事件 + 指针捕获同场景 16/16 全达。
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current); // 手指按下即接管
    rafRef.current = null;
    dragPidRef.current = e.pointerId;
    capturedRef.current = false;
    touch.current = { y0: e.clientY, pos0: posRef.current, lastY: e.clientY, lastT: Date.now(), v: 0 };
    movedRef.current = false;
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const t = touch.current;
    if (!t || (dragPidRef.current != null && e.pointerId !== dragPidRef.current)) return;
    const y = e.clientY;
    const dy = y - t.y0;
    // 位移过阈值才捕获指针：否则卡内按钮与点列的点击会被重定向到容器
    if (!capturedRef.current && Math.abs(dy) > 6) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
        capturedRef.current = true;
      } catch {
        /* 不支持捕获：交给 window 级兜底 */
      }
    }
    if (Math.abs(dy) > 8) movedRef.current = true;
    const dt = Math.max(1, Date.now() - t.lastT);
    t.v = (y - t.lastY) / dt;
    t.lastY = y;
    t.lastT = Date.now();
    setPosBoth(t.pos0 - dy / geo.step); // 1:1 跟手（列随手上行 = 前进）
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (dragPidRef.current != null && e.pointerId !== dragPidRef.current) return;
    finishDrag(e.clientY);
  };
  const relOf = (k: number): number => {
    const c = ((pos % n) + n) % n;
    let d = (k - c) % n;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    return d * geo.step;
  };
  return (
    <div className="hw-carousel-row">
      <div className="hw-dots" aria-hidden>
        {items.map((_, k) => (
          <span key={k} className={"hw-dot" + (k === curIdx ? " is-cur" : "")} onClick={() => gotoIdx(k)} />
        ))}
      </div>
      <div
        className="hw-carousel"
        ref={shellRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp} // 中断也走同一收尾：吸附，绝不卡在两张之间
      >
        {items.map((h, k) => {
          const yPx = relOf(k);
          // 可见范围 = 容器半高 + 一步：容器越高，滚筒里同时出现的卡越多
          if (Math.abs(yPx) > geo.h / 2 + geo.step) return null;
          const ad = Math.abs(yPx) / geo.step;
          const scale = Math.max(0.86, 1 - ad * 0.07);
          const opacity = Math.max(0.3, 1 - ad * 0.22);
          const info = ddlInfo(h.deadline);
          const front = ad < 0.5;
          return (
            <div
              key={h.id}
              data-hw-id={h.id}
              className={"hw-card" + (front ? " is-cur" : "")}
              style={{
                /* 霖 2026-10-02 #3：卡片的位置就是这个内联 transform，长按放大必须**乘进去**
                   （`--ctx-press-k` 由按压样式给出，见 global.css），否则按压那条
                   `scale` 会把定位一起顶掉、整张卡跳到右下角。 */
                transform: "translate(-50%, -50%) translateY(" + yPx + "px) scale(calc(" + scale + " * var(--ctx-press-k, 1)))",
                opacity,
                zIndex: 100 - Math.round(Math.abs(yPx)),
                height: geo.step - 2, // 卡高随步距缩放（CSS 的 168px 只是首帧兜底）
              }}
              /* C8（霖 2026-10-01 走查）：这里原来用 onClickCapture——捕获阶段先跑，
                 卡面动作钮的 stopPropagation 拦不住，点「忽略」会先把详情打开。改成冒泡阶段，
                 子元素先拿到事件；拖拽过（movedRef）或不是前台卡时仍然吞掉这次点击。 */
              onClick={(e) => {
                if (movedRef.current || !front) {
                  e.stopPropagation();
                  return;
                }
                // 宽屏分栏（§2.8.2）：前台卡点开 → 右栏就地渲染详情，不跳页
                if (onPick) {
                  onPick(h);
                  return;
                }
                openHomeworkRow(h, { navigate, from: "tasks", courseName: courseLabelOf(h) });
              }}
            >
              <div className="hw-card-head">
                <div className="hw-card-course">{h.source ? h.courseName ?? courseNameOf(h.courseId) : courseNameOf(h.courseId)}</div>
                {/* 动作钮所有卡常驻（非前台仅隐藏），避免前台切换时头部重排造成字距突变 */}
                <div className={"hw-card-actions" + (front ? "" : " is-hidden")} onClick={(e) => e.stopPropagation()}>
                  <button
                    className="hw-card-act"
                    title="忽略这条作业"
                    aria-label="忽略这条作业"
                    tabIndex={front ? 0 : -1}
                    onClick={(e) => {
                      e.stopPropagation();
                      void ignoreWithConfirm(h);
                    }}
                  >
                    <IconX />
                  </button>
                  <HwRemindButton h={h} />
                  {!h.source && semesterId ? (
                    <CollectStar atom={{ kind: "assignment", key: enc(h.courseId, h.id, h.title, courseNameOf(h.courseId), semesterId) }} title="收藏作业" />
                  ) : null}
                </div>
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
      {collectAtom ? <CollectModal atom={collectAtom} onClose={() => setCollectAtom(null)} /> : null}
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

  /* D7（霖 2026-10-02）：待办页生活 tab 点新闻项**不跳页**，在本页弹详情抽屉。
     抽屉组件与新闻页共用（components/NewsDetailDrawer.tsx），取数逻辑与 NewsTab.openDetail
     一致（只少了搜索高亮缓存——待办页没有搜索框）。 */
  const [newsDetail, setNewsDetail] = useState<NewsDetailState | null>(null);
  const openNewsDetail = useCallback((item: NewsItem) => {
    if (!item.xxid) {
      if (item.url) void openExternal(item.url);
      return;
    }
    setNewsDetail({ item, state: "loading" });
    info
      .getNewsDetail(item.xxid)
      .then((d) => setNewsDetail({ item, state: "ok", data: d }))
      .catch((err: unknown) => setNewsDetail({ item, state: "error", err: explainNetworkError(err) }));
  }, []);
  const readVersion = useNoticeReadVersion(); // 通知未读口径：全站共享的本地已读覆盖
  const [courseFilter, setCourseFilter] = useState<string>(""); // "" = 全部课程
  const wide = useExpanded(); // ≥840px（§2.8.1 expanded）：学习/生活 双栏同显

  const courseMap = useMemo(() => new Map((data?.courses ?? []).map((c) => [c.id, c.name])), [data]);
  const courseNameOf = (id: string): string => courseMap.get(id) ?? "课程";
  const extHw = useMemo(() => ext.items.map(toHomework), [ext.items]);

  const flowAll = useMemo(() => {
    const live = [...(data?.homework ?? []), ...extHw]
      .filter((h) => !ignored.has(h.id) && !h.audited && !h.submitted && !h.graded);
    const withDays = live.map((h) => ({ h, d: ddlInfo(h.deadline) }));
    const notOver = withDays.filter((x) => !x.d.overdue).sort((a, b) => a.h.deadline.localeCompare(b.h.deadline));
    const over = withDays.filter((x) => x.d.overdue).sort((a, b) => a.h.deadline.localeCompare(b.h.deadline));
    return [...notOver, ...over].map((x) => x.h);
  }, [data, extHw, ignored]);

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
      { duration: 400, easing: EASE_EMPHASIZED },
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

  /* 横向滑动切换 学习/生活 tab（C7）：手势本体在 lib/useSwipeTabs.ts（touch 事件 +
     主轴判定 + touch-action: pan-y）。这里只管「按可见顺序取相邻项」——宽屏双栏同显时关掉。 */
  const swipeRef = useSwipeTabs<HTMLDivElement>({
    order: ["learn", "life"],
    current: tab,
    onChange: (next) => setTab(next as typeof tab),
    disabled: wide,
  });

  return (
    <>
      <PageHead
        title="待办"
        meta={data ? semesterText(data.semester.id) : "今天该管的事"}
        menu={[{
            key: "refresh",
            label: "刷新",
            icon: <IconRefresh width={16} height={16} />,
            disabled: state === "loading",
            onSelect: () => void reload(),
          }].filter(Boolean) as PageMenuItem[]}
      />

      {!wide ? (
        <SegmentedOverflow>
          <button role="tab" aria-selected={tab === "learn"} className={tab === "learn" ? "is-active" : ""} onClick={() => setTab("learn")}>学习</button>
          <button role="tab" aria-selected={tab === "life"} className={tab === "life" ? "is-active" : ""} onClick={() => setTab("life")}>生活</button>
        </SegmentedOverflow>
      ) : null}

      <div className={"tasks-body" + (wide ? " is-wide" : "")} ref={swipeRef}>
      <section className={"tasks-pane" + (wide || tab === "learn" ? "" : " is-hidden")}>
        <div className="tasks-pane-head">学习</div>
        {/* 元素出场（§3.6：「待办页元素错峰出场」此前延后到动效令牌落地）：
            只在这一层用一个 .stagger——筛选行 → 卡片流 → 统计/入口逐项上浮 26ms。
            不在子容器再套一层：父子同时进场会糊成一团，也不给卡片流内的卡加动画
            （那层是拖拽 transform 的地盘，动画叠上去会和手势抢属性）。 */}
        <div className="tasks-learn stagger">
          {/* 按课程检索：作业流上方，避免在几十条作业里翻找某一科 */}
          <div className="hw-filter">
            {/* C16（霖 2026-10-01 走查）：这里原来是裸 <select>（浏览器默认样式的下拉），
                统一换成全站共用的 SearchSelect（portal + fixed、圆角/描边/阴影/字号同款）。 */}
            <SearchSelect
              value={courseFilter}
              onChange={setCourseFilter}
              placeholder={`全部课程（${flowAll.length}）`}
              options={[
                { value: "", label: `全部课程（${flowAll.length}）` },
                ...flowCourses
                  .filter((c) => !c.source)
                  .map((c) => ({ value: c.key, label: `${c.label}（${c.count}）`, group: "网络学堂" })),
                ...flowExtSources.flatMap((src) =>
                  flowCourses
                    .filter((c) => c.source === src)
                    .map((c) => ({ value: c.key, label: `${c.label}（${c.count}）`, group: extHwSourceName(src) })),
                ),
              ]}
            />
            {courseFilter ? (
              <button className="hw-filter-clear" onClick={() => setCourseFilter("")}>清除</button>
            ) : null}
          </div>
          {/* 作业卡片流（拖拽实时跟手） */}
          <div className="tasks-flow-wrap">
            {state === "loading" && flow.length === 0 ? (
              <HwSkeletonCard />
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
          {/* 霖 2026-09-30 #4：汇总区与通知条此前长按没反应 —— 挂 data-ctx-atom，
              由 ContextMenuLayer 的全局兜底层给「收藏」（收「全部作业」「全部通知」页面原子） */}
          <div className="tasks-mid" data-ctx-atom='{"kind":"page","key":"learn-assignments"}' data-ctx-title="全部作业">
            <div className="tasks-stats">
              {/* 两项计数各自独立成卡（轻拟物：受光面 + 投影 + 内高光，按下内凹） */}
              <button className="task-stat" onClick={() => navigate("learn-assignments")}>
                <span className="task-stat-num" key={"n" + flow.length}>{flow.length}</span>
                <span className="task-stat-label">还剩作业</span>
              </button>
              <button className="task-stat" onClick={() => navigate("learn-assignments")}>
                <span className="task-stat-num task-stat-urgent" key={"s" + dueSoon}>{dueSoon}</span>
                <span className="task-stat-label">3 日内截止</span>
              </button>
            </div>
            <div className="tasks-entries">
              <button className="task-entry" onClick={() => navigate("learn-assignments")}>全部作业 →</button>
              <button className="task-entry" onClick={() => navigate("learn")}>进入网络学堂 →</button>
            </div>
          </div>
          {/* 课程通知提示条（不再列条目） */}
          <div className={"notice-strip" + (unread.length > 0 ? " has-unread" : "")} data-ctx-atom='{"kind":"page","key":"learn-notices"}' data-ctx-title="全部通知">
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
            <button className="task-sec-more" onClick={() => navigate("learn-notices")}>全部通知 →</button>
          </div>
        </div>
      </section>
      <section className={"tasks-pane" + (wide || tab === "life" ? "" : " is-hidden")}>
        {wide && pcSel ? (
          <>
            <div className="tasks-pane-head">
              <span>作业详情</span>
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
                  返回生活 →
                </button>
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
                  <button className="tasks-pane-close" onClick={() => toggleFull(false)}>收起 ⤡</button>
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
        <div className="tasks-pane-head">生活</div>
        <div className="tasks-life tab-anim" data-dir="prev">
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
            <NewsRows feed={news.data!} navigate={navigate} onOpen={openNewsDetail} />
      ) : (
            <Card><Empty text="新闻还在路上，稍后再来看看。" /></Card>
      )}
          <div className="task-life-note">行政类通知（报到、党团活动等）暂无稳定数据源，接入后补充到这里。</div>
        </div>
          </>
        )}
      </section>
      </div>
      {/* D7：详情抽屉挂在页面根上（组件内部 createPortal 到 body，位置只影响重渲染时机）。
          手机是底部抽屉、PC 是留 20px 边距的右侧面板；返回键先关它（E1 浮层帧）。 */}
      <NewsDetailDrawer
        detail={newsDetail}
        onClose={() => setNewsDetail(null)}
        onRetry={openNewsDetail}
      />
    </>
  );
}

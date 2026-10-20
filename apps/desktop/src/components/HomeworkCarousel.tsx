import { Btn, IconBtn } from "@onethu/gui";
import { Empty } from "./Layout.js";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { parseLearnTime, SOURCE_NAMES, type Homework } from "@onethu/core";
import { IconX } from "./Icons.js";
import { CollectStar } from "./Collect.js";
import { HwRemindButton } from "../pages/learn/shared.js";
import { openHomeworkRow } from "../lib/homeworkEntry.js";
import { CONFIRM_IGNORE_HW, confirmDanger } from "../lib/confirm.js";
import { ignoreHw } from "../state/hwIgnore.js";
import { useApp } from "../state/context.js";
import { isAndroidNavigator } from "../lib/androidHost.js";
import { enc } from "../state/atoms.js";
import { prefersReducedMotion } from "../lib/motion.js";
import { normalizeWheelDelta, takeWheelStep } from "../lib/detailSlots.js";
import { t as i18n } from "../i18n/index.js";


/** DDL 解析：剩余天数 + 色档 + 展示文案（大数字 + 日期两行） */
export function ddlInfo(deadline: string): { days: number | null; overdue: boolean; big: string; small: string; date: string; cls: string } {
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

/** Shared by the page and home widget: pending first, overdue at the end. */
export function pendingHomework(items: Homework[], ignored: { has(id: string): boolean }): Homework[] {
  return items.filter(h => !ignored.has(h.id) && !h.audited && !h.submitted && !h.graded)
    .sort((a, b) => Number(ddlInfo(a.deadline).overdue) - Number(ddlInfo(b.deadline).overdue) || a.deadline.localeCompare(b.deadline));
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

export function HwCarousel({ items, courseNameOf, courseLabelOf, semesterId, onPick, onFront, captureWheel = true }: { items: Homework[]; courseNameOf: (id: string) => string; courseLabelOf: (h: Homework) => string; semesterId?: string; onPick?: (h: Homework) => void; onFront?: (h: Homework) => void; captureWheel?: boolean }): ReactNode {
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
  const shellRef = useRef<HTMLDivElement | null>(null);
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
  const hapticPathLogged = useRef(false); // 触觉降级路径只记一次日志
  useEffect(() => {
    if (curIdx === lastTick.current) return;
    lastTick.current = curIdx;
    if (!isAndroidNavigator(navigator)) {
      try { navigator.vibrate?.(4); } catch { /* 静默 */ }
      return;
    }
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<{ ok: boolean; mode?: string }>("ui_haptic_tick"))
      .then((r) => {
        // 跨机型排查：只记一次实际路径。prebaked=各 ROM 自家标定波形（理想）；
        // waveform/legacy=该机 HAL 不认预烘焙，已降级自绘波形（手感会略弱）。
        if (r?.mode && r.mode !== "prebaked" && !hapticPathLogged.current) {
          hapticPathLogged.current = true;
          void import("../lib/clients.js")
            .then((m) => m.logLine(`[HAPTIC] 预烘焙不可用，降级路径=${r.mode}`))
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
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
    if (!captureWheel || n === 0 || e.ctrlKey || e.metaKey) return;
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
          <Btn variant="outline" onClick={() => navigate("learn-assignments")}>{i18n("auto.components.HomeworkCarousel.1")}</Btn>
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
              className={"hw-card" + (front ? " is-cur" : "")}
              style={{
                "--hw-y": yPx + "px", "--hw-scale": scale, "--hw-alpha": opacity,
                "--hw-layer": 100 - Math.round(Math.abs(yPx)), "--hw-height": (geo.step - 2) + "px",
              } as CSSProperties}
              onClickCapture={(e) => {
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
                  <IconBtn
                    className="hw-card-act"
                    label={i18n("auto.components.HomeworkCarousel.2")}
                    icon={<IconX />}
                    tabIndex={front ? 0 : -1}
                    onClick={async () => {
                      const ok = await confirmDanger(
                      `确定要忽略《${h.title}》吗？\n\n忽略后它不再出现在作业区与日程提醒中，可在「全部作业 → 已忽略」恢复。`,
                        CONFIRM_IGNORE_HW,
                      );
                      if (ok) ignoreHw(h.id, h.title);
                    }}
                  />
                  <HwRemindButton h={h} />
                  {!h.source && semesterId ? (
                    <CollectStar atom={{ kind: "assignment", key: enc(h.courseId, h.id, h.title, courseNameOf(h.courseId), semesterId) }} title={i18n("auto.components.HomeworkCarousel.3")} />
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
    </div>
  );
}


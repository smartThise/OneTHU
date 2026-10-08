/**
 * 网络学堂子页共享件 —— learnX 移植（行组件 / 学期文案 / 状态徽标 / 富文本渲染）。
 * 数据统一来自 useLearnData（state/data.ts），行点击经 app 轻路由进只读详情页。
 */
import { useEffect, useRef, useState } from "react";
import { useExitPhase } from "../../lib/useExitPhase.js";
import { stripInlineColors } from "../../lib/htmlTheme.js";
import type { CSSProperties, ReactNode } from "react";
import type { CourseFile, Homework, Notification } from "@onethu/core";
import { LEARN_PREFIX, LEARN_FILE_DOWNLOAD, parseLearnTime } from "@onethu/core";
import { useApp } from "../../state/context.js";
import { getSelectedSemester, setSelectedSemester } from "../../state/data.js";
import { backTargetOf, type Page } from "../../state/app.js";
import { downloadLearnFile, fetchImageAsDataUrl, fetchImageByUrl } from "../../lib/clients.js";
import { revealLocalPath } from "../../lib/localFile.js";
import { isAndroidNavigator } from "../../lib/androidHost.js";
import { explainNetworkError } from "../../lib/transport.js";
import { showToast } from "../../state/toast.js";
import { useContextMenu, useLongPress, type CtxItem } from "../../components/ContextMenu.js";
import { invoke } from "@tauri-apps/api/core";
import { openFilePreview } from "../../components/FilePreview.js";
import { openExternal } from "../info/openExternal.js";
import { openHomeworkRow } from "../../lib/homeworkEntry.js";
import { CONFIRM_IGNORE_HW, confirmDanger } from "../../lib/confirm.js";
import { ignoreHw, unignoreHw, useHwIgnored } from "../../state/hwIgnore.js";
import { homeworkEntryScoreText } from "../../lib/yktDetail.js";
import { Card } from "../../components/Layout.js";
import { IconBell, IconChevron, IconDownload, IconExternal, IconFolder, IconStar, IconX } from "../../components/Icons.js";
import { CollectModal } from "../../components/Collect.js";
import { useFavs } from "../../state/favs.js";
import type { AtomRef } from "../../state/favorites.js";
import { enc } from "../../state/atoms.js";
import { fmtRemindOffset, REMIND_MAX, REMIND_MIN, REMIND_PRESETS, setHwReminder, useHwDefault, useHwReminder } from "../../state/hwRemind.js";
import { extHwSourceName } from "../../state/exthw.js";

/* ---------- 深链学期挂钩 ----------
 * 深链（小OH navigate / 收藏原子）可能带 semesterId：courseId 是学期作用域的，
 * 不先切学期就在"当前学期"课程包里 find → 空白课程（2026-09-07 微积分A2 实录）。
 * 渲染期写模块级学期（无 React 状态副作用），useLearnData 的 load 随后读到新学期。 */
export function useLearnNavSemester(): void {
  const { navParams } = useApp();
  const wanted = typeof navParams?.semesterId === "string" ? navParams.semesterId : "";
  if (wanted && getSelectedSemester() !== wanted) setSelectedSemester(wanted);
}

/* ---------- 学期文案（learnX getSemesterTextFromId） ---------- */

export function semesterText(id: string): string {
  const [a, b, term] = id.split("-");
  const termText = term === "1" ? "秋季学期" : term === "2" ? "春季学期" : term === "3" ? "夏季学期" : "";
  return `${a}-${b} 学年${termText}`;
}

/* ---------- 时间/状态（解析统一走 core parseLearnTime，杜绝 NaN/Invalid Date） ---------- */

/** learn 时间串 → "YYYY-MM-DD HH:mm"；空/解析失败返回 ""（不回退 raw.slice） */
export function fmtDateTime(s: string | undefined): string {
  const d = parseLearnTime(s ?? "");
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 行组件时间列：日期 / 时:分 两段（替代对原始串的 blind slice） */
export function fmtWhenParts(s: string | undefined): { date: string; time: string } {
  const full = fmtDateTime(s);
  if (!full) return { date: "", time: "" };
  return { date: full.slice(5, 10), time: full.slice(11, 16) };
}

/** 截止倒计时（deadline 相对当前时刻，mobile AssignmentDetail 的
 *  dayjs().to(deadline) 同语义）：未来 "还剩 X 天/小时"，过去 "N 天前截止/已截止" */
export function timeLeft(deadline: string): { text: string; overdue: boolean } {
  const d = parseLearnTime(deadline);
  if (!d) return { text: "", overdue: false };
  const diff = d.getTime() - Date.now();
  if (diff <= 0) {
    const days = Math.floor(-diff / 86400000);
    return { text: days > 0 ? `${days} 天前截止` : "已截止", overdue: true };
  }
  const days = Math.floor(diff / 86400000);
  if (days >= 1) return { text: `还剩 ${days} 天`, overdue: false };
  const hours = Math.floor(diff / 3600000);
  if (hours >= 1) return { text: `还剩 ${hours} 小时`, overdue: false };
  return { text: "还剩不足 1 小时", overdue: false };
}

/** 作业状态徽标：已批改/已提交/按截止紧迫度 */
export function homeworkChip(h: Homework): { text: string; cls: string } {
  if (h.graded) return { text: "已批改", cls: "chip-blue" };
  if (h.submitted) return { text: "已提交", cls: "chip-green" };
  const { text, overdue } = timeLeft(h.deadline);
  if (overdue) return { text: text || "已截止", cls: "chip-red" };
  const dl = parseLearnTime(h.deadline);
  const days = dl ? Math.ceil((dl.getTime() - Date.now()) / 86400000) : Infinity;
  if (days <= 3) return { text: text || "未提交", cls: "chip-amber" };
  return { text: text || "未提交", cls: "chip-gray" };
}

/** 分数显示：负数为等级码（thu-learn-lib GRADE_LEVEL_MAP 精简版） */
const GRADE_LABELS: Record<string, string> = {
  "-100": "已阅", "-99": "A+", "-98": "A", "-92": "A-", "-87": "B+", "-85": "良好", "-82": "B",
  "-78": "B-", "-74": "C+", "-71": "C", "-68": "C-", "-67": "G", "-66": "D+", "-64": "D",
  "-65": "免修", "-63": "通过", "-62": "EX", "-61": "免课", "-60": "通过", "-59": "不通过",
  "-55": "W", "-51": "I", "-50": "不完整", "-31": "NA", "-30": "F",
};

export function gradeLabel(grade: string | number | undefined): string {
  if (grade === undefined || grade === "") return "";
  const n = Number(grade);
  if (Number.isNaN(n)) return String(grade);
  if (n >= 0) return String(grade);
  return GRADE_LABELS[String(n)] ?? String(grade);
}

/* ---------- 富文本（通知正文/作业说明，服务端 HTML） ---------- */

/** 1×1 透明占位：图片改写前的瞬时 src，杜绝 webview 直挂 learn 地址的碎图闪烁 */
const IMG_PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** 正文图片 dataURL 会话缓存：详情页反复进出不重复抓 2MB 级大图 */
const imgDataCache = new Map<string, string>();

/**
 * 正文里的 <img> 指向 learn 资源（需会话 Cookie），webview 直挂只会得到登录页。
 * 渲染后经应用侧 fetch_binary 抓字节转 dataURL 回填（isTauri 才可用，预览环境跳过）。
 * 抓取双路回退：learn 直连（带 _csrf）→ fetchImageByUrl（WebVPN 包装 + 双桶 Cookie）。
 */
export function RichContent({ html, fallback = "暂无内容。" }: { html?: string; fallback?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let cancelled = false;
    const done = new WeakSet<HTMLImageElement>();

    const grab = async (img: HTMLImageElement, raw: string): Promise<void> => {
      const abs = /^https?:\/\//i.test(raw) ? raw : new URL(raw, LEARN_PREFIX + "/").toString();
      img.src = IMG_PLACEHOLDER; // 插入瞬间掐断 webview 原生加载（无应用 Cookie，只会得到登录页碎图）
      try {
        const hit = imgDataCache.get(abs);
        // 三级回退（用户实锤：讨论区图片好、通知/作业碎图）：①learn 直连带
        // csrf ②按 host 分流（非公网包 webvpn；公网再试双桶 cookie 直连）
        // ③无视分流强制 webvpn 包装——learn 直连在校园网外不可达时的真终点
        const dataUrl = hit
          ?? (await fetchImageAsDataUrl(abs)
            .catch(() => fetchImageByUrl(abs))
            .catch(() => fetchImageByUrl(abs, true)));
        if (cancelled) return;
        if (!dataUrl) throw new Error("empty");
        if (imgDataCache.size > 60) imgDataCache.clear();
        imgDataCache.set(abs, dataUrl);
        img.src = dataUrl;
      } catch {
        if (!cancelled) {
          img.setAttribute("alt", (img.getAttribute("alt") ? img.getAttribute("alt") + " " : "") + "（图片加载失败）");
          img.style.opacity = "0.45";
          void invoke("log_debug", { line: `RichContent 图片抓取失败: ${abs.slice(0, 180)}` }).catch(() => undefined);
        }
      }
    };

    const run = (): void => {
      for (const img of Array.from(root.querySelectorAll("img"))) {
        if (done.has(img)) continue;
        const raw = img.getAttribute("src") ?? "";
        img.dataset.onethu = "1";
        if (!raw || /^(data|blob):/i.test(raw)) continue;
        done.add(img);
        void grab(img, raw);
      }
    };

    run();
    // React 重设 innerHTML 或异步注入新图时补抓（WeakSet 防重入）
    const mo = new MutationObserver(() => run());
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    return () => {
      cancelled = true;
      mo.disconnect();
    };
  }, [html]);

  // 正文里的 <a> 点击交给系统浏览器：Tauri webview 内 href 跳转会整页带跑、
  // target=_blank 又不生效（新闻/通知正文外链"按兵不动"的另一半根源）。
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onClick = (ev: MouseEvent): void => {
      const a = (ev.target as Element | null)?.closest?.("a[href]");
      if (!a) return;
      ev.preventDefault();
      const href = a.getAttribute("href") ?? "";
      if (!href || /^(javascript|data|blob|mailto|tel):/i.test(href)) return;
      // 相对地址按 learn 站点补全（info 新闻正文由 core 层补成 info 绝对地址，不受影响）
      let abs = href;
      if (!/^https?:\/\//i.test(href)) {
        try {
          abs = new URL(href, LEARN_PREFIX + "/").toString();
        } catch {
          return;
        }
      }
      void openExternal(abs);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [html]);

  const text = (html ?? "").replace(/<[^>]*>/g, "").trim();
  if (!text && !/<(img|table|a)\b/i.test(html ?? "")) {
    return <div className="empty">{fallback}</div>;
  }
  // 学堂正文里也带行内颜色（通知/作业正文由服务端渲染）→ 深色主题下同样会黑字，
  // 与 THUbook 同源处理：剥掉颜色声明，正文继承主题令牌（htmlTheme.stripInlineColors）
  return <div className="rich" ref={ref} dangerouslySetInnerHTML={{ __html: stripInlineColors(html ?? "") }} />;
}

/* ---------- 导航 ---------- */

export function BackButton({
  to,
  label,
  courseId,
  courseTab,
}: {
  to: Page;
  label?: string;
  courseId?: string;
  /** 三级页 → 课程详情「各回各家」：目标 tab（仅 to=learn-course 时附带） */
  courseTab?: string;
}) {
  const { navigate, back } = useApp();
  /* G1：目标与参数由 backTargetOf 算（顶栏返回键共用同一份，不再两处各写一遍） */
  const target = backTargetOf(to, label, courseId, courseTab);
  /* E1：优先退会话内导航栈——「待办 → 全部作业 → 某作业」返回应落在**全部作业**，
     而不是各页硬编码的父页；只有深链冷启动（栈里没有上一页）才回落到声明父页。 */
  return (
    <button className="btn btn-ghost" onClick={() => back(() => navigate(target.to, target.params, { replace: true }))}>
      ← {label ?? "返回"}
    </button>
  );
}

/* ---------- 行组件（与全局列表同款 .row 结构，点击进详情） ---------- */

interface RowProps {
  courseName?: string;
  from: Page;
  style?: CSSProperties;
}

/** 提醒弹层（通用）：档位 + 自定义分钟。value=null 表示未设（单作业=跟随全局）。 */
export function HwRemindPop({
  value,
  onApply,
  onDismiss,
  title,
  allowClear,
  foot,
}: {
  value: number | null;
  onApply: (m: number | null) => void;
  /** Escape 关闭（b32）：**不改变提醒值**，只是把弹层关掉。缺省=本弹层不接管 Esc
   *  （长按菜单里的提醒面板就属这种：Esc 归外层 A3 菜单的捕获期监听处理）。 */
  onDismiss?: () => void;
  title: string;
  allowClear?: boolean;
  foot?: string;
}) {
  const [custom, setCustom] = useState("");
  /* 退场相位：选档/自定义会关掉弹层（外层 onApply 里 setOpen(false)）→ 先播退场再回调。
     清除（m=null）后弹层仍然开着，走退场会淡出后卡住，因此那条路径直接应用。
     b32：Esc 走同一条退场动画，但退场动作换成 onDismiss（用 esc 标志在回调里分流，
     因为 useExitPhase 的回调是挂载时就固定的那一个）。 */
  const pending = useRef<number | null>(null);
  const esc = useRef(false);
  const [closing, requestClose] = useExitPhase(() => (esc.current ? onDismiss?.() : onApply(pending.current)));
  const apply = (m: number | null): void => {
    if (m == null) {
      onApply(null);
      return;
    }
    esc.current = false;
    pending.current = m;
    requestClose();
  };
  /* Esc 关闭：浮层要自己先吃掉 Esc（捕获阶段 + 阻断），否则页面自己的 Esc 处理会跟着跑一遍。
     与 components/ContextMenu.tsx 的 A3 菜单同款口径。 */
  useEffect(() => {
    if (!onDismiss) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      esc.current = true;
      requestClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDismiss, requestClose]);
  const applyCustom = (): void => {
    const n = Math.round(Number(custom));
    if (Number.isFinite(n) && n >= REMIND_MIN && n <= REMIND_MAX) apply(n);
  };
  return (
    <div className={"hwremind-pop" + (closing ? " is-closing" : "")} role="menu" aria-label="提醒时间">
      <div className="hwremind-pop-title">{title}</div>
      <div className="hwremind-grid">
        {REMIND_PRESETS.map((m) => (
          <button key={m} className={"chip-btn" + (value === m ? " is-on" : "")} onClick={() => apply(m)}>
            {fmtRemindOffset(m)}
          </button>
        ))}
      </div>
      <div className="hwremind-custom">
        <input
          inputMode="numeric"
          placeholder={`自定义（${REMIND_MIN}–${REMIND_MAX} 分钟）`}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && applyCustom()}
        />
        <button className="btn" disabled={!(Math.round(Number(custom)) >= REMIND_MIN && Math.round(Number(custom)) <= REMIND_MAX)} onClick={applyCustom}>
          设定
        </button>
        {allowClear && value != null ? (
          <button className="btn btn-ghost" title="清除（恢复跟随全局默认）" onClick={() => apply(null)}>
            清除
          </button>
        ) : null}
      </div>
      {foot ? <div className="hwremind-pop-foot">{foot}</div> : null}
    </div>
  );
}

/** 单作业铃铛：覆盖值（null = 跟随全局默认） */
export function HwRemindButton({ h }: { h: Homework }) {
  const cur = useHwReminder(h.id);
  const def = useHwDefault();
  const [open, setOpen] = useState(false);
  return (
    <div className="hwremind" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button
        className={"btn btn-ghost hwremind-bell" + (cur ? " is-on" : "")}
        title={cur ? `截止前 ${fmtRemindOffset(cur)} 提醒（覆盖全局默认 ${fmtRemindOffset(def)}）` : `自定义提醒（当前跟随全局默认 ${fmtRemindOffset(def)}）`}
        aria-label="设置作业提醒"
        onClick={() => setOpen((o) => !o)}
      >
        <IconBell width={14} height={14} />
        {cur ? <span className="hwremind-tag">{fmtRemindOffset(cur)}</span> : null}
      </button>
      {open ? (
        <HwRemindPop
          value={cur}
          title={`作业截止前提醒（覆盖全局默认 ${fmtRemindOffset(def)}）`}
          allowClear
          onDismiss={() => setOpen(false)}
          onApply={(m) => {
            setHwReminder(h.id, m);
            if (m != null) setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** 作业行长按菜单里的「提醒」档位面板：与卡片铃铛同一条通路（订阅当前值，不是打开时的快照） */
function RowRemindPanel({ h, close }: { h: Homework; close: () => void }): ReactNode {
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

export function HomeworkRow({ h, courseName, from, style, showGrade = false, sem }: RowProps & { h: Homework; showGrade?: boolean; sem?: string }) {
  const { navigate } = useApp();
  /* 霖 2026-09-30 #4：作业列表行此前完全没有长按菜单（只有作业卡片有）。
     与卡片同一套项：忽略 / 提醒 / 收藏（外部源没有站内收藏项，与卡片同条件）。 */
  const menu = useContextMenu();
  const [collect, setCollect] = useState<AtomRef | null>(null);
  // R21c：忽略状态。已忽略的行灰显并标「已忽略」，可在此就地恢复；忽略需二次确认
  // （弹窗写明后果）；入口在全部作业、各学科作业、搜索结果里都出现（共用本组件）。
  const isIgnored = useHwIgnored(h.id);
  // R20-B2b：行点击统一走 openHomeworkRow 三态分流（雨课堂参数齐备 → learn-ykt-detail
  // 原生详情，全平台默认原生；其余外部源 → R20-A 通道；内部作业 → 站内详情）。
  const go = () => {
    openHomeworkRow(h, { navigate, from, courseName });
  };
  const chip = homeworkChip(h);
  const toggleIgnore = async (): Promise<void> => {
    if (isIgnored) {
      unignoreHw(h.id);
      return;
    }
    const ok = await confirmDanger(
      `确定要忽略《${h.title}》吗？\n\n忽略后它不再出现在作业区与日程提醒中，也不再推送任何截止提醒——请自行留意错过截止的后果。可在「已忽略」栏中恢复。`,
      CONFIRM_IGNORE_HW,
    );
    if (ok) ignoreHw(h.id, h.title);
  };
  // 已批改直接显示成绩（thu-app learnHome「已批改 (分数)」语义）：等级码经 gradeLabel 转文字
  const gradeScore = showGrade && h.graded && h.grade !== undefined && h.grade !== "" ? gradeLabel(h.grade) : "";
  // 外部源分数（R9 考试 + R20-B3 已批改雨课堂作业同口径）：已提交且带分 → 「已批改 · 30/40」
  const examScore = homeworkEntryScoreText(h);
  const score = gradeScore || examScore;
  const lp = useLongPress((x, y) => {
    const items: CtxItem[] = [
      {
        key: "ignore",
        label: isIgnored ? "取消忽略" : "忽略",
        danger: !isIgnored,
        icon: isIgnored ? <IconStar width={14} height={14} /> : <IconX width={14} height={14} />,
        onSelect: () => void toggleIgnore(),
      },
      {
        key: "remind",
        label: "提醒",
        icon: <IconBell width={14} height={14} />,
        panel: (close) => <RowRemindPanel h={h} close={close} />,
      },
    ];
    if (!h.source) {
      items.push({
        key: "collect",
        label: "收藏",
        icon: <IconStar width={14} height={14} />,
        onSelect: () => setCollect({ kind: "assignment", key: enc(h.courseId, h.id, h.title, courseName ?? "", sem ?? "") }),
      });
    }
    menu.open({ x, y, title: h.title, items });
  });
  return (
    <div
      className={`row row-click${isIgnored ? " is-hw-ignored" : ""}`}
      style={isIgnored ? { ...style, opacity: 0.55 } : style}
      role="button"
      tabIndex={0}
      {...lp}
      onClick={go}
      onKeyDown={(e) => e.key === "Enter" && go()}
    >
      <div className="row-when">
        <b>{fmtWhenParts(h.deadline).date}</b>
        <span>{fmtWhenParts(h.deadline).time} 截止</span>
      </div>
      <div className="row-main">
        <div className="row-title">
          {h.source ? <span className="src-badge" title={h.externalProgress ? `已作答 ${h.externalProgress}` : undefined}>{extHwSourceName(h.source)}</span> : null}
          {h.kind === "exam" ? <span className="tag-exam" title="考试">考试</span> : null}
          {h.audited ? <span className="tag-audit" title="旁听课堂">旁听</span> : null}
          {h.title}
        </div>
        <div className="row-sub">{courseName ?? h.courseName ?? "课程"}</div>
      </div>
      <span className={`chip ${chip.cls}`} title={score ? `成绩：${score}` : undefined}>
        <span className="dot" />
        {score ? `${chip.text} · ${score}` : chip.text}
      </span>
      {/* R23（霖需求）：部分作答的外部作业（进行中）在截止 chip 右侧标注题级进度 */}
      {h.externalProgress && !h.submitted ? (
        <span className="chip chip-gray" title={`已完成 ${h.externalProgress} 题`}>
          已完成 {h.externalProgress} 题
        </span>
      ) : null}
      {/* DDL 提醒（作业列表页启用；行点击导航要 stopPropagation）。R10 15.3：外部作业
          的 h.id（ext:source:...）稳定可用，提醒链路只需 deadline/title，一并放开 */}
      {isIgnored ? <span className="chip chip-gray" title="已忽略：不提醒、不进作业区与日程">已忽略</span> : null}
      {/* 霖 2026-10-02：忽略/提醒/收藏这三个行内控件撤掉——它们占着标题的横向空间，而三个功能
          已经在行的长按菜单里齐了（忽略/取消忽略、提醒、收藏），要用按住这一行即可。
          只有「作业流」卡片（TasksPage 的 .hw-card）保留卡面上的这三个按钮。 */}
      {collect ? <CollectModal atom={collect} onClose={() => setCollect(null)} /> : null}
      <IconChevron className="row-caret" width={14} height={14} />
    </div>
  );
}

/** A3 / A4 行内收藏的统一入口：列表行不再内联星标，收藏进 ctx 菜单。
 *  语义与列表星标同源（都读 useFavs）：已收录 → 「取消收藏」，就地从它所在的各收藏夹移除；
 *  未收录 → 「收藏」，打开 CollectModal 选夹（与页面级「收藏」同一模型，不是一键塞默认夹）。 */
function useRowCollect(atom: AtomRef): { item: CtxItem; modal: ReactNode } {
  const favs = useFavs();
  const [open, setOpen] = useState(false);
  const folders = favs.foldersContaining(atom);
  const item: CtxItem =
    folders.length > 0
      ? {
          key: "collect",
          label: "取消收藏",
          icon: <IconStar width={14} height={14} />,
          onSelect: () => folders.forEach((id) => favs.toggleAtomIn(id, atom)),
        }
      : {
          key: "collect",
          label: "收藏",
          icon: <IconStar width={14} height={14} />,
          onSelect: () => setOpen(true),
        };
  return { item, modal: open ? <CollectModal atom={atom} onClose={() => setOpen(false)} /> : null };
}

export function NoticeRow({ n, courseName, from, style, sem }: RowProps & { n: Notification; sem?: string }) {
  const { navigate } = useApp();
  const go = () => navigate("learn-notice-detail", { courseId: n.courseId, itemId: n.id, from });
  /* A3（霖 2026-10-05）：通知行此前没有长按菜单（只有作业行有）——接上与作业行同一套矩阵。
     行内星标按 A4 的统一口径撤掉：列表项只留信息，收藏进菜单。 */
  const menu = useContextMenu();
  const collect = useRowCollect({ kind: "notice", key: enc(n.courseId, n.id, n.title, courseName ?? "", sem ?? "") });
  const lp = useLongPress((x, y) => {
    menu.open({ x, y, title: n.title, items: [collect.item] });
  });
  return (
    <div
      className="row row-click"
      style={style}
      role="button"
      tabIndex={0}
      {...lp}
      onClick={go}
      onKeyDown={(e) => e.key === "Enter" && go()}
    >
      <div className="row-when">
        <b>{fmtWhenParts(n.publishTime).date}</b>
        <span>{fmtWhenParts(n.publishTime).time}</span>
      </div>
      <div className="row-main">
        <div className="row-title">
          {n.important ? <span className="flag" title="标记为重要" /> : null}
          {n.title}
        </div>
        <div className="row-sub">
          {courseName ?? "课程"} · {n.publisher}
        </div>
      </div>
      {collect.modal}
      <IconChevron className="row-caret" width={14} height={14} />
    </div>
  );
}

/** 拼接落盘绝对路径：下载目录可能以 `/` 或 `\` 结尾（Windows 资源管理器路径） */
function joinDownloadPath(dir: string, name: string): string {
  if (!dir) return "";
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith("/") || dir.endsWith("\\") ? dir + name : dir + sep + name;
}

export function FileRow({ f, courseName, from, style, sem }: RowProps & { f: CourseFile; sem?: string }) {
  const { navigate } = useApp();
  const menu = useContextMenu();
  /* A4（霖 2026-10-05）：列表项只留信息——行内「预览」与星标撤掉，预览 / 下载 / 收藏进 ctx 菜单。 */
  const collect = useRowCollect({ kind: "file", key: enc(f.courseId, f.id, f.title, courseName ?? "", sem ?? "") });
  /** 本次会话里这条路真实落过盘的路径：Rust 侧在响应头给出真名时以真名为准，
   *  所以「在文件夹中显示」优先用它，没有才按「下载目录 + 前端文件名」推算 */
  const [savedPath, setSavedPath] = useState("");
  const go = () => navigate("learn-file-detail", { courseId: f.courseId, itemId: f.id, from });
  const preview = () =>
    openFilePreview({ name: learnFileName(f.title || `课件 ${f.id}`, f.fileType), url: LEARN_FILE_DOWNLOAD(f.id) });
  const doDownload = async (): Promise<void> => {
    try {
      const path = await downloadLearnFile(f.id, learnFileName(f.title || `课件 ${f.id}`, f.fileType));
      setSavedPath(path);
      showToast(`已下载到：${path}`);
    } catch (e) {
      showToast("下载失败：" + explainNetworkError(e));
    }
  };
  const doReveal = async (): Promise<void> => {
    try {
      let target = savedPath;
      if (!target) {
        const dir = await invoke<{ path: string; isDefault: boolean } | null>("download_directory_get");
        target = dir?.path ? joinDownloadPath(dir.path, learnFileName(f.title || `课件 ${f.id}`, f.fileType)) : "";
      }
      if (!target) {
        showToast("当前平台不支持在文件夹中显示，请先下载后用文件管理器打开");
        return;
      }
      await revealLocalPath(target);
    } catch {
      showToast("未找到已下载的文件，请先下载后重试");
    }
  };
  /* A3 长按菜单（矩阵第四行）。A4 起顺序固定为：预览 / 下载 /（在文件夹中显示）/ 收藏 ——
     前三项都是「对这个文件的操作」，收藏是原子操作，放最后，避免同一菜单里两类混排。
     三项都走既有通路：预览 = openFilePreview，下载 = downloadLearnFile（与文件详情页同一命令），
     定位 = 自写 Rust 命令 revealLocalPath。 */
  const lp = useLongPress((x, y) => {
    const items: CtxItem[] = [
      { key: "preview", label: "预览", icon: <IconExternal width={14} height={14} />, onSelect: () => preview() },
      { key: "download", label: "下载", icon: <IconDownload width={14} height={14} />, onSelect: () => void doDownload() },
    ];
    /* Android 的下载落在应用私有目录，系统文件管理器没有「定位」语义
       （与 DownloadOpenButtons 同一口径：那一端不显示，而不是显示一个点了必然失败的项） */
    if (!isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined)) {
      items.push({
        key: "reveal",
        label: "在文件夹中显示",
        icon: <IconFolder width={14} height={14} />,
        onSelect: () => void doReveal(),
      });
    }
    items.push(collect.item);
    menu.open({ x, y, title: f.title, items });
  });
  return (
    <div
      className="row row-click"
      style={style}
      role="button"
      tabIndex={0}
      {...lp}
      onClick={go}
      onKeyDown={(e) => e.key === "Enter" && go()}
    >
      <div className="row-when">
        <b>{fmtWhenParts(f.uploadTime).date}</b>
        <span>{fmtWhenParts(f.uploadTime).time}</span>
      </div>
      <div className="row-main">
        <div className="row-title">{f.title}</div>
        <div className="row-sub">{courseName ?? "课程"}</div>
      </div>
      {f.fileType ? <span className="chip chip-gray">{f.fileType.toUpperCase()}</span> : null}
      {/* 行内「预览」与星标已按 A4 撤掉（进 ctx 菜单）：行高与其它列表项一致，命中区不再被撑开 */}
      {collect.modal}
      <IconChevron className="row-caret" width={14} height={14} />
    </div>
  );
}

/* ---------- 详情区块 ---------- */

/** 落盘文件名（mobile helpers/fs downloadFile 的 `${title}.${fileType}` 同构）：
 *  title 已带同扩展名时不再追加，杜绝 "x.pdf.pdf" 双后缀 */
export function learnFileName(title: string, fileType?: string): string {
  const t = (title ?? "").trim() || "learn-file";
  const ext = (fileType ?? "").trim().replace(/^\./, "").toLowerCase();
  if (!ext || t.toLowerCase().endsWith("." + ext)) return t;
  return `${t}.${ext}`;
}

/** 详情页信息键值行（文件类型 / 大小 / 说明等） */
export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="setting-row">
      <span className="setting-title">{label}</span>
      <span className="setting-desc" style={{ marginTop: 0, textAlign: "right" }}>{value}</span>
    </div>
  );
}

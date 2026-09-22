/**
 * 网络学堂子页共享件 —— learnX 移植（行组件 / 学期文案 / 状态徽标 / 富文本渲染）。
 * 数据统一来自 useLearnData（state/data.ts），行点击经 app 轻路由进只读详情页。
 */
import { useEffect, useRef, useState } from "react";
import { stripInlineColors } from "../../lib/htmlTheme.js";
import type { CSSProperties, ReactNode } from "react";
import type { CourseFile, Homework, Notification } from "@onethu/core";
import { LEARN_PREFIX, LEARN_FILE_DOWNLOAD, parseLearnTime } from "@onethu/core";
import { useApp } from "../../state/context.js";
import { getSelectedSemester, setSelectedSemester } from "../../state/data.js";
import { topLevelPage, type Page } from "../../state/app.js";
import { fetchImageAsDataUrl, fetchImageByUrl } from "../../lib/clients.js";
import { invoke } from "@tauri-apps/api/core";
import { openFilePreview } from "../../components/FilePreview.js";
import { openExternal } from "../info/openExternal.js";
import { openHomeworkRow } from "../../lib/homeworkEntry.js";
import { CONFIRM_IGNORE_HW, confirmDanger } from "../../lib/confirm.js";
import { ignoreHw, unignoreHw, useHwIgnored } from "../../state/hwIgnore.js";
import { homeworkEntryScoreText } from "../../lib/yktDetail.js";
import { Card } from "../../components/Layout.js";
import { IconBell, IconChevron } from "../../components/Icons.js";
import { CollectStar } from "../../components/Collect.js";
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
  const { navigate } = useApp();
  // 返回课程详情必须带回 courseId，否则详情页空参渲染成白页（此前要退两次的根因）；
  // 返回一级页（learn 等）则一律不带参数，避免列表页残留上一页的导航态
  const params =
    courseId && topLevelPage(to) !== to
      ? { courseId, ...(to === "learn-course" && courseTab ? { courseTab } : {}) }
      : undefined;
  return (
    <button className="btn btn-ghost" onClick={() => navigate(to, params)}>
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
  title,
  allowClear,
  foot,
}: {
  value: number | null;
  onApply: (m: number | null) => void;
  title: string;
  allowClear?: boolean;
  foot?: string;
}) {
  const [custom, setCustom] = useState("");
  const apply = (m: number | null): void => {
    onApply(m); // 关闭弹层由外层 onApply 自己决定
  };
  const applyCustom = (): void => {
    const n = Math.round(Number(custom));
    if (Number.isFinite(n) && n >= REMIND_MIN && n <= REMIND_MAX) apply(n);
  };
  return (
    <div className="hwremind-pop" role="menu" aria-label="提醒时间">
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
function HwRemindButton({ h }: { h: Homework }) {
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
          onApply={(m) => {
            setHwReminder(h.id, m);
            if (m != null) setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

export function HomeworkRow({ h, courseName, from, style, showGrade = false, sem, remind }: RowProps & { h: Homework; showGrade?: boolean; sem?: string; remind?: boolean }) {
  const { navigate } = useApp();
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
  return (
    <div
      className={`row row-click${isIgnored ? " is-hw-ignored" : ""}`}
      style={isIgnored ? { ...style, opacity: 0.55 } : style}
      role="button"
      tabIndex={0}
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
      {/* 忽略/恢复：任何状态（未交/已交/已批）的作业都能忽略，故常驻（不随 remind 开关） */}
      <button
        className="btn btn-ghost hw-ignore-btn"
        style={{ height: 22, padding: "0 8px", fontSize: 11, flex: "none" }}
        title={isIgnored ? "恢复：重新参与提醒与显示" : "忽略：不再提醒，也不在作业区与日程显示"}
        onClick={(e) => {
          e.stopPropagation();
          void toggleIgnore();
        }}
      >
        {isIgnored ? "恢复" : "忽略"}
      </button>
      {remind && !isIgnored ? <HwRemindButton h={h} /> : null}
      {/* 列表级星标：与详情页 key 同构（courseId~id~title~课程名~学期），点进行前就能收。
          R10 15.3：外部作业复用同款拼接（courseId=ext:source、id=ext:...，稳定唯一） */}
      <CollectStar atom={{ kind: "assignment", key: enc(h.courseId, h.id, h.title, courseName ?? "", sem ?? "") }} title={h.title} />
      <IconChevron className="row-caret" width={14} height={14} />
    </div>
  );
}

export function NoticeRow({ n, courseName, from, style, sem }: RowProps & { n: Notification; sem?: string }) {
  const { navigate } = useApp();
  const go = () => navigate("learn-notice-detail", { courseId: n.courseId, itemId: n.id, from });
  return (
    <div
      className="row row-click"
      style={style}
      role="button"
      tabIndex={0}
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
      <CollectStar atom={{ kind: "notice", key: enc(n.courseId, n.id, n.title, courseName ?? "", sem ?? "") }} title={n.title} />
      <IconChevron className="row-caret" width={14} height={14} />
    </div>
  );
}

export function FileRow({ f, courseName, from, style, sem }: RowProps & { f: CourseFile; sem?: string }) {
  const { navigate } = useApp();
  const go = () => navigate("learn-file-detail", { courseId: f.courseId, itemId: f.id, from });
  const preview = () =>
    openFilePreview({ name: learnFileName(f.title || `课件 ${f.id}`, f.fileType), url: LEARN_FILE_DOWNLOAD(f.id) });
  return (
    <div
      className="row row-click"
      style={style}
      role="button"
      tabIndex={0}
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
      <button
        className="btn btn-ghost"
        style={{ flexShrink: 0, padding: "0 8px", fontSize: 12 }}
        onClick={(e) => {
          e.stopPropagation(); // 不触发行进详情
          preview();
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        预览
      </button>
      <CollectStar atom={{ kind: "file", key: enc(f.courseId, f.id, f.title, courseName ?? "", sem ?? "") }} title={f.title} />
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

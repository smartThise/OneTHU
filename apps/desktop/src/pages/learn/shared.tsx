import { t as i18n, msg as i18nMsg, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
import { Btn } from "@onethu/gui";
/**
 * 网络学堂子页共享件 —— learnX 移植（行组件 / 学期文案 / 状态徽标 / 富文本渲染）。
 * 数据统一来自 useLearnData（state/data.ts），行点击经 app 轻路由进只读详情页。
 */
import { useEffect, useRef, useState } from "react";
import { useExitPhase } from "../../lib/useExitPhase.js";
import { stripInlineColors } from "../../lib/htmlTheme.js";
import { sanitizeDisplayHtml } from "../../lib/safeHtml.js";
import type { CSSProperties, ReactNode } from "react";
import type { CourseFile, Homework, Notification } from "@onethu/core";
import { LEARN_PREFIX, LEARN_FILE_DOWNLOAD, parseLearnTime } from "@onethu/core";
import { useApp } from "../../state/context.js";
import { getSelectedSemester, setSelectedSemester } from "../../state/data.js";
import { topLevelPage, type Page } from "../../state/app.js";
import { requestSettingsTab } from "../../state/settingsMode.js";
import { fetchImageAsDataUrl, fetchImageByUrl } from "../../lib/clients.js";
import { isSessionExpiredError } from "../../lib/sessionErrors.js";
import { invoke } from "@tauri-apps/api/core";
import { openFilePreview } from "../../components/FilePreview.js";
import { openExternal } from "../info/openExternal.js";
import { openHomeworkRow } from "../../lib/homeworkEntry.js";
import { CONFIRM_IGNORE_HW, CONFIRM_IMG_RELOGIN, confirmChoice, confirmDanger } from "../../lib/confirm.js";
import { ignoreHw, unignoreHw, useHwIgnored } from "../../state/hwIgnore.js";
import { homeworkEntryScoreText } from "../../lib/yktDetail.js";
import { Card } from "../../components/Layout.js";
import { IconBell, IconChevron } from "../../components/Icons.js";
import { CollectStar } from "../../components/Collect.js";
import { enc } from "../../state/atoms.js";
import { fmtRemindOffset, REMIND_MAX, REMIND_MIN, REMIND_PRESETS, setHwReminder, useHwDefault, useHwReminder } from "../../state/hwRemind.js";
import { extHwSourceName, isExternalNoticeId } from "../../state/exthw.js";
import { vaultCatchAttr } from "../../components/vault/vaultDrag.js";

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
  const termText = term === "1" ? i18n("pages.learn.shared.c81b126c4f9f") : term === "2" ? i18n("pages.learn.shared.32618426e9ce") : term === "3" ? i18n("pages.learn.shared.841b72c0a068") : "";
  return i18n("pages.learn.shared.c8d2e6c5f573", { a: String(a), b: String(b), termText: String(termText) });
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
    return { text: days > 0 ? i18n("pages.learn.shared.a3a84f9d16fe", { days: String(days) }) : i18n("pages.learn.shared.681ed99063ed"), overdue: true };
  }
  const days = Math.floor(diff / 86400000);
  if (days >= 1) return { text: i18n("pages.learn.shared.e2c25cf4974f", { days: String(days) }), overdue: false };
  const hours = Math.floor(diff / 3600000);
  if (hours >= 1) return { text: i18n("pages.learn.shared.44b8133e76e9", { hours: String(hours) }), overdue: false };
  return { text: i18n("pages.learn.shared.a89a72eb186b"), overdue: false };
}

/** 作业状态徽标：已批改/已提交/按截止紧迫度 */
export function homeworkChip(h: Homework): { text: string; cls: string } {
  if (h.graded) return { text: i18n("pages.learn.shared.d42baf1647c8"), cls: "chip-blue" };
  if (h.submitted) return { text: i18n("pages.learn.shared.bc37a6110a07"), cls: "chip-green" };
  // TUOJ 部分作答：状态直接写成「进行中 · x/y」（而不是只给 DDL 倒计时 + 另一个进度 chip）
  if (h.externalProgress && (h.source === "tuoj" || h.source === "tuojClassic")) {
    return { text: i18n("pages.learn.shared.inProgress") + " · " + h.externalProgress, cls: "chip-amber" };
  }
  const { text, overdue } = timeLeft(h.deadline);
  if (overdue) return { text: text || i18n("pages.learn.shared.681ed99063ed"), cls: "chip-red" };
  const dl = parseLearnTime(h.deadline);
  const days = dl ? Math.ceil((dl.getTime() - Date.now()) / 86400000) : Infinity;
  if (days <= 3) return { text: text || i18n("pages.learn.shared.8032af4a590f"), cls: "chip-amber" };
  return { text: text || i18n("pages.learn.shared.8032af4a590f"), cls: "chip-gray" };
}

/** 分数显示：负数为等级码（thu-learn-lib GRADE_LEVEL_MAP 精简版） */
const GRADE_LABELS: Record<string, string> = {
  get "-100"() { return i18n("pages.learn.shared.25f4520c3f09"); }, "-99": "A+", "-98": "A", "-92": "A-", "-87": "B+", get "-85"() { return i18n("pages.learn.shared.cfea0dce5c5d"); }, "-82": "B",
  "-78": "B-", "-74": "C+", "-71": "C", "-68": "C-", "-67": "G", "-66": "D+", "-64": "D",
  get "-65"() { return i18n("pages.learn.shared.3a3d05a1e514"); }, get "-63"() { return i18n("pages.learn.shared.1e9f2561b7cf"); }, "-62": "EX", get "-61"() { return i18n("pages.learn.shared.bb791b64b227"); }, get "-60"() { return i18n("pages.learn.shared.1e9f2561b7cf"); }, get "-59"() { return i18n("pages.learn.shared.2caa51eaf305"); },
  "-55": "W", "-51": "I", get "-50"() { return i18n("pages.learn.shared.abf099167903"); }, "-31": "NA", "-30": "F",
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

/** 会话失效弹窗的去重窗口：一页往往同时挂好几张图（论坛一屏十几张），
 *  它们会一起失败——只在第一张失败时弹一次，别把用户刷屏 */
const SESSION_PROMPT_GAP_MS = 10_000;
let lastSessionPromptAt = 0;
/** 弹窗开着时不再叠加：用户还没答完，后面几张图接着失败也只算一次 */
let sessionPromptOpen = false;

/** 正文图片因登录状态失效没加载出来时的二选一弹窗（复用 lib/confirm 的**非危险档**：
 *  同款玻璃卡，但没有「不可撤销」那套红色警告——这里两个选项都是正常动作）。
 *  比一条会自己消失的中央提示更不容易被漏掉，也把「下一步做什么」直接摆到用户面前。 */
const IMG_RELOGIN_MSG = [
  "正文里的图片没能加载出来，登录状态可能已失效。",
  "重新登录后图片会自动恢复；也可以先忽略，稍后下拉刷新再试。",
].join("\n");

/** 登录态没了：数据页有错误链会提示，图片这条旁路必须自己提醒——否则用户看到的
 *  只是「几张图不显示」，推不到「该重新登录了」。true = 去重新登录，false = 忽略。 */
async function promptImagesNeedLogin(onRelogin: () => void): Promise<void> {
  const now = Date.now();
  if (sessionPromptOpen || now - lastSessionPromptAt < SESSION_PROMPT_GAP_MS) return;
  sessionPromptOpen = true;
  lastSessionPromptAt = now;
  try {
    if (await confirmChoice(IMG_RELOGIN_MSG, CONFIRM_IMG_RELOGIN)) onRelogin();
  } finally {
    sessionPromptOpen = false;
  }
}

/**
 * 正文里的 <img> 指向 learn 资源（需会话 Cookie），webview 直挂只会得到登录页。
 * 渲染后经应用侧 fetch_binary 抓字节转 dataURL 回填（isTauri 才可用，预览环境跳过）。
 * 抓取双路回退：learn 直连（带 _csrf）→ fetchImageByUrl（WebVPN 包装 + 双桶 Cookie）。
 */
export function RichContent({ html, fallback = i18n("pages.learn.shared.e617151df84b") }: { html?: string; fallback?: string }) {
  const uiLocale = useUiLocale();

  const ref = useRef<HTMLDivElement | null>(null);
  const { navigate } = useApp();

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
      } catch (e) {
        if (!cancelled) {
          const reason = e instanceof Error ? e.message : String(e);
          img.setAttribute("alt", (img.getAttribute("alt") ? img.getAttribute("alt") + " " : "") + i18n("pages.learn.shared.8f612e642106"));
          // 悬停可看原因（此前失败只剩一个半透明碎图，原因在 catch 里被丢掉）
          img.setAttribute("title", `图片加载失败：${reason.slice(0, 120)}`);
          img.style.opacity = "0.45";
          // 登录态没了：数据页有错误链会提示，图片这条旁路必须自己提醒，
          // 否则用户看到的只是「几张图不显示」，推不到「该重新登录了」。
          // 点「重新登录」→ 设置页账号区（统一认证的退出/重登都在那儿）
          if (isSessionExpiredError(e)) {
            void promptImagesNeedLogin(() => {
              requestSettingsTab(i18n("pages.learn.shared.311bb313fdec"));
              navigate("settings");
            });
          }
          void invoke("log_debug", { line: i18n("pages.learn.shared.53b11426d994", { value: String(abs.slice(0, 180)), value2: String(reason.slice(0, 120)) }) }).catch(() => undefined);
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
  // 与 THUBook 同源处理：剥掉颜色声明，正文继承主题令牌（htmlTheme.stripInlineColors）
  return <div className="rich" ref={ref} dangerouslySetInnerHTML={{ __html: sanitizeDisplayHtml(stripInlineColors(html ?? "")) }} />;
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
  const uiLocale = useUiLocale();

  const { navigate } = useApp();
  // 返回课程详情必须带回 courseId，否则详情页空参渲染成白页（此前要退两次的根因）；
  // 返回一级页（learn 等）则一律不带参数，避免列表页残留上一页的导航态
  const params =
    courseId && topLevelPage(to) !== to
      ? { courseId, ...(to === "learn-course" && courseTab ? { courseTab } : {}) }
      : undefined;
  return (
    <Btn variant="ghost" onClick={() => navigate(to, params)}>← {label ?? i18n("pages.learn.shared.572cf45ba436")}</Btn>
  );
}

/* ---------- 行组件（与全局列表同款 .row 结构，点击进详情） ---------- */

interface RowProps {
  courseName?: string;
  /** 原始课程名仅供持久化 Atom；展示译名不能写进身份键。 */
  identityCourseName?: string;
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
  const uiLocale = useUiLocale();

  const [custom, setCustom] = useState("");
  /* 退场相位：选档/自定义会关掉弹层（外层 onApply 里 setOpen(false)）→ 先播退场再回调。
     清除（m=null）后弹层仍然开着，走退场会淡出后卡住，因此那条路径直接应用。 */
  const pending = useRef<number | null>(null);
  const [closing, requestClose] = useExitPhase(() => onApply(pending.current));
  const apply = (m: number | null): void => {
    if (m == null) {
      onApply(null);
      return;
    }
    pending.current = m;
    requestClose();
  };
  const applyCustom = (): void => {
    const n = Math.round(Number(custom));
    if (Number.isFinite(n) && n >= REMIND_MIN && n <= REMIND_MAX) apply(n);
  };
  return (
    <div className={"hwremind-pop" + (closing ? " is-closing" : "")} role="menu" aria-label={i18n("pages.learn.shared.98b552661af4")}>
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
          placeholder={i18n("pages.learn.shared.b1b3e336fcd8", { REMIND_MIN: String(REMIND_MIN), REMIND_MAX: String(REMIND_MAX) })}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && applyCustom()}
        />
        <Btn variant="outline" disabled={!(Math.round(Number(custom)) >= REMIND_MIN && Math.round(Number(custom)) <= REMIND_MAX)} onClick={applyCustom}>{i18n("pages.learn.shared.f6a7a5a5030e")}</Btn>
        {allowClear && value != null ? (
          <Btn variant="ghost" titleAttr={i18n("pages.learn.shared.150ee8f52c11")} onClick={() => apply(null)}>{i18n("pages.learn.shared.bce2377283c2")}</Btn>
        ) : null}
      </div>
      {foot ? <div className="hwremind-pop-foot">{foot}</div> : null}
    </div>
  );
}

/** 单作业铃铛：覆盖值（null = 跟随全局默认） */
export function HwRemindButton({ h }: { h: Homework }) {
  const uiLocale = useUiLocale();

  const cur = useHwReminder(h.id);
  const def = useHwDefault();
  const [open, setOpen] = useState(false);
  return (
    <div className="hwremind" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Btn variant="ghost" titleAttr={cur ? i18n("pages.learn.shared.202fa214cac5", { value: String(fmtRemindOffset(cur)), value2: String(fmtRemindOffset(def)) }) : i18n("pages.learn.shared.e99956112716", { value: String(fmtRemindOffset(def)) })} aria-label={i18n("pages.learn.shared.3440d4ded272")} onClick={() => setOpen((o) => !o)}><IconBell width={14} height={14} />{cur ? <span className="hwremind-tag">{fmtRemindOffset(cur)}</span> : null}</Btn>
      {open ? (
        <HwRemindPop
          value={cur}
          title={i18n("pages.learn.shared.5e9c4866d498", { value: String(fmtRemindOffset(def)) })}
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

export function HomeworkRow({
  h,
  courseName,
  identityCourseName,
  from,
  style,
  showGrade = false,
  sem,
  remind,
  fromCourseId,
}: RowProps & {
  h: Homework;
  showGrade?: boolean;
  sem?: string;
  remind?: boolean;
  /** R29：from=learn-course 时带回课程 id（课程页合并雨课堂作业后的返回路径） */
  fromCourseId?: string;
}) {
  const uiLocale = useUiLocale();

  const { navigate } = useApp();
  // R21c：忽略状态。已忽略的行灰显并标「已忽略」，可在此就地恢复；忽略需二次确认
  // （弹窗写明后果）；入口在全部作业、各学科作业、搜索结果里都出现（共用本组件）。
  const isIgnored = useHwIgnored(h.id);
  // R20-B2b：行点击统一走 openHomeworkRow 三态分流（雨课堂参数齐备 → learn-ykt-detail
  // 原生详情，全平台默认原生；其余外部源 → R20-A 通道；内部作业 → 站内详情）。
  const go = () => {
    openHomeworkRow(h, { navigate, from, courseName, ...(fromCourseId ? { fromCourseId } : {}) });
  };
  const chip = homeworkChip(h);
  const toggleIgnore = async (): Promise<void> => {
    if (isIgnored) {
      unignoreHw(h.id);
      return;
    }
    const ok = await confirmDanger(
      i18nMsg("pages.learn.shared.c81409a22552", { title: String(h.title) }),
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
      data-vault-catch={vaultCatchAttr({ type: "atom", title: h.title, sub: courseName ?? h.courseName ?? i18n("pages.learn.shared.60db1afb4022"), atom: { kind: "assignment", key: enc(h.courseId, h.id, h.title, identityCourseName ?? courseName ?? "", sem ?? "") }, source: i18n("enum.label.aa39cac2b409") })}
      style={isIgnored ? { ...style, opacity: 0.55 } : style}
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => e.key === "Enter" && go()}
    >
      <div className="row-when">
        <b>{fmtWhenParts(h.deadline).date}</b>
        <span>{i18nRich("pages.learn.shared.8691a5ef9e5d", { time: fmtWhenParts(h.deadline).time })}</span>
      </div>
      <div className="row-main">
        <div className="row-title">
          {h.source ? <span className="src-badge" title={h.externalProgress ? i18n("pages.learn.shared.416183bc4268", { externalProgress: String(h.externalProgress) }) : undefined}>{extHwSourceName(h.source)}</span> : null}
          {h.kind === "exam" ? <span className="tag-exam" title={i18n("pages.learn.shared.d26ef0190d6c")}>{i18n("pages.learn.shared.d26ef0190d6c")}</span> : null}
          {h.kind === "quiz" ? <span className="tag-quiz" title={i18n("pages.learn.shared.quiz")}>{i18n("pages.learn.shared.quiz")}</span> : null}
          {h.audited ? <span className="tag-audit" title={i18n("pages.learn.shared.f7b18ee399fc")}>{i18n("pages.learn.shared.f8308b0b2728")}</span> : null}
          {h.title}
        </div>
        <div className="row-sub">{courseName ?? h.courseName ?? i18n("pages.learn.shared.60db1afb4022")}</div>
      </div>
      <span className={`chip ${chip.cls}`} title={score ? i18n("pages.learn.shared.ac1c4e6be9c9", { score: String(score) }) : undefined}>
        <span className="dot" />
        {score ? `${chip.text} · ${score}` : chip.text}
      </span>
      {/* R23（霖需求）：部分作答的外部作业（进行中）在截止 chip 右侧标注题级进度 */}
      {h.externalProgress && !h.submitted && h.source !== "tuoj" && h.source !== "tuojClassic" ? (
        <span className="chip chip-gray" title={i18n("pages.learn.shared.849f9c17224f", { externalProgress: String(h.externalProgress) })}>{i18nRich("pages.learn.shared.849f9c17224f", { externalProgress: h.externalProgress })}</span>
      ) : null}
      {/* DDL 提醒（作业列表页启用；行点击导航要 stopPropagation）。R10 15.3：外部作业
          的 h.id（ext:source:...）稳定可用，提醒链路只需 deadline/title，一并放开 */}
      {isIgnored ? <span className="chip chip-gray" title={i18n("pages.learn.shared.9a11869bc072")}>{i18n("pages.learn.shared.c9bb70bcaaa3")}</span> : null}
      {/* 忽略/恢复：任何状态（未交/已交/已批）的作业都能忽略，故常驻（不随 remind 开关） */}
      <Btn variant="ghost" titleAttr={isIgnored ? i18n("pages.learn.shared.6c87be20895b") : i18n("pages.learn.shared.475f7e24fc3e")} onClick={(e) => {
          e.stopPropagation();
          void toggleIgnore();
        }}>{isIgnored ? i18n("pages.learn.shared.e0534b8a4e46") : i18n("pages.learn.shared.6e90ac940752")}</Btn>
      {remind && !isIgnored ? <HwRemindButton h={h} /> : null}
      {/* 列表级星标：与详情页 key 同构（courseId~id~title~课程名~学期），点进行前就能收。
          R10 15.3：外部作业复用同款拼接（courseId=ext:source、id=ext:...，稳定唯一） */}
      <CollectStar atom={{ kind: "assignment", key: enc(h.courseId, h.id, h.title, identityCourseName ?? courseName ?? "", sem ?? "") }} title={h.title} />
      <IconChevron className="row-caret" width={14} height={14} />
    </div>
  );
}

export function NoticeRow({
  n,
  courseName,
  identityCourseName,
  from,
  style,
  sem,
  navCourseId,
}: RowProps & {
  n: Notification;
  sem?: string;
  /** 导航用的课程 id 覆盖（合并课程页进入的雨课堂公告：详情页「返回」要回网络学堂课程） */
  navCourseId?: string;
}) {
  const uiLocale = useUiLocale();

  const { navigate } = useApp();
  // R32：**所有来源的通知（含雨课堂公告）都进同一个站内详情页**——同一套 UI、同一套已读口径；
  // 雨课堂公告的正文由详情页按 id 调雨课堂链路取回后就地渲染，不打开官方页。
  const go = () => navigate("learn-notice-detail", { courseId: navCourseId ?? n.courseId, itemId: n.id, from });
  return (
    <div
      className="row row-click"
      data-vault-catch={vaultCatchAttr({ type: "atom", title: n.title, sub: (courseName ?? i18n("pages.learn.shared.60db1afb4022")) + " · " + n.publisher, atom: { kind: "notice", key: enc(n.courseId, n.id, n.title, identityCourseName ?? courseName ?? "", sem ?? "") }, source: i18n("enum.label.aa39cac2b409") })}
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
          {n.important ? <span className="flag" title={i18n("pages.learn.shared.86809a4acfcd")} /> : null}
          {n.title}
        </div>
        <div className="row-sub">
          {/* 外部公告的 publisher 已含「课程 · 雨课堂」全称（今日页没有课程名上下文），
              这里不再重复拼课程名 */}
          {isExternalNoticeId(n.id)
            ? n.publisher
            : `${courseName ?? i18n("pages.learn.shared.60db1afb4022")} · ${n.publisher}`}
        </div>
      </div>
      <CollectStar atom={{ kind: "notice", key: enc(n.courseId, n.id, n.title, identityCourseName ?? courseName ?? "", sem ?? "") }} title={n.title} />
      <IconChevron className="row-caret" width={14} height={14} />
    </div>
  );
}

export function FileRow({ f, courseName, identityCourseName, from, style, sem }: RowProps & { f: CourseFile; sem?: string }) {
  const uiLocale = useUiLocale();

  const { navigate } = useApp();
  const go = () => navigate("learn-file-detail", { courseId: f.courseId, itemId: f.id, from });
  const preview = () =>
    openFilePreview({ name: learnFileName(f.title || i18n("pages.learn.shared.2f3a2301c3d3", { id: String(f.id) }), f.fileType), url: LEARN_FILE_DOWNLOAD(f.id) });
  return (
    <div
      className="row row-click"
      data-vault-catch={vaultCatchAttr({ type: "atom", title: f.title, sub: (courseName ?? i18n("pages.learn.shared.60db1afb4022")) + i18n("pages.learn.shared.cd71d77e92a1"), atom: { kind: "file", key: enc(f.courseId, f.id, f.title, identityCourseName ?? courseName ?? "", sem ?? "") }, source: i18n("enum.label.aa39cac2b409") })}
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
        <div className="row-sub">{courseName ?? i18n("pages.learn.shared.60db1afb4022")}</div>
      </div>
      {f.fileType ? <span className="chip chip-gray">{f.fileType.toUpperCase()}</span> : null}
      <button
        className="btn btn-ghost row-preview"
        data-tx="keep"
        style={{ flexShrink: 0, padding: "0 8px", fontSize: 12 }}
        onClick={(e) => {
          e.stopPropagation(); // 不触发行进详情
          preview();
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >{i18n("pages.learn.shared.13d61fea9f17")}</button>
      <CollectStar atom={{ kind: "file", key: enc(f.courseId, f.id, f.title, identityCourseName ?? courseName ?? "", sem ?? "") }} title={f.title} />
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
  const uiLocale = useUiLocale();

  return (
    <div className="setting-row">
      <span className="setting-title">{label}</span>
      <span className="setting-desc" style={{ marginTop: 0, textAlign: "right" }}>{value}</span>
    </div>
  );
}

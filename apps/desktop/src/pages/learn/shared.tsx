/**
 * 网络学堂子页共享件 —— learnX 移植（行组件 / 学期文案 / 状态徽标 / 富文本渲染）。
 * 数据统一来自 useLearnData（state/data.ts），行点击经 app 轻路由进只读详情页。
 */
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { CourseFile, Homework, Notification } from "@onethu/core";
import { LEARN_PREFIX, LEARN_FILE_DOWNLOAD, parseLearnTime } from "@onethu/core";
import { useApp } from "../../state/context.js";
import { topLevelPage, type Page } from "../../state/app.js";
import { fetchImageAsDataUrl } from "../../lib/clients.js";
import { openFilePreview } from "../../components/FilePreview.js";
import { openExternal } from "../info/openExternal.js";
import { Card } from "../../components/Layout.js";
import { IconChevron } from "../../components/Icons.js";

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

/**
 * 正文里的 <img> 指向 learn 资源（需会话 Cookie），webview 直挂只会得到登录页。
 * 渲染后经应用侧 fetch_binary 抓字节转 dataURL 回填（isTauri 才可用，预览环境跳过）。
 */
export function RichContent({ html, fallback = "暂无内容。" }: { html?: string; fallback?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let cancelled = false;
    for (const img of Array.from(root.querySelectorAll("img"))) {
      const raw = img.getAttribute("src") ?? "";
      img.dataset.onethu = "1";
      if (!raw || /^(data|blob):/i.test(raw)) continue;
      const abs = /^https?:\/\//i.test(raw) ? raw : new URL(raw, LEARN_PREFIX + "/").toString();
      fetchImageAsDataUrl(abs)
        .then((dataUrl) => {
          if (!cancelled) img.src = dataUrl;
        })
        .catch(() => {
          if (!cancelled) {
            img.setAttribute("alt", (img.getAttribute("alt") ? img.getAttribute("alt") + " " : "") + "（图片加载失败）");
            img.style.opacity = "0.45";
          }
        });
    }
    return () => {
      cancelled = true;
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
  return <div className="rich" ref={ref} dangerouslySetInnerHTML={{ __html: html ?? "" }} />;
}

/* ---------- 导航 ---------- */

export function BackButton({ to, label, courseId }: { to: Page; label?: string; courseId?: string }) {
  const { navigate } = useApp();
  // 返回课程详情必须带回 courseId，否则详情页空参渲染成白页（此前要退两次的根因）；
  // 返回一级页（learn 等）则一律不带参数，避免列表页残留上一页的导航态
  const params = courseId && topLevelPage(to) !== to ? { courseId } : undefined;
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

export function HomeworkRow({ h, courseName, from, style }: RowProps & { h: Homework }) {
  const { navigate } = useApp();
  const go = () => navigate("learn-assignment-detail", { courseId: h.courseId, itemId: h.id, from });
  const chip = homeworkChip(h);
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
        <b>{fmtWhenParts(h.deadline).date}</b>
        <span>{fmtWhenParts(h.deadline).time} 截止</span>
      </div>
      <div className="row-main">
        <div className="row-title">{h.title}</div>
        <div className="row-sub">{courseName ?? "课程"}</div>
      </div>
      <span className={`chip ${chip.cls}`}>
        <span className="dot" />
        {chip.text}
      </span>
      <IconChevron className="row-caret" width={14} height={14} />
    </div>
  );
}

export function NoticeRow({ n, courseName, from, style }: RowProps & { n: Notification }) {
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
      <IconChevron className="row-caret" width={14} height={14} />
    </div>
  );
}

export function FileRow({ f, courseName, from, style }: RowProps & { f: CourseFile }) {
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

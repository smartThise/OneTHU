/**
 * 网络学堂子页共享件 —— learnX 移植（行组件 / 学期文案 / 状态徽标 / 富文本渲染）。
 * 数据统一来自 useLearnData（state/data.ts），行点击经 app 轻路由进只读详情页。
 */
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { CourseFile, Homework, Notification } from "@onethu/core";
import { LEARN_PREFIX, LEARN_FILE_DOWNLOAD } from "@onethu/core";
import { useApp } from "../../state/context.js";
import type { Page } from "../../state/app.js";
import { fetchImageAsDataUrl } from "../../lib/clients.js";
import { openFilePreview } from "../../components/FilePreview.js";
import { Card } from "../../components/Layout.js";
import { IconChevron } from "../../components/Icons.js";

/* ---------- 学期文案（learnX getSemesterTextFromId） ---------- */

export function semesterText(id: string): string {
  const [a, b, term] = id.split("-");
  const termText = term === "1" ? "秋季学期" : term === "2" ? "春季学期" : term === "3" ? "夏季学期" : "";
  return `${a}-${b} 学年${termText}`;
}

/* ---------- 时间/状态 ---------- */

/** "2025-09-01 10:00:00" → "2025-09-01 10:00" */
export function fmtDateTime(s: string | undefined): string {
  return (s ?? "").slice(0, 16);
}

export function timeLeft(deadline: string): { text: string; overdue: boolean } {
  const t = new Date(deadline.replace(" ", "T")).getTime();
  if (Number.isNaN(t)) return { text: "", overdue: false };
  const diff = t - Date.now();
  if (diff <= 0) {
    const days = Math.floor(-diff / 86400000);
    return { text: days > 0 ? `逾期 ${days} 天` : "已截止", overdue: true };
  }
  const days = Math.floor(diff / 86400000);
  if (days >= 1) return { text: `剩 ${days} 天`, overdue: false };
  const hours = Math.floor(diff / 3600000);
  if (hours >= 1) return { text: `剩 ${hours} 小时`, overdue: false };
  return { text: "剩不足 1 小时", overdue: false };
}

/** 作业状态徽标：已批改/已提交/按截止紧迫度 */
export function homeworkChip(h: Homework): { text: string; cls: string } {
  if (h.graded) return { text: "已批改", cls: "chip-blue" };
  if (h.submitted) return { text: "已提交", cls: "chip-green" };
  const { text, overdue } = timeLeft(h.deadline);
  if (overdue) return { text: text || "已截止", cls: "chip-red" };
  const days = Math.ceil((new Date(h.deadline.replace(" ", "T")).getTime() - Date.now()) / 86400000);
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

  const text = (html ?? "").replace(/<[^>]*>/g, "").trim();
  if (!text && !/<(img|table|a)\b/i.test(html ?? "")) {
    return <div className="empty">{fallback}</div>;
  }
  return <div className="rich" ref={ref} dangerouslySetInnerHTML={{ __html: html ?? "" }} />;
}

/* ---------- 导航 ---------- */

export function BackButton({ to, label, courseId }: { to: Page; label?: string; courseId?: string }) {
  const { navigate } = useApp();
  // 返回课程详情必须带回 courseId，否则详情页空参渲染成白页（此前要退两次的根因）
  return (
    <button className="btn btn-ghost" onClick={() => navigate(to, courseId ? { courseId } : undefined)}>
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
        <b>{h.deadline.slice(5, 10)}</b>
        <span>{h.deadline.slice(11, 16)} 截止</span>
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
        <b>{n.publishTime.slice(5, 10)}</b>
        <span>{n.publishTime.slice(11, 16)}</span>
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
    openFilePreview({ name: f.title || `课件 ${f.id}`, url: LEARN_FILE_DOWNLOAD(f.id) });
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
        <b>{f.uploadTime.slice(5, 10)}</b>
        <span>{f.uploadTime.slice(11, 16)}</span>
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

/** 详情页信息键值行（文件类型 / 大小 / 说明等） */
export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="setting-row">
      <span className="setting-title">{label}</span>
      <span className="setting-desc" style={{ marginTop: 0, textAlign: "right" }}>{value}</span>
    </div>
  );
}

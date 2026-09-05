/**
 * 全局搜索（learnX Search）：课程/作业/通知/文件相关性搜索，分节展示。
 * 打分模型：查询串按空白切词 + 中文 2-gram；字段权重 标题 10/词、正文 2/词、
 * 附件名 5/词、课程名 4/词；字段完全前缀命中该词再 ×1.5；多词全命中（AND）+20；
 * 得分 0 过滤；按得分降序、同分时间倒序；行内展示相对最高分的分数条与命中词高亮。
 */
import { useMemo, useState } from "react";
import { PageAtomStar } from "../..//components/Collect.js";
import type { ReactNode } from "react";
import { Card, Empty, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { IconChevron, IconSearch } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import { useLearnData } from "../../state/data.js";
import { homeworkChip } from "./shared.js";
import type { CourseFile, CourseInfo, Homework, Notification } from "@onethu/core";

/* ---------- 分词：空白切词 + 中文 2-gram ---------- */

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** tokens = 空白切出的完整词 ∪ 词内中文连续段（长度 ≥2）的全部二字串 */
function tokenize(raw: string): string[] {
  const tokens = new Set<string>();
  for (const word of raw.toLowerCase().split(/\s+/)) {
    if (!word) continue;
    tokens.add(word);
    let run = "";
    const flushRun = () => {
      for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2));
      run = "";
    };
    for (const ch of word) {
      if (CJK_RE.test(ch)) run += ch;
      else flushRun();
    }
    flushRun();
  }
  return [...tokens];
}

/* ---------- 打分 ---------- */

interface FieldHit {
  /** 已转小写的字段文本 */
  text: string;
  /** 权重：标题 10 / 正文 2 / 附件名 5 / 课程名 4 */
  weight: number;
}

/** 单条目得分：每词按命中字段累加权（该字段以此词开头 ×1.5），全部词命中（AND）+20 */
function scoreEntry(fields: FieldHit[], tokens: string[]): number {
  let score = 0;
  let allHit = true;
  for (const token of tokens) {
    let tokenScore = 0;
    for (const field of fields) {
      if (field.text.length > 0 && field.text.includes(token)) {
        tokenScore += field.weight * (field.text.startsWith(token) ? 1.5 : 1);
      }
    }
    if (tokenScore > 0) score += tokenScore;
    else allHit = false;
  }
  if (allHit && tokens.length >= 2) score += 20;
  return score;
}

interface ScoredRow<T> {
  item: T;
  /** 同分时间倒序用（课程无时间为 0） */
  time: number;
  score: number;
}

/** 得分 0 过滤 → 得分降序 → 时间倒序（稳定排序保留原有次序） */
function rankRows<T>(rows: ScoredRow<T>[]): ScoredRow<T>[] {
  return rows
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.time - a.time);
}

/** "2025-09-01 10:00:00" 等时间的秒级值，解析失败为 0 */
function timeOf(s: string | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s.includes(" ") ? s.replace(" ", "T") : s);
  return Number.isNaN(t) ? 0 : t;
}

/** 正文/说明为服务端 HTML，去标签并还原常见实体后参与正文匹配 */
function stripHtml(html?: string): string {
  return (html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .toLowerCase();
}

/* ---------- 展示件：分数条 / 命中词高亮 / 行 ---------- */

/** 相对最高分的比例宽度小进度条 */
function ScoreBar({ score, max }: { score: number; max: number }) {
  if (max <= 0) return null;
  const pct = Math.max(3, Math.round((score / max) * 100));
  return (
    <div
      aria-hidden
      title={`相关度 ${score}`}
      style={{ marginTop: 5, maxWidth: 280, height: 3, borderRadius: 999, background: "var(--accent-soft)", overflow: "hidden" }}
    >
      <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: "var(--accent)" }} />
    </div>
  );
}

/** 命中词高亮：<mark> 风格 span（背景 var(--accent-soft)），贪心最长匹配、自动跳过重叠 */
function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  if (!text || tokens.length === 0) return <>{text}</>;
  const lower = text.toLowerCase();
  const ordered = [...tokens].sort((a, b) => b.length - a.length);
  const nodes: ReactNode[] = [];
  let plain = "";
  let i = 0;
  let key = 0;
  const flush = () => {
    if (plain) {
      nodes.push(plain);
      plain = "";
    }
  };
  while (i < text.length) {
    let hitLen = 0;
    for (const t of ordered) {
      if (lower.startsWith(t, i)) {
        hitLen = t.length;
        break;
      }
    }
    if (hitLen > 0) {
      flush();
      nodes.push(
        <span key={key++} style={{ background: "var(--accent-soft)", borderRadius: 3 }}>
          {text.slice(i, i + hitLen)}
        </span>,
      );
      i += hitLen;
    } else {
      plain += text[i];
      i += 1;
    }
  }
  flush();
  return <>{nodes}</>;
}

function SearchCourseRow({ c, tokens, score, max, delay }: { c: CourseInfo; tokens: string[]; score: number; max: number; delay: number }) {
  const { navigate } = useApp();
  const go = () => navigate("learn-course", { courseId: c.id, from: "learn-search" });
  return (
    <div
      className="row row-click"
      role="button"
      tabIndex={0}
      style={{ animationDelay: `${delay}ms` }}
      onClick={go}
      onKeyDown={(e) => e.key === "Enter" && go()}
    >
      <div className="row-when"><b style={{ fontSize: "var(--text-sm)" }}>{c.courseNumber}</b></div>
      <div className="row-main">
        <div className="row-title"><Highlight text={c.name} tokens={tokens} /></div>
        <div className="row-sub">
          <Highlight text={c.teacherName} tokens={tokens} />
          {c.courseIndex ? ` · 班号 ${c.courseIndex}` : ""}
        </div>
        <ScoreBar score={score} max={max} />
      </div>
    </div>
  );
}

function SearchHomeworkRow({ h, courseName, tokens, score, max, delay }: { h: Homework; courseName?: string; tokens: string[]; score: number; max: number; delay: number }) {
  const { navigate } = useApp();
  const go = () => navigate("learn-assignment-detail", { courseId: h.courseId, itemId: h.id, from: "learn-search" });
  const chip = homeworkChip(h);
  return (
    <div
      className="row row-click"
      role="button"
      tabIndex={0}
      style={{ animationDelay: `${delay}ms` }}
      onClick={go}
      onKeyDown={(e) => e.key === "Enter" && go()}
    >
      <div className="row-when">
        <b>{h.deadline.slice(5, 10)}</b>
        <span>{h.deadline.slice(11, 16)} 截止</span>
      </div>
      <div className="row-main">
        <div className="row-title"><Highlight text={h.title} tokens={tokens} /></div>
        <div className="row-sub"><Highlight text={courseName ?? "课程"} tokens={tokens} /></div>
        <ScoreBar score={score} max={max} />
      </div>
      <span className={`chip ${chip.cls}`}>
        <span className="dot" />
        {chip.text}
      </span>
      <IconChevron className="row-caret" width={14} height={14} />
    </div>
  );
}

function SearchNoticeRow({ n, courseName, tokens, score, max, delay }: { n: Notification; courseName?: string; tokens: string[]; score: number; max: number; delay: number }) {
  const { navigate } = useApp();
  const go = () => navigate("learn-notice-detail", { courseId: n.courseId, itemId: n.id, from: "learn-search" });
  return (
    <div
      className="row row-click"
      role="button"
      tabIndex={0}
      style={{ animationDelay: `${delay}ms` }}
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
          <Highlight text={n.title} tokens={tokens} />
        </div>
        <div className="row-sub">
          <Highlight text={courseName ?? "课程"} tokens={tokens} />
          {" · "}
          {n.publisher}
        </div>
        <ScoreBar score={score} max={max} />
      </div>
      <IconChevron className="row-caret" width={14} height={14} />
    </div>
  );
}

function SearchFileRow({ f, courseName, tokens, score, max, delay }: { f: CourseFile; courseName?: string; tokens: string[]; score: number; max: number; delay: number }) {
  const { navigate } = useApp();
  const go = () => navigate("learn-file-detail", { courseId: f.courseId, itemId: f.id, from: "learn-search" });
  return (
    <div
      className="row row-click"
      role="button"
      tabIndex={0}
      style={{ animationDelay: `${delay}ms` }}
      onClick={go}
      onKeyDown={(e) => e.key === "Enter" && go()}
    >
      <div className="row-when">
        <b>{f.uploadTime.slice(5, 10)}</b>
        <span>{f.uploadTime.slice(11, 16)}</span>
      </div>
      <div className="row-main">
        <div className="row-title"><Highlight text={f.title} tokens={tokens} /></div>
        <div className="row-sub"><Highlight text={courseName ?? "课程"} tokens={tokens} /></div>
        <ScoreBar score={score} max={max} />
      </div>
      {f.fileType ? <span className="chip chip-gray">{f.fileType.toUpperCase()}</span> : null}
      <IconChevron className="row-caret" width={14} height={14} />
    </div>
  );
}

/* ---------- 页面 ---------- */

export function SearchPage() {
  const { navigate } = useApp();
  const { data, state } = useLearnData();
  const [q, setQ] = useState("");

  const tokens = useMemo(() => tokenize(q), [q]);

  const results = useMemo(() => {
    if (!data || tokens.length === 0) return null;
    const courseNameOf = (id: string) => (data.courses.find((c) => c.id === id)?.name ?? "").toLowerCase();

    const courses = rankRows(
      data.courses.map((c) => ({
        item: c,
        time: 0,
        score: scoreEntry(
          [
            { text: c.name.toLowerCase(), weight: 4 }, // 课程名
            { text: c.englishName.toLowerCase(), weight: 4 },
            { text: c.courseNumber.toLowerCase(), weight: 4 },
            { text: c.teacherName.toLowerCase(), weight: 4 },
          ],
          tokens,
        ),
      })),
    );
    const homework = rankRows(
      data.homework.map((h) => ({
        item: h,
        time: timeOf(h.publishTime),
        score: scoreEntry(
          [
            { text: h.title.toLowerCase(), weight: 10 }, // 标题
            { text: stripHtml(h.content), weight: 2 }, // 正文
            { text: courseNameOf(h.courseId), weight: 4 }, // 课程名
          ],
          tokens,
        ),
      })),
    );
    const notifications = rankRows(
      data.notifications.map((n) => ({
        item: n,
        time: timeOf(n.publishTime),
        score: scoreEntry(
          [
            { text: n.title.toLowerCase(), weight: 10 }, // 标题
            { text: stripHtml(n.content), weight: 2 }, // 正文
            { text: (n.attachmentName ?? "").toLowerCase(), weight: 5 }, // 附件名
            { text: courseNameOf(n.courseId), weight: 4 }, // 课程名
          ],
          tokens,
        ),
      })),
    );
    const files = rankRows(
      data.files.map((f) => ({
        item: f,
        time: timeOf(f.uploadTime),
        score: scoreEntry(
          [
            { text: f.title.toLowerCase(), weight: 10 }, // 标题（文件名）
            { text: (f.description ?? "").toLowerCase(), weight: 2 }, // 正文/说明
            { text: (f.fileType ?? "").toLowerCase(), weight: 5 }, // 附件类型名
            { text: courseNameOf(f.courseId), weight: 4 }, // 课程名
          ],
          tokens,
        ),
      })),
    );

    const maxScore = Math.max(
      0,
      ...[...courses, ...homework, ...notifications, ...files].map((r) => r.score),
    );
    return { courses, homework, notifications, files, maxScore };
  }, [data, tokens]);

  const byCourse = useMemo(
    () => new Map((data?.courses ?? []).map((c) => [c.id, c.name])),
    [data],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>搜索</h1>
          <div className="page-head-meta">课程 / 作业 / 通知 / 文件的相关性搜索（标题 · 正文 · 附件 · 课程名）</div>
        </div>
        <div className="page-head-actions">
          <PageAtomStar atomKey="learn-search" title="网络学堂搜索" />
          <button className="btn btn-ghost" onClick={() => navigate("learn")}>← 返回</button>
        </div>
      </div>

      <div className="search-box">
        <IconSearch width={15} height={15} />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="输入关键词，如“实验”“考试”“讲义”…"
          aria-label="搜索关键词"
        />
        {q ? (
          <button className="btn btn-ghost" onClick={() => setQ("")}>清除</button>
        ) : null}
      </div>

      {state === "loading" && !data ? (
        <SkeletonRows rows={5} />
      ) : !results ? (
        <Card><Empty text="输入关键词开始搜索。" /></Card>
      ) : results.courses.length + results.homework.length + results.notifications.length + results.files.length === 0 ? (
        <Card><Empty text={`没有与“${q.trim()}”相关的内容。`} /></Card>
      ) : (
        <>
          {results.courses.length > 0 ? (
            <>
              <SectionHead title="课程" aside={`${results.courses.length} 门`} />
              <Card className="list">
                {results.courses.map((r, i) => (
                  <SearchCourseRow
                    key={r.item.id}
                    c={r.item}
                    tokens={tokens}
                    score={r.score}
                    max={results.maxScore}
                    delay={i * 25}
                  />
                ))}
              </Card>
            </>
          ) : null}

          {results.homework.length > 0 ? (
            <>
              <SectionHead title="作业" aside={`${results.homework.length} 条`} />
              <Card className="list">
                {results.homework.map((r, i) => (
                  <SearchHomeworkRow
                    key={`${r.item.courseId}-${r.item.id}`}
                    h={r.item}
                    courseName={byCourse.get(r.item.courseId)}
                    tokens={tokens}
                    score={r.score}
                    max={results.maxScore}
                    delay={i * 25}
                  />
                ))}
              </Card>
            </>
          ) : null}

          {results.notifications.length > 0 ? (
            <>
              <SectionHead title="通知" aside={`${results.notifications.length} 条`} />
              <Card className="list">
                {results.notifications.map((r, i) => (
                  <SearchNoticeRow
                    key={`${r.item.courseId}-${r.item.id}`}
                    n={r.item}
                    courseName={byCourse.get(r.item.courseId)}
                    tokens={tokens}
                    score={r.score}
                    max={results.maxScore}
                    delay={i * 25}
                  />
                ))}
              </Card>
            </>
          ) : null}

          {results.files.length > 0 ? (
            <>
              <SectionHead title="文件" aside={`${results.files.length} 个`} />
              <Card className="list">
                {results.files.map((r, i) => (
                  <SearchFileRow
                    key={`${r.item.courseId}-${r.item.id}`}
                    f={r.item}
                    courseName={byCourse.get(r.item.courseId)}
                    tokens={tokens}
                    score={r.score}
                    max={results.maxScore}
                    delay={i * 25}
                  />
                ))}
              </Card>
            </>
          ) : null}
        </>
      )}
    </>
  );
}

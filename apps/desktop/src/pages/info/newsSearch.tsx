/**
 * 新闻本地检索辅助（SearchPage.tsx 打分思路的新闻版）+ 订阅持久化。
 * 打分模型：查询串按空白切词 + 中文 2-gram；字段权重 标题 10/词、来源 4/词、
 * 正文摘要 2/词；字段以该词开头 ×1.5；多词全命中（AND）+20；得分 0 过滤，
 * 得分降序、同分时间倒序。服务端 searchNews 可用时优先服务端结果，本地打分兜底。
 */
import type { ReactNode } from "react";
import type { NewsItem } from "@onethu/core";

/* ---------- 分词：空白切词 + 中文 2-gram（learn/SearchPage 同款） ---------- */

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** tokens = 空白切出的完整词 ∪ 词内中文连续段（长度 ≥2）的全部二字串 */
export function tokenize(raw: string): string[] {
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
  /** 权重：标题 10 / 来源 4 / 正文摘要 2 */
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

/** "2025-09-01 10:00:00" 等时间的秒级值，解析失败为 0 */
function timeOf(s: string | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s.includes(" ") ? s.replace(" ", "T") : s);
  return Number.isNaN(t) ? 0 : t;
}

export interface ScoredNews {
  item: NewsItem;
  score: number;
}

/**
 * 本地相关性排序：标题 10 / 来源 4 / 正文摘要 2（bodyTextOf 由调用方提供——
 * 正文摘要仅在站内预览过才可得，未预览为空串）。得分 0 过滤。
 */
export function rankNews(
  items: NewsItem[],
  tokens: string[],
  bodyTextOf: (item: NewsItem) => string,
): ScoredNews[] {
  if (tokens.length === 0) return [];
  return items
    .map((item) => ({
      item,
      score: scoreEntry(
        [
          { text: item.name.toLowerCase(), weight: 10 },
          { text: (item.source ?? "").toLowerCase(), weight: 4 },
          { text: bodyTextOf(item).toLowerCase(), weight: 2 },
        ],
        tokens,
      ),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || timeOf(b.item.date) - timeOf(a.item.date));
}

/** 时间倒序（订阅动态聚合用；解析失败视为最旧） */
export function byDateDesc(a: NewsItem, b: NewsItem): number {
  return timeOf(b.date) - timeOf(a.date);
}

/* ---------- 命中词高亮（SearchPage Highlight 同款：贪心最长匹配、跳过重叠） ---------- */

export function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
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

/* ---------- 订阅持久化：localStorage onethu.news.subs = 来源名（string[]） ---------- */

const SUBS_KEY = "onethu.news.subs";

/** 读取订阅来源名列表（坏值/隐私模式静默回空；去重去空白） */
export function readSubs(): string[] {
  try {
    const raw = localStorage.getItem(SUBS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return [
      ...new Set(
        arr
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim()),
      ),
    ];
  } catch {
    return [];
  }
}

/** 写回订阅（容量/隐私模式写入失败容忍） */
export function writeSubs(subs: string[]): void {
  try {
    localStorage.setItem(SUBS_KEY, JSON.stringify(subs));
  } catch {
    /* ignore */
  }
}

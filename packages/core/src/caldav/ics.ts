/**
 * ICS (iCalendar RFC 5545) 最小编解码器 —— OneTHU 日程云同步专用。
 *
 * 设计边界（有意为之，不追求全库）：
 * - 只解 VEVENT（VTODO/VJOURNAL 忽略）；时区支持 TZID（Intl 任意时区换算）/
 *   UTC(Z)/浮动（按 Asia/Shanghai，校园场景固定时区无 DST，换算确定性最好）。
 * - 服务端（Coremail）会规范化内容：注入 VTIMEZONE、METHOD:PUBLISH ——
 *   回读解析必须容忍任意属性顺序与未知属性。
 * - 序列化永远输出 TZID=Asia/Shanghai + 自带 VTIMEZONE 块（兼容 iOS/系统日历），
 *   换行 CRLF、75 字节折行（不切断多字节）、文本转义，否则服务器/客户端会拒收。
 * - 重复规则展开支持 WEEKLY(BYDAY/INTERVAL/UNTIL/COUNT)/DAILY/MONTHLY + EXDATE
 *   + RECURRENCE-ID 覆盖实例去重 —— 覆盖课表导出(RRULE WEEKLY)与常规日程展示。
 */

export const ONETHU_PRODID = "-//OneTHU//Calendar 0.9//CN";
export const CAMPUS_TZ = "Asia/Shanghai";

/* ---------------- 类型 ---------------- */

export interface IcsRrule {
  freq: "WEEKLY" | "DAILY" | "MONTHLY";
  /** 每 interval 个周期一次（双周=2） */
  interval: number;
  /** WEEKLY 生效：星期几（MO..SU）；缺省=DTSTART 当天 */
  byDay?: string[];
  /** 截止（含当天），epoch ms */
  until?: number;
  /** 总场数（含首场） */
  count?: number;
}

export interface IcsEvent {
  uid: string;
  summary: string;
  location?: string;
  description?: string;
  /** epoch ms（精确时刻） */
  start: number;
  end: number;
  allDay?: boolean;
  rrule?: IcsRrule;
  /** 单场修改实例的原时刻（该 UID 主事件的展开会跳过它） */
  recurrenceId?: number;
  /** 排除场（epoch ms 集合） */
  exdates?: number[];
  categories?: string[];
  /** 提前提醒分钟数（序列化为 VALARM/TRIGGER -PTnM；云/本地事件通用） */
  alarmMinutes?: number;
  /** OneTHU 私有来源标记（X-ONETHU-SRC：course/manual/…） */
  onethuSource?: string;
  /** 用户在编辑器里勾了「在桌面小组件显示」（X-ONETHU-WIDGET:1）：该日程进桌面小组件的
   *  「今天」卡片，行与 DDL 同款（见 apps/desktop/src/state/widgetSnapshot.ts）。
   *  缺省 = 不进（保持既有行为：自定义日程原本不上小组件）。 */
  onethuWidget?: boolean;
  /** 手动补充课程：选中的教学周（X-ONETHU-WEEKS，形如 1-8,10-16）。
   *  这是「哪些周上课」的事实源，RRULE/EXDATE 由它派生（见 caldav/courseWeeks.ts）。 */
  onethuWeeks?: number[];
  /** 手动补充课程：起止节次（X-ONETHU-PERIOD，形如 3-4）。网格按真实时刻摆放，
   *  节次只服务表单回填与「第 3-4 节」展示。 */
  onethuPeriod?: { start: number; end: number };
  lastModified?: number;
  /* ---- 服务端伴随字段（parseIcsWithMeta 注入，非 ICS 内容） ---- */
  href?: string;
  etag?: string;
}

export interface IcsOccurrence {
  uid: string;
  start: number;
  end: number;
  /** 是否为单场覆盖实例（RECURRENCE-ID） */
  override: boolean;
  summary: string;
  location?: string;
  description?: string;
  allDay?: boolean;
  categories?: string[];
  onethuSource?: string;
  alarmMinutes?: number;
}

/* ---------------- 时区换算（Intl，任意 IANA 时区） ---------------- */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function tzFmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface WallTime { y: number; mo: number; d: number; h: number; mi: number; s: number; }

/** epoch → 指定时区的墙钟（展示/序列化用） */
export function epochToWall(tz: string, ms: number): WallTime {
  const parts = tzFmt(tz).formatToParts(new Date(ms));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/** 指定时区的墙钟 → epoch（两轮逼近，DST 边界安全） */
export function wallToEpoch(tz: string, w: WallTime): number {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  const offset = (ms: number): number => {
    const t = epochToWall(tz, ms);
    return Date.UTC(t.y, t.mo - 1, t.d, t.h, t.mi, t.s) - ms;
  };
  let ms = guess - offset(guess);
  ms = guess - offset(ms);
  return ms;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
export function fmtDateTimeLocal(w: WallTime): string {
  return `${pad(w.y, 4)}${pad(w.mo)}${pad(w.d)}T${pad(w.h)}${pad(w.mi)}${pad(w.s)}`;
}
export function fmtDateLocal(w: WallTime): string {
  return `${pad(w.y, 4)}${pad(w.mo)}${pad(w.d)}`;
}
export function fmtDateTimeUtc(ms: number): string {
  return `${new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
}

/* ---------------- 文本转义（RFC5545 §3.3.11） ---------------- */

export function escapeText(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}
export function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_match, escaped: string) => /[nN]/.test(escaped) ? "\n" : escaped);
}

/* ---------------- 折行（≤75 字节，不切多字节） ---------------- */

export function foldLine(line: string): string[] {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return [line];
  const out: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let cut = Math.min(start + limit, bytes.length);
    // 不切断 UTF-8 多字节序列：回退到 ASCII 边界（<0x80 或 >=0xC0）
    while (cut > start && cut < bytes.length && (bytes[cut]! & 0xc0) === 0x80) cut--;
    out.push(new TextDecoder().decode(bytes.subarray(start, cut)));
    start = cut;
    limit = 74; // 后续行首有 1 个空格
  }
  return out;
}

/* ---------------- 解析 ---------------- */

interface RawProp { name: string; params: Record<string, string>; value: string; }

/** 展开折行 → 属性行（CRLF/CR/LF 归一） */
function unfold(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    if ((line[0] === " " || line[0] === "\t") && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseProp(line: string): RawProp | null {
  const colon = line.indexOf(":");
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segs = head.split(";");
  const name = (segs.shift() ?? "").toUpperCase();
  const params: Record<string, string> = {};
  for (const s of segs) {
    const eq = s.indexOf("=");
    if (eq > 0) params[s.slice(0, eq).toUpperCase()] = s.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

/** DTSTART/DTEND/EXDATE 值解析 */
function parseDateValue(value: string, params: Record<string, string>): { ms: number; allDay: boolean } | null {
  const v = value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) {
    // 全天：浮动语义按校园时区的当日零点
    return { ms: wallToEpoch(params.TZID || CAMPUS_TZ, { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: 0, mi: 0, s: 0 }), allDay: true };
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const w = { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: +m[4]!, mi: +m[5]!, s: +m[6]! };
  if (m[7] === "Z") return { ms: Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s), allDay: false };
  return { ms: wallToEpoch(params.TZID || CAMPUS_TZ, w), allDay: false };
}

function parseRrule(value: string): IcsRrule | undefined {
  const rule: IcsRrule = { freq: "WEEKLY", interval: 1 };
  let freq = "WEEKLY";
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).toUpperCase();
    const v = part.slice(eq + 1);
    if (k === "FREQ") freq = v.toUpperCase();
    else if (k === "INTERVAL") { const n = parseInt(v, 10); if (n > 0) rule.interval = n; }
    else if (k === "BYDAY") rule.byDay = v.toUpperCase().split(",").map((s) => s.replace(/[^A-Z]/g, "")).filter(Boolean);
    else if (k === "UNTIL") {
      const p = parseDateValue(v, {});
      if (p) rule.until = p.ms + (v.length === 8 ? 86_399_000 : 0); // 全天 UNTIL 含当天全天
    } else if (k === "COUNT") { const n = parseInt(v, 10); if (n > 0) rule.count = n; }
  }
  if (freq !== "WEEKLY" && freq !== "DAILY" && freq !== "MONTHLY") return undefined;
  rule.freq = freq;
  return rule;
}

const WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]; // getUTCDay 索引

const WEEK_MAX = 99;

/** 周号规范化：去重、升序、只留 1..max（非法值丢弃） */
export function normalizeWeeks(weeks: readonly number[], max = WEEK_MAX): number[] {
  const set = new Set<number>();
  for (const w of weeks) {
    const n = Math.round(Number(w));
    if (Number.isFinite(n) && n >= 1 && n <= max) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** 周号清单解析：吃 "1,3,5-9" / "1 3 5" / 全角逗号与波浪号；坏片段丢弃不报错 */
export function parseWeekList(value: string, max = WEEK_MAX): number[] {
  const raw: number[] = [];
  for (const seg of value.split(/[,，;；\s]+/)) {
    if (!seg) continue;
    const range = /^(\d{1,3})\s*[-~–—]\s*(\d{1,3})$/.exec(seg);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a <= b) for (let i = a; i <= b; i++) raw.push(i);
      continue;
    }
    if (/^\d{1,3}$/.test(seg)) raw.push(Number(seg));
  }
  return normalizeWeeks(raw, max);
}

/** 周号清单序列化：升序 + 连续段压成区间（1-8,10-16）——手写/外部编辑时一眼能读 */
export function formatWeekList(weeks: readonly number[], max = WEEK_MAX): string {
  const list = normalizeWeeks(weeks, max);
  const parts: string[] = [];
  let i = 0;
  while (i < list.length) {
    const from = list[i]!;
    let to = from;
    while (i + 1 < list.length && list[i + 1] === to + 1) {
      i++;
      to = list[i]!;
    }
    parts.push(from === to ? String(from) : `${from}-${to}`);
    i++;
  }
  return parts.join(",");
}

/** 节次区间解析："3-4" / "3" / "3~4" → {start,end}；坏值或倒序返回 null */
export function parsePeriod(value: string): { start: number; end: number } | null {
  const m = /^(\d{1,2})\s*(?:[-~–—]\s*(\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  if (start < 1 || end < start) return null;
  return { start, end };
}

/** 解析 VCALENDAR 文本 → 事件列表（未知属性忽略，坏事件跳过不炸整体） */
export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;
  let inAlarm = false;
  for (const line of unfold(text)) {
    const prop = parseProp(line);
    if (!prop) continue;
    const { name, params, value } = prop;
    if (name === "BEGIN" && value.trim().toUpperCase() === "VEVENT") {
      cur = { uid: "", summary: "", start: 0, end: 0 };
      inAlarm = false;
      continue;
    }
    if (name === "BEGIN" && value.trim().toUpperCase() === "VALARM") {
      inAlarm = true;
      continue;
    }
    if (name === "END" && value.trim().toUpperCase() === "VALARM") {
      inAlarm = false;
      continue;
    }
    if (name === "END" && value.trim().toUpperCase() === "VEVENT") {
      if (cur && cur.uid && cur.start !== undefined) {
        if (cur.end === undefined || cur.end < cur.start) cur.end = cur.start + (cur.allDay ? 86_400_000 : 0);
        events.push(cur as IcsEvent);
      }
      cur = null;
      inAlarm = false;
      continue;
    }
    if (!cur) continue;
    if (inAlarm) {
      // TRIGGER:-PT120M → 事件开始前 120 分钟提醒（只认 DISPLAY 提前量）
      if (name === "TRIGGER") {
        const m = /^-PT(\d+)M$/.exec(value.trim());
        if (m?.[1]) cur.alarmMinutes = Number(m[1]);
      }
      continue;
    }
    switch (name) {
      case "UID": cur.uid = value.trim(); break;
      case "SUMMARY": cur.summary = unescapeText(value); break;
      case "LOCATION": cur.location = unescapeText(value); break;
      case "DESCRIPTION": cur.description = unescapeText(value); break;
      case "DTSTART": { const p = parseDateValue(value, params); if (p) { cur.start = p.ms; cur.allDay = p.allDay; } break; }
      case "DTEND": { const p = parseDateValue(value, params); if (p) cur.end = p.ms; break; }
      case "RRULE": cur.rrule = parseRrule(value); break;
      case "RECURRENCE-ID": { const p = parseDateValue(value, params); if (p) cur.recurrenceId = p.ms; break; }
      case "EXDATE": {
        for (const v of value.split(",")) {
          const p = parseDateValue(v, params);
          if (p) (cur.exdates ??= []).push(p.ms);
        }
        break;
      }
      case "CATEGORIES": cur.categories = value.split(",").map((s) => unescapeText(s.trim())).filter(Boolean); break;
      case "X-ONETHU-SRC": cur.onethuSource = value.trim(); break;
      case "X-ONETHU-WIDGET": cur.onethuWidget = /^(1|true)$/i.test(value.trim()); break;
      case "X-ONETHU-WEEKS": cur.onethuWeeks = parseWeekList(value); break;
      case "X-ONETHU-PERIOD": { const p = parsePeriod(value); if (p) cur.onethuPeriod = p; break; }
      case "LAST-MODIFIED": { const p = parseDateValue(value, params); if (p) cur.lastModified = p.ms; break; }
      default: break;
    }
  }
  return events;
}

/* ---------------- 序列化 ---------------- */

function prop(name: string, params: string, value: string): string[] {
  const head = params ? `${name};${params}` : name;
  return foldLine(`${head}:${value}`).map((line, index) => index ? ` ${line}` : line);
}

/** 单个 VEVENT 块（不含 VCALENDAR 外壳） */
export function serializeEvent(ev: IcsEvent, nowMs = Date.now()): string[] {
  const lines: string[] = [];
  lines.push(...prop("BEGIN", "", "VEVENT"));
  lines.push(...prop("UID", "", ev.uid));
  lines.push(...prop("DTSTAMP", "", fmtDateTimeUtc(nowMs)));
  if (ev.allDay) {
    lines.push(...prop("DTSTART", "VALUE=DATE", fmtDateLocal(epochToWall(CAMPUS_TZ, ev.start))));
    lines.push(...prop("DTEND", "VALUE=DATE", fmtDateLocal(epochToWall(CAMPUS_TZ, ev.end))));
  } else {
    lines.push(...prop("DTSTART", `TZID=${CAMPUS_TZ}`, fmtDateTimeLocal(epochToWall(CAMPUS_TZ, ev.start))));
    lines.push(...prop("DTEND", `TZID=${CAMPUS_TZ}`, fmtDateTimeLocal(epochToWall(CAMPUS_TZ, ev.end))));
  }
  lines.push(...prop("SUMMARY", "", escapeText(ev.summary || "(无标题)")));
  if (ev.location) lines.push(...prop("LOCATION", "", escapeText(ev.location)));
  if (ev.description) lines.push(...prop("DESCRIPTION", "", escapeText(ev.description)));
  if (ev.rrule) {
    const r = ev.rrule;
    const segs = [`FREQ=${r.freq}`];
    if (r.interval > 1) segs.push(`INTERVAL=${r.interval}`);
    if (r.byDay?.length) segs.push(`BYDAY=${r.byDay.join(",")}`);
    if (r.until) segs.push(`UNTIL=${fmtDateTimeUtc(r.until)}`);
    if (r.count) segs.push(`COUNT=${r.count}`);
    lines.push(...prop("RRULE", "", segs.join(";")));
  }
  const recurrenceValue = (ms: number): string => ev.allDay ? fmtDateLocal(epochToWall(CAMPUS_TZ, ms)) : fmtDateTimeLocal(epochToWall(CAMPUS_TZ, ms));
  const recurrenceParams = ev.allDay ? "VALUE=DATE" : `TZID=${CAMPUS_TZ}`;
  if (ev.recurrenceId !== undefined) lines.push(...prop("RECURRENCE-ID", recurrenceParams, recurrenceValue(ev.recurrenceId)));
  if (ev.exdates?.length) lines.push(...prop("EXDATE", recurrenceParams, ev.exdates.map(recurrenceValue).join(",")));
  if (ev.categories?.length) lines.push(...prop("CATEGORIES", "", ev.categories.map(escapeText).join(",")));
  if (ev.onethuSource) lines.push(...prop("X-ONETHU-SRC", "", ev.onethuSource));
  if (ev.onethuWidget) lines.push(...prop("X-ONETHU-WIDGET", "", "1"));
  if (ev.onethuWeeks?.length) lines.push(...prop("X-ONETHU-WEEKS", "", formatWeekList(ev.onethuWeeks)));
  if (ev.onethuPeriod) lines.push(...prop("X-ONETHU-PERIOD", "", `${ev.onethuPeriod.start}-${ev.onethuPeriod.end}`));
  if (ev.lastModified) lines.push(...prop("LAST-MODIFIED", "", fmtDateTimeUtc(ev.lastModified)));
  if (ev.alarmMinutes && ev.alarmMinutes > 0) {
    lines.push(...prop("BEGIN", "", "VALARM"));
    lines.push(...prop("ACTION", "", "DISPLAY"));
    lines.push(...prop("DESCRIPTION", "", escapeText(ev.summary || "提醒")));
    lines.push(...prop("TRIGGER", "", `-PT${Math.round(ev.alarmMinutes)}M`));
    lines.push(...prop("END", "", "VALARM"));
  }
  lines.push(...prop("END", "", "VEVENT"));
  return lines;
}

const VTIMEZONE_SHANGHAI = [
  "BEGIN:VTIMEZONE",
  "TZID:Asia/Shanghai",
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "TZOFFSETFROM:+0800",
  "TZOFFSETTO:+0800",
  "TZNAME:CST",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** 完整 VCALENDAR 文本（CRLF 行尾） */
export function serializeCalendar(events: IcsEvent[], nowMs = Date.now()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${ONETHU_PRODID}`, "CALSCALE:GREGORIAN", ...VTIMEZONE_SHANGHAI];
  for (const ev of events) lines.push(...serializeEvent(ev, nowMs));
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/* ---------------- 重复规则展开 ---------------- */

/** 周一=0..周日=6（本地校园时区语义） */
function weekdayIndex(ms: number): number {
  const w = epochToWall(CAMPUS_TZ, ms);
  const utc = new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay();
  return (utc + 6) % 7;
}
function dayStartMs(ms: number): number {
  const w = epochToWall(CAMPUS_TZ, ms);
  return wallToEpoch(CAMPUS_TZ, { y: w.y, mo: w.mo, d: w.d, h: 0, mi: 0, s: 0 });
}
const DAY_MS = 86_400_000;

/**
 * 展开单个事件在 [fromMs, toMs] 内的出现。
 * 双周课（INTERVAL=2）以 DTSTART 所在周为锚定周（周一为一周之始，WKST=MO 默认）。
 */
export function expandEvent(ev: IcsEvent, fromMs: number, toMs: number, overrides: Set<number> = new Set()): IcsOccurrence[] {
  const duration = Math.max(0, ev.end - ev.start);
  const mk = (start: number, override = false): IcsOccurrence => ({
    uid: ev.uid, start, end: start + duration, override,
    summary: ev.summary, location: ev.location, description: ev.description,
    allDay: ev.allDay, categories: ev.categories, onethuSource: ev.onethuSource, alarmMinutes: ev.alarmMinutes,
  });
  if (!ev.rrule) {
    if (ev.start <= toMs && ev.end >= fromMs) return [mk(ev.start)];
    return [];
  }
  const r = ev.rrule;
  const interval = Math.max(1, r.interval || 1); // 防御：调用方省略 interval 时按 1
  const firstDay = dayStartMs(ev.start);
  const timeOfDay = ev.start - firstDay;
  const exset = new Set((ev.exdates ?? []).map((m) => dayStartMs(m)));
  const out: IcsOccurrence[] = [];
  let count = 0;
  const anchorWeek = dayStartMs(firstDay - weekdayIndex(firstDay) * DAY_MS);
  for (let day = firstDay; day <= toMs + DAY_MS; day += DAY_MS) {
    if (r.until !== undefined && day > r.until) break;
    let hit = false;
    if (r.freq === "WEEKLY") {
      const wd = WD[(weekdayIndex(day) + 1) % 7]!; // WD[0]=SU：周一=0 → WD[1]=MO
      const byDays = r.byDay?.length ? r.byDay : [WD[(weekdayIndex(firstDay) + 1) % 7]!];
      if (byDays.includes(wd)) {
        const weekStart = dayStartMs(day - weekdayIndex(day) * DAY_MS);
        const weeks = Math.round((weekStart - anchorWeek) / (7 * DAY_MS));
        hit = weeks % interval === 0;
      }
    } else if (r.freq === "DAILY") {
      hit = Math.round((day - firstDay) / DAY_MS) % interval === 0;
    } else {
      // MONTHLY：同月内日号
      const dw = epochToWall(CAMPUS_TZ, day);
      const fw = epochToWall(CAMPUS_TZ, firstDay);
      hit = dw.d === fw.d && (dw.mo - fw.mo + (dw.y - fw.y) * 12) % interval === 0;
    }
    if (!hit) continue;
    count++;
    if (r.count !== undefined && count > r.count) break;
    const start = day + timeOfDay;
    if (start + duration < fromMs) continue; // 窗口外早场：不计入结果但要数 count
    if (exset.has(day)) continue;
    if (overrides.has(day)) continue; // 该实例被 RECURRENCE-ID 覆盖：由覆盖事件自己展示
    out.push(mk(start));
    if (out.length > 500) break; // 防御性上限（异常规则不无限展开）
  }
  return out;
}

/**
 * 展开一组事件（同 UID 的覆盖实例自动接管被覆盖场次）→ 按开始时间排序。
 */
export function expandEventSet(events: IcsEvent[], fromMs: number, toMs: number): IcsOccurrence[] {
  const overrideMap = new Map<string, Set<number>>(); // uid → 被覆盖日
  for (const ev of events) {
    if (ev.recurrenceId !== undefined) {
      const set = overrideMap.get(ev.uid) ?? new Set<number>();
      set.add(dayStartMs(ev.recurrenceId));
      overrideMap.set(ev.uid, set);
    }
  }
  const out: IcsOccurrence[] = [];
  for (const ev of events) {
    if (ev.recurrenceId !== undefined) {
      // 覆盖实例：作为独立出现（时间在窗口内才展示）
      if (ev.start <= toMs && ev.end >= fromMs) out.push({ uid: ev.uid, start: ev.start, end: ev.end, override: true, summary: ev.summary, location: ev.location, description: ev.description, allDay: ev.allDay, categories: ev.categories, onethuSource: ev.onethuSource, alarmMinutes: ev.alarmMinutes });
      continue;
    }
    out.push(...expandEvent(ev, fromMs, toMs, overrideMap.get(ev.uid)));
  }
  return out.sort((a, b) => a.start - b.start);
}

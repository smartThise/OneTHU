import { useCallback, useEffect, useMemo, useRef, useState } from "react";
/**
 * 研讨间预约（cab.lib.tsinghua.edu.cn ic-web，thu-info-app libRoomSelect/libRoomBook/
 * libRoomPerformBook 桌面化移植）：
 * - 房型（kindId/kindName）选择 + 未来 5 天日期选择（lib validDateNum=5）
 * - 可约资源列表：逐格三态时段（30 分钟一格：绿=可约 / 红=已被占 / 灰=不可选，
 *   格内显式标注时段文本与占用状态，明确指出哪几个时段被占）；资源请求带代数去重
 *   （仅最新一次请求可落状态），房型/日期切换才清空列表，预约/取消后的刷新为软刷新
 *   （旧列表保留展示，杜绝占用格闪没）
 * - 时段筛选：按 5 分钟粒度选起止时间，只显示整段连续空闲且满足房间
 *   开放时间、最短/最长时长与当日未过期约束的房间；从筛选结果点「预约」
 *   会自动带入该时段
 * - 选时段（开始/结束 5 分钟粒度、min/max 时长与占用约束，libRoomPerformBook 同算法；
 *   点列表时段立即打开确认窗口，自动带入合法起止时间；确认窗只保留精确微调，
 *   不重复展示全天时段表；
 *   lib 为开始/结束双轮单选连续区间，不支持多选离散时段，此处保持一致）
 *   → 确认后提交预约（ic-web/reserve POST JSON，sysKind=1 等字段为 lib 源码字面值）
 * - 我的预约（未来 6 天 resvInfo 列表）+ 取消（POST /reserve/delete {uuid}，
 *   行内确认后调用并即时刷新）
 * - 成员：仅以本人 accNo 提交（minUser>1 的多人房间给出说明，成员搜索端点已在
 *   InfoClient.fuzzySearchLibRoomMember 移植，UI 暂不开放）
 * - 首次预约报「填写邮箱地址」→ getUserInfo 邮箱确认 → ic-web/account/update 绑定后重试
 *
 * 2026-10-14 OneGUI 换血：筛选条 = Field+Inline+Grow（房型 SearchSelect/CollectStar
 * 原样复用，保留 .ss-row 给下拉撤底边距；日期 5 天走 Segment——原生 time 输入换
 * SearchSelect 复用，5 分钟粒度候选全日可搜，与预约面板同一时段选择族）·
 * 错误/免登录引导/预约结果 = Banner（error 免登录可重试、success/error 语义色）·
 * 骨架 LoadingBlock、空态 EmptyState · 可约房间行 = Card flush + List divided + Row
 * （房间状态语义 Tag tone=neutral，.row-amount 换 trailing 预约钮）· 逐格三态时段格 =
 * Btn tonal 轻量化网格（可约 success / 已被占 error / 不可选中性 disabled，本线
 * 座位格判例同款，selected 高亮=面板当前开始时刻，.slot-grid/.slot-cell 共享类其他
 * 场次页仍用保留）· 预约面板 = Card+Field+Spacer+实体按钮；顶部精确段条（UsageBar）
 * 退役：占段精确信息由三态格与 sub 行全量承载（同一 convertUsageToSegments 源），
 * aria 概述并入 Row sub 文本。
 */

/* ── OG 全量 imported ── */
import { isAuthError, type LibRoomBookRecord, type LibRoomRes } from "@onethu/core";
import {
  Banner,
  Btn,
  Card,
  EmptyState,
  Field,
  Grow,
  Inline,
  List,
  LoadingBlock,
  Modal,
  Row,
  Section,
  Segment,
  Spacer,
  Stack,
  Tag,
  Text,
} from "@onethu/gui";
import { SearchSelect } from "../../components/SearchSelect.jsx";
import { CollectStar } from "../../components/Collect.js";
import { enc, noteAtomCache } from "../../state/atoms.js";
import { info, logLine, session } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { openExternal } from "./openExternal.js";
import { useApp } from "../../state/context.js";
import { softRecover } from "../../lib/reload.js";
import { showToast } from "../../state/toast.js";
import { t as i18n } from "../../i18n/index.js";


/* 研讨间「未绑定邮箱」引导条（2026-09 用户反馈：新生首次使用必须在 cab.lib
 * 原网站绑定邮箱，否则会话建立/userInfo 校验恒败，只报错会让用户干等）。
 * 命中会话失败类文案时显示引导 + 一键打开原站；其余错误原样只走 Banner。 */
function EmailBindHint({ text }: { text: string }) {
  if (!/研讨间会话未能建立|研讨间登录失败|userInfo 校验/.test(text)) return null;
  return (
    <Banner
      tone="warning"
      title={i18n("auto.pages.info.LibRoomTab.1")}
      action={
        <Btn variant="outline" onClick={() => void openExternal("https://cab.lib.tsinghua.edu.cn/")}>
          {i18n("auto.pages.info.LibRoomTab.2")}</Btn>
      }
    >
      {i18n("auto.pages.info.LibRoomTab.3")}</Banner>
  );
}

function logErr(tag: string, err: unknown): void {
  void logLine(
    "PAGE-ERR " + tag + " " + (err instanceof Error ? err.message : String(err)),
  ).catch(() => undefined);
}

type LoadState = "loading" | "error" | "ready";

const VALID_DATE_NUM = 5; // lib libRoomSelect validDateNum

const pad2 = (n: number): string => String(n).padStart(2, "0");
const hhmm = (d: Date): string => {
  if (Number.isNaN(d.getTime())) throw new Error("invalid date");
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
/** 记录渲染专用：服务端时间字段异常时不抛错（渲染层绝不 crash） */
const hhmmSafe = (d: Date): string => {
  try {
    return hhmm(d);
  } catch {
    return "–";
  }
};
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

interface DayChoice {
  offset: number;
  /** 查询用 yyyyMMdd */
  compact: string;
  /** 预约/展示用 yyyy-MM-dd */
  iso: string;
  label: string;
}

function dayChoices(): DayChoice[] {
  const out: DayChoice[] = [];
  for (let k = 0; k < VALID_DATE_NUM; k++) {
    const d = new Date();
    d.setDate(d.getDate() + k);
    out.push({
      offset: k,
      compact: `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`,
      iso: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      label: k === 0 ? "今天" : `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${WEEKDAYS[d.getDay()]}`,
    });
  }
  return out;
}

/** 空闲时段筛选候选：全日 00:00~23:55 每 5 分钟一档（原 step=300 time 输入的同域
 *  替代——SearchSelect ≥6 选项自动带搜索框，5 分钟粒度可搜可点）。 */
const TIME_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let m = 0; m < 24 * 60; m += 5) {
    const hm = `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
    out.push({ value: hm, label: hm });
  }
  return out;
})();

/* ------------- 时段切分（libRoomBookTimeIndicator 逐行移植） ------------- */

/** [start, duration(分钟), occupied] —— lib convertUsageToSegments */
type SegmentData = [string, number, boolean];

const timeDiff = (start: string, end: string): number => {
  const sh = Number(start.slice(0, 2));
  const sm = Number(start.slice(3, 5));
  const eh = Number(end.slice(0, 2));
  const em = Number(end.slice(3, 5));
  return eh * 60 + em - (sh * 60 + sm);
};

const convertUsageToSegments = (res: LibRoomRes): SegmentData[] => {
  if (res.openStart === null || res.openEnd === null) return [];
  try {
    const sorted = [...res.usage].sort((a, b) => (a.start < b.start ? -1 : 1));
    const result: SegmentData[] = [];
    let lastTime = res.openStart;
    for (const u of sorted) {
      const beginTime = hhmm(u.start);
      const endTime = hhmm(u.end);
      if (beginTime > lastTime) result.push([lastTime, timeDiff(lastTime, beginTime), false]);
      result.push([beginTime, timeDiff(beginTime, endTime), true]);
      lastTime = endTime;
    }
    if (res.openEnd > lastTime) result.push([lastTime, timeDiff(lastTime, res.openEnd), false]);
    return result;
  } catch {
    return [[res.openStart, timeDiff(res.openEnd, res.openStart), false]];
  }
};

/* ------------- 可选开始/结束时刻（libRoomPerformBook 同算法，下拉替代滚轮） ------------- */

interface TimePoint {
  start: string;
  duration: number;
}

const fmtPoint = (h: number, m: number): string => `${pad2(h)}:${pad2(m)}`;

const validBegins = (res: LibRoomRes, iso: string): TimePoint[] => {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const nowHm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  return convertUsageToSegments(res)
    .filter(([_, duration, occupied]) => duration >= res.minMinute && !occupied)
    .flatMap(([start, duration]) => {
      const startH = Number(start.slice(0, 2));
      const startM = Number(start.slice(3, 5));
      const out: TimePoint[] = [];
      const count = Math.floor((duration - res.minMinute) / 5) + 1;
      for (let k = 0; k < count; k++) {
        let m = startM + k * 5;
        const h = startH + Math.floor(m / 60);
        m -= Math.floor(m / 60) * 60;
        out.push({ start: fmtPoint(h, m), duration: duration - k * 5 });
      }
      return out;
    })
    .filter(({ start }) => iso > today || start > nowHm);
};

const validEnds = (res: LibRoomRes, begs: TimePoint[], beg: string): TimePoint[] => {
  const item = begs.find((e) => e.start === beg) ?? begs[0];
  if (!item) return [];
  const result: TimePoint[] = [];
  let h = Number(beg.slice(0, 2));
  let m = Number(beg.slice(3, 5)) + res.minMinute;
  const availableMinute = res.maxMinute > 0 ? Math.min(item.duration, res.maxMinute) : item.duration;
  const count = Math.floor((availableMinute - res.minMinute - timeDiff(item.start, beg)) / 5) + 1;
  for (let i = 0; i < count; i++) {
    h += Math.floor(m / 60);
    m -= Math.floor(m / 60) * 60;
    result.push({ start: fmtPoint(h, m), duration: -1 });
    m += 5;
  }
  return result;
};

/* ------------- 逐格三态时段（可约 / 已被占 / 不可选） ------------- */

const SLOT_MIN = 30;

type SlotState = "free" | "occupied" | "blocked";

interface RoomSlot {
  /** HH:mm */
  start: string;
  /** HH:mm */
  end: string;
  state: SlotState;
}

const toMin = (hm: string): number => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const minToHm = (m: number): string => (m >= 1440 ? "24:00" : `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`);

/** 所选时段是否可以在该房间作为一次完整预约。 */
const isRoomFreeForRange = (res: LibRoomRes, iso: string, start: string, end: string): boolean => {
  if (!res.openStart || !res.openEnd || res.kindName.includes("暂未开放")) return false;
  const startMin = toMin(start);
  const endMin = toMin(end);
  const openStartMin = toMin(res.openStart);
  const openEndMin = toMin(res.openEnd);
  if (![startMin, endMin, openStartMin, openEndMin].every(Number.isFinite)) return false;
  if (startMin >= endMin || startMin < openStartMin || endMin > openEndMin) return false;

  const duration = endMin - startMin;
  if (duration < res.minMinute || (res.maxMinute > 0 && duration > res.maxMinute)) return false;

  // 与预约面板共用同一组候选时刻：同时覆盖 5 分钟粒度、当日已过期、
  // 最短/最长时长和连续空闲段，保证「筛得出」就一定能在下方选中。
  const begins = validBegins(res, iso);
  if (!begins.some((p) => p.start === start)) return false;
  if (!validEnds(res, begins, start).some((p) => p.start === end)) return false;

  return !res.usage.some((u) => {
    const usageStart = toMin(hhmmSafe(u.start));
    const usageEnd = toMin(hhmmSafe(u.end));
    return Number.isFinite(usageStart) && Number.isFinite(usageEnd) && usageStart < endMin && usageEnd > startMin;
  });
};

/** 占用归属（tooltip 展示预约人/事由；解析失败返回空串） */
const usageAt = (res: LibRoomRes, s: number, e: number): string => {
  for (const u of res.usage) {
    const us = toMin(hhmmSafe(u.start));
    const ue = toMin(hhmmSafe(u.end));
    if (Number.isNaN(us) || Number.isNaN(ue)) continue;
    if (us <= s && ue >= e) {
      const who = [u.owner, u.title].filter(Boolean).join(" · ");
      return who ? `（${who}）` : "";
    }
  }
  return "";
};

/**
 * 房间当日逐格三态：以 convertUsageToSegments 的占用切分为源，铺成 SLOT_MIN 格。
 * 红格=已被占（usage 覆盖）；空闲格中存在合法开始时刻（validBegins 命中）→ 绿=可约；
 * 过去时刻或剩余不足 minMinute 的空闲格 → 灰=不可选。与可选开始算法同源，永不互相矛盾。
 */
const roomSlots = (res: LibRoomRes, iso: string): RoomSlot[] => {
  if (res.openStart === null || res.openEnd === null) return [];
  const segs = convertUsageToSegments(res);
  if (segs.length === 0) return [];
  const begins = validBegins(res, iso);
  const beginMins = begins.map((b) => toMin(b.start));
  const out: RoomSlot[] = [];
  for (const [segStart, segDur, occupied] of segs) {
    if (!Number.isFinite(segDur) || segDur <= 0) continue;
    const base = toMin(segStart);
    if (Number.isNaN(base)) continue;
    for (let off = 0; off < segDur; off += SLOT_MIN) {
      const s = base + off;
      const e = Math.min(s + SLOT_MIN, base + segDur);
      if (occupied) {
        out.push({ start: minToHm(s), end: minToHm(e), state: "occupied" });
        continue;
      }
      const selectable = beginMins.some((b) => b >= s && b < e);
      out.push({
        start: minToHm(s),
        end: minToHm(e),
        state: selectable ? "free" : "blocked",
      });
    }
  }
  return out;
};

const SLOT_STATE_LABEL: Record<SlotState, string> = {
  free: "可约",
  occupied: "已被占",
  blocked: "不可选",
};

const SLOT_TONE: Record<SlotState, OGBToneAlias> = {
  free: "success",
  occupied: "error",
  blocked: "default",
};
type OGBToneAlias = "default" | "quiet" | "brand" | "error" | "warning" | "success" | "info";

/** 列表绿格直接打开确认窗；红/灰格不可选。 */
function SlotGrid({
  slots,
  res,
  onPickFree,
}: {
  slots: RoomSlot[];
  res: LibRoomRes;
  onPickFree?: (slot: RoomSlot) => void;
}) {
  if (slots.length === 0) return null;
  return (
    <Inline gap={1} wrap>
      {slots.map((sl) => {
        const label = SLOT_STATE_LABEL[sl.state];
        const interactive = onPickFree !== undefined && sl.state === "free";
        const tip = `${sl.start}~${sl.end} · ${label}${
          sl.state === "occupied" ? usageAt(res, toMin(sl.start), toMin(sl.end)) : ""
        }${interactive ? " · 点击选此开始时刻" : ""}`;
        return (
          <Btn
            key={`${sl.start}-${sl.end}`}
            variant="tonal"
            tone={SLOT_TONE[sl.state]}
            size="sm"
            disabled={!interactive}
            titleAttr={tip}
            onClick={interactive ? () => onPickFree!(sl) : undefined}
          >
            {sl.start}~{sl.end} {label}
          </Btn>
        );
      })}
    </Inline>
  );
}

interface BookTarget {
  res: LibRoomRes;
  day: DayChoice;
}

export function LibRoomTab({
  deepKind,
}: {
  /** 深链（实体原子）：自动选中的房型 kindId */
  deepKind?: number;
} = {}) {
  const { status } = useApp();
  const userId = session.username;

  /* 房型 */
  const [kinds, setKinds] = useState<Array<{ kindId: number; kindName: string }> | null>(null);
  const [kindState, setKindState] = useState<LoadState>("loading");
  const [kindError, setKindError] = useState<string | null>(null);
  const [kindId, setKindId] = useState<number | null>(null);

  /* 日期 + 资源 */
  const days = useMemo(dayChoices, []);
  const [day, setDay] = useState<DayChoice>(days[0]!);
  const [resources, setResources] = useState<LibRoomRes[] | null>(null);
  const [resState, setResState] = useState<LoadState>("loading");
  const [resError, setResError] = useState<string | null>(null);
  const [resTick, setResTick] = useState(0);
  /* 时段筛选：两端都有值且起点早于终点时才生效 */
  const [filterBeg, setFilterBeg] = useState("");
  const [filterEnd, setFilterEnd] = useState("");

  /* 预约面板 */
  const [target, setTarget] = useState<BookTarget | null>(null);
  const [beg, setBeg] = useState<string>("");
  const [end, setEnd] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  /* 我的预约 */
  const [records, setRecords] = useState<LibRoomBookRecord[] | null>(null);
  const [recState, setRecState] = useState<LoadState>("loading");
  const [recError, setRecError] = useState<string | null>(null);
  /* 取消预约：先点「取消预约」进入行内确认，再点「确认取消」才调 /reserve/delete */
  const [pendingCancel, setPendingCancel] = useState<string | null>(null);
  const [busyCancel, setBusyCancel] = useState<string | null>(null);

  /* 登录态丢失静默自愈：每条加载链路独立计数（成功清零），同一次失败最多自动恢复 1 次；
   * 恢复中保持 loading 骨架不闪红，自动恢复也失败才亮 Banner（手动重试清零重计）。 */
  const kindRecover = useRef(0);
  const resRecover = useRef(0);
  const recRecover = useRef(0);

  const loadKinds = useCallback(async () => {
    if (status !== "ready" || !userId) return;
    setKindState("loading");
    setKindError(null);
    try {
      const list = await info.getLibRoomInfoList(userId);
      if (list.length === 0) throw new Error("房型列表为空（ic-web 未返回数据，请稍后重试）");
      kindRecover.current = 0;
      setKinds(list);
      setKindState("ready");
      setKindId((prev) => prev ?? list[0]!.kindId);
      noteAtomCache({ libroomKinds: list.map((k) => ({ kindId: k.kindId, kindName: k.kindName })) });
    } catch (err) {
      logErr("LIBROOM-KIND", err);
      // 登录态丢失：不闪红，静默重建研讨间 cab 会话后自动重载一次；仍失败才亮 Banner
      // 登录态丢失：softRelogin 透明全链重建 → 原地重拉
      if (isAuthError(err) && (await softRecover("libroom"))) return loadKinds();
      // softRecover 失败/节流 → 落回数据级恢复兜底
      if (isAuthError(err) && kindRecover.current < 1) {
        kindRecover.current += 1;
        await info.forceEnsure("libroom", userId).catch((renewErr: unknown) => {
          logErr("LIBROOM-RENEW", renewErr);
        });
        return loadKinds();
      }
      setKindState("error");
      setKindError(explainNetworkError(err));
    }
  }, [status, userId]);

  /* 深链：房型目录就绪后自动选中目标房型 */
  useEffect(() => {
    if (deepKind == null || kindState !== "ready" || !kinds) return;
    if (!kinds.some((k) => k.kindId === deepKind)) return;
    setKindId((cur) => (cur === deepKind ? cur : deepKind));
  }, [deepKind, kindState, kinds]);

  const loadRecords = useCallback(async () => {
    if (status !== "ready" || !userId) return;
    setRecState("loading");
    setRecError(null);
    try {
      setRecords(await info.getLibRoomRecords(userId));
      recRecover.current = 0;
      setRecState("ready");
    } catch (err) {
      logErr("LIBROOM-REC", err);
      // 登录态丢失：静默重建会话后自动重载一次（保持骨架，不闪红）
      // 登录态丢失：softRelogin 透明全链重建 → 原地重拉
      if (isAuthError(err) && (await softRecover("libroom"))) return loadRecords();
      // softRecover 失败/节流 → 落回数据级恢复兜底
      if (isAuthError(err) && recRecover.current < 1) {
        recRecover.current += 1;
        await info.forceEnsure("libroom", userId).catch((renewErr: unknown) => {
          logErr("LIBROOM-RENEW", renewErr);
        });
        return loadRecords();
      }
      setRecState("error");
      setRecError(explainNetworkError(err));
    }
  }, [status, userId]);

  useEffect(() => {
    void loadKinds();
    void loadRecords();
  }, [loadKinds, loadRecords]);

  /* 资源：随房型/日期变化。
   * - 请求代数去重：resGen 自增，仅最新一次发出的请求可落状态（resTick 重取、
   *   房型/日期连点时旧响应一律丢弃，杜绝互相覆盖）；
   * - 软/硬刷新：房型/日期变化（源变化）才清空列表与选房；预约/取消后的 resTick
   *   重取保留旧列表展示（stale-while-revalidate），占用格不再先消失再出现。 */
  const resGen = useRef(0);
  const lastResSource = useRef<string | null>(null);
  useEffect(() => {
    if (kindId === null || status !== "ready" || !userId) return;
    const gen = ++resGen.current;
    const source = `${kindId}|${day.compact}`;
    const sameSource = lastResSource.current === source;
    let alive = true;
    if (!sameSource) {
      setTarget(null);
      setResources(null);
    }
    setResState("loading");
    setResError(null);
    info
      .getLibRoomResourceList(userId, day.compact, kindId)
      .then((list) => {
        if (!alive || gen !== resGen.current) return;
        resRecover.current = 0;
        lastResSource.current = source;
        setResources(list);
        setResState("ready");
        // 面板开着时同步刷新占用（如取消自己的预约后该时段回绿）：仅替换 res，
        // 保留用户已选的 beg/end 字符串；新数据下不再合法时 ends 落空 → 提交按钮
        // 自动禁用，用户重选即可。
        setTarget((t) => {
          if (!t) return null;
          const fresh = list.find((x) => x.devId === t.res.devId);
          return fresh ? { ...t, res: fresh } : null;
        });
      })
      .catch(async (err: unknown) => {
        if (!alive || gen !== resGen.current) return;
        logErr("LIBROOM-RES", err);
        // 登录态丢失：softRelogin 透明全链重建 → tick 链自动重拉
        if (isAuthError(err) && (await softRecover("libroom"))) { resRecover.current = 0; setResTick((n) => n + 1); return; }
        // softRecover 失败/节流 → 落回数据级恢复兜底
        if (isAuthError(err) && resRecover.current < 1) {
          // 登录态丢失：静默重建研讨间会话后自动重取一次（保持骨架，不闪红）
          resRecover.current += 1;
          info
            .forceEnsure("libroom", userId)
            .catch((renewErr: unknown) => logErr("LIBROOM-RENEW", renewErr))
            .finally(() => setResTick((n) => n + 1));
          return;
        }
        setResState("error");
        setResError(explainNetworkError(err));
      });
    return () => {
      alive = false;
    };
  }, [kindId, day, status, userId, resTick]);

  const begins = useMemo(() => (target ? validBegins(target.res, target.day.iso) : []), [target]);
  const ends = useMemo(() => (target && beg ? validEnds(target.res, begins, beg) : []), [target, begins, beg]);
  const chooseStart = (value: string): void => {
    setBookError(null);
    setBeg(value);
    setEnd(target ? validEnds(target.res, begins, value)[0]?.start ?? "" : "");
  };

  const filterComplete = filterBeg !== "" && filterEnd !== "";
  const filterValid = filterComplete && filterBeg < filterEnd;
  const visibleResources = useMemo(
    () =>
      resources === null || !filterValid
        ? resources
        : resources.filter((r) => isRoomFreeForRange(r, day.iso, filterBeg, filterEnd)),
    [resources, filterValid, day.iso, filterBeg, filterEnd],
  );

  const pickRoom = (res: LibRoomRes, preferredBeg?: string, preferredEnd?: string): void => {
    setBookError(null);
    setPendingEmail(null);
    setNotice(null);
    const requestedBeg = preferredBeg ?? (filterValid ? filterBeg : undefined);
    const requestedEnd = preferredEnd ?? (filterValid ? filterEnd : undefined);
    const starts = validBegins(res, day.iso);
    const begin = starts.find((p) => p.start === requestedBeg)?.start
      ?? starts.find((p) => requestedBeg && p.start >= requestedBeg && p.start < (requestedEnd ?? "24:00"))?.start
      ?? starts[0]?.start ?? "";
    const finishes = validEnds(res, starts, begin);
    setBeg(begin);
    setEnd(finishes.find((p) => p.start === requestedEnd)?.start ?? finishes[0]?.start ?? "");
    setTarget({ res, day });
  };

  const doBook = useCallback(
    async (t: BookTarget, begin: string, finish: string): Promise<void> => {
      const accNo = info.getLibRoomAccNo();
      if (!userId) {
        setBookError("需要先登录（未读取到学号）");
        return;
      }
      if (accNo === null) {
        setBookError("研讨间账号信息缺失（accNo），请重试");
        return;
      }
      /* 不再因 minUser>1 硬性阻断（用户点名「红色绿色的都不让预约」）：
         以仅本人（accNo）先按后端真实规则提交——馆方若要求成组人数会明确拒绝，
         那时把后端原话交给用户并指路网页端加成员；馆方放行就按用户的选择预约成功。 */
      setBusy(true);
      setBookError(null);
      try {
        // lib bookLibraryRoom：`${date} ${beg}:00`，成员以 accNo（非学号）提交
        await info.bookLibRoom(userId, t.res, `${t.day.iso} ${begin}:00`, `${t.day.iso} ${finish}:00`, [
          accNo,
        ]);
        const message = `${t.res.roomName} ${t.day.iso} ${begin}~${finish} 预约成功，请留意图书馆邮件通知`;
        setNotice({ ok: true, text: message });
        showToast(message);
        setTarget(null);
        void loadRecords();
        setResTick((n) => n + 1);
      } catch (err) {
        logErr("LIBROOM-BOOK", err);
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("填写邮箱地址")) {
          // lib libRoomPerformBook 同款流程：绑定邮箱后自动重试一次
          try {
            const userInfo = await info.getUserInfo();
            if (userInfo.email) {
              setPendingEmail(userInfo.email);
              setBookError("首次预约需绑定邮箱地址，请确认下方邮箱后重试");
              return;
            }
          } catch (emailErr) {
            logErr("LIBROOM-EMAIL", emailErr);
          }
          setBookError("首次预约需绑定邮箱地址（未能自动获取邮箱），请先在图书馆研讨间系统网页端绑定后重试");
          return;
        }
        const explained = explainNetworkError(err);
        /* 后端按成组规则拒绝（人数/成员不足）：原话照给 + 指路网页端加成员 */
        setBookError(
          /人数|成员|成组/.test(explained) && t.res.minUser > 1
            ? `${explained}（本应用仅以本人提交；该房间要求 ${t.res.minUser}~${t.res.maxUser} 人成组，请到图书馆研讨间系统网页端添加成员后预约）`
            : explained,
        );
      } finally {
        setBusy(false);
      }
    },
    [userId, loadRecords],
  );

  const confirmEmailAndRetry = async (): Promise<void> => {
    if (!userId || !pendingEmail || !target || !beg || !end) return;
    setBusy(true);
    try {
      await info.updateLibRoomEmail(userId, pendingEmail);
      setPendingEmail(null);
      await doBook(target, beg, end);
    } catch (err) {
      logErr("LIBROOM-EMAIL-SET", err);
      setBookError(explainNetworkError(err));
    } finally {
      setBusy(false);
    }
  };

  const cancelRecord = async (r: LibRoomBookRecord): Promise<void> => {
    if (!userId || !r.uuid) return;
    setBusyCancel(r.uuid);
    setNotice(null);
    try {
      await info.cancelLibRoomBooking(userId, r.uuid);
      setNotice({ ok: true, text: "已取消该预约" });
      void loadRecords();
      setResTick((n) => n + 1);
    } catch (err) {
      logErr("LIBROOM-CANCEL", err);
      setNotice({ ok: false, text: explainNetworkError(err) });
    } finally {
      setBusyCancel(null);
      setPendingCancel(null);
    }
  };

  const canSubmit =
    target !== null && !busy && isRoomFreeForRange(target.res, target.day.iso, beg, end);

  const dayOptions = days.map((d) => ({
    value: String(d.offset),
    label: d.label,
  }));

  return (
    <Stack gap={3}>
      <Section title={i18n("auto.pages.info.LibRoomTab.4")} hint="cab.lib.tsinghua.edu.cn · ic-web" />
      {kindState === "error" ? (
        <Banner
          tone="error"
          action={
            <Btn
              variant="ghost"
              tone="error"
              size="sm"
              onClick={() => {
                kindRecover.current = 0;
                void loadKinds();
              }}
            >
              {i18n("auto.pages.info.LibRoomTab.5")}</Btn>
          }
        >
          {kindError ?? ""}
        </Banner>
      ) : null}
      {kindState === "error" ? <EmailBindHint text={kindError ?? ""} /> : null}
      {kindState === "loading" && !kinds ? <LoadingBlock rows={2} /> : null}

      {kinds && kinds.length > 0 ? (
        <>
          {/* 筛选条：房型 / 日期 / 空闲时段（Field + Inline + Grow 判例同款） */}
          <Inline gap={3} wrap vAlign="end">
            <Grow>
              <Field label={i18n("auto.pages.info.LibRoomTab.6")}>
                <Inline gap={1} className="ss-row">
                  <Grow>
                    <SearchSelect
                      value={kindId != null ? String(kindId) : ""}
                      onChange={(v) => setKindId(Number(v) || null)}
                      placeholder={i18n("auto.pages.info.LibRoomTab.7")}
                      options={kinds.map((k) => ({ value: String(k.kindId), label: k.kindName }))}
                    />
                  </Grow>
                  {kindId != null ? (
                    <CollectStar
                      atom={{ kind: "libroom-k", key: enc(kindId, kinds?.find((k) => k.kindId === kindId)?.kindName ?? "") }}
                      title={kinds?.find((k) => k.kindId === kindId)?.kindName ?? "研讨间房型"}
                    />
                  ) : null}
                </Inline>
              </Field>
            </Grow>
            <Field label={i18n("auto.pages.info.LibRoomTab.8")}>
              <Segment
                size="sm"
                options={dayOptions}
                value={String(day.offset)}
                onChange={(value) => setDay(days[Number(value)] ?? days[0]!)}
              />
            </Field>
            <Field
              label={i18n("auto.pages.info.LibRoomTab.9")}
              error={filterComplete && !filterValid ? "结束时间需晚于开始时间" : undefined}
            >
              <Inline gap={1} vAlign="center" wrap>
                <SearchSelect
                  value={filterBeg}
                  onChange={setFilterBeg}
                  placeholder={i18n("auto.pages.info.LibRoomTab.10")}
                  options={TIME_OPTIONS}
                />
                <Text slot="label" tone="faint" nowrap>{i18n("auto.pages.info.LibRoomTab.11")}</Text>
                <SearchSelect
                  value={filterEnd}
                  onChange={setFilterEnd}
                  placeholder={i18n("auto.pages.info.LibRoomTab.12")}
                  options={TIME_OPTIONS}
                />
                {filterBeg || filterEnd ? (
                  <Btn
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFilterBeg("");
                      setFilterEnd("");
                    }}
                  >
                    {i18n("auto.pages.info.LibRoomTab.13")}</Btn>
                ) : null}
              </Inline>
            </Field>
          </Inline>

          <Section
            title={i18n("auto.pages.info.LibRoomTab.14")}
            hint={`${day.label}${filterValid ? ` · ${filterBeg}~${filterEnd} 连续空闲 ${visibleResources?.length ?? 0} 间` : ""} · 时段格 绿=可约 红=已被占 灰=不可选${resState === "loading" && resources !== null ? " · 刷新中…" : ""}`}
          />
          {resState === "loading" && resources === null ? <LoadingBlock rows={4} /> : null}
          {resState === "error" ? (
            <Banner
              tone="error"
              action={
                <Btn
                  variant="ghost"
                  tone="error"
                  size="sm"
                  onClick={() => {
                    resRecover.current = 0;
                    setResTick((n) => n + 1);
                  }}
                >
                  {i18n("auto.pages.info.LibRoomTab.5")}</Btn>
              }
            >
              {resError ?? ""}
            </Banner>
          ) : null}
          {resState === "error" ? <EmailBindHint text={resError ?? ""} /> : null}
          {resources !== null && resources.length === 0 ? (
            <Card>
              <EmptyState title={i18n("auto.pages.info.LibRoomTab.15")} />
            </Card>
          ) : null}
          {resources !== null && resources.length > 0 && visibleResources?.length === 0 ? (
            <Card>
              <EmptyState title={`没有研讨间在 ${filterBeg}~${filterEnd} 整段可约，请调整时间或清除筛选。`} />
            </Card>
          ) : null}
          {visibleResources !== null && visibleResources.length > 0 ? (
            <Card flush>
              <List divided>
                {visibleResources.map((r) => (
                  <Row
                    flush
                    key={r.devId}
                    title={
                      <>
                        <Text as="span" slot="body" weight="medium">
                          {r.roomName}
                          {r.maxUser > 1 ? `（${r.minUser}~${r.maxUser} 人）` : ""}
                        </Text>
                        {r.kindName.includes("暂未开放") ? <Tag tone="neutral">{i18n("auto.pages.info.LibRoomTab.16")}</Tag> : null}
                      </>
                    }
                    sub={`${r.openStart && r.openEnd
                      ? `开放 ${r.openStart}~${r.openEnd} · 单次 ${r.minMinute}~${r.maxMinute} 分钟`
                      : "当日不开放"}${r.usage.length > 0 ? ` · 已约 ${r.usage.length} 段` : ""}`}
                    trailing={
                      <Btn
                        variant="solid"
                        tone="brand"
                        disabled={r.kindName.includes("暂未开放") || r.openStart === null}
                        onClick={() => pickRoom(r)}
                      >
                        {i18n("auto.pages.info.LibRoomTab.17")}</Btn>
                    }
                  >
                    {/* 逐格三态：明确列出被占时段（红=已被占 / 绿=可约 / 灰=不可选）。
                        绿格直接可点：点任何一段「可约」即以该格为开始时刻发起预约
                        （用户点名「红色绿色的都不让我选择预约」——绿格原先整排只读）。 */}
                    <SlotGrid
                      slots={roomSlots(r, day.iso)}
                      res={r}
                      onPickFree={(sl) => pickRoom(r, sl.start, sl.end)}
                    />
                  </Row>
                ))}
              </List>
            </Card>
          ) : null}
        </>
      ) : null}

      {/* 选房后的预约面板 */}
      {target ? (
        <Modal
          open={target !== null}
          onClose={() => { if (!busy) setTarget(null); }}
          title={`预约 ${target.res.roomName}`}
          size="md"
          maskClose={!busy}
          closeButton={!busy}
          foot={<>
            <Btn variant="outline" disabled={busy} onClick={() => setTarget(null)}>{i18n("auto.pages.info.LibRoomTab.18")}</Btn>
            <Btn variant="solid" tone="brand" disabled={!canSubmit} onClick={() => {
              if (target && beg && end) void doBook(target, beg, end);
            }}>{busy ? "提交中…" : "提交预约"}</Btn>
          </>}
        >
          <Stack gap={3}>
            <Inline gap={2} vAlign="baseline" wrap>
              <Text as="h3" slot="subtitle">
                {target.day.iso}
              </Text>
              {target.res.maxUser > 1 ? (
                <Tag tone="neutral">{target.res.minUser}~{target.res.maxUser} {i18n("auto.pages.info.LibRoomTab.19")}</Tag>
              ) : null}
              <Tag tone="brand">{target.day.label}</Tag>
            </Inline>
            <Banner tone="info">{i18n("auto.pages.info.LibRoomTab.20")}{target.day.label} {beg || "–"}~{end || "–"}{i18n("auto.pages.info.LibRoomTab.21")}</Banner>
            <Inline gap={2} wrap vAlign="end">
              {/* 两个时段选择并排各占半行（Grow），不再各霸一行 */}
              <Grow><Field label={i18n("auto.pages.info.LibRoomTab.22")}>
                <SearchSelect
                  value={beg}
                  onChange={chooseStart}
                  placeholder={begins.length === 0 ? "无可约时段" : "开始"}
                  disabled={begins.length === 0}
                  options={begins.map((b) => ({ value: b.start, label: b.start }))}
                />
              </Field></Grow>
              <Grow><Field label={i18n("auto.pages.info.LibRoomTab.23")}>
                <SearchSelect
                  value={end}
                  onChange={setEnd}
                  placeholder={ends.length === 0 ? "–" : "结束"}
                  disabled={ends.length === 0}
                  options={ends.map((p2) => ({ value: p2.start, label: p2.start }))}
                />
              </Field></Grow>
            </Inline>
            <Text slot="label" tone="quiet">
              {i18n("auto.pages.info.LibRoomTab.24")}{target.res.minUser > 1
                ? ` 该房间标称需 ${target.res.minUser}~${target.res.maxUser} 人成组：应用会先以仅本人提交，馆方若拒绝会给出原话，届时请到研讨间系统网页端添加成员。`
                : ` 单次可约 ${target.res.minMinute}~${target.res.maxMinute} 分钟，5 分钟粒度。`}
            </Text>
            {bookError ? <Banner tone="error">{bookError}</Banner> : null}
            {pendingEmail ? (
              <Banner tone="warning" action={<Btn variant="solid" disabled={busy} onClick={() => void confirmEmailAndRetry()}>{i18n("auto.pages.info.LibRoomTab.25")}</Btn>}>
                {i18n("auto.pages.info.LibRoomTab.26")}{pendingEmail} {i18n("auto.pages.info.LibRoomTab.27")}</Banner>
            ) : null}
          </Stack>
        </Modal>
      ) : null}

      {notice ? <Banner tone={notice.ok ? "success" : "error"}>{notice.text}</Banner> : null}

      <Section title={i18n("auto.pages.info.LibRoomTab.28")} hint={i18n("auto.pages.info.LibRoomTab.29")} />
      {recState === "loading" ? <LoadingBlock rows={2} /> : null}
      {recState === "error" ? (
        <Banner
          tone="error"
          action={
            <Btn
              variant="ghost"
              tone="error"
              size="sm"
              onClick={() => {
                recRecover.current = 0;
                void loadRecords();
              }}
            >
              {i18n("auto.pages.info.LibRoomTab.5")}</Btn>
          }
        >
          {recError ?? ""}
        </Banner>
      ) : null}
      {recState === "error" ? <EmailBindHint text={recError ?? ""} /> : null}
      {recState === "ready" && (records ?? []).length === 0 ? (
        <Card>
          <EmptyState title={i18n("auto.pages.info.LibRoomTab.30")} />
        </Card>
      ) : null}
      {recState === "ready" && (records ?? []).length > 0 ? (
        <Card flush>
          <List divided>
            {(records ?? []).map((r) => (
              <Row
                flush
                key={r.uuid || r.rsvId}
                title={`${r.devName || "研讨间"}${r.kindName ? ` · ${r.kindName}` : ""}`}
                sub={`${r.date} ${hhmmSafe(r.begin)}~${hhmmSafe(r.end)}${
                  r.members.length > 0 ? ` · 成员 ${r.members.map((m) => m.name).join("、")}` : ""
                }`}
                trailing={
                  r.uuid ? (
                    pendingCancel === r.uuid ? (
                      <Inline gap={2} vAlign="center">
                        <Text slot="label" tone="quiet">{i18n("auto.pages.info.LibRoomTab.31")}</Text>
                        <Btn variant="solid" tone="error" disabled={busyCancel !== null} onClick={() => void cancelRecord(r)}>
                          {busyCancel !== null ? "取消中…" : "确认取消"}
                        </Btn>
                        <Btn variant="outline" disabled={busyCancel !== null} onClick={() => setPendingCancel(null)}>
                          {i18n("auto.pages.info.LibRoomTab.32")}</Btn>
                      </Inline>
                    ) : (
                      <Btn variant="outline" disabled={busyCancel !== null} onClick={() => setPendingCancel(r.uuid)}>
                        {i18n("auto.pages.info.LibRoomTab.33")}</Btn>
                    )
                  ) : null
                }
              />
            ))}
          </List>
        </Card>
      ) : null}
    </Stack>
  );
}

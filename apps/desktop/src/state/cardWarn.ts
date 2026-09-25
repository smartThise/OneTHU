/**
 * 校园卡余额预警（判定 + 持久化 + 投递编排）。
 *
 * 触发口径：**任何一次余额刷新**都过一遍这里 —— 卡页手刷、切回本栏的自动重试、
 * 首页/小组件的静默重验证、充值后的刷新，全部收敛在 `useCard` 取数成功之后，
 * 于是刷新途径继续增加时不需要再补一处接线。
 *
 * 判定与投递分开：`evaluateCardWarn` 是纯函数（入参出参都是快照，任何环境可测），
 * 投递经 `CardWarnDeps` 注入，生产走 notifyBridge，测试注入假实现。
 *
 * 两种提醒模式（互斥）：
 *   · 「不重复提醒」（默认开，事件驱动）：余额一变就在**刷新那一刻**立刻提醒，同一个
 *     余额只提醒一次。该模式下冷却不参与判定，卡片上冷却输入也置灰不可设。
 *   · 关掉它（定时重复）：按冷却周期重复提醒——余额没变也会到点重发。
 * 恢复规则对两种模式一致：余额回到预警线以上（或关掉预警）时撤回通知并清空状态。
 *
 * 通知 id 固定为 `card-warn:balance`：同 id 重发即覆盖，不会堆一屏。
 */
import { encodeWidgetTarget } from "./widgetTarget.js";
import { dismissNotifications, postNotificationNow } from "./notifyBridge.js";

export interface CardWarnSettings {
  /** 预警开关：默认关，装完不打扰 */
  enabled: boolean;
  /** 余额预警线（元）：余额小于等于它就提醒 */
  threshold: number;
  /** 冷却（分钟）：关掉「不重复提醒」后，两次提醒的最小间隔 */
  cooldownMin: number;
  /** 不重复提醒（当余额未变化）：开 = 余额一变就立刻提醒，冷却不参与 */
  skipUnchanged: boolean;
}

export const CARD_WARN_DEFAULTS: CardWarnSettings = {
  enabled: false,
  threshold: 20,
  cooldownMin: 240,
  skipUnchanged: true,
};

export const CARD_WARN_MAX_COOLDOWN = 1440;
export const CARD_WARN_MAX_THRESHOLD = 100_000;

export const CARD_WARN_KEY_SETTINGS = "onethu.cardwarn.v1";
export const CARD_WARN_KEY_STATE = "onethu.cardwarn.state.v1";

/** 通知 id（固定）：重发即覆盖，撤回也认它 */
export const CARD_WARN_NOTIFY_ID = "card-warn:balance";
/** 通知渠道：Android 侧「校园卡余额」单独一档，用户可单独关掉 */
export const CARD_WARN_CHANNEL = "balance";
/** 点击通知落到生活页的校园卡栏 */
export const CARD_WARN_TARGET = encodeWidgetTarget("life", { lifeTab: "card" });

export interface CardWarnState {
  /** 上次提醒时的余额（null = 尚未提醒过） */
  warnedBalance: number | null;
  /** 上次提醒时刻（毫秒） */
  warnedAt: number | null;
  /** 通知处于「已发出、余额尚未恢复」的状态 */
  active: boolean;
  /** 最近一次投递是否送达（权限被关等会为 false，卡片据此说明原因） */
  delivered: boolean;
  /** 未送达的原因（已送达时为空串） */
  reason: string;
}

export const CARD_WARN_STATE_DEFAULT: CardWarnState = {
  warnedBalance: null,
  warnedAt: null,
  active: false,
  delivered: false,
  reason: "",
};

export type CardWarnAction = "notify" | "dismiss" | "none";

/** 判定原因（调试与卡片状态行共用；不是给用户看的成品文案） */
export type CardWarnReason = "off" | "recovered" | "first" | "repeat" | "cooldown" | "unchanged" | "steady";

export interface CardWarnVerdict {
  action: CardWarnAction;
  reason: CardWarnReason;
  /** 判定后的状态（投递结果回填 delivered / reason 之前） */
  state: CardWarnState;
}

/* ------------------------------- 持久化 ------------------------------- */

function readJson<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, v: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(v));
  } catch {
    /* 配额/隐私模式：内存态照常工作 */
  }
}

/** 读设置（缺字段用默认补齐；非法值一律回落默认，不让坏存储影响提醒） */
export function loadCardWarnSettings(): CardWarnSettings {
  const raw = readJson<Partial<CardWarnSettings>>(CARD_WARN_KEY_SETTINGS) ?? {};
  const num = (v: unknown, dflt: number, max: number): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : dflt;
  return {
    enabled: raw.enabled === true,
    threshold: num(raw.threshold, CARD_WARN_DEFAULTS.threshold, CARD_WARN_MAX_THRESHOLD),
    cooldownMin: Math.round(num(raw.cooldownMin, CARD_WARN_DEFAULTS.cooldownMin, CARD_WARN_MAX_COOLDOWN)),
    skipUnchanged: raw.skipUnchanged !== false,
  };
}

export function saveCardWarnSettings(patch: Partial<CardWarnSettings>): CardWarnSettings {
  const next = { ...loadCardWarnSettings(), ...patch };
  writeJson(CARD_WARN_KEY_SETTINGS, next);
  return next;
}

export function loadCardWarnState(): CardWarnState {
  const raw = readJson<Partial<CardWarnState>>(CARD_WARN_KEY_STATE) ?? {};
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    warnedBalance: num(raw.warnedBalance),
    warnedAt: num(raw.warnedAt),
    active: raw.active === true,
    delivered: raw.delivered === true,
    reason: typeof raw.reason === "string" ? raw.reason : "",
  };
}

export function saveCardWarnState(state: CardWarnState): void {
  writeJson(CARD_WARN_KEY_STATE, state);
}

/* ------------------------------- 判定 ------------------------------- */

/** 通知文案（title/body 与用户约定的口径一致：还剩多少 + 低于设置的多少）。
 *  标题里的品牌名与内容之间留一个空格（通知栏里更易读） */
export function cardWarnText(balance: number, threshold: number): { title: string; body: string } {
  return {
    title: "OneTHU 余额预警",
    body: `余额还剩 ¥${balance.toFixed(2)}，已低于设置的 ¥${threshold.toFixed(2)}`,
  };
}

/**
 * 判定这一次余额观察该做什么。
 *
 * 冷却是「两次提醒之间的间隔」，余额未变化抑制是「同一数值不重复」，两者独立：
 * 勾了后者时，冷却到点也不会重发，直到余额变了。
 */
export function evaluateCardWarn(input: {
  balance: number;
  now: number;
  settings: CardWarnSettings;
  state: CardWarnState;
}): CardWarnVerdict {
  const { balance, now, settings, state } = input;

  // 关掉预警：不再判定，已发出的通知要撤掉（否则残留一条「余额不足」关不掉）
  if (!settings.enabled) {
    return state.active
      ? { action: "dismiss", reason: "off", state: { ...CARD_WARN_STATE_DEFAULT } }
      : { action: "none", reason: "off", state: { ...CARD_WARN_STATE_DEFAULT } };
  }

  if (!Number.isFinite(balance)) return { action: "none", reason: "steady", state };
  if (balance > settings.threshold) {
    // 恢复正常：撤回通知并清空状态，下次再低于预警线要能立刻提醒
    return state.active || state.warnedBalance !== null
      ? { action: "dismiss", reason: "recovered", state: { ...CARD_WARN_STATE_DEFAULT } }
      : { action: "none", reason: "steady", state: { ...CARD_WARN_STATE_DEFAULT } };
  }

  const fire = (reason: "first" | "repeat"): CardWarnVerdict => ({
    action: "notify",
    reason,
    state: { warnedBalance: balance, warnedAt: now, active: true, delivered: false, reason: "" },
  });

  if (!state.active) return fire("first");
  // 「不重复提醒」＝ 事件驱动：余额一变就在刷新当下立刻提醒（不是定时提醒），
  // 因此该模式下冷却完全不参与判定；界面同步把冷却输入置灰，避免出现"设了没用"的字段。
  if (settings.skipUnchanged) {
    return state.warnedBalance === balance
      ? { action: "none", reason: "unchanged", state }
      : fire("repeat");
  }
  const cooldownMs = Math.max(0, settings.cooldownMin) * 60_000;
  if (state.warnedAt !== null && now - state.warnedAt < cooldownMs) {
    return { action: "none", reason: "cooldown", state };
  }
  return fire("repeat");
}

/* ------------------------------- 投递编排 ------------------------------- */

export interface CardWarnDeps {
  post: (n: { id: string; title: string; body: string; channel: string; target: string }) => Promise<{ ok: boolean; reason?: string }>;
  dismiss: (ids: string[]) => Promise<void>;
}

const PROD_DEPS: CardWarnDeps = {
  post: (n) => postNotificationNow(n),
  dismiss: (ids) => dismissNotifications(ids),
};

/** 状态变化的订阅（卡片状态行据此重画；不引入 React，任何环境可测） */
const listeners = new Set<() => void>();
export function subscribeCardWarn(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function emit(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* 订阅者自己的异常不影响判定 */
    }
  }
}

/** 串行化：两处 `useCard` 实例与设置变更可能在同一毫秒各观察一次，
 *  并发读到的都是「尚未提醒」就会重复判定，故状态读改写一律排队。 */
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function runObserve(balance: number, now: number, deps: CardWarnDeps): Promise<CardWarnAction> {
  const settings = loadCardWarnSettings();
  const verdict = evaluateCardWarn({ balance, now, settings, state: loadCardWarnState() });
  if (verdict.action === "none") return "none";

  if (verdict.action === "dismiss") {
    await deps.dismiss([CARD_WARN_NOTIFY_ID]);
    saveCardWarnState(verdict.state);
    emit();
    return "dismiss";
  }

  const { title, body } = cardWarnText(balance, settings.threshold);
  let res: { ok: boolean; reason?: string } = { ok: false, reason: "unknown" };
  try {
    res = await deps.post({
      id: CARD_WARN_NOTIFY_ID,
      title,
      body,
      channel: CARD_WARN_CHANNEL,
      target: CARD_WARN_TARGET,
    });
  } catch (e) {
    res = { ok: false, reason: String(e).slice(0, 80) };
  }
  // 已提醒状态照记：冷却按「提醒过一次」算，避免每次刷新都重投一次
  saveCardWarnState({ ...verdict.state, delivered: res.ok, reason: res.ok ? "" : (res.reason ?? "failed") });
  emit();
  return "notify";
}

/** 观察一次余额（任何刷新路径拿到新余额后调用）。整条链不抛错：提醒失败不该影响取数。 */
export function observeCardBalance(
  balance: number,
  opts?: { now?: number; deps?: CardWarnDeps },
): Promise<CardWarnAction> {
  const now = opts?.now ?? Date.now();
  const deps = opts?.deps ?? PROD_DEPS;
  return serialize(() => runObserve(balance, now, deps).catch(() => "none" as CardWarnAction));
}

/**
 * 设置变更后立刻生效：用当前已知余额重算一次。
 *
 * 关掉预警、把预警线调到当前余额之下，都要能马上撤回已展示的通知；反之把预警线调到
 * 余额之上、刚打开预警时，这条已有的余额就是一次观察，应当立即提醒。
 * `balance = null`（还没拿到余额）时只处理「关掉预警」这一种能确定的情形。
 */
export function applyCardWarnChange(
  balance: number | null,
  opts?: { now?: number; deps?: CardWarnDeps },
): Promise<CardWarnAction> {
  const now = opts?.now ?? Date.now();
  const deps = opts?.deps ?? PROD_DEPS;
  return serialize(async () => {
    const settings = loadCardWarnSettings();
    if (!settings.enabled) {
      const state = loadCardWarnState();
      if (!state.active) return "none" as CardWarnAction;
      await deps.dismiss([CARD_WARN_NOTIFY_ID]);
      saveCardWarnState({ ...CARD_WARN_STATE_DEFAULT });
      emit();
      return "dismiss" as CardWarnAction;
    }
    if (balance === null || !Number.isFinite(balance)) return "none" as CardWarnAction;
    return runObserve(balance, now, deps).catch(() => "none" as CardWarnAction);
  });
}

/** 未送达原因 → 用户能看懂的一句话（原生回报的是原因码，不直接上屏） */
const REASON_TEXT: Record<string, string> = {
  "notifications-denied": "系统通知未授权，请在系统设置里允许本应用通知",
  "not-implemented-desktop": "本平台暂不支持系统通知",
  "not-bundled": "应用未打包运行，系统通知不可用",
  "in-past": "投递时刻已过",
};

export function cardWarnReasonText(reason: string): string {
  const key = String(reason ?? "").trim();
  return REASON_TEXT[key] ?? (key || "系统通知不可用");
}

/** 卡片状态行用的一句话（入参是快照，纯函数） */
export function cardWarnStatusText(input: {
  settings: CardWarnSettings;
  state: CardWarnState;
  balance: number | null;
  now: number;
}): string {
  const { settings, state, balance, now } = input;
  if (!settings.enabled) return "未开启：余额低于预警线时不会提醒";
  if (balance !== null && balance > settings.threshold) {
    return `当前余额 ¥${balance.toFixed(2)}，高于预警线 ¥${settings.threshold.toFixed(2)}`;
  }
  if (state.active) {
    if (!state.delivered) return `提醒未送达：${cardWarnReasonText(state.reason)}`;
    const min = state.warnedAt === null ? null : Math.max(0, Math.floor((now - state.warnedAt) / 60_000));
    const ago = min === null ? "" : min < 1 ? "刚刚" : min < 60 ? `${min} 分钟前` : `${Math.floor(min / 60)} 小时前`;
    return `已提醒${ago ? `（${ago}）` : ""}`;
  }
  if (balance !== null) return `当前余额 ¥${balance.toFixed(2)}，已低于预警线`;
  return `余额低于 ¥${settings.threshold.toFixed(2)} 时提醒`;
}

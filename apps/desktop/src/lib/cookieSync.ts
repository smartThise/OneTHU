/**
 * F3 ④（b21）：两个 cookie 仓的同步与**单调保护**。
 *
 * 背景（阶段 0 只读取证结论，REDMI / dev 包 b20，原始 buffer 在临时目录）：
 *  - 实际发请求的是**原生仓**：`apps/desktop/src-tauri/src/lib.rs:1351` 的
 *    `http_native` 显式丢弃调用方传入的 `Cookie` 头（`matches!(lower.as_str(),
 *    "host" | "content-length" | "cookie") => continue`），收发全走
 *    `SharedNativeJar`（cookie_store，`lib.rs:1255-1274`）。JS 侧 `MemoryCookieJar`
 *    只是影子账本 + 老通道（`tauriFetch` → `http_request`，该命令自带
 *    `reqwest::Client::builder()`，**没有** cookie 仓，只能靠 JS 头供票）。
 *  - 真机两样本冷启（21:50:19 与 22:10:18）各抓 113s / 50s：JS jar 的
 *    `wengine_vpn_ticket` 恒为持久化快照里的同一个值（`wrdvpn1-b293…`，跨进程不变），
 *    原生仓每次冷启从 `(无)` 起铸一张新票（`wrdvpn1-ae98a5…` / `wrdvpn1-80f516…`），
 *    两仓并列数百行**从不相等**，且 JS 侧那张票从未被任何一方更新。
 *  - 因此同步方向是「**原生 → JS 回灌**为主」+「JS → 原生只走既有窄通道（引导页
 *    body 票，且基础设施票除外）」。回灌缺口正是长期不同步的来源。
 *  - 旁枝 (i)（b35，霖 2026-10-05 裁定「把旁支解决了」）：除「响应带 Set-Cookie」的被动
 *    回灌外，另有 `planJarReconcile` / `createCookieReconciler` 的**主动核对**（登录成功 /
 *    冷启就绪各一次，有界幂等）——方向仍是原生 → JS，基础设施票只回灌、不反播。
 *
 * 单调规则（本模块唯一职责，规则与依据都写在这里）：
 *  - 每个键（`host|path|name`）维护「当前值 + 曾经出现过的值集合」。传入值与当前值
 *    相同 → `same`（幂等，不重复写/不重复播种）；传入值是**曾经出现过、之后被换掉**
 *    的值 → `stale`（旧票回放，拒收）；其余 → `accept`（旧当前值退役，新值上位）。
 *  - 依据：wengine 票是服务端一次性随机签发（`wrdvpn1-` + 32 位随机 hex），同一值
 *    二次下发只可能是**旧票被回放**（2026-09-17 实录：引导页回放的陈旧匿名票覆盖了
 *    刚铸好的真票，首页瞬间全绿后几秒即死；`clients.ts` 的基础设施票过滤就是那次的
 *    产物）。票值上没有可靠的「签发/更新时间」字段，所以用「进程内观测顺序 + 值历史」
 *    作为单调序——这也是唯一在真机上可复核的序。
 *  - 进程冷启时历史为空：调用方应先用两仓里**已存在**的值做基线（本模块的
 *    `existingValue` 入参），这样「持久化快照里的旧票」会在第一张新票到来时退役，
 *    之后任何回放都被拒。
 *  - 边界（如实记）：如果某键在本进程里第一次收到的就是一个更旧的值，本模块无从
 *    分辨（没有服务端时间戳可依）；这只影响首次取值，不影响此后任何一次覆盖判定。
 */

/** 判定结果：accept = 采纳并上位；same = 与当前值相同（幂等）；stale = 旧票回放，拒收 */
export type CookieSyncDecision = "accept" | "same" | "stale";

/** wengine 基础设施票（与 `clients.ts` 播种过滤同一份名单，2026-09-17 定案）：
 *  这些票**绝不**由 JS 侧播种进原生仓（会盖掉刚铸好的真票），只在原生 → JS 方向回灌。 */
export function isWengineInfraCookie(name: string): boolean {
  return name === "wengine_vpn_ticket" || name.startsWith("show_") || name === "heartbeat" || name === "refresh";
}

interface Generation {
  current: string;
  /** 曾经是当前值、之后被换掉的值（保留最近若干代，够挡住回放即可） */
  seen: Set<string>;
}

const generations = new Map<string, Generation>();
/** 每个键保留的历史代数上限：只挡「刚被换掉又回来」的回放，不无限增长 */
const SEEN_LIMIT = 8;

export function cookieSyncKey(host: string, path: string, name: string): string {
  return `${host.toLowerCase()}|${path || "/"}|${name}`;
}

/** 清空世代表（冷启水合后调用；世代是进程内概念，不跨进程继承） */
export function resetCookieSyncState(): void {
  generations.clear();
}

/**
 * 单调判定（唯一真源）。
 * `existingValue` 只在该键首次出现时用作基线（通常传「该仓里已有的值」）；
 * 不传 = 该键此前没有任何基线，第一个观测到的值直接上位。
 */
export function decideCookieSync(key: string, value: string, existingValue?: string | null): CookieSyncDecision {
  const base = existingValue === undefined ? null : existingValue;
  let g = generations.get(key);
  if (!g) {
    // `seen` 始终包含当前值：这样「当前值被换掉之后再回来」必被 stale 挡住
    // （stale 判定只在 value !== current 时到达，所以把 current 放进 seen 无副作用）。
    g = { current: base ?? value, seen: new Set(base === null ? [value] : [base]) };
    generations.set(key, g);
    // 没有基线 = 本进程第一次观测到这个键：直接采纳（不做跨会话猜测）。
    // 有基线（仓里的现值）则继续走常规判定：同值 same、新值 accept、旧值 stale。
    if (base === null) return "accept";
  }
  if (value === g.current) return "same";
  if (g.seen.has(value)) return "stale";
  g.seen.add(value);
  while (g.seen.size > SEEN_LIMIT) {
    const oldest = g.seen.values().next().value;
    if (oldest === undefined) break;
    g.seen.delete(oldest);
  }
  g.current = value;
  return "accept";
}

/** Set-Cookie 行的 cookie 名（`name=value; attrs`） */
export function cookieNameOf(line: string): string {
  const eq = line.indexOf("=");
  if (eq <= 0) return "";
  const semi = line.indexOf(";");
  return (semi >= 0 && semi < eq ? line.slice(0, semi) : line.slice(0, eq)).trim();
}

/** Set-Cookie 行的 cookie 值 */
export function cookieValueOf(line: string): string {
  const eq = line.indexOf("=");
  if (eq < 0) return "";
  const semi = line.indexOf(";");
  return line.slice(eq + 1, semi < 0 ? undefined : semi).trim();
}

/**
 * 基础设施票的回灌行：**强制** `Path=/` 且丢掉原 `Domain=` 属性。
 * 理由：回灌目标键必须是「物理跳主机 + 路径 /」（`LIB-JAR` 旁证与
 * `hopCookieProvider` 读的都是这个键）；若保留 `Domain=.tsinghua.edu.cn`，
 * JS jar 里会多出一条同值异键记录，旁证仍只读到旧值，两仓看起来永远不同步。
 * 基础设施票只在 webvpn 物理域使用，收窄到 host-only 不影响实际收发。
 */
export function infraMirrorLine(line: string): string {
  return `${cookieNameOf(line)}=${cookieValueOf(line)}; Path=/`;
}

export interface CookieMirrorPlan {
  url: string;
  line: string;
}

/**
 * 原生 → JS 回灌计划（**只在原生响应带 Set-Cookie 时**被调用）。
 * 只看 wengine 基础设施票：其余 cookie 的入账仍走既有 `jar.setFromResponse`
 * 的「解码回真实域」路径，本模块不碰（避免影响老通道供票）。
 * `existingValueOf` 用来给世代表打基线（调用方传 JS jar 里同键的现值）。
 */
export function planNativeCookieMirror(
  hops: Array<{ u: string; l: string }>,
  existingValueOf?: (host: string, path: string, name: string) => string | null,
): CookieMirrorPlan[] {
  const out: CookieMirrorPlan[] = [];
  for (const h of hops) {
    const name = cookieNameOf(h.l);
    if (!name || !isWengineInfraCookie(name)) continue;
    let host: string;
    try {
      host = new URL(h.u).hostname;
    } catch {
      continue;
    }
    const existing = existingValueOf ? existingValueOf(host, "/", name) : null;
    if (decideCookieSync(cookieSyncKey(host, "/", name), cookieValueOf(h.l), existing) !== "accept") continue;
    out.push({ url: h.u, line: infraMirrorLine(h.l) });
  }
  return out;
}

/** 原生仓只读快照的一行（Rust `http_native_cookie_dump`）：host/path 是**生效**值
 *  （host-only 也会解析出主机），不是原始 `Domain=` 属性。 */
export interface NativeCookieRecord {
  host: string;
  path: string;
  name: string;
  value: string;
}

export interface CookieReconcileStats {
  total: number;
  missing: number;
  updated: number;
  same: number;
  stale: number;
  infra: number;
}

export interface CookieReconcileResult {
  plans: CookieMirrorPlan[];
  stats: CookieReconcileStats;
}

/**
 * ④ 旁枝 (i)（b35）：**主动核对计划**——把原生仓里「存在而 JS 缺 / 不同」的键按单调规则
 * 回灌到 JS 侧（有界：只在调用方给定的挂点跑；幂等：同值不产出任何写行）。
 *
 * 方向仍是「原生 → JS」：本函数只产出**写 JS jar** 的行，绝不产出反播原生的播种行。
 * 基础设施票与 b21 的回灌同一口径——键收窄到「物理域 + Path=/」并且**只回灌、不反播**
 * （反播口只有 `planSeedToNative`，它对基础设施票恒 `null`）。
 * `existingValueOf` 传 JS jar 里同键的现值：既作世代基线，也用来区分「JS 缺（missing）」
 * 与「JS 有但不同（updated）」。
 */
export function planJarReconcile(
  cookies: NativeCookieRecord[],
  existingValueOf?: (host: string, path: string, name: string) => string | null,
): CookieReconcileResult {
  const plans: CookieMirrorPlan[] = [];
  const stats: CookieReconcileStats = { total: 0, missing: 0, updated: 0, same: 0, stale: 0, infra: 0 };
  for (const c of cookies) {
    if (!c || !c.name || !c.host) continue;
    stats.total += 1;
    const infra = isWengineInfraCookie(c.name);
    const path = infra ? "/" : c.path || "/";
    const key = cookieSyncKey(c.host, path, c.name);
    const existing = existingValueOf ? existingValueOf(c.host, path, c.name) : null;
    if (existing === c.value) {
      decideCookieSync(key, c.value, existing); // 推进世代基线，但不写（同值幂等）
      stats.same += 1;
      continue;
    }
    const decision = decideCookieSync(key, c.value, existing);
    if (decision === "same") {
      stats.same += 1;
      continue;
    }
    if (decision === "stale") {
      stats.stale += 1;
      continue;
    }
    if (existing === null) stats.missing += 1;
    else stats.updated += 1;
    if (infra) stats.infra += 1;
    plans.push({ url: `https://${c.host}${path}`, line: `${c.name}=${c.value}; Path=${path}` });
  }
  return { plans, stats };
}

/** 主动核对的触发器：登录成功（含 2FA / 静默重登的 `login()`）与冷启就绪（`resumeSession`）。 */
export type CookieReconcileTrigger = "login" | "boot";

export interface CookieReconcileIO {
  /** 读原生仓只读快照（Rust `http_native_cookie_dump`）；失败应抛错，由 reconciler 静默降级 */
  dumpNative: () => Promise<NativeCookieRecord[]>;
  existingValueOf: (host: string, path: string, name: string) => string | null;
  /** 写 JS jar（唯一副作用出口；这里没有、也不许有「写原生仓」的口子） */
  writeJs: (plan: CookieMirrorPlan) => void;
  log: (line: string) => void;
}

export interface CookieReconciler {
  run: (trigger: CookieReconcileTrigger) => Promise<"done" | "skipped" | "failed">;
}

/**
 * 有界 / 幂等 / 可观测的主动核对执行器（业务侧与护栏同一份实现）。
 *  - **有界**：同一触发器本进程最多跑一次（`done` 集合），第二个调用返回 `skipped`；
 *    没有轮询、没有定时器、没有重试环。
 *  - **幂等**：同值不写（`planJarReconcile` 的 `same`）；单条坏跳跳过不影响其余。
 *  - **可观测**：每次真跑恰一行 `LIB-JAR-RECONCILE trigger=… native=… missing=… updated=…
 *    same=… stale=… infra=…`（只有计数，**不含票值**）；失败也留一行
 *    `LIB-JAR-RECONCILE trigger=… failed …`。
 *  - **失败静默降级**：`run` 绝不抛（核对失败不影响登录 / boot 主链）。
 */
export function createCookieReconciler(io: CookieReconcileIO): CookieReconciler {
  const done = new Set<CookieReconcileTrigger>();
  const log = (line: string): void => {
    try {
      io.log(line);
    } catch {
      /* 日志口坏不影响主链 */
    }
  };
  return {
    async run(trigger) {
      if (done.has(trigger)) return "skipped";
      done.add(trigger); // 先占位：并发重入也只跑一次
      try {
        const rows = await io.dumpNative();
        const { plans, stats } = planJarReconcile(rows, io.existingValueOf);
        for (const p of plans) {
          try {
            io.writeJs(p);
          } catch {
            /* 单条坏跳跳过，不影响其余 */
          }
        }
        log(
          `LIB-JAR-RECONCILE trigger=${trigger} native=${stats.total} missing=${stats.missing} ` +
            `updated=${stats.updated} same=${stats.same} stale=${stats.stale} infra=${stats.infra}`,
        );
        return "done";
      } catch (e) {
        log(`LIB-JAR-RECONCILE trigger=${trigger} failed ${e instanceof Error ? e.message : String(e)}`);
        return "failed";
      }
    },
  };
}

/**
 * JS → 原生播种计划（**只在既有播种挂点**——wengine 引导页 body 票——被调用）。
 * 返回 null = 不播种（基础设施票 / 空行 / 旧票回放 / 幂等重复）。
 * 这里**不**用 JS jar 的现值打基线：播种的输入本来就直接来自 jar，用它打基线会把
 * 每一次播种都判成 `same`。世代历史由两个方向共同喂——回灌方向喂基础设施票、播种
 * 方向喂所有被播过的票，所以「先播了 v1、之后换成 v2、v1 再回来」会被如实拒掉。
 * 边界（如实记）：若某票只在原生侧被换掉（JS 侧从未播过、回灌方向也不覆盖该票种），
 * 本模块对该票没有历史，JS 侧第一次递上来的旧值仍会被采纳——这一档由「播种口只接
 * 引导页 body 票 + 基础设施票永不禁播种」兜住，不做跨仓猜测。
 */
export function planSeedToNative(url: string, cookiePair: string): string | null {
  const name = cookieNameOf(cookiePair);
  if (!name) return null;
  if (isWengineInfraCookie(name)) return null;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (decideCookieSync(cookieSyncKey(host, "/", name), cookieValueOf(cookiePair), null) !== "accept") return null;
  return `${name}=${cookieValueOf(cookiePair)}; Path=/`;
}

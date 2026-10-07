/**
 * 在线服务（THOS 服务大厅原生化，上游 thu-info-app 5774b4a9 移植）。
 *
 * 数据层 = vendored @onethu/info-lib 的 thos-services 模块：
 *   prepareThosSession（计数+会话校验，roamingWrapper 内嵌登录链自愈）
 *   getThosTasks(kind)（进行中/待办/已办结/草稿/抄送/阶段性）
 *   getThosServices（服务目录）
 * —— 无任何新增登录/2FA/WebVPN 代码，会话随主登录链自愈（上游 docs/online-services.md 定案）。
 *
 * UI 适配：上游 RN ScrollView/TouchableOpacity/AsyncStorage → web div/localStorage；
 * 官方服务页动作走系统浏览器（openExternal）——Tauri webview 与 rust 会话
 * 不共享 cookie，内嵌 webview 的 cookie 桥是后续增强，不阻塞本期。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollectStar } from "../../components/Collect.js";
import { SEED_KEYWORDS, loadSeedState, pickSeedServices } from "../../lib/thosSeed.js";
import { enc, noteAtomCache } from "../../state/atoms.js";
import { IconPin } from "../../components/Icons.js";
import type {
  ThosCounts,
  ThosPage,
  ThosService,
  ThosTask,
  ThosTaskKind,
} from "@onethu/info-lib";
import { Card, Empty, ErrorNote, PageHead, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { useApp } from "../../state/context.js";

type Tab = ThosTaskKind | "services";

const TASK_KINDS: ThosTaskKind[] = ["active", "todo", "completed", "drafts", "unread", "phases"];
const PRIMARY: ThosTaskKind[] = ["active", "todo", "completed"];

const KIND_LABEL: Record<ThosTaskKind, string> = {
  active: "进行中",
  todo: "待我处理",
  completed: "已办结",
  drafts: "草稿",
  unread: "抄送",
  phases: "阶段性事项",
};

const STATUS_LABEL: Record<string, string> = {
  退回修改: "已退回 · 需修改",
  待我处理: "待我处理",
  正在办理: "正在办理",
  已办结: "已办结",
  办理成功: "办理成功",
  办理失败: "办理未成功，请重试",
  已撤回: "已撤回",
  草稿: "草稿",
  未阅: "未阅",
  已阅: "已阅",
  待办理: "待办理",
};

/** 「任务已被XX办理」站方文案（上游 getThosTaskStatusLabel 同款兜底） */
function statusLabel(status: string): string {
  if (STATUS_LABEL[status]) return STATUS_LABEL[status]!;
  const prefix = "任务已被";
  const suffix = "办理";
  if (status.startsWith(prefix) && status.endsWith(suffix)) {
    return `已由 ${status.slice(prefix.length, status.length - suffix.length)} 办理`;
  }
  return status;
}

const PHASE_STATE: Record<string, string> = {
  "0": "待办理",
  "1": "进行中",
  "4": "成功",
  "5": "失败",
};
const phaseLabel = (state: string): string => PHASE_STATE[state] ?? "状态未知";

function favKey(userId: string): string {
  return `thos-favorites:${userId}`;
}

function recentKey(userId: string): string {
  return `thos-recent:${userId}`;
}

function loadRecent(userId: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(recentKey(userId)) ?? "[]");
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 预置「常用服务」的一次性标记（只做一次，之后完全由用户增删） */
function seedKey(userId: string): string {
  return `thos-favorites-seeded:${userId}`;
}


function loadFavorites(userId: string): string[] {
  try {
    const raw = localStorage.getItem(favKey(userId));
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const DATE_LABEL: Record<ThosTaskKind, string> = {
  completed: "办结时间",
  drafts: "最后修改",
  active: "申请时间",
  todo: "申请时间",
  unread: "抄送时间",
  phases: "申请时间",
};

/** 还没匹配上的预置关键词（仅用于日志说明"为什么常用里少一项"） */
function SEED_KEYWORDS_LEFT(done: string[]): string[] {
  return SEED_KEYWORDS.filter((k) => !done.includes(k));
}

export function ThosPage() {
  const { user, navParams } = useApp();
  const userId = user?.username ?? "";
  const demo = userId === "8888";
  const initialTab = (navParams as { thosTab?: Tab } | null)?.thosTab;

  const [tab, setTab] = useState<Tab>(initialTab ?? "services");
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<ThosCounts>();
  const [tasks, setTasks] = useState<Partial<Record<ThosTaskKind, ThosPage<ThosTask>>>>({});
  const [services, setServices] = useState<ThosPage<ThosService>>();
  const [favorites, setFavorites] = useState<string[]>([]);
  /** 最近打开过的服务（排序依据：收藏优先，其次最近使用，其余保持学校原序） */
  const [recent, setRecent] = useState<string[]>([]);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [updated, setUpdated] = useState<number>();
  const generation = useRef(0);

  useEffect(() => {
    setRecent(loadRecent(userId));
  }, [userId]);

  useEffect(() => {
    const list = loadFavorites(userId);
    setFavorites(list);
    // 有常用服务时默认进「常用服务」而不是「全部服务」（用户定案 2026-09-20）
    setOnlyFavorites(list.length > 0);
  }, [userId]);

  const load = useCallback(async () => {
    if (!userId) return;
    const token = ++generation.current;
    const alive = () => token === generation.current;
    setBusy(true);
    setError(undefined);
    setTasks({});
    setServices(undefined);
    setCounts(undefined);
    setUpdated(undefined);
    try {
      const { initInfoLib } = await import("../../lib/infoLib.js");
      const helper = initInfoLib();
      const result = await helper.prepareThosSession();
      if (!alive()) return;
      setCounts(result);
      const warnings: string[] = [];
      for (const kind of TASK_KINDS) {
        if (!alive()) return;
        try {
          const page = await helper.getThosTasks(kind);
          if (!alive()) return;
          setTasks((prev) => ({ ...prev, [kind]: page }));
        } catch {
          warnings.push(`${KIND_LABEL[kind]}列表加载失败`);
        }
      }
      if (!alive()) return;
      try {
        const page = await helper.getThosServices();
        if (alive()) setServices(page);
      } catch {
        warnings.push("服务列表没有加载出来，请刷新后重试");
      }
      if (alive()) {
        setUpdated(Date.now());
        setError(warnings.length ? warnings.join("\n") : undefined);
      }
    } catch {
      if (alive()) setError("连不上在线服务，登录可能已过期，请重新登录");
    } finally {
      if (alive()) setBusy(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 服务目录就绪 → 写入原子缓存：收藏面板可检索、OH 可一句话命中并打开 */
  useEffect(() => {
    const items = services?.items ?? [];
    if (items.length === 0) return;
    noteAtomCache({
      thosServices: items.map((x) => ({ id: x.id, name: x.name, department: x.department, url: x.url })),
    });
  }, [services]);

  /** 记录一次服务打开（用于"最近使用"排序；与收藏互不影响） */
  const recall = (id: string): void => {
    if (!id) return;
    const next = [id, ...recent.filter((x) => x !== id)].slice(0, 20);
    setRecent(next);
    try {
      localStorage.setItem(recentKey(userId), JSON.stringify(next));
    } catch {
      /* 存不下不影响会话 */
    }
  };

  /** 首启预置：把「亲友（来访/入校报备）」与「缓考」铆进常用服务。
   *  逐关键词记账 + 口语容错匹配（学校侧正式名与用户口语常有出入，见 lib/thosSeed.ts）；
   *  漏掉的关键词不记账，下次进页面继续补；匹配规则升级会重补一次（修本次事故）。 */
  useEffect(() => {
    const items = services?.items ?? [];
    if (!userId || items.length === 0) return;
    const state = loadSeedState(localStorage.getItem(seedKey(userId)));
    const { ids, done } = pickSeedServices(items, favorites, state.done);
    const changed = done.length !== state.done.length;
    if (ids.length === 0) {
      if (changed) {
        try {
          localStorage.setItem(seedKey(userId), JSON.stringify({ v: state.v, done }));
        } catch {
          /* 存不下不影响本次会话 */
        }
      }
      return;
    }
    const next = [...favorites, ...ids];
    setFavorites(next);
    setOnlyFavorites(true);
    // 留痕（不打印服务 id 之外的东西）：预置是"静默功能"，出问题只能靠日志定位
    void import("../../lib/clients.js")
      .then((m) => {
        const names = items.filter((x) => ids.includes(x.id)).map((x) => x.name);
        const pending = SEED_KEYWORDS_LEFT(done);
        return m.logLine(
          `[THOS-SEED] 常用服务预置：${names.join(" / ") || "无"}${pending.length ? `（未匹配待补：${pending.join("、")}）` : ""}`,
        );
      })
      .catch(() => undefined);
    try {
      localStorage.setItem(favKey(userId), JSON.stringify(next));
      localStorage.setItem(seedKey(userId), JSON.stringify({ v: state.v, done }));
    } catch {
      /* 存不下也不影响本次会话 */
    }
  }, [services, favorites, userId]);

  const favorite = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id];
    setFavorites(next);
    if (onlyFavorites && next.length === 0) setOnlyFavorites(false);
    try {
      localStorage.setItem(favKey(userId), JSON.stringify(next));
    } catch {
      setError("收藏未保存，请再试一次");
    }
  };

  /** 内嵌官方页：rust 在 webview 内自动完成 THOS 漫游链（id 表单页自动填表
   *  SM2 提交 → thu-oauth callback → webvpn 票落地 webview cookie），随后
   *  top-level 导航到目标页——零二次登录。
   *  R21：这里曾内联复份整条打开链、失败只 setError（横幅不显眼时等于"点了没反应"）；
   *  现委托 openThosInApp——失败 toast 明示 + 回落系统浏览器，打开链全应用只剩一份。 */
  const openOfficial = async (url: string) => {
    try {
      const { logLine } = await import("../../lib/clients.js");
      await logLine(`[THOS-UI] openOfficial 入口 demo=${demo} url=${url.slice(0, 60)}`);
    } catch { /* noop */ }
    if (demo || !url) return;
    const { openThosInApp } = await import("../../lib/thosOpen.js");
    await openThosInApp(url);
  };

  const rows = tab === "services" ? [] : (tasks[tab]?.items ?? []);
  const pending = tab === "todo"
    ? [
        ...rows,
        ...(tasks.active?.items ?? []).filter(
          (x) => ["退回修改", "待我处理"].includes(x.status) && !rows.some((item) => item.id === x.id),
        ),
      ]
    : rows;
  const taskRows = useMemo(
    () =>
      pending.filter((x) =>
        `${x.title} ${x.node} ${x.id} ${x.status} ${x.workflowStatus ?? ""} ${x.summary ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, query, tab],
  );
  const serviceRows = useMemo(() => {
    const rows = (services?.items ?? []).filter(
      (x) =>
        (!onlyFavorites || favorites.includes(x.id)) &&
        `${x.name} ${x.department}`.toLowerCase().includes(query.toLowerCase()),
    );
    // 可解释排序：已收藏 → 最近打开过 → 其余保持学校原序（稳定排序，不改动同档内相对次序）
    const rank = new Map(recent.map((id, i) => [id, i] as const));
    return [...rows].sort((a, b) => {
      const fa = favorites.includes(a.id) ? 0 : 1;
      const fb = favorites.includes(b.id) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }, [services, onlyFavorites, favorites, query, recent]);
  const page = tab === "services" ? services : tasks[tab];
  const complete = page?.complete && (tab !== "todo" || tasks.active?.complete);

  const tabBtn = (id: string, label: React.ReactNode, selected: boolean, onClick: () => void) => (
    <button key={id} role="tab" aria-selected={selected} className={selected ? "is-active" : ""} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <>
      <PageHead
        title="在线服务"
        meta={updated ? `更新于 ${new Date(updated).toLocaleTimeString()}` : undefined}
        actions={
          <button className="btn btn-ghost" onClick={() => void load()} disabled={busy}>
            刷新
          </button>
        }
      />
      {demo ? (
        <Card>
          <Empty text="演示模式：8888 账号的在线服务数据为虚构，官方页动作已禁用。" />
        </Card>
      ) : null}
      <div className="thos-note">
        <div className="thos-note-row">
          <span className="thos-note-tag">首次</span>
          <span>自动填充账号密码登录，随后进入服务大厅，可在大厅里选择业务。</span>
        </div>
        <div className="thos-note-row">
          <span className="thos-note-tag">之后</span>
          <span>点选服务直接跳转对应页面，不再经过服务大厅。</span>
        </div>
      </div>
      <input
        className="thos-search"
        aria-label="搜索在线服务"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          tab === "services"
            ? onlyFavorites
              ? "搜索常用服务"
              : "搜索服务目录（名称/部门）"
            : "搜索事项（标题/节点/编号）"
        }
      />

      <div className="thos-tabs" role="tablist" aria-label="在线服务分类">
        {PRIMARY.map((kind) => tabBtn(kind, `${KIND_LABEL[kind]} ${counts?.[kind as keyof ThosCounts] ?? "—"}`, tab === kind, () => { setTab(kind); setQuery(""); setOnlyFavorites(false); }))}
        {(["drafts", "unread", "phases"] as ThosTaskKind[]).map((kind) =>
          tabBtn(kind, `${KIND_LABEL[kind]} ${(counts as Record<string, number | undefined> | undefined)?.[kind] ?? "—"}`, tab === kind, () => { setTab(kind); setQuery(""); setOnlyFavorites(false); }),
        )}
        {tabBtn("services-fav", `常用 ${favorites.length}`, tab === "services" && onlyFavorites, () => { setTab("services"); setOnlyFavorites(favorites.length > 0); setQuery(""); })}
        {tabBtn("services-all", "全部服务", tab === "services" && !onlyFavorites, () => { setTab("services"); setOnlyFavorites(false); setQuery(""); })}
      </div>


      {error ? <ErrorNote text={error} onRetry={() => void load()} /> : null}
      {busy && !page ? <SkeletonRows rows={4} /> : null}
      {!(tab === "services" && onlyFavorites) && !complete && page ? (
        <div className="thos-partial">结果可能不完整（分页读取未全部完成）</div>
      ) : null}
      {busy && page ? <div className="thos-partial">刷新中…</div> : null}

      {tab === "services" ? (
        <SectionHead title={onlyFavorites ? "常用服务" : "服务目录"} aside={`${serviceRows.length} 项`} />
      ) : (
        <SectionHead title={KIND_LABEL[tab]} aside={`${taskRows.length} 项`} />
      )}

      {tab === "services" ? (
        <div className="thos-grid">
          {serviceRows.map((item) => (
            <Card key={item.id} className="thos-service-card">
              <div className="row" style={{ animation: "none" }}>
                <button
                  className="row-main thos-service-open"
                  aria-label={`打开服务 ${item.name}`}
                  onClick={() => {
                    recall(item.id);
                    void openOfficial(item.url);
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <strong>{item.name}</strong>
                  </span>
                  <span className="dim">{item.department || "部门未提供"}</span>
                  {item.kind ? (
                    <span className="chip chip-amber">
                      {item.kind === "form" ? "表单" : item.kind === "guide" ? "指南" : item.kind === "integration" ? "集成" : "服务组"}
                    </span>
                  ) : null}
                </button>
                {/* 两个动作语义互不相同，故并列：
                    星号 = 统一收藏原子（收进任意收藏夹）；图钉 = 仅"在常用"（排序置顶） */}
                <span className="thos-service-actions">
                  <CollectStar
                    atom={{ kind: "thos-service", key: enc(item.id, item.name, item.department ?? "") }}
                    title={item.name}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={favorites.includes(item.id) ? `取消常用 ${item.name}` : `加入常用 ${item.name}`}
                    title={favorites.includes(item.id) ? "取消常用" : "钉在常用"}
                    style={{ color: favorites.includes(item.id) ? "var(--accent, #4176e6)" : "var(--text-3, #999)", flex: "none" }}
                    onClick={() => favorite(item.id)}
                  >
                    <IconPin width={14} height={14} />
                  </button>
                </span>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="thos-list">
          {taskRows.map((item) => (
            <Card key={`${item.kind}:${item.key}`} className="thos-task-card">
              <button
                className="row thos-task-open"
                style={{ animation: "none", width: "100%", textAlign: "left" }}
                onClick={() => openOfficial(item.url)}
                disabled={!item.url || demo}
              >
                <div className="row-main">
                  <strong>{item.title}</strong>
                  <span className="chip chip-amber">{statusLabel(item.status)}</span>
                  {item.workflowStatus ? <span className="chip">{statusLabel(item.workflowStatus)}</span> : null}
                  {item.node ? <span className="dim">节点：{item.node}</span> : null}
                  {item.summary ? <span className="dim">摘要：{item.summary}</span> : null}
                  {item.progress !== undefined ? (
                    <span className="thos-progress" aria-label={`进度 ${item.progress}%`}>
                      <span className="thos-progress-bar">
                        <span style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }} />
                      </span>
                      <span className="dim">{item.progress}%</span>
                    </span>
                  ) : null}
                  {item.date ? <span className="dim">{DATE_LABEL[item.kind]}：{item.date}</span> : null}
                </div>
              </button>
            </Card>
          ))}
        </div>
      )}

      {page && (tab === "services" ? serviceRows : taskRows).length === 0 && !busy ? (
        <Card>
          <Empty
            text={
              tab === "services" && onlyFavorites && !query && complete
                ? "还没有常用服务——去「全部服务」里点 ★ 收藏"
                : query
                  ? "没有匹配项"
                  : complete
                    ? "暂无事项"
                    : "暂无数据"
            }
          />
        </Card>
      ) : null}

    </>
  );
}

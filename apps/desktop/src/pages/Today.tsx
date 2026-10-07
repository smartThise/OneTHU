/**
 * 今日（首页）—— 全量卡片化：
 * - 卡片注册表（lib/homeCards.ts）：bespoke 特殊展示卡 + entry 一键入口大卡；
 * - 布局持久化：localStorage onethu.home.layout（列位 main/rail/off + 列内顺序 +
 *   折叠）与 onethu.home.defaults（各卡折叠偏好，重加/恢复默认时回填）；
 * - 统一 CardShell：标题行（标题+说明 + 右侧折叠箭头；编辑模式追加 ↑↓←→/✕），
 *   折叠 = 卡体收起只留标题行（chevron 旋转），展开/收起即时持久化；
 * - 编辑模式：PageHead「编辑」→ shell 显示列内上下移 / 跨栏左右移 / 隐藏（✕）；
 *   「添加卡片」弹层把被隐藏的卡片加回所选列末尾；「完成」退出；
 * - 数据 hook 仍集中在 TodayPage（照旧单次取数），bespoke 卡体是纯展示闭包。
 *   纯展示体已外移 components/HomeWidgets.tsx（万物原子化：同款组件的自持版
 *   可挂任意用户收藏夹；本页行为与外移前完全一致）。
 * 版式参考 thu-info-app 首页信息结构（只取语义；UI 仍用 OneTHU 设计系统）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Card, Empty, ErrorNote, PageHead } from "../components/Layout.js";
import { HomeCoachMarks } from "../components/HomeCoachMarks.js";
import { IconCalendar, IconChevron, IconFlag, IconRefresh, IconSchedule, IconTrace } from "../components/Icons.js";
import { useApp } from "../state/context.js";
import type { LearnNav, Page } from "../state/app.js";
import { useExpanded } from "../state/usePlatformLayout.js";
import { useCampusData, useCard, useTodayCalendar, useTodayDeadlines, useTodayNewsFeed, useTodayReservations } from "../state/data.js";
import {
  AgendaRows, CardBalanceBody, ClassRows, EntryCard, HomeworkRows, NewsRows, NoticeRows, ResvRows,
  RowClick, SECTION_OF, WEEKDAYS, calDaysUntil, deadlineMs, countdownChip, ymd,
  type AgendaRow,
} from "../components/HomeWidgets.js";
import { fmtMonthDayWeek } from "../lib/dateText.js";
import {
  buildHomeRegistry, loadCollapsedDefaults, loadLayout, resolveLayout,
  saveCollapsedDefaults, saveLayout, type HomeOrientation,
  HOME_CARD_META,
  type HomeCardDef, type HomeCardId, type HomeCol, type HomeLayoutItem,
} from "../lib/homeCards.js";
import { restoreDefaultTodayCards } from "../state/onboarding.js";
import { readSubs } from "./info/newsSearch.js";
import { openExternal } from "./info/openExternal.js";
import { toHomework, useExternalHomework } from "../state/exthw.js";
import { useIgnoredHw } from "../state/hwIgnore.js";
import { parseLearnTime, type ScheduleEntry } from "@onethu/core";
import { suggestAtoms } from "../lib/suggest.js";
import { resolveAtom } from "../state/atoms.js";

/** 轻路由签名（与 AppState.navigate 一致） */
type Nav = (page: Page, params?: LearnNav) => void;

/* ══════════ 最近使用 / 猜你喜欢（本机统计驱动，卡体为空则整卡不渲染） ══════════ */

/** 一行 = 一个原子。样式与「最近通知」等同款行（tl-bar + 标题/说明 + 右侧箭头）：
 *  之前用一个 accent-soft 的方形图标底，摆在首页像一排小按钮，"原子选择条"很怪。 */
function AtomUseRows({
  rows,
  onOpen,
  emptyText,
}: {
  rows: Array<{ ref: { kind: string; key: string }; title: string; sub?: string; why?: string }>;
  onOpen: (page: Page, params?: LearnNav) => void;
  /** 没有内容时显示的说明（**不再整卡消失**：只留这两张卡的用户会看到空白首页） */
  emptyText: string;
}) {
  const views = rows
    .map((r) => ({ r, view: resolveAtom(r.ref) }))
    .filter((x): x is { r: (typeof rows)[number]; view: NonNullable<ReturnType<typeof resolveAtom>> } => !!x.view);
  if (views.length === 0) {
    return (
      <Card className="list">
        <Empty text={emptyText} icon={<IconFlag width={20} height={20} />} />
      </Card>
    );
  }
  return (
    <Card className="list">
      {views.map(({ r, view }, i) => (
        <RowClick
          key={r.ref.kind + "~" + r.ref.key}
          style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
          onClick={() => view.open((p, params) => onOpen(p, params as LearnNav))}
        >
          <div className="tl-bar" style={{ background: "var(--border-strong)" }} />
          <div className="tl-main">
            <div className="tl-title">{r.title || view.title}</div>
            <div className="tl-sub">
              {r.why ? `${r.why} · ${r.sub ?? view.sub ?? ""}` : (r.sub ?? view.sub ?? "")}
            </div>
          </div>
          <IconChevron className="row-caret" width={14} height={14} />
        </RowClick>
      ))}
    </Card>
  );
}

/** 空态留痕：这类卡"没内容"必须能在日志里看出来，否则用户只看到一片空白 */
let emptyLogged: Record<string, boolean> = {};
/** 节次 → 当日分钟数（下一节课判定用）。SECTION_OF 是「开始时间」表，末节按 45 分钟一节算结束 */
function sectionStartMin(n: number): number | null {
  const t = SECTION_OF[n];
  if (!t) return null;
  const parts = t.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** "HH:MM" → 当日分钟数 */
function hhmmMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 当日分钟数 → "HH:MM" */
function minText(m: number): string {
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

function logEmpty(which: string): void {
  if (emptyLogged[which]) return;
  emptyLogged[which] = true;
  void import("../lib/clients.js")
    .then((m) => m.logLine(`[TODAY-CARD] ${which} 暂无内容（显示空态说明）`))
    .catch(() => undefined);
}

/** 猜你喜欢：同类推荐 + 起步项（绝不会是已收藏/已用过的） */
function suggestRows(): Array<{ ref: { kind: string; key: string }; title: string; sub?: string; why?: string }> {
  const rows = suggestAtoms(5).map((s) => ({ ref: s.ref, title: s.title, sub: s.sub, why: s.why }));
  if (rows.length === 0) logEmpty("猜你喜欢");
  return rows;
}

/* ══════════ CardShell（统一卡片外壳：标题行 + 折叠 + 编辑工具） ══════════ */

/** 已落位卡片（col 必为 main/rail；off 只存在于持久化表里） */
type PlacedCard = { id: HomeCardId; col: HomeCol; collapsed: boolean };

/** 编辑移动方向：up/down=列内移动；main/rail=跨栏移动 */
type MoveDir = "up" | "down" | "main" | "rail";

/** 卡片外壳：标题行（bespoke=标题+说明可点折叠；entry=入口大卡可点进入）
 *  + 右侧 [编辑工具][折叠箭头]。bespoke 卡体返回 null 时整卡不渲染（原隐藏行为）。 */
function HomeCard({
  def, item, index, count, editing, portrait, onOpen, onToggle, onMove, onRemove,
}: {
  def: HomeCardDef;
  item: PlacedCard;
  index: number;
  count: number;
  editing: boolean;
  portrait: boolean;
  onOpen: () => void;
  onToggle: (id: HomeCardId) => void;
  onMove: (id: HomeCardId, dir: MoveDir) => void;
  onRemove: (id: HomeCardId) => void;
}) {
  const body = def.kind === "bespoke" ? (def.render?.() ?? null) : null;
  if (def.kind === "bespoke" && body === null) return null;
  const collapsed = item.collapsed;
  const cls = "home-card" + (collapsed ? " is-collapsed" : "") + (editing ? " is-editing" : "");
  const Icon = def.icon;

  /* shellFree（今日概览条）：卡体即整卡；标题行常显（与编辑态一致），工具行仅编辑时出现 */
  if (def.shellFree && def.kind === "bespoke") {
    return (
      <section className={cls} data-card={def.id}>
        {
          <div className="home-card-head">
            <span className="home-card-title" style={{ cursor: "default" }}>
              <h2>{def.title}</h2>
              {def.aside ? <span className="home-card-aside">{def.aside}</span> : null}
            </span>
            {editing ? (
            <div className="home-card-tools">
              <button type="button" className="icon-btn tool-up" disabled={index === 0} title="上移" aria-label={"上移" + def.title} onClick={() => onMove(def.id, "up")}>
                <IconChevron width={13} height={13} />
              </button>
              <button type="button" className="icon-btn tool-down" disabled={index === count - 1} title="下移" aria-label={"下移" + def.title} onClick={() => onMove(def.id, "down")}>
                <IconChevron width={13} height={13} />
              </button>
              {!portrait ? (
                <>
                <button type="button" className="icon-btn tool-left" title={item.col === "main" ? "已在主栏" : "移到主栏"} aria-label={"把" + def.title + "移到主栏"} onClick={() => onMove(def.id, "main")}>
                  <IconChevron width={13} height={13} />
                </button>
                <button type="button" className="icon-btn tool-right" title={item.col === "rail" ? "已在侧栏" : "移到侧栏"} aria-label={"把" + def.title + "移到侧栏"} onClick={() => onMove(def.id, "rail")}>
                  <IconChevron width={13} height={13} />
                </button>
                </>
              ) : null}
              <button type="button" className="icon-btn tool-x" title="隐藏此卡片（可经「添加卡片」找回）" aria-label={"隐藏" + def.title} onClick={() => onRemove(def.id)}>
                ✕
              </button>
            </div>
            ) : null}
          </div>
        }
        <div className="home-card-body">{body}</div>
      </section>
    );
  }

  return (
    <section className={cls} data-card={def.id}>
      <div className="home-card-head">
        {def.kind === "entry" ? (
          <button
            type="button"
            className="home-entry-btn"
            disabled={editing}
            onClick={onOpen}
            aria-label={def.title}
            title={editing ? undefined : "打开「" + def.title + "」"}
          >
            <span className="home-entry-icon"><Icon width={20} height={20} /></span>
            <span className="home-entry-text">
              <span className="home-entry-name">{def.title}</span>
              {def.hint ? <span className="home-entry-hint">{def.hint}</span> : null}
            </span>
            {!editing ? <IconChevron width={14} height={14} className="row-caret" /> : null}
          </button>
        ) : (
          <button
            type="button"
            className="home-card-title"
            onClick={() => onToggle(def.id)}
            data-coach="home-collapse"
            aria-expanded={!collapsed}
            title={collapsed ? "展开" : "折叠"}
          >
            <h2>{def.title}</h2>
            {def.aside ? <span className="home-card-aside">{def.aside}</span> : null}
          </button>
        )}

        {editing ? (
          <div className="home-card-tools">
            <button type="button" className="icon-btn tool-up" disabled={index === 0} title="上移" aria-label={"上移" + def.title} onClick={() => onMove(def.id, "up")}>
              <IconChevron width={13} height={13} />
            </button>
            <button type="button" className="icon-btn tool-down" disabled={index === count - 1} title="下移" aria-label={"下移" + def.title} onClick={() => onMove(def.id, "down")}>
              <IconChevron width={13} height={13} />
            </button>
            {!portrait ? (
              <>
              <button type="button" className="icon-btn tool-left" title={item.col === "main" ? "已在主栏" : "移到主栏"} aria-label={"把" + def.title + "移到主栏"} onClick={() => onMove(def.id, "main")}>
                <IconChevron width={13} height={13} />
              </button>
              <button type="button" className="icon-btn tool-right" title={item.col === "rail" ? "已在侧栏" : "移到侧栏"} aria-label={"把" + def.title + "移到侧栏"} onClick={() => onMove(def.id, "rail")}>
                <IconChevron width={13} height={13} />
              </button>
              </>
            ) : null}
            <button
              type="button"
              className="icon-btn tool-x"
              title={def.kind === "entry" ? "隐藏此入口（可经「添加卡片」找回）" : "隐藏此卡片（可经「添加卡片」找回）"}
              aria-label={"隐藏" + def.title}
              onClick={() => onRemove(def.id)}
            >
              ✕
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className="icon-btn home-card-fold"
          aria-label={collapsed ? "展开" + def.title : "折叠" + def.title}
          data-coach="home-collapse"
            aria-expanded={!collapsed}
          title={collapsed ? "展开" : "折叠"}
          onClick={() => onToggle(def.id)}
        >
          <IconChevron width={15} height={15} />
        </button>
      </div>
      {def.kind === "bespoke" && !collapsed ? <div className="home-card-body">{body}</div> : null}
    </section>
  );
}

/** 添加卡片弹层：列出全部被隐藏的卡片（入口卡 + 固有内容卡），点击加入所选列末尾。 */
function AddCardsModal({
  hidden, portrait, onAdd, onClose,
}: {
  hidden: HomeCardDef[];
  portrait: boolean;
  onAdd: (id: HomeCardId, col: HomeCol) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="home-modal-mask" onClick={onClose}>
      <div className="home-modal" role="dialog" aria-modal="true" aria-label="添加首页卡片" onClick={(e) => e.stopPropagation()}>
        <div className="home-modal-head">
          <h3>添加卡片</h3>
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
        <div className="home-modal-body">
          <div className="home-modal-hint">
            点选「主栏 / 侧栏」把卡片加到该栏末尾；被隐藏的入口卡与固有内容卡（日程/作业/通知等）都可在这里找回。
          </div>
          {hidden.length === 0 ? (
            <Empty text="没有可添加的卡片——所有入口卡都已显示在首页上。" />
          ) : (
            hidden.map((def) => {
              const Icon = def.icon;
              return (
                <div key={def.id} className="home-modal-row">
                  <span className="home-entry-icon"><Icon width={18} height={18} /></span>
                  <div className="home-modal-text">
                    <div className="home-entry-name">{def.title}</div>
                    {def.hint ? <div className="home-entry-hint">{def.hint}</div> : null}
                  </div>
                  {portrait ? (
                    <button className="btn" onClick={() => onAdd(def.id, "main")}>添加</button>
                  ) : (
                    <>
                      <button className="btn" onClick={() => onAdd(def.id, "main")}>主栏</button>
                      <button className="btn" onClick={() => onAdd(def.id, "rail")}>侧栏</button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ══════════ 页面 ══════════ */

export function TodayPage() {
  const { navigate } = useApp();
  const { data, state, error, reload } = useCampusData();
  // 校园卡余额（快捷入口展示用）：未加载完成前入口置灰不可点
  const card = useCard(1);
  // 今日预约（座位 + 研讨间）：加载中/无预约都不渲染整卡
  const resv = useTodayReservations();
  // 最近日程（校历节点）：取不到数据时整卡隐藏
  const cal = useTodayCalendar();
  // 学校重要事项倒计时（info 门户 deadline 接口；失败静默，据此整卡隐藏）
  const { list: deadlineList, state: dlState } = useTodayDeadlines();
  // 订阅新闻（onethu.news.subs 来源优先，回退最新）：失败时整卡隐藏。
  // Today 页切走即卸载，回来自动重读 localStorage；storage 事件兜底跨标签同步。
  const [subs, setSubs] = useState<string[]>(() => readSubs());
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "onethu.news.subs") setSubs(readSubs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const news = useTodayNewsFeed(subs);
  // 倒计时时间窗的稳定「现在」（useMemo 依赖用；页头日期每次渲染取真实 now）
  const stableNow = useMemo(() => new Date(), []);
  const now = new Date();
  // 分端（§2.8.2）：PC/横屏（expanded）下问候语缩进顶栏，右栏常驻「下一节课」
  const expanded = useExpanded();
  const greetWord =
    now.getHours() < 5 ? "夜深了" : now.getHours() < 11 ? "早上好" : now.getHours() < 13 ? "中午好" : now.getHours() < 18 ? "下午好" : "晚上好";
  const nowMin = now.getHours() * 60 + now.getMinutes();

  /* ---- 朝向（宽>高=横屏）：竖屏/横屏各存一套布局 ---- */
  const [portrait, setPortrait] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(orientation: portrait)").matches : true,
  );
  const orientation: HomeOrientation = portrait ? "portrait" : "landscape";
  const oriRef = useRef<HomeOrientation>(orientation);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const on = (): void => setPortrait(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  /* ---- 布局持久化状态：首帧即可由注册表元数据对账出完整布局 ---- */
  const [layout, setLayout] = useState<HomeLayoutItem[]>(() => resolveLayout(HOME_CARD_META, loadLayout(oriRef.current)));

  /* 别处改了首页卡片（导览的「今日页留哪些卡」、设置里的恢复默认）→ 立刻重读。
     没有这条时，导览点完"完成"首页纹丝不动，用户得退出去再进来才看得到。 */
  useEffect(() => {
    const on = (): void => {
      setLayout(resolveLayout(HOME_CARD_META, loadLayout(oriRef.current)));
      setFoldDefaults(loadCollapsedDefaults());
    };
    window.addEventListener("onethu.home.changed", on);
    return () => window.removeEventListener("onethu.home.changed", on);
  }, []);
  const [foldDefaults, setFoldDefaults] = useState<Partial<Record<HomeCardId, boolean>>>(() => loadCollapsedDefaults());
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // 布局变动即时持久化到「当前朝向」的桶；朝向刚切换时先载入另一套，本次不保存（防串桶）
  useEffect(() => {
    if (orientation !== oriRef.current) {
      oriRef.current = orientation;
      setLayout(resolveLayout(HOME_CARD_META, loadLayout(orientation)));
      return;
    }
    saveLayout(layout, orientation);
  }, [layout, orientation]);
  // 折叠偏好每次变动即时持久化（含首帧：入口卡以 off 入库，完成「已知卡」登记）
  useEffect(() => {
    saveCollapsedDefaults(foldDefaults);
  }, [foldDefaults]);
  /* ---- 布局编辑操作 ---- */
  const toggleCard = (id: HomeCardId) => {
    const cur = layout.find((it) => it.id === id);
    if (!cur) return;
    const collapsed = !cur.collapsed;
    setLayout(layout.map((it) => (it.id === id ? { ...it, collapsed } : it)));
    // 折叠偏好同步记入 defaults：重加/恢复默认时按用户习惯回填
    setFoldDefaults((d) => ({ ...d, [id]: collapsed }));
  };

  const moveCard = (id: HomeCardId, dir: MoveDir) => {
    if (portrait && (dir === "up" || dir === "down")) {
      // 竖屏：无左右栏概念，按展示顺序（主栏→侧栏串成一条）上下移；
      // 跨过主/侧栏边界时继承邻居的栏位（回到横屏后位置自洽）
      setLayout((prev) => {
        const flat = prev.filter((it) => it.col === "main" || it.col === "rail");
        const k = flat.findIndex((it) => it.id === id);
        const nk = dir === "up" ? k - 1 : k + 1;
        if (k < 0 || nk < 0 || nk >= flat.length) return prev;
        const moving = flat[k];
        const neighbor = flat[nk];
        if (!moving || !neighbor) return prev;
        const rest = prev.filter((it) => it.id !== moving.id);
        const nIdx = rest.findIndex((it) => it.id === neighbor.id);
        // up = 插到邻居（上方卡）之前；down = 插到邻居（下方卡）之后——
        // 两个方向都插 nIdx 会把 down 变成落回原位的无操作
        rest.splice(dir === "up" ? nIdx : nIdx + 1, 0, { ...moving, col: neighbor.col });
        return rest;
      });
      return;
    }
    setLayout((prev) => {
      const moving = prev.find((it) => it.id === id);
      if (!moving || (moving.col !== "main" && moving.col !== "rail")) return prev;
      if (dir === "up" || dir === "down") {
        const col = prev.filter((it) => it.col === moving.col);
        const k = col.findIndex((it) => it.id === id);
        const nk = dir === "up" ? k - 1 : k + 1;
        if (k < 0 || nk < 0 || nk >= col.length) return prev;
        const a = col[k];
        const b = col[nk];
        if (!a || !b) return prev;
        return prev.map((it) => (it.id === a.id ? b : it.id === b.id ? a : it));
      }
      if (moving.col === dir) return prev; // 已在目标栏
      // 跨栏：原列同序位插入目标列（clamp 到目标列长）
      const from = prev.filter((it) => it.col === moving.col);
      const to = prev.filter((it) => it.col === dir);
      const k = from.findIndex((it) => it.id === id);
      from.splice(k, 1);
      to.splice(Math.min(k, to.length), 0, { ...moving, col: dir });
      const off = prev.filter((it) => it.col === "off");
      return [...from, ...to, ...off];
    });
  };

  /** 隐藏卡片（col→off；入口卡与固有 bespoke 卡一视同仁，均可经「添加卡片」找回） */
  const removeCard = (id: HomeCardId) => {
    setLayout((prev) => prev.map((it) => (it.id === id ? { ...it, col: "off" as const } : it)));
  };

  /** 把隐藏的卡片加回所选列末尾；竖屏无栏位概念，落到展示序列最末（继承末卡栏位） */
  const addCard = (id: HomeCardId, col: HomeCol) => {
    if (portrait) {
      setLayout((prev) => {
        const flat = prev.filter((it) => it.col === "main" || it.col === "rail");
        const endCol = flat.length > 0 ? flat[flat.length - 1]!.col : "main";
        const rest = prev.filter((it) => it.id !== id);
        return [...rest, { id, col: endCol, collapsed: foldDefaults[id] ?? false }];
      });
      return;
    }
    setLayout((prev) => {
      const rest = prev.filter((it) => it.id !== id);
      return [...rest, { id, col, collapsed: foldDefaults[id] ?? false }];
    });
  };

  /* ---- 数据派生（与外移前同口径） ---- */

  /** 未提交作业（首页作业区唯一口径：submitted===false，含已逾期，按截止升序）；
   *  合并外部作业（雨课堂/TUOJ/Tyche/DSA OJ）——未配置凭据时 extHw 恒为空，零回归 */
  const ext = useExternalHomework();
  const extHw = useMemo(() => ext.items.map(toHomework), [ext.items]);
  // R21c：忽略状态（忽略后不再出现在首页作业区，仍可在「全部作业 → 已忽略」找回）
  const ignored = useIgnoredHw();
  const unsubmitted = useMemo(
    () =>
      [...(data?.homework ?? []), ...extHw]
        .filter((h) => !h.submitted && !ignored.has(h.id)) // R21c：已忽略不进首页作业区
        .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [data, extHw, ignored],
  );

  /** 今天的日程事件：有 date 按 date 精确匹配（数据窗口跨 3 周不会重复），
   *  无 date 退回 dayOfWeek；按开始时间升序 */
  const todayEvents = useMemo<ScheduleEntry[]>(() => {
    const wd = now.getDay() === 0 ? 7 : now.getDay();
    const today = ymd(now);
    return (data?.schedule ?? [])
      .filter((s) => (s.date ? s.date === today : s.dayOfWeek === wd))
      .sort((a, b) => {
        const ta = a.startTime ?? SECTION_OF[a.startSection ?? 1] ?? "99:99";
        const tb = b.startTime ?? SECTION_OF[b.startSection ?? 1] ?? "99:99";
        return ta.localeCompare(tb);
      });
  }, [data]);

  /** 下一节课：今天还没结束的最近一节（§2.8.2 PC 右栏常驻卡）；今天没课 → 整卡不渲染 */
  const nextClass = useMemo(() => {
    for (const s of todayEvents) {
      const st = s.startTime ? hhmmMin(s.startTime) : sectionStartMin(s.startSection ?? 1);
      if (st == null) continue;
      const en = (sectionStartMin(s.endSection ?? s.startSection ?? 1) ?? st) + 45;
      if (en > nowMin) return { s, st, en, left: st - nowMin };
    }
    return null;
  }, [todayEvents, nowMin]);

  /** 三日内截止（今明后三天内、且尚未过期） */
  const dueSoon = useMemo(
    () =>
      unsubmitted.filter((h) => {
        const d = parseLearnTime(h.deadline);
        return d && d.getTime() >= now.getTime() && calDaysUntil(d) <= 2;
      }).length,
    [unsubmitted],
  );

  /** 日程与提醒合并时间线（校历节点 + 重要事项，日期升序取前 6） */
  const agendaRows = useMemo<AgendaRow[]>(() => {
    const calRows: AgendaRow[] =
      cal.state !== "ready"
        ? []
        : (cal.nodes ?? []).slice(0, 6).map((n) => ({
            key: n.key,
            date: n.date,
            title: n.name,
            sub: "校历 · 星期" + WEEKDAYS[n.date.getDay()],
            chipText: n.daysUntil === 0 ? "今天" : "还有 " + n.daysUntil + " 天",
            chipCls: n.daysUntil <= 1 ? "chip-red" : n.daysUntil <= 7 ? "chip-amber" : "chip-gray",
            barCls: n.key.endsWith("-end") ? "var(--amber)" : undefined,
            onClick: () => navigate("schedule"),
          }));
    const dlRows: AgendaRow[] =
      dlState !== "ready"
        ? []
        : (deadlineList ?? [])
            .map((d) => ({ ...d, beginMs: deadlineMs(d.begin), endMs: deadlineMs(d.end) }))
            .filter((d) => Number.isFinite(d.beginMs) && Number.isFinite(d.endMs))
            .filter((d) => stableNow.getTime() < d.endMs && stableNow.getTime() >= d.beginMs - 14 * 86400000)
            .sort((a, b) => a.beginMs - b.beginMs)
            .map((d) => {
              const chip = countdownChip(d.beginMs, d.endMs, stableNow);
              return {
                key: "dl-" + d.title + "-" + d.begin,
                date: new Date(d.beginMs),
                title: d.title,
                sub: "重要事项 · " + (d.begin ?? "").slice(5, 16) + " ~ " + (d.end ?? "").slice(5, 16),
                chipText: chip.text,
                chipCls: chip.cls,
                barCls: "var(--border-strong)",
                onClick: d.url ? () => void openExternal(d.url!) : undefined,
              } as AgendaRow;
            });
    return [...calRows, ...dlRows].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 6);
  }, [cal.state, cal.nodes, dlState, deadlineList, stableNow, navigate]);

  const dataReady = !(state === "loading" && !data);
  const courseName = (courseId: string) => data?.courses.find((c) => c.id === courseId)?.name ?? "课程";

  /* ---- 注册表：静态元数据 + bespoke 渲染闭包（数据 hook 全在本组件，单次取数） ---- */
  const registry: HomeCardDef[] = buildHomeRegistry({
    "balance-strip": {
      // 余额速览条（§2.2）：校园卡余额直读；电费需宿舍上下文（P2 接入），先做入口
      render: () => (
        <div className="balance-strip">
          <button className="balance-cell" onClick={() => navigate("life", { lifeTab: "card" })}>
            <span className="balance-label">校园卡</span>
            <span className="balance-value">
              {card.data?.info.balance != null ? "¥" + card.data.info.balance : "—"}
            </span>
          </button>
          <span className="balance-sep" aria-hidden />
          <button className="balance-cell" onClick={() => navigate("life", { lifeTab: "dorm", dormSection: "ele" })}>
            <span className="balance-label">宿舍电费</span>
            <span className="balance-value balance-value-dim">去查询</span>
          </button>
        </div>
      ),
    },
    "today-overview": {
      render: () => (
        <div className="stats stats-overview">
          <EntryCard
            num={dataReady ? unsubmitted.length : "–"}
            label="未交作业"
            dimLabel="未交作业"
            disabled={!dataReady}
            onClick={() => navigate("learn-assignments")}
          />
          <EntryCard
            num={dataReady ? dueSoon : "–"}
            label="三日内截止"
            dimLabel="三日内截止"
            disabled={!dataReady}
            onClick={() => navigate("learn-assignments")}
          />
          <EntryCard
            num={dataReady ? todayEvents.length : "–"}
            label="今日课程"
            dimLabel="今日课程"
            disabled={!dataReady}
            onClick={() => navigate("schedule")}
          />
        </div>
      ),
    },
    "next-class": {
      // 右栏常驻「下一节课」：时间 + 课名 + 地点；上课前给「还有 N 分钟」，上课中显示「进行中」
      render: () =>
        nextClass ? (
          <div className="next-class">
            <div className="next-class-when">
              <span className="next-class-time">{minText(nextClass.st) + "–" + minText(nextClass.en)}</span>
              <span className="next-class-left">{nextClass.left > 0 ? nextClass.left + " 分钟后" : "进行中"}</span>
            </div>
            <div className="next-class-name">{nextClass.s.courseName}</div>
            {nextClass.s.location ? <div className="next-class-where">{nextClass.s.location}</div> : null}
          </div>
        ) : null,
      aside: nextClass ? (nextClass.left > 0 ? nextClass.left + " 分钟后开始" : "正在进行") : undefined,
    },
    agenda: {
      // 两路都还没就绪 → 整卡不渲染；就绪但都为空 → 也隐藏（首页不留死卡）
      render: () => (agendaRows.length > 0 ? <AgendaRows rows={agendaRows} /> : null),
    },
    homework: {
      render: () => <HomeworkRows loading={!dataReady} rows={unsubmitted} courseName={courseName} navigate={navigate} />,
      aside: dataReady ? unsubmitted.length + " 条 · 点击查看详情" : "加载中…",
    },
    notices: {
      render: () => <NoticeRows items={data?.notifications ?? []} navigate={navigate} />,
    },
    "for-you": {
      render: () => (
        <AtomUseRows
          rows={suggestRows()}
          onOpen={navigate}
          emptyText="暂时没有可推荐的——用一会儿再来看，或到「编辑 → 添加卡片」挑你要的卡片。"
        />
      ),
    },
    cardEntry: {
      render: () => <CardBalanceBody balance={card.data?.info.balance ?? null} navigate={navigate} />,
    },
    resv: {
      render: () => (resv.state === "ready" && (resv.list?.length ?? 0) > 0 ? <ResvRows list={resv.list!} navigate={navigate} /> : null),
    },
    classes: {
      render: () => <ClassRows events={todayEvents} navigate={navigate} />,
    },
    news: {
      render: () => (news.state === "ready" && (news.data?.list.length ?? 0) > 0 ? <NewsRows feed={news.data!} navigate={navigate} /> : null),
      aside:
        news.state === "ready" && news.data
          ? news.data.from === "subs"
            ? "已订阅 " + news.data.subCount + " 来源 · 最新 " + news.data.list.length + " 条"
            : news.data.subCount > 0
              ? "订阅来源暂无新闻，显示最新"
              : "未订阅来源，显示最新"
          : undefined,
    },
  });
  const defById = useMemo(() => new Map(registry.map((d) => [d.id, d])), [registry]);

  /** 列内渲染序列（数组顺序即列内顺序） */
  const mainItems = useMemo(() => layout.filter((it): it is PlacedCard => it.col === "main"), [layout]);
  const railItems = useMemo(() => layout.filter((it): it is PlacedCard => it.col === "rail"), [layout]);
  const hiddenDefs = useMemo(
    () =>
      layout
        .filter((it) => it.col === "off")
        .map((it) => defById.get(it.id))
        .filter((d): d is HomeCardDef => !!d),
    [layout, defById],
  );

  /** 竖屏展示序列：主栏在前、侧栏在后串成一条（与旧布局竖向堆叠顺序一致） */
  const flatItems = useMemo(() => (portrait ? [...mainItems, ...railItems] : mainItems), [portrait, mainItems, railItems]);

  // 布局留痕：卡片系统完全由 localStorage 驱动，"首页怎么空了"只能靠这一行回放
  // （记录已落位的卡 id 与朝向；每次进入今日页一行，便于对照设置里的选择）
  useEffect(() => {
    void import("../lib/clients.js")
      .then((m) =>
        m.logLine(
          `[TODAY] 朝向=${orientation} 主栏=[${mainItems.map((i) => i.id).join(",")}] 侧栏=[${railItems.map((i) => i.id).join(",")}] 收起=${layout.filter((i) => i.col === "off").length}`,
        ),
      )
      .catch(() => undefined);
  }, [orientation, mainItems, railItems, layout]);

  const renderCard = (it: PlacedCard, index: number, list: PlacedCard[]) => {
    const def = defById.get(it.id);
    if (!def) return null;
    return (
      <HomeCard
        key={it.id}
        def={def}
        item={it}
        index={index}
        count={list.length}
        editing={editing}
        portrait={portrait}
        onOpen={() => {
          if (def.entry) navigate(def.entry.page, def.entry.params);
        }}
        onToggle={toggleCard}
        onMove={moveCard}
        onRemove={removeCard}
      />
    );
  };

  return (
    <>
      <PageHead
        title="今日"
        meta={
          (expanded ? greetWord + " · " : "") +
          fmtMonthDayWeek(now) +
          (data?.user ? " · " + data.user.name : "")
        }
        actions={
          <>
            <button className="btn" onClick={() => void reload()} disabled={state === "loading"}>
              <IconRefresh width={14} height={14} />
              刷新
            </button>
            {editing ? (
              <>
                <button className="btn" onClick={() => setAddOpen(true)}>
                  添加卡片
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setEditing(false);
                    setAddOpen(false);
                  }}
                >
                  完成
                </button>
              </>
            ) : (
              <button className="btn" data-coach="home-edit" onClick={() => setEditing(true)}>
                编辑
              </button>
            )}
          </>
        }
      />

      <HomeCoachMarks />
      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      {/* 页面级问候（非卡片，§2.2）：时段问候 + 今日要事摘要 + 日程快捷入口。
          不进卡片系统——它是页面骨架，不该被「添加卡片」勾选。 */}
      <div className={"today-hero" + (expanded ? " is-slim" : "")}>
        {/* PC/横屏（expanded）：问候语已缩进顶栏（§2.8.2），这里不再重复一遍 */}
        {!expanded ? (
          <>
            <div className="today-hero-line">
              {greetWord}
              {data?.user?.name ? "，" + data.user.name : ""}
            </div>
            <div className="today-hero-sub">
              {todayEvents.length > 0
                ? "今天有 " + todayEvents.length + " 节课" + (todayEvents[0]?.startTime ? " · 第一节 " + todayEvents[0]!.startTime : "")
                : "今天没有课，自由安排"}
            </div>
          </>
        ) : null}
        <div className="today-quick">
          <button className="today-quick-chip" onClick={() => navigate("schedule")}>
            <IconSchedule width={14} height={14} />课表
          </button>
          <button className="today-quick-chip" onClick={() => navigate("trace")}>
            <IconTrace width={14} height={14} />寻迹
          </button>
          <button className="today-quick-chip" onClick={() => navigate("reserve")}>
            <IconFlag width={14} height={14} />预约
          </button>
          <button className="today-quick-chip" onClick={() => navigate("info", { infoTab: "calendar" })}>
            <IconCalendar width={14} height={14} />校历
          </button>
        </div>
      </div>
      {/* 顶部三块统计已并入「今日概览」卡（today-overview），随卡片系统移动/隐藏 */}
      {portrait ? (
        /* 竖屏：无左右栏，主栏+侧栏串成一条展示序列 */
        <div className="today-grid today-grid-flat" style={{ marginTop: 14 }}>
          <div className="today-col">{flatItems.map((it, i) => renderCard(it, i, flatItems))}</div>
        </div>
      ) : (
        <div className="today-grid" style={{ marginTop: 14 }}>
          <div className="today-col">{mainItems.map((it, i) => renderCard(it, i, mainItems))}</div>
          <div className="today-rail">{railItems.map((it, i) => renderCard(it, i, railItems))}</div>
        </div>
      )}

      {flatItems.length === 0 ? (
        <Card>
          <Empty text="首页卡片都被收起来了——恢复默认，或自己挑几张。" />
          <div style={{ display: "flex", justifyContent: "center", gap: 8, paddingBottom: 14 }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                // 一键自救：恢复注册表默认布局（今天页空白大多来自导览里"以为在选、其实全点掉"）
                restoreDefaultTodayCards(orientation);
                setLayout(resolveLayout(HOME_CARD_META, null));
              }}
            >
              恢复默认布局
            </button>
            <button className="btn" onClick={() => setEditing(true)}>
              自己挑卡片
            </button>
          </div>
        </Card>
      ) : null}

      {addOpen && editing ? (
        <AddCardsModal hidden={hiddenDefs} portrait={portrait} onAdd={addCard} onClose={() => setAddOpen(false)} />
      ) : null}
    </>
  );
}

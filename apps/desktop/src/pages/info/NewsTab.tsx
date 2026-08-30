/**
 * 校内新闻页 —— getNews 列表 + getNewsDetail 站内预览（thu-info-lib news.ts 同源）。
 * 点击条目先在应用内看正文（NEWS_DETAIL?xxid=…&_csrf= → object.xxDto），
 * 再由用户选择「在系统浏览器打开」原链接。
 *
 * 增强：
 * ① 搜索栏（300ms 防抖，全局生效：全部新闻/订阅动态两栏都吃同一搜索词）：
 *    「全部新闻」栏服务端 searchNews（thu-info-lib searchNewsList 同端点）优先，
 *    失败/演示态回退本地打分（newsSearch.tsx，SearchPage 加权思路）；「订阅动态」栏
 *    在订阅取数结果内做本地打分检索。命中词高亮。
 * ② 机构订阅（thu-info-app「动态」tab 金标准移植）：
 *    - 订阅条件以服务端为权威（core getNewsSubscriptionList ←
 *      querySubscribeConditionNameList/XXFB），localStorage onethu.news.subs 只做
 *      UI 偏好缓存；订阅管理弹层内添加（addNewsSubscription ← addSubscribeCondition，
 *      form-encoded dygz/mkid）与删除（removeNewsSubscription ←
 *      deleteSubscribeCondition/{id}/XXFB）即时调服务端并刷新。
 *    - 「订阅动态」＝单一分页列表（core getNewsListBySubscription ←
 *      POST querySubscribeInfomationPageList{currentPage,dyid}，不传 dyid =
 *      全部条件合并），逐页翻看——不是对已抓取页做本地过滤，也不做逐来源 fan-out。
 *      栏顶部来源 chips（「全部」+ 每个订阅条件一个子菜单，短标签取来源名/标题，
 *      横向可滚动、选中高亮，key=条件 dyid）：「全部」走合并分页，点单个条件按其
 *      dyid 精确取数，切 chip 重置分页与列表。
 *    - 弹层（及详情抽屉）createPortal 挂 body + 遮罩 flex 视口居中
 *      （zhjwxk/Courses.tsx maskStyle/panelStyle 同款）。
 * ③ 顶部 InfoPage 同款 segmented 二级分栏「全部新闻 / 订阅动态」
 *    （无订阅时隐藏分段控件，只显示全部新闻）。
 * ④ 首页新闻直达：可选 newsId（xxid）prop —— InfoPage 从 LearnNav.infoNewsId 下传；
 *    列表就绪后在列表中定位该条并自动打开详情（不在列表则用最小条目打开，标题由
 *    getNewsDetail 的 title 补充），打开后经 onConsumeNewsId 消费置空；不带参数时
 *    行为与旧版一致。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { NewsDetail, NewsItem } from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { IconDownload, IconExternal, IconSearch } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import { useNews } from "../../state/data.js";
import { info, downloadLearnUrl } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { openFilePreview } from "../../components/FilePreview.js";
import { RichContent } from "../learn/shared.js";
import { Highlight, byDateDesc, rankNews, readSubs, tokenize, writeSubs } from "./newsSearch.js";
import { openExternal } from "./openExternal.js";

const PAGE_SIZE = 20;

/** 来源行（info.getNewsSourceList 元素；本地结构化类型，不扩 core 导出面） */
interface NewsSourceRow {
  sourceId: string;
  sourceName: string;
}

/** 服务端订阅条件（core InfoClient.getNewsSubscriptionList 元素；本地结构化类型） */
interface SubCondition {
  id: string;
  source?: string;
  channel?: string;
  keyword?: string;
  title: string;
}

/** 条件的单行标签（来源 > 栏目 > 关键词 > 标题；lib makeStr 同序） */
const conditionLabel = (c: SubCondition): string =>
  c.source || c.channel || c.keyword || c.title || c.id;

interface DetailState {
  item: NewsItem;
  state: "loading" | "ok" | "error";
  data?: NewsDetail;
  err?: string;
}

/* ══════════ 弹层（createPortal 挂 body：视口定位不再受滚动容器/祖先 transform 影响）══════════ */
/* 订阅管理弹层：遮罩 flex 视口垂直居中（Courses.tsx maskStyle/panelStyle 同款） */
const subMaskStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  zIndex: 70,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
};
const subPanelStyle: CSSProperties = {
  width: "100%",
  maxWidth: 560,
  maxHeight: "78vh",
  display: "flex",
  flexDirection: "column",
  background: "var(--surface)",
  borderRadius: 14,
  border: "1px solid var(--border)",
  boxShadow: "0 18px 50px rgba(0, 0, 0, 0.28)",
};
const subPanelHead: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  padding: "14px 20px 12px",
  borderBottom: "1px solid var(--border)",
};
const subPanelBody: CSSProperties = { padding: "12px 20px 20px", overflowY: "auto" };

/* 新闻详情抽屉：同样挂 body，保持右侧滑出形态 */
const drawerMaskStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  justifyContent: "flex-end",
  zIndex: 60,
};
const drawerPanelStyle: CSSProperties = {
  width: "min(720px, 94vw)",
  background: "var(--surface)",
  overflowY: "auto",
  padding: "20px 26px 28px",
  borderRadius: "16px 0 0 16px",
  border: "1px solid var(--border)",
  borderRight: "none",
};

/** 新闻行：标题命中高亮；订阅动态行附加来源 chip 标注 */
function NewsRow({
  n,
  tokens,
  showSourceChip = false,
  delay = 0,
  onOpen,
}: {
  n: NewsItem;
  tokens: string[];
  showSourceChip?: boolean;
  delay?: number;
  onOpen: (item: NewsItem) => void;
}) {
  return (
    <button
      className="row row-link"
      style={{ animationDelay: `${delay}ms`, textAlign: "left", width: "100%" }}
      onClick={() => onOpen(n)}
      title="点击查看详情"
    >
      <div className="row-when">
        <b>{n.date ? n.date.slice(5, 10).replace("-", "/") : "--"}</b>
        <span>{n.source || "校内"}</span>
      </div>
      <div className="row-main">
        <div className="row-title" style={{ whiteSpace: "normal" }}>
          {n.topped ? <span className="chip chip-blue" style={{ marginRight: 8 }}>置顶</span> : null}
          <Highlight text={n.name} tokens={tokens} />
          {showSourceChip && n.source ? (
            <span className="chip chip-gray" style={{ marginLeft: 8 }}>{n.source}</span>
          ) : null}
        </div>
      </div>
      {n.url ? <IconExternal width={14} height={14} /> : null}
    </button>
  );
}

export function NewsTab({
  newsId,
  onConsumeNewsId,
}: {
  /** 首页新闻直达 xxid（InfoPage 从 LearnNav.infoNewsId 下传；打开后消费置空） */
  newsId?: string | null;
  /** 直达消费回调：详情打开后通知 InfoPage 清掉待处理 newsId */
  onConsumeNewsId?: () => void;
} = {}) {
  const { status } = useApp();
  const demo = status === "demo";
  const [page, setPage] = useState(1);
  const { data, state, error, reload } = useNews(page, PAGE_SIZE);
  const [detail, setDetail] = useState<DetailState | null>(null);

  /* --- 附件下载（详情抽屉）：走桌面统一 download_file 链路 --- */
  /** 正在下载的附件 url（互斥按条目生效），及落盘结果/错误提示 */
  const [dlAtt, setDlAtt] = useState<string | null>(null);
  const [dlHint, setDlHint] = useState<string | null>(null);
  /** 附件下载：downloadLearnUrl 对任意 URL 通用（withLearnCsrf 对非 learn host 原样返回），
   *  info 附件 URL 已由 core 带 _csrf，Cookie 由共享 jar 按 info host 提供；落盘名用附件名。 */
  const doDownloadAtt = async (url: string, name: string): Promise<void> => {
    if (dlAtt) return;
    setDlAtt(url);
    setDlHint(null);
    try {
      const path = await downloadLearnUrl(url, name || "news-attachment");
      setDlHint(`已下载到：${path}`);
    } catch (err: unknown) {
      setDlHint("下载失败：" + explainNetworkError(err));
    } finally {
      setDlAtt(null);
    }
  };

  /* --- 分栏：全部新闻 / 订阅动态（无订阅时隐藏分段控件，恒显全部新闻） --- */
  const [seg, setSeg] = useState<"all" | "subs">("all");

  /* --- 搜索：输入即时回显，检索防抖 300ms（两个分栏共用同一搜索词） --- */
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [serverState, setServerState] = useState<"idle" | "loading" | "ok" | "fallback">("idle");
  const [serverResults, setServerResults] = useState<NewsItem[] | null>(null);

  /* --- 订阅：服务端条件为权威；localStorage onethu.news.subs 只做 UI 偏好缓存 --- */
  const [subs, setSubs] = useState<string[]>(() => readSubs());
  const [subsServer, setSubsServer] = useState<SubCondition[] | null>(null);
  const [subsTick, setSubsTick] = useState(0);
  const [subsOpen, setSubsOpen] = useState(false);
  const [sources, setSources] = useState<NewsSourceRow[] | null>(null);
  const [sourcesErr, setSourcesErr] = useState<string | null>(null);
  /** 弹层操作进行中（条件 id / 单位 id），互斥防连点 */
  const [opBusy, setOpBusy] = useState<string | null>(null);
  const [opErr, setOpErr] = useState<string | null>(null);

  /* 无订阅时隐藏分段控件并恒显「全部新闻」（避免订阅清空后停在空的订阅栏） */
  const activeSeg: "all" | "subs" = subs.length > 0 ? seg : "all";

  /* --- 订阅动态：单一分页列表（服务端按全部订阅条件合并返回） --- */
  const [subPage, setSubPage] = useState(1);
  /** 订阅动态来源 chip 选中项：条件 id（「all」= 全部条件合并分页） */
  const [subSel, setSubSel] = useState<string>("all");
  const [subFeed, setSubFeed] = useState<NewsItem[] | null>(null);
  const [subFeedState, setSubFeedState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [subFeedErr, setSubFeedErr] = useState<string | null>(null);
  const [subFeedTick, setSubFeedTick] = useState(0);

  /* 会话内已抓取新闻聚合（xxid 去重、翻页不丢）与已预览正文摘要（本地检索正文用） */
  const fetchedRef = useRef(new Map<string, NewsItem>());
  const plainRef = useRef(new Map<string, string>());
  const [plainBump, setPlainBump] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const fetchedList = useMemo(() => {
    for (const n of data ?? []) if (n.xxid) fetchedRef.current.set(n.xxid, n);
    return [...fetchedRef.current.values()];
  }, [data]);

  /* 服务端搜索优先（演示态跳过）；失败 → fallback，由本地打分兜底 */
  useEffect(() => {
    if (!query || demo) {
      setServerResults(null);
      setServerState("idle");
      return;
    }
    let alive = true;
    setServerState("loading");
    info
      .searchNews(query, 1)
      .then((rows) => {
        if (!alive) return;
        setServerResults(rows);
        setServerState("ok");
      })
      .catch(() => {
        if (!alive) return;
        setServerResults(null);
        setServerState("fallback");
      });
    return () => {
      alive = false;
    };
  }, [query, demo]);

  /* 订阅弹层首次打开拉全量可订阅单位（演示态不拉，用已抓取来源演示本地勾选） */
  useEffect(() => {
    if (!subsOpen || demo || sources) return;
    info
      .getNewsSourceList()
      .then((rows) => setSources(rows))
      .catch((err: unknown) => setSourcesErr(explainNetworkError(err)));
  }, [subsOpen, demo, sources, sourcesErr]);

  /* Esc 关闭订阅弹层（Courses 弹窗同款） */
  useEffect(() => {
    if (!subsOpen) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") setSubsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [subsOpen]);

  const tokens = useMemo(() => tokenize(query), [query]);

  /* 本地兜底检索：标题 10 / 来源 4 / 正文摘要 2（plainBump=新预览正文后重算） */
  const localResults = useMemo(
    () => rankNews(fetchedList, tokens, (n) => plainRef.current.get(n.xxid) ?? ""),
    [fetchedList, tokens, plainBump],
  );

  const searching = query.length > 0;
  const showServer = searching && serverState === "ok";
  const searchItems: NewsItem[] = showServer && serverResults
    ? serverResults
    : localResults.map((r) => r.item);

  /* 服务端订阅条件（权威）：挂载即拉并镜像到本地 UI 缓存；失败静默（先用本地缓存）。
   * subsTick 变化（弹层添加/删除成功后触发）即重拉刷新。 */
  useEffect(() => {
    if (demo) return;
    let alive = true;
    info
      .getNewsSubscriptionList()
      .then((rows) => {
        if (!alive) return;
        const conds: SubCondition[] = rows.map((r) => ({
          id: r.id,
          source: r.source,
          channel: r.channel,
          keyword: r.keyword,
          title: r.title,
        }));
        setSubsServer(conds);
        const labels = conds.map(conditionLabel);
        setSubs(labels);
        writeSubs(labels);
      })
      .catch(() => {
        /* 条件列表失败：保留本地缓存展示；弹层内会给出显式错误 */
      });
    return () => {
      alive = false;
    };
  }, [demo, subsTick]);

  /* 订阅动态来源 chips：每个订阅条件一个小子菜单（短标签 = 来源名优先，否则条件
   * 标题/栏目/关键词；key = 条件 id 即 dyid）。「全部」= 全部条件合并；
   * 演示态回退本地缓存标签。 */
  const subChips = useMemo(() => {
    if (demo) return subs.map((label) => ({ id: label, label }));
    return (subsServer ?? [])
      .filter((c) => c.id)
      .map((c) => ({ id: c.id, label: c.source || c.title || c.channel || c.keyword || `#${c.id}` }));
  }, [demo, subs, subsServer]);
  /** 选中条件 id（「all」= 全部条件合并分页，不传 dyid） */
  const subDyid = subSel === "all" ? undefined : subSel;
  /* 选中条件已被删除（不在 chips 中）→ 回退「全部」并重置分页 */
  useEffect(() => {
    if (subSel !== "all" && !subChips.some((c) => c.id === subSel)) {
      setSubSel("all");
      setSubPage(1);
    }
  }, [subSel, subChips]);

  /* 订阅动态单一分页列表：进入「订阅动态」栏（或翻页/刷新/切 chip/订阅变化）时取数。
   * POST querySubscribeInfomationPageList{currentPage,dyid?}：「全部」不传 dyid =
   * 服务端按该账号全部订阅条件合并返回；选中 chip 传其条件 dyid 精确取该子菜单列表
   * （thu-info-app「动态」tab 同端点），本地不做任何来源过滤 / 逐条件 fan-out。 */
  useEffect(() => {
    if (demo || activeSeg !== "subs") return;
    let alive = true;
    setSubFeedState("loading");
    setSubFeedErr(null);
    info
      .getNewsListBySubscription(subPage, subDyid)
      .then((rows) => {
        if (!alive) return;
        setSubFeed(rows);
        setSubFeedState("ready");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setSubFeedState("error");
        setSubFeedErr(explainNetworkError(err));
      });
    return () => {
      alive = false;
    };
  }, [demo, activeSeg, subPage, subFeedTick, subSel, subDyid]);

  /* 演示态无服务端订阅链：回退到已抓取（demo=DEMO_NEWS）内按缓存来源过滤（含来源 chip） */
  const subSet = useMemo(() => new Set(subs), [subs]);
  const demoFeed = useMemo(() => {
    const base = fetchedList.filter((n) => n.source && subSet.has(n.source)).sort(byDateDesc);
    return subSel === "all" ? base : base.filter((n) => n.source === subSel);
  }, [fetchedList, subSet, subSel]);

  /* 订阅动态栏的搜索：在订阅分页结果内本地打分（服务端搜索无法圈定订阅范围） */
  const subItems = demo ? demoFeed : (subFeed ?? []);
  const subShown = useMemo(
    () =>
      searching
        ? rankNews(subItems, tokens, (n) => plainRef.current.get(n.xxid) ?? "").map((r) => r.item)
        : subItems,
    [subItems, searching, tokens, plainBump],
  );
  /* thu-info-app 同判据：返回空页 = 到底；非空页即认为还有下一页 */
  const subCanNext = (demo ? demoFeed.length : (subFeed?.length ?? 0)) > 0;

  /* 弹层可添加单位：非演示 = 服务端可订阅单位权威集（fbdwnm 需其 id）；
   * 演示态回退到已抓取新闻中出现过的来源（本地勾选演示） */
  const modalSources = useMemo(() => {
    const seen = new Set<string>();
    const rows: NewsSourceRow[] = [];
    const push = (r: NewsSourceRow) => {
      const name = r.sourceName.trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      rows.push({ sourceId: r.sourceId || name, sourceName: name });
    };
    if (demo) {
      for (const n of fetchedList) {
        const name = (n.source ?? "").trim();
        if (name) push({ sourceId: name, sourceName: name });
      }
    } else if (sources) {
      [...sources].reverse().forEach(push);
    }
    return rows;
  }, [demo, fetchedList, sources]);

  /** 切换订阅动态来源 chip（按条件 id）：重置分页（「全部」= 全部条件合并分页） */
  const selectSubChip = (id: string) => {
    if (id === subSel) return;
    setSubSel(id);
    setSubPage(1);
  };

  /** 仅演示态：本地缓存勾选（无服务端） */
  const toggleSub = (name: string) => {
    setSubs((prev) => {
      const next = prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name];
      writeSubs(next);
      return next;
    });
  };

  /** 单位是否已订阅：非演示看服务端条件（source 名命中），演示看本地缓存 */
  const unitSubscribed = (name: string): boolean =>
    demo ? subs.includes(name) : (subsServer ?? []).some((c) => c.source === name);

  /* 删除一条服务端订阅条件；成功后刷新条件列表（权威镜像缓存）与订阅动态 */
  const removeCondition = async (c: SubCondition): Promise<void> => {
    setOpErr(null);
    setOpBusy(c.id);
    try {
      const ok = await info.removeNewsSubscription(c.id);
      if (!ok) throw new Error("服务端返回删除失败");
      setSubsTick((t) => t + 1);
      setSubFeedTick((t) => t + 1);
    } catch (err: unknown) {
      setOpErr(explainNetworkError(err));
    } finally {
      setOpBusy(null);
    }
  };

  /* 弹层点选单位：已订阅 → 删掉同名条件；未订阅 → 用单位 id 添加服务端条件。
   * 成功后刷新条件列表（权威镜像回本地缓存）与订阅动态。演示态只动本地缓存。 */
  const toggleUnit = async (unit: NewsSourceRow): Promise<void> => {
    if (demo) {
      toggleSub(unit.sourceName);
      return;
    }
    setOpErr(null);
    const existing = (subsServer ?? []).filter((c) => c.source === unit.sourceName);
    setOpBusy(unit.sourceId || unit.sourceName);
    try {
      if (existing.length > 0) {
        for (const c of existing) {
          const ok = await info.removeNewsSubscription(c.id);
          if (!ok) throw new Error("服务端返回删除失败");
        }
      } else {
        const ok = await info.addNewsSubscription({ sourceId: unit.sourceId });
        if (!ok) throw new Error("服务端返回添加失败");
      }
      setSubsTick((t) => t + 1);
      setSubFeedTick((t) => t + 1);
    } catch (err: unknown) {
      setOpErr(explainNetworkError(err));
    } finally {
      setOpBusy(null);
    }
  };

  const openDetail = (item: NewsItem) => {
    if (!item.xxid) {
      if (item.url) void openExternal(item.url);
      return;
    }
    setDetail({ item, state: "loading" });
    setDlHint(null);
    setDlAtt(null);
    info
      .getNewsDetail(item.xxid)
      .then((d) => {
        if (item.xxid && d.plain) {
          plainRef.current.set(item.xxid, d.plain);
          setPlainBump((b) => b + 1);
        }
        setDetail({ item, state: "ok", data: d });
      })
      .catch((err: unknown) =>
        setDetail({ item, state: "error", err: explainNetworkError(err) }),
      );
  };

  /* --- 首页新闻直达：newsId（xxid）→ 定位条目并打开详情，打开后消费置空 --- */
  const consumeRef = useRef(onConsumeNewsId);
  consumeRef.current = onConsumeNewsId;
  const openedNewsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!newsId) {
      openedNewsRef.current = null; // 消费置空后清标记：同一条新闻再次点击可重新打开
      return;
    }
    if (openedNewsRef.current === newsId) return;
    if (state === "loading") return; // 等列表数据到达（直达目标多在第 1 页可命中原始条目）
    const found = (data ?? []).find((n) => n.xxid === newsId) ?? null;
    openedNewsRef.current = newsId;
    // 不在当前列表（第 2 页/订阅动态条目）：用最小条目打开，正文到达后标题由详情补充
    openDetail(found ?? { name: "", xxid: newsId });
    consumeRef.current?.();
  }, [newsId, state, data, openDetail]);

  const canPrev = page > 1;
  const fullPage = (data?.length ?? 0) >= PAGE_SIZE;

  return (
    <>
      <SectionHead
        title="校内新闻"
        aside="信息门户发布 · 点击在系统浏览器打开"
        /* 分页控制放右侧 */
        key={`head-${page}`}
      />

      {/* 搜索栏 + 订阅管理入口（全局：两个分栏共用同一搜索词） */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <div className="search-box" style={{ flex: 1 }}>
          <IconSearch width={15} height={15} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="搜索标题 / 正文 / 来源（服务端优先，本地兜底）"
            aria-label="搜索新闻"
          />
          {input ? (
            <button className="btn btn-ghost" onClick={() => setInput("")}>清除</button>
          ) : null}
        </div>
        <button className="btn" onClick={() => setSubsOpen(true)}>
          订阅管理{subs.length > 0 ? `（${subs.length}）` : ""}
        </button>
      </div>

      {/* segmented 二级分栏（InfoPage 同款；无订阅时隐藏，只显示全部新闻） */}
      {subs.length > 0 ? (
        <div className="segmented" role="tablist" aria-label="新闻分栏" style={{ marginBottom: 10 }}>
          <button
            role="tab"
            aria-selected={activeSeg === "all"}
            className={activeSeg === "all" ? "is-active" : ""}
            onClick={() => setSeg("all")}
          >
            全部新闻
          </button>
          <button
            role="tab"
            aria-selected={activeSeg === "subs"}
            className={activeSeg === "subs" ? "is-active" : ""}
            onClick={() => setSeg("subs")}
          >
            订阅动态（{subs.length}）
          </button>
        </div>
      ) : null}

      {/* 分页/刷新（全部新闻栏专属） */}
      {activeSeg === "all" ? (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
          <button
            className="btn"
            disabled={!canPrev || state === "loading" || searching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span className="page-indicator">第 {page} 页</span>
          <button
            className="btn"
            disabled={!fullPage || state === "loading" || searching}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
          <button className="btn" onClick={() => void reload()} disabled={state === "loading"}>
            刷新
          </button>
        </div>
      ) : null}

      {searching && activeSeg === "all" ? (
        <>
          <SectionHead
            title={`搜索：${query}`}
            aside={
              showServer
                ? `服务端搜索 · ${searchItems.length} 条`
                : serverState === "loading"
                  ? localResults.length > 0
                    ? `本地先行 ${localResults.length} 条 · 服务端搜索中…`
                    : "服务端搜索中…"
                  : serverState === "fallback"
                    ? `本地兜底 · 已抓取 ${fetchedList.length} 条内检索（服务端搜索不可用）`
                    : `本地检索 · ${searchItems.length} 条`
            }
            key={`search-${query}`}
          />
          {searchItems.length === 0 ? (
            <Card>
              <Empty
                text={
                  serverState === "loading" && localResults.length === 0
                    ? "正在检索…"
                    : `没有与“${query}”相关的新闻。`
                }
              />
            </Card>
          ) : (
            <Card className="list">
              {searchItems.map((n, i) => (
                <NewsRow
                  key={n.xxid || `s${i}`}
                  n={n}
                  tokens={tokens}
                  delay={Math.min(i, 12) * 25}
                  onOpen={openDetail}
                />
              ))}
            </Card>
          )}
        </>
      ) : activeSeg === "subs" ? (
        <>
          <SectionHead
            title="订阅动态"
            aside={
              searching
                ? `“${query}” 命中 ${subShown.length} 条（${subSel === "all" ? "全部订阅" : `「${subChips.find((c) => c.id === subSel)?.label ?? subSel}」`}内检索）`
                : subSel === "all"
                  ? `已订阅 ${subsServer?.length ?? subs.length} 个条件 · 第 ${subPage} 页 · ${subShown.length} 条`
                  : `来源：${subChips.find((c) => c.id === subSel)?.label ?? subSel} · 第 ${subPage} 页 · ${subShown.length} 条`
            }
            key={`sub-feed-${searching ? query : ""}-${subPage}-${subSel}`}
          />

          {/* 来源 chips：每个订阅条件一个小子菜单（「全部」+ 来源名/标题短标签；
              横向可滚动；当前选中高亮；key = 条件 dyid） */}
          {subChips.length > 0 ? (
            <div
              role="tablist"
              aria-label="订阅来源"
              style={{
                display: "flex",
                gap: 6,
                overflowX: "auto",
                paddingBottom: 4,
                marginBottom: 10,
                scrollbarWidth: "thin",
              }}
            >
              <button
                key="all"
                role="tab"
                aria-selected={subSel === "all"}
                className={`chip ${subSel === "all" ? "chip-blue" : "chip-gray"}`}
                style={{ flexShrink: 0, whiteSpace: "nowrap", cursor: "pointer" }}
                onClick={() => selectSubChip("all")}
                title="全部订阅条件合并分页"
              >
                全部
              </button>
              {subChips.map((c) => {
                const active = subSel === c.id;
                return (
                  <button
                    key={c.id}
                    role="tab"
                    aria-selected={active}
                    className={`chip ${active ? "chip-blue" : "chip-gray"}`}
                    style={{ flexShrink: 0, whiteSpace: "nowrap", cursor: "pointer" }}
                    onClick={() => selectSubChip(c.id)}
                    title={`只看「${c.label}」的订阅列表（dyid=${c.id}）`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {subFeedState === "error" ? (
            <ErrorNote text={subFeedErr ?? ""} onRetry={() => setSubFeedTick((t) => t + 1)} />
          ) : null}
          <Card className="list">
            {subFeedState === "loading" ? (
              <SkeletonRows rows={6} />
            ) : subShown.length === 0 ? (
              <Empty
                text={
                  searching
                    ? `订阅动态中没有与“${query}”相关的新闻。`
                    : subPage > 1
                      ? "本页没有更多订阅动态了。"
                      : "该订阅条件暂无新闻——稍后刷新，或到订阅管理调整条件。"
                }
              />
            ) : (
              subShown.map((n, i) => (
                <NewsRow
                  key={n.xxid || `f${i}`}
                  n={n}
                  tokens={searching ? tokens : []}
                  showSourceChip
                  delay={Math.min(i, 12) * 25}
                  onOpen={openDetail}
                />
              ))
            )}
          </Card>
          {!demo && !searching ? (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
              <button
                className="btn"
                disabled={subPage <= 1 || subFeedState === "loading"}
                onClick={() => setSubPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </button>
              <span className="page-indicator">第 {subPage} 页</span>
              <button
                className="btn"
                disabled={!subCanNext || subFeedState === "loading"}
                onClick={() => setSubPage((p) => p + 1)}
              >
                下一页
              </button>
              <button
                className="btn"
                disabled={subFeedState === "loading"}
                onClick={() => setSubFeedTick((t) => t + 1)}
              >
                刷新
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

          {state === "loading" && !data ? (
            <SkeletonRows rows={8} />
          ) : (data?.length ?? 0) === 0 ? (
            <Card>
              <Empty text={page > 1 ? "本页没有更多新闻了。" : "暂无新闻。"} />
            </Card>
          ) : (
            <Card className="list">
              {data!.map((n, i) => (
                <NewsRow
                  key={n.xxid || i}
                  n={n}
                  tokens={[]}
                  delay={Math.min(i, 12) * 25}
                  onOpen={openDetail}
                />
              ))}
            </Card>
          )}
        </>
      )}

      {detail
        ? createPortal(
            <div style={drawerMaskStyle} onClick={() => setDetail(null)}>
              <div style={drawerPanelStyle} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                  <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.45 }}>
                    {detail.item.name || detail.data?.title || "新闻详情"}
                  </h2>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    {detail.item.url ? (
                      <button className="btn" onClick={() => void openExternal(detail.item.url!)}>
                        <IconExternal width={14} height={14} />
                        在浏览器打开
                      </button>
                    ) : null}
                    <button className="btn btn-ghost" onClick={() => setDetail(null)}>关闭</button>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 12 }}>
                  {[detail.item.source, detail.item.date].filter(Boolean).join(" · ")}
                </div>
                {detail.state === "loading" ? (
                  <SkeletonRows rows={6} />
                ) : detail.state === "error" ? (
                  <ErrorNote text={detail.err ?? ""} onRetry={() => openDetail(detail.item)} />
                ) : (
                  <>
                    <RichContent html={detail.data?.html} fallback="正文为空。" />
                    {detail.data && detail.data.attachments.length > 0 ? (
                      <div
                        style={{
                          marginTop: 14,
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: "10px 12px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                          附件（{detail.data.attachments.length}）
                        </div>
                        {detail.data.attachments.map((a, i) => (
                          <div key={`${i}-${a.url}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ flexShrink: 0 }}>📄</span>
                            <span
                              style={{ flex: 1, fontSize: 13, overflowWrap: "anywhere" }}
                              title={a.name}
                            >
                              {a.name}
                            </span>
                            <button
                              className="btn btn-ghost"
                              onClick={() => openFilePreview({ name: a.name, url: a.url })}
                            >
                              预览
                            </button>
                            <button
                              className="btn btn-ghost"
                              disabled={dlAtt === a.url}
                              onClick={() => void doDownloadAtt(a.url, a.name)}
                            >
                              <IconDownload width={14} height={14} />
                              {dlAtt === a.url ? "下载中…" : "下载"}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {dlHint ? (
                      <div style={{ marginTop: 8, fontSize: 12, color: "var(--accent)", overflowWrap: "anywhere" }}>
                        {dlHint}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}

      {subsOpen
        ? createPortal(
            <div style={subMaskStyle} onClick={() => setSubsOpen(false)}>
              <div style={subPanelStyle} onClick={(e) => e.stopPropagation()}>
                <div style={subPanelHead}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>订阅管理</h3>
                  <button className="btn btn-ghost" onClick={() => setSubsOpen(false)}>关闭</button>
                </div>
                <div style={subPanelBody}>
                  <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 12 }}>
                    订阅条件以信息门户服务端为权威（与 thu-info 同接口、同账号），添加/删除
                    即时写入门户订阅并刷新；本机 localStorage 仅作界面偏好缓存。
                  </div>
                  {opErr ? <ErrorNote text={opErr} /> : null}

                  {/* 我的订阅（服务端权威条件列表） */}
                  <div style={{ fontSize: 13, fontWeight: 600, margin: "4px 0 8px" }}>
                    我的订阅{subsServer ? `（${subsServer.length}）` : ""}
                  </div>
                  {!demo && subsServer === null ? <SkeletonRows rows={2} /> : null}
                  {demo ? (
                    <Empty text="演示态无服务端订阅，仅本地缓存演示。" />
                  ) : subsServer && subsServer.length === 0 ? (
                    <Empty text="暂无订阅条件——在下方点选发布单位即可添加。" />
                  ) : subsServer && subsServer.length > 0 ? (
                    <div style={{ marginBottom: 12 }}>
                      {subsServer.map((c) => (
                        <div key={c.id} className="row" style={{ alignItems: "center", gap: 10 }}>
                          <div className="row-main">
                            <div className="row-title" style={{ whiteSpace: "normal" }}>
                              {c.title || conditionLabel(c)}
                            </div>
                            <div className="row-sub">
                              {[
                                c.source ? `来源：${c.source}` : "",
                                c.channel ? `栏目：${c.channel}` : "",
                                c.keyword ? `关键词：${c.keyword}` : "",
                              ].filter(Boolean).join(" · ") || `#${c.id}`}
                            </div>
                          </div>
                          <button
                            className="btn btn-ghost"
                            style={{ flexShrink: 0 }}
                            disabled={opBusy !== null}
                            onClick={() => void removeCondition(c)}
                            title="删除该服务端订阅条件"
                          >
                            {opBusy === c.id ? "删除中…" : "删除"}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {/* 添加订阅（点选发布单位 → addSubscribeCondition） */}
                  <div style={{ fontSize: 13, fontWeight: 600, margin: "4px 0 8px" }}>
                    添加订阅（点选发布单位）
                  </div>
                  {sourcesErr ? (
                    <ErrorNote text={`可订阅单位列表加载失败：${sourcesErr}`} />
                  ) : null}
                  {!demo && !sources && !sourcesErr ? <SkeletonRows rows={3} /> : null}
                  {modalSources.length > 0 ? (
                    <div className="chips">
                      {modalSources.map((s) => {
                        const on = unitSubscribed(s.sourceName);
                        const busy = opBusy === (s.sourceId || s.sourceName);
                        return (
                          <button
                            key={s.sourceId}
                            className={`chip ${on ? "chip-blue" : "chip-gray"}`}
                            disabled={opBusy !== null}
                            onClick={() => void toggleUnit(s)}
                            title={on ? "删除该订阅条件" : "添加订阅条件（服务端）"}
                          >
                            {busy ? "…" : on ? "✓ " : ""}
                            {s.sourceName}
                          </button>
                        );
                      })}
                    </div>
                  ) : sources && !sourcesErr && !demo ? (
                    <Empty text="可订阅单位列表为空。" />
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

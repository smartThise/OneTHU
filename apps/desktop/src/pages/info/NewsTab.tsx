/**
 * 校内新闻页 —— getNews 列表 + getNewsDetail 站内预览（thu-info-lib news.ts 同源）。
 * 点击条目先在应用内看正文（NEWS_DETAIL?xxid=…&_csrf= → object.xxDto），
 * 再由用户选择「在系统浏览器打开」原链接。
 *
 * 增强：
 * ① 搜索栏（300ms 防抖，全局生效：全部新闻/订阅动态两栏都吃同一搜索词）：
 *    「全部新闻」栏服务端 searchNews（thu-info-lib searchNewsList 同端点）优先，
 *    失败回退本地打分（newsSearch.tsx，SearchPage 加权思路）；「订阅动态」栏
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
 *      选中高亮，key=条件 dyid）：「全部」走合并分页，点单个条件按其
 *      dyid 精确取数，切 chip 重置分页与列表。
 *    - 弹层与详情面板统一走 OG Modal（portal 遮罩/滚动锁/Esc 由 Shell 承担）。
 * ③ 顶部 InfoPage 同款 segmented 二级分栏「全部新闻 / 订阅动态」
 *    （无订阅时隐藏分段控件，只显示全部新闻）。
 * ④ 首页新闻直达：可选 newsId（xxid）prop —— InfoPage 从 LearnNav.infoNewsId 下传；
 *    列表就绪后在列表中定位该条并自动打开详情（不在列表则用最小条目打开，标题由
 *    getNewsDetail 的 title 补充），打开后经 onConsumeNewsId 消费置空；不带参数时
 *    行为与旧版一致。
 *
 * 2026-10-14 OneGUI 换血：列表行 = Card flush + List divided + Row（标题命中高亮
 * 走 Text slot=body，时间戳·来源走 Text slot=micro+tone，置顶 Tag tone=brand、
 * 订阅行来源 Tag tone=neutral，外链图标与 CollectStar 进 trailing——星标本就
 * stopPropagation，不会误触行打开）；搜索 = OG Input(type=search) + Grow + Btn；
 * 来源筛选条 = OG Chip(selected)（OtherInfoPage 同款筛选工具条）；
 * 分页行 = Inline+Spacer+Text(slot=label)+Btn；详情 = OG Modal(size=lg，
 * ≈旧 720px 抽屉宽度)；订阅管理 = OG Modal(size=md，≈旧 560px)；骨架 =
 * Card(pad=none)+LoadingBlock；空态 EmptyState；下载提示 Banner(tone=success)。
 * 手写遮罩四兄弟（subMaskStyle/subPanelStyle/subPanelHead/subPanelBody/
 * drawerMaskStyle/drawerPanelStyle）与 .news-row-wrap/.search-box/.page-indicator/
 * .chips/.chip-blue/.chip-gray/.row-when/.row-main/.row-title/.row-sub 引用全部退场。
 * 详情正文仍是 RichContent（门户远端富文本 HTML + 图片代理抓取，MailPage 同判例
 * 豁免：站外 HTML 不可令牌化）。
 */
import { vaultCatchAttachment } from "../../lib/vaultCatch.js";
import { useEffect, useMemo, useRef, useState, Fragment, type ReactNode } from "react";
import type { NewsDetail, NewsItem } from "@onethu/core";
import {
  Banner,
  Btn,
  Card,
  Chip,
  EmptyState,
  Grow,
  IconDownload,
  IconExternal,
  IconFile,
  IconSearch,
  Inline,
  Input,
  List,
  LoadingBlock,
  Modal,
  Row,
  Section,
  SectionCard,
  Spacer,
  Stack,
  Tag,
  Text,
} from "@onethu/gui";
import { ErrorNote, SegmentedOverflow } from "../../components/Layout.js";
import { CollectStar } from "../../components/Collect.js";
import { enc, noteAtomCache } from "../../state/atoms.js";
import { useNews } from "../../state/data.js";
import { info, downloadLearnUrl } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { openFilePreview } from "../../components/FilePreview.js";
import { DownloadOpenButtons } from "../../components/DownloadOpenButtons.js";
import { RichContent } from "../learn/shared.js";
import { Highlight, rankNews, readSubs, tokenize, writeSubs } from "./newsSearch.js";
import { openExternal } from "./openExternal.js";
import { t as i18n } from "../../i18n/index.js";


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

/** 新闻行：标题命中高亮；订阅动态行附加来源徽标。
 *  OG Row 组装：主列 children 放「标题（可折行，云盘行同形态）+ 时间戳·来源 micro 行」，
 *  字重 medium 对应旧 .row-title；置顶/来源徽标是 Tag，外链图标与 CollectStar 在
 *  trailing（星标自带 stopPropagation，不会误触行打开）。 */
function NewsRow({
  n,
  tokens,
  showSourceChip = false,
  onOpen,
}: {
  n: NewsItem;
  tokens: string[];
  showSourceChip?: boolean;
  onOpen: (item: NewsItem) => void;
}) {
  const dateStr = n.date ? n.date.slice(5, 10).replace("-", "/") : "--";
  return (
    <Row
      flush
      role="button"
      tabIndex={0}
      titleAttr={i18n("auto.pages.info.NewsTab.1")}
      onClick={() => onOpen(n)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(n);
        }
      }}
      trailing={
        <>
          {showSourceChip && n.source ? <Tag tone="neutral">{n.source}</Tag> : null}
          {n.url ? <IconExternal size="sm" title={i18n("auto.pages.info.NewsTab.2")} /> : null}
          {n.xxid ? (
            <CollectStar atom={{ kind: "news", key: enc(n.xxid, n.name, n.source) }} title={n.name} />
          ) : null}
        </>
      }
    >
      <Stack gap={1}>
        <Text slot="body" weight="medium">
          {n.topped ? (
            <>
              <Tag tone="brand">{i18n("auto.pages.info.NewsTab.3")}</Tag>{" "}
            </>
          ) : null}
          <Highlight text={n.name} tokens={tokens} />
        </Text>
        <Text slot="micro" tone="faint" nowrap>
          {dateStr} · {n.source || "校内"}
        </Text>
      </Stack>
    </Row>
  );
}

export function NewsTab({
  newsId,
  onConsumeNewsId,
  initialQuery,
  onConsumeQuery,
  deepSubSource,
}: {
  /** 首页新闻直达 xxid（InfoPage 从 LearnNav.infoNewsId 下传；打开后消费置空） */
  newsId?: string | null;
  /** 直达消费回调：详情打开后通知 InfoPage 清掉待处理 newsId */
  onConsumeNewsId?: () => void;
  /** 新闻搜索直达词（选课·外校课「查通知」）：预填并立即搜索，消费后由父级置空 */
  initialQuery?: string | null;
  onConsumeQuery?: () => void;
  /** 订阅源原子深链：条件就绪后切「订阅动态」并选中同名条件（news-src 原子用） */
  deepSubSource?: string;
} = {}) {
  const [page, setPage] = useState(1);
  const { data, state, error, reload } = useNews(page, PAGE_SIZE);
  const [detail, setDetail] = useState<DetailState | null>(null);

  /* --- 附件下载（详情面板）：走桌面统一 download_file 链路 --- */
  /** 正在下载的附件 url（互斥按条目生效），及落盘结果/错误提示 */
  const [dlAtt, setDlAtt] = useState<string | null>(null);
  // R23：下载提示携带落盘路径，右侧挂「打开文件 / 打开目录」
  const [dlHint, setDlHint] = useState<{ text: string; path?: string } | null>(null);
  /** 附件下载：downloadLearnUrl 对任意 URL 通用（withLearnCsrf 对非 learn host 原样返回），
   *  info 附件 URL 已由 core 带 _csrf，Cookie 由共享 jar 按 info host 提供；落盘名用附件名。 */
  const doDownloadAtt = async (url: string, name: string): Promise<void> => {
    if (dlAtt) return;
    setDlAtt(url);
    setDlHint(null);
    try {
      const path = await downloadLearnUrl(url, name || "news-attachment");
      setDlHint({ text: `已下载到：${path}`, path });
    } catch (err: unknown) {
      setDlHint({ text: "下载失败：" + explainNetworkError(err) });
    } finally {
      setDlAtt(null);
    }
  };

  /* --- 分栏：全部新闻 / 订阅动态（无订阅时隐藏分段控件，恒显全部新闻） --- */
  const [seg, setSeg] = useState<"all" | "subs">("all");

  /* --- 搜索：输入即时回显，检索防抖 300ms（两个分栏共用同一搜索词） --- */
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  /* 「查通知」直达（选课·外校课卡片）：预填关键词并立即搜索（绕过 300ms 防抖），消费后由父级置空 */
  useEffect(() => {
    if (initialQuery == null) return;
    setInput(initialQuery);
    setQuery(initialQuery);
    setPage(1);
    setSeg("all");
    onConsumeQuery?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);
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

  /* 原子搜索缓存：已拉到的新闻入库（搜索框不主动请求新闻服务） */
  useEffect(() => {
    const items = (data ?? []).filter((n) => n.xxid).map((n) => ({ xxid: n.xxid, name: n.name, source: n.source }));
    if (items.length > 0) noteAtomCache({ newsItems: items });
  }, [data]);

  /* 服务端搜索优先；失败 → fallback，由本地打分兜底 */
  useEffect(() => {
    if (!query) {
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
  }, [query]);

  /* 订阅弹层首次打开拉全量可订阅单位（服务端权威集） */
  useEffect(() => {
    if (!subsOpen || sources) return;
    info
      .getNewsSourceList()
      .then((rows) => setSources(rows))
      .catch((err: unknown) => setSourcesErr(explainNetworkError(err)));
  }, [subsOpen, sources, sourcesErr]);

  /* OG Modal 自带 Esc/遮罩/滚动锁关闭（ Courses 弹窗同款出口），此处不再手挂 keydown */

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
        /* 服务端条件重复自愈：同 source|channel|keyword|title 只留第一条，多余的静默删除。
         * 重复添加的病灶：切换单位按来源名精确匹配判重，名字形态不一致就再添一条——
         * 10 个源 ×5 = 50 条就是这么攒出来的；此处幂等清理并回写镜像缓存 */
        const seen = new Set<string>();
        const uniq: SubCondition[] = [];
        const dupIds: string[] = [];
        for (const c of conds) {
          const k = [c.source, c.channel, c.keyword, c.title].map((x) => (x || "").trim()).join("|");
          if (seen.has(k)) {
            if (c.id) dupIds.push(c.id);
          } else {
            seen.add(k);
            uniq.push(c);
          }
        }
        setSubsServer(uniq);
        noteAtomCache({
          newsSources: [...new Set(uniq.map((c) => (c.source || c.title || "").trim()).filter(Boolean))].map((name) => ({ name })),
        });
        const labels = uniq.map(conditionLabel);
        setSubs(labels);
        writeSubs(labels);
        for (const id of dupIds) void info.removeNewsSubscription(id).catch(() => {});
      })
      .catch(() => {
        /* 条件列表失败：保留本地缓存展示；弹层内会给出显式错误 */
      });
    return () => {
      alive = false;
    };
  }, [subsTick]);

  /* 订阅动态来源 chips：每个订阅条件一个小子菜单（短标签 = 来源名优先，否则条件
   * 标题/栏目/关键词；key = 条件 id 即 dyid）。「全部」= 全部条件合并。 */
  const subChips = useMemo(() => {
    return (subsServer ?? [])
      .filter((c) => c.id)
      .map((c) => ({ id: c.id, label: c.source || c.title || c.channel || c.keyword || `#${c.id}` }));
  }, [subsServer]);
  /** 选中条件 id（「all」= 全部条件合并分页，不传 dyid） */
  const subDyid = subSel === "all" ? undefined : subSel;
  /* 选中条件已被删除（不在 chips 中）→ 回退「全部」并重置分页 */
  useEffect(() => {
    if (subSel !== "all" && !subChips.some((c) => c.id === subSel)) {
      setSubSel("all");
      setSubPage(1);
    }
  }, [subSel, subChips]);

  /* 订阅源原子深链：条件就绪后切「订阅动态」并选中同名条件（仅一次） */
  const deepSubApplied = useRef(false);
  useEffect(() => {
    if (deepSubApplied.current || !deepSubSource) return;
    const chip = (subsServer ?? []).find((c) => (c.source || c.title || "").trim() === deepSubSource.trim());
    if (!chip || !chip.id) return;
    deepSubApplied.current = true;
    setSeg("subs");
    setSubSel(chip.id);
    setSubPage(1);
  }, [deepSubSource, subsServer]);

  /* 订阅动态单一分页列表：进入「订阅动态」栏（或翻页/刷新/切 chip/订阅变化）时取数。
   * POST querySubscribeInfomationPageList{currentPage,dyid?}：「全部」不传 dyid =
   * 服务端按该账号全部订阅条件合并返回；选中 chip 传其条件 dyid 精确取该子菜单列表
   * （thu-info-app「动态」tab 同端点），本地不做任何来源过滤 / 逐条件 fan-out。 */
  useEffect(() => {
    if (activeSeg !== "subs") return;
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
  }, [activeSeg, subPage, subFeedTick, subSel, subDyid]);

  /* 订阅动态栏的搜索：在订阅分页结果内本地打分（服务端搜索无法圈定订阅范围） */
  const subItems = subFeed ?? [];
  const subShown = useMemo(
    () =>
      searching
        ? rankNews(subItems, tokens, (n) => plainRef.current.get(n.xxid) ?? "").map((r) => r.item)
        : subItems,
    [subItems, searching, tokens, plainBump],
  );
  /* thu-info-app 同判据：返回空页 = 到底；非空页即认为还有下一页 */
  const subCanNext = (subFeed?.length ?? 0) > 0;

  /* 弹层可添加单位：服务端可订阅单位权威集（fbdwnm 需其 id） */
  const modalSources = useMemo(() => {
    const seen = new Set<string>();
    const rows: NewsSourceRow[] = [];
    const push = (r: NewsSourceRow) => {
      const name = r.sourceName.trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      rows.push({ sourceId: r.sourceId || name, sourceName: name });
    };
    if (sources) [...sources].reverse().forEach(push);
    return rows;
  }, [sources]);

  /** 切换订阅动态来源 chip（按条件 id）：重置分页（「全部」= 全部条件合并分页） */
  const selectSubChip = (id: string) => {
    if (id === subSel) return;
    setSubSel(id);
    setSubPage(1);
  };

  /** 单位是否已订阅：看服务端条件（source 名命中） */
  const unitSubscribed = (name: string): boolean =>
    (subsServer ?? []).some((c) => (c.source || "").trim() === name.trim());

  /* 删除一条服务端订阅条件；成功后刷新条件列表（权威镜像缓存）与订阅动态 */
  const removeCondition = async (c: SubCondition): Promise<void> => {
    setOpErr(null);
    setOpBusy(c.id);
    try {
      const ok = await info.removeNewsSubscription(c.id);
      if (!ok) throw new Error("删除未成功，请刷新后重试");
      setSubsTick((t) => t + 1);
      setSubFeedTick((t) => t + 1);
    } catch (err: unknown) {
      setOpErr(explainNetworkError(err));
    } finally {
      setOpBusy(null);
    }
  };

  /* 弹层点选单位：已订阅 → 删掉同名条件；未订阅 → 用单位 id 添加服务端条件。
   * 成功后刷新条件列表（权威镜像回本地缓存）与订阅动态。 */
  const toggleUnit = async (unit: NewsSourceRow): Promise<void> => {
    setOpErr(null);
    const existing = (subsServer ?? []).filter((c) => (c.source || "").trim() === unit.sourceName.trim());
    setOpBusy(unit.sourceId || unit.sourceName);
    try {
      if (existing.length > 0) {
        for (const c of existing) {
          const ok = await info.removeNewsSubscription(c.id);
          if (!ok) throw new Error("删除未成功，请刷新后重试");
        }
      } else {
        const ok = await info.addNewsSubscription({ sourceId: unit.sourceId });
        if (!ok) throw new Error("添加未成功，请刷新后重试");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newsId, state, data, openDetail]);

  const canPrev = page > 1;
  const fullPage = (data?.length ?? 0) >= PAGE_SIZE;

  return (
    <Stack gap={3}>
      <Section
        title={i18n("auto.pages.info.NewsTab.4")}
        hint={i18n("auto.pages.info.NewsTab.5")}
        /* 分页/搜索切换时重挂以重放进场节奏 */
        key={`head-${page}`}
      />

      {/* 搜索栏 + 订阅管理入口（全局：两个分栏共用同一搜索词） */}
      <Inline gap={2}>
        <Grow>
          <Input
            type="search"
            size="md"
            icon={<IconSearch size="sm" />}
            value={input}
            onChange={setInput}
            placeholder={i18n("auto.pages.info.NewsTab.6")}
            aria-label={i18n("auto.pages.info.NewsTab.7")}
          />
        </Grow>
        <Btn variant="outline" onClick={() => setSubsOpen(true)}>{i18n("auto.pages.info.NewsTab.8")}{subs.length > 0 ? `（${subs.length}）` : ""}
        </Btn>
      </Inline>

      {/* segmented 二级分栏（InfoPage 同款；无订阅时隐藏，只显示全部新闻） */}
      {subs.length > 0 ? (
        <SegmentedOverflow ariaLabel="新闻分栏">
          <Btn
            size="sm"
            variant={activeSeg === "all" ? "tonal" : "ghost"}
            role="tab"
            aria-selected={activeSeg === "all"}
            onClick={() => setSeg("all")}
          >
            {i18n("auto.pages.info.NewsTab.9")}</Btn>
          <Btn
            size="sm"
            variant={activeSeg === "subs" ? "tonal" : "ghost"}
            role="tab"
            aria-selected={activeSeg === "subs"}
            onClick={() => setSeg("subs")}
          >
            {i18n("auto.pages.info.NewsTab.10")}{subs.length}）
          </Btn>
        </SegmentedOverflow>
      ) : null}

      {/* 分页/刷新（全部新闻栏专属） */}
      {activeSeg === "all" ? (
        <Inline gap={2}>
          <Spacer />
          <Text slot="label" tone="faint" nowrap>{i18n("auto.pages.info.NewsTab.11")}{page} {i18n("auto.pages.info.NewsTab.12")}</Text>
          <Btn variant="outline" disabled={!canPrev || state === "loading" || searching} onClick={() => setPage((p) => Math.max(1, p - 1))}>{i18n("auto.pages.info.NewsTab.13")}</Btn>
          <Btn variant="outline" disabled={!fullPage || state === "loading" || searching} onClick={() => setPage((p) => p + 1)}>{i18n("auto.pages.info.NewsTab.14")}</Btn>
          <Btn variant="outline" onClick={() => void reload()} disabled={state === "loading"}>{i18n("auto.pages.info.NewsTab.15")}</Btn>
        </Inline>
      ) : null}

      {searching && activeSeg === "all" ? (
        <Fragment key={`search-${query}`}>
          <Section
            title={`搜索：${query}`}
            hint={
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
          />
          {searchItems.length === 0 ? (
            <Card>
              <EmptyState
                title={
                  serverState === "loading" && localResults.length === 0
                    ? "正在检索…"
                    : `没有与“${query}”相关的新闻。`
                }
              />
            </Card>
          ) : (
            <Card flush>
              <List divided>
                {searchItems.map((n, i) => (
                  <NewsRow
                    key={n.xxid || `s${i}`}
                    n={n}
                    tokens={tokens}
                    onOpen={openDetail}
                  />
                ))}
              </List>
            </Card>
          )}
        </Fragment>
      ) : activeSeg === "subs" ? (
        <Fragment key={`sub-feed-${searching ? query : ""}-${subPage}-${subSel}`}>
          <Section
            title={i18n("auto.pages.info.NewsTab.16")}
            hint={
              searching
                ? `“${query}” 命中 ${subShown.length} 条（${subSel === "all" ? "全部订阅" : `「${subChips.find((c) => c.id === subSel)?.label ?? subSel}」`}内检索）`
                : subSel === "all"
                  ? `已订阅 ${subsServer?.length ?? subs.length} 个条件 · 第 ${subPage} 页 · ${subShown.length} 条`
                  : `来源：${subChips.find((c) => c.id === subSel)?.label ?? subSel} · 第 ${subPage} 页 · ${subShown.length} 条`
            }
          />

          {/* 来源 chips：每个订阅条件一个小子菜单（「全部」+ 来源名/标题短标签；
              key = 条件 dyid；OtherInfoPage 筛选条同款 Chip(selected)） */}
          {subChips.length > 0 ? (
            <Inline gap={1} wrap>
              <Chip
                size="sm"
                selected={subSel === "all"}
                onClick={() => selectSubChip("all")}
              >
                {i18n("auto.pages.info.NewsTab.17")}</Chip>
              {subChips.map((c) => (
                <Chip
                  key={c.id}
                  size="sm"
                  selected={subSel === c.id}
                  onClick={() => selectSubChip(c.id)}
                >
                  {c.label}
                </Chip>
              ))}
            </Inline>
          ) : null}

          {subFeedState === "error" ? (
            <ErrorNote text={subFeedErr ?? ""} onRetry={() => setSubFeedTick((t) => t + 1)} />
          ) : null}
          <Card flush>
            {subFeedState === "loading" ? (
              <LoadingBlock rows={6} />
            ) : subShown.length === 0 ? (
              <EmptyState
                title={
                  searching
                    ? `订阅动态中没有与“${query}”相关的新闻。`
                    : subPage > 1
                      ? "本页没有更多订阅动态了。"
                      : "该订阅条件暂无新闻——稍后刷新，或到订阅管理调整条件。"
                }
              />
            ) : (
              <List divided>
                {subShown.map((n, i) => (
                  <NewsRow
                    key={n.xxid || `f${i}`}
                    n={n}
                    tokens={searching ? tokens : []}
                    showSourceChip
                    onOpen={openDetail}
                  />
                ))}
              </List>
            )}
          </Card>
          {!searching ? (
            <Inline gap={2}>
              <Spacer />
              <Text slot="label" tone="faint" nowrap>{i18n("auto.pages.info.NewsTab.11")}{subPage} {i18n("auto.pages.info.NewsTab.12")}</Text>
              <Btn variant="outline" disabled={subPage <= 1 || subFeedState === "loading"} onClick={() => setSubPage((p) => Math.max(1, p - 1))}>{i18n("auto.pages.info.NewsTab.13")}</Btn>
              <Btn variant="outline" disabled={!subCanNext || subFeedState === "loading"} onClick={() => setSubPage((p) => p + 1)}>{i18n("auto.pages.info.NewsTab.14")}</Btn>
              <Btn variant="outline" disabled={subFeedState === "loading"} onClick={() => setSubFeedTick((t) => t + 1)}>{i18n("auto.pages.info.NewsTab.15")}</Btn>
            </Inline>
          ) : null}
        </Fragment>
      ) : (
        <Fragment key={`all-${page}`}>
          {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

          {state === "loading" && !data ? (
            <Card pad="none">
              <LoadingBlock rows={8} />
            </Card>
          ) : (data?.length ?? 0) === 0 ? (
            <Card>
              <EmptyState title={page > 1 ? "本页没有更多新闻了。" : "暂无新闻。"} />
            </Card>
          ) : (
            <Card flush>
              <List divided>
                {data!.map((n, i) => (
                  <NewsRow
                    key={n.xxid || i}
                    n={n}
                    tokens={[]}
                    onOpen={openDetail}
                  />
                ))}
              </List>
            </Card>
          )}
        </Fragment>
      )}

      {/* 详情：OG Modal（≈旧 720px 右滑抽屉；portal/遮罩/Esc/滚动锁由 Shell 统一） */}
      {detail
        ? (
          <Modal
            open
            onClose={() => setDetail(null)}
            size="lg"
            title={detail.item.name || detail.data?.title || "新闻详情"}
            foot={
              <>
                {detail.item.url ? (
                  <Btn variant="outline" icon={<IconExternal size="sm" />} onClick={() => void openExternal(detail.item.url!)}><span>{i18n("auto.pages.info.NewsTab.18")}</span>
                  </Btn>
                ) : null}
                <Btn variant="ghost" onClick={() => setDetail(null)}>{i18n("auto.pages.info.NewsTab.19")}</Btn>
              </>
            }
          >
            <Stack gap={3}>
              <Text slot="micro" tone="faint" nowrap>
                {[detail.item.source, detail.item.date].filter(Boolean).join(" · ")}
              </Text>
              {detail.state === "loading" ? (
                <Card pad="none">
                  <LoadingBlock rows={6} />
                </Card>
              ) : detail.state === "error" ? (
                <ErrorNote text={detail.err ?? ""} onRetry={() => openDetail(detail.item)} />
              ) : (
                <>
                  {/* 门户远端富文本（站外 HTML），MailPage 判例豁免：不可令牌化 */}
                  <RichContent html={detail.data?.html} fallback="正文为空。" />
                  {detail.data && detail.data.attachments.length > 0 ? (
                    <SectionCard title={`附件（${detail.data.attachments.length}）`} flush>
                      <List>
                        {detail.data.attachments.map((a, i) => (
                          <Row
                            key={`${i}-${a.url}`}
                            flush
                            size="sm"
                            data-vault-catch={vaultCatchAttachment({ kind: "news", name: a.name, url: a.url, label: i18n("auto.pages.info.NewsTab.p1") })}
                            leading={<IconFile size="sm" title={i18n("auto.pages.info.NewsTab.20")} />}
                            titleAttr={a.name}
                            trailing={
                              <>
                                <Btn size="sm" variant="ghost" onClick={() => openFilePreview({ name: a.name, url: a.url })}>{i18n("auto.pages.info.NewsTab.21")}</Btn>
                                <Btn size="sm" variant="ghost" disabled={dlAtt === a.url} icon={<IconDownload size="sm" />} onClick={() => void doDownloadAtt(a.url, a.name)}>
                                  {dlAtt === a.url ? "下载中…" : "下载"}
                                </Btn>
                              </>
                            }
                          >
                            <Text slot="label">{a.name}</Text>
                          </Row>
                        ))}
                      </List>
                    </SectionCard>
                  ) : null}
                  {dlHint ? (
                    <Banner tone="success" action={dlHint.path ? <DownloadOpenButtons path={dlHint.path} /> : undefined}>
                      {dlHint.text}
                    </Banner>
                  ) : null}
                </>
              )}
            </Stack>
          </Modal>
        )
        : null}

      {/* 订阅管理：OG Modal（≈旧 560px 弹层；说明行走 Text，分组行 Card+List+Row） */}
      {subsOpen
        ? (
          <Modal
            open
            onClose={() => setSubsOpen(false)}
            size="md"
            title={i18n("auto.pages.info.NewsTab.8")}
          >
            <Stack gap={3}>
              <Text slot="micro" tone="faint">
                {i18n("auto.pages.info.NewsTab.22")}</Text>
              {opErr ? <ErrorNote text={opErr} /> : null}

              {/* 我的订阅（服务端权威条件列表） */}
              <Stack gap={2}>
                <Text slot="label" weight="semibold">
                  {i18n("auto.pages.info.NewsTab.23")}{subsServer ? `（${subsServer.length}）` : ""}
                </Text>
                {subsServer === null ? (
                  <Card pad="none">
                    <LoadingBlock rows={2} />
                  </Card>
                ) : subsServer.length === 0 ? (
                  <EmptyState title={i18n("auto.pages.info.NewsTab.24")} />
                ) : (
                  <Card flush>
                    <List>
                      {subsServer.map((c) => (
                        <Row
                          key={c.id}
                          flush
                          size="sm"
                          title={c.title || conditionLabel(c)}
                          sub={[
                            c.source ? `来源：${c.source}` : "",
                            c.channel ? `栏目：${c.channel}` : "",
                            c.keyword ? `关键词：${c.keyword}` : "",
                          ].filter(Boolean).join(" · ") || `#${c.id}`}
                          trailing={
                            <Btn
                              variant="ghost"
                              size="sm"
                              disabled={opBusy !== null}
                              onClick={() => void removeCondition(c)}
                              titleAttr={i18n("auto.pages.info.NewsTab.25")}
                          >
                              {opBusy === c.id ? "删除中…" : "删除"}
                            </Btn>
                          }
                        />
                      ))}
                    </List>
                  </Card>
                )}
              </Stack>

              {/* 添加订阅（点选发布单位 → addSubscribeCondition） */}
              <Stack gap={2}>
                <Text slot="label" weight="semibold">
                  {i18n("auto.pages.info.NewsTab.26")}</Text>
                {sourcesErr ? (
                  <ErrorNote text={`可订阅单位列表加载失败：${sourcesErr}`} />
                ) : null}
                {!sources && !sourcesErr ? (
                  <Card pad="none">
                    <LoadingBlock rows={3} />
                  </Card>
                ) : null}
                {modalSources.length > 0 ? (
                  <Inline gap={1} wrap>
                    {modalSources.map((s) => {
                      const on = unitSubscribed(s.sourceName);
                      const busy = opBusy === (s.sourceId || s.sourceName);
                      return (
                        <Fragment key={s.sourceId}>
                          <Chip
                            size="sm"
                            selected={on}
                            disabled={opBusy !== null}
                            onClick={() => void toggleUnit(s)}
                          >
                            {busy ? "…" : on ? "✓ " : ""}
                            {s.sourceName}
                          </Chip>
                          <CollectStar atom={{ kind: "news-src", key: enc(s.sourceName) }} title={s.sourceName} />
                        </Fragment>
                      );
                    })}
                  </Inline>
                ) : sources && !sourcesErr ? (
                  <EmptyState title={i18n("auto.pages.info.NewsTab.27")} />
                ) : null}
              </Stack>
            </Stack>
          </Modal>
        )
        : null}
    </Stack>
  );
}

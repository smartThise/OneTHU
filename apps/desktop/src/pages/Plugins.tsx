import { CliServerSettings } from "../components/CliServerSettings.js";
import { getLocale as getUiLocale } from "../i18n/index.js";
import { t as i18n, rich as i18nRich, msg as i18nMsg, useLocale as useUiLocale } from "../i18n/index.js";
/**
 * 插件页（侧栏一级入口「插件」）：
 * 三区信息架构——电表概览条 / 模块卡（开关·设置·日志·删除 + 命令）/ 安装面板。
 * 设置与运行日志走底部 Sheet：设置显式「保存」+ 已保存回执（不再静默落盘）；
 * 日志全高终端（时间戳 + 方法符着色 + 自动贴底 + 打断/清空）。
 *
 * 2026-10-14 OneGUI 换血（判例 7a1805de 云盘 / 3c73347c 图书馆 / 59b3657b 选课）：
 * 电表条 StatTile；视图/类别/排序/安装页签 Segment；模块卡 Card+Row+Tag（状态/类别徽标
 * 走 Tag tone 语义）；启停 OG Switch；公告/市场结果 Banner；命令区 AccordionItem；
 * 结构化结果 Surface sunken+KeyValue+Card list；设置/MCP/日志三合一 OG Sheet
 * （遮罩按下判定与 dirty 确认流原样保留；草稿保存/回执行为零改动）；市场格 Grid+Card
 * flush interactive+Row（详情按钮 / 仓库链接 / 安装梯队全保留）；安装面板 Card+Segment
 * +TextArea（文件选择走隐藏 input + Btn 触发，与 Forum 同款模式）。行为/数据零改动。
 */
import {
  AccordionItem, Avatar, Banner, Btn, Card, Chip, EmptyState, Field, Grid, Grow, IconBtn,
  IconFile, IconGithub, IconPlug, IconStar, Inline, Input, KeyValue, List, LoadingBlock,
  Row, Segment, Select, SettingsRow, Sheet, Spacer, Stack, StatTile, Surface, Switch, Tag,
  TextArea, Text,
} from "@onethu/gui";
import { defineSearchRows } from "../state/searchRows.js";
import { compareVersions, fetchEntryFromMarket, fetchEntryFromRepo, fetchLiveVersion, fetchRemoteManifestFromRepoRef, fetchRegistry, fetchStarMap, normalizeRepoUrl, parseRepoInput, type MarketEntry } from "../lib/market.js";
import type { CommandResult } from "../plugins/types.js";
import { loadMcpServers, saveMcpServers, type McpServerEntry } from "../lib/mcpStore.js";
import { openFormModal } from "../lib/formModal.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSyncExternalStore, useEffect, useRef, useState, type ReactNode } from "react";
import { confirmOk } from "../lib/confirm.js";
import { Card as LayoutCard, PageHead, focusSettingsTarget, goEntry, useEntry } from "../components/Layout.js";
import { requestPluginsFocus, subscribePluginsFocus, takePluginsFocus, type PluginsFocusSpec } from "../state/pluginsFocus.js";
import { showToast } from "../state/toast.js";
import { useApp } from "../state/context.js";
import { navGo } from "../plugins/bridges.js";
import { requestSettingsSection, requestSettingsTab } from "../state/settingsMode.js";
import { OhSettingsPage } from "../components/OhSettingsPage.js";
import { openImageViewer } from "../components/ImageViewer.js";
import { isThemeEntry, resolveAssetUrl } from "../lib/market.js";
import { useExitHold } from "../lib/motion.js";
import { PluginLogo } from "../components/PluginLogo.js";
import {
  commandsSnapshot, disablePlugin, enablePlugin, installedPlugins,
  isLive, runCommand, subscribe, subscribeCommands, uninstallPlugin,
} from "../plugins/loader.js";
import { addRustPlugin, updatePlugin } from "../plugins/registry.js";
import { clearPluginEvents, pluginEvents, subscribePluginEvents } from "../plugins/events.js";
import { notifyRust } from "../plugins/rust.js";
import { PLUGIN_PERMISSIONS } from "../plugins/types.js";
import { collectWidgetSlots } from "../plugins/pluginWidgets.js";
import { useThemes } from "../state/theme.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 模块卡左上的双字母针脚：取名称词首字母，退化为 id 尾段 */
function monogram(name: string, id: string): string {
  const ascii = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .replace(/[^A-Za-z0-9]/g, "");
  if (ascii.length >= 2) return ascii.slice(0, 2).toUpperCase();
  if (ascii.length === 1) return ascii.toUpperCase();
  return (id.split(".").pop() ?? "pk").slice(0, 2).toUpperCase();
}

/** 动态选项（optionsFrom）：设置里存 JSON 数组（如 madmodelModels 实时名单）；
 *  合并静态兜底项（空值/默认），解析失败退静态。 */
function optionsFor(f: any, live: Record<string, string>): Array<{ value: string; label: string }> {
  const raw = f.optionsFrom ? live[f.optionsFrom] : "";
  const statik: Array<{ value: string; label: string }> = f.options ?? [];
  if (!raw) return statik;
  try {
    const ids: unknown = JSON.parse(raw);
    if (Array.isArray(ids) && ids.length) {
      const base = statik.filter((o) => !o.value);
      return [...base, ...ids.map((id) => ({ value: String(id), label: String(id) }))];
    }
  } catch {
    /* 退静态 */
  }
  return statik;
}

/** 操作结果携带状态；翻译文本不参与业务判断。 */
type PluginMessage = { text: string; tone: "success" | "error" };

/* ── ④ 跨页「带参数打开插件页」请求（**只带筛选参数**；入口态一律走 Layout 的 goEntry）──
   外部（外观与布局的「安装主题」等）写请求 → 插件页挂载或已挂载时消费：
     requestPluginsView({ view: "market", category: "theme" })
   ⑤ 筛选状态同时做**模块级记忆**（同一会话内），返回再进不会丢。 */
export type PluginsViewReq = { view?: "mine" | "market"; category?: "all" | "theme" | "general"; install?: boolean };

/** 插件页 →「外观与布局 → 主题」的反向跳转（用户点名那条：主题卡片上的按钮原来是死的）。
 *  三级请求一起下：页签 + 分区（滚动并高亮）+ 导航；手机端设置就是「我的」页，同一条路径。 */
export function gotoAppearanceTheme(): void {
  requestSettingsSection(i18n("pages.plugins.788db1cfec2a"));
  requestSettingsTab(i18n("pages.plugins.efcccbda5d2b"));
  goEntry("settings"); // 入口态唯一来源
}
let pendingPluginsView: PluginsViewReq | null = null;
const pluginsViewListeners = new Set<() => void>();
let lastPluginsView: "mine" | "market" = "mine";
let lastPluginsCat: "all" | "theme" | "general" = "all";

/* 视图/类别的"筛选参数"仍走一次性（这本来就不是入口态）；**入口态一律走状态机** */
export function requestPluginsView(req: PluginsViewReq): void {
  pendingPluginsView = { ...req };
  for (const f of pluginsViewListeners) f();
  goEntry("plugins");
}
function takePluginsView(): PluginsViewReq | null {
  const v = pendingPluginsView;
  pendingPluginsView = null;
  return v;
}


/* task-19/22：插件页动作行的声明式注册（「检查更新」「去切换主题」等）。
   go 完成插件家族的二级/三级：切视图（我的插件 / 市场 / 主题筛选）→ 展开安装面板 → 落行滚动高亮；
   条件隐藏行（当前没有可检查更新的卡）→ 落「我的插件」分节根 + 一句解释，不冒充命中。

   **锚点口径（2026-10-15 oh-wire 复核，与 Layout.tsx:595-617 的解析器对齐）**：
   focusSettingsTarget 会**自己补** `row-`/`sec-` 前缀（slug=slugOf(want) 后查
   `row-<slug>` / `sec-<slug>`），所以 target/fallbackTarget/root 一律传**光名字**：
   传给分节/行/按钮的**标题或文本**，而不是它们身上的 data-set-id（传 "sec-我的插件" 会被
   拼成 `sec-sec-我的插件`，永远命不中——用户侧表现=搜到了、点了没反应）。 */
defineSearchRows([
  {
    id: "plg-check-update", tab: "插件", section: "我的插件", get title() { return i18n("pages.plugins.7f68ebad19ba"); }, aliases: ["更新", "检查新版本"], get desc() { return i18n("pages.plugins.4a97f1c0bf72"); } , breadcrumb: ["插件", "我的插件", "检查更新"], displayRoot: "插件",
    /* 按钮只出现在「来自仓库且非内置核心」的插件卡上；整页没有这类卡 = 隐藏行 */
    visible: () => installedPlugins().some((p) => p.repo && p.manifest.kind !== "rust" && !p.embedded && !p.builtin && p.manifest.id !== "onethu.harness"),
    fallbackNote: "「检查更新」按钮在每个来自仓库的插件卡上；当前列表没有这类卡，已带到「我的插件」视图。",
    root: "我的插件",
    go: () => {
      requestPluginsFocus({ target: "plg-check-update", fallbackTarget: "我的插件", note: i18n("pages.plugins.cd21f64a56a4") });
    },
  },
  { id: "plg-switch-theme", tab: "插件", section: "我的插件", get title() { return i18n("pages.plugins.e6a68608da0c"); }, aliases: ["切换主题", "换主题"], get desc() { return i18n("pages.plugins.d2ccc4a2731e"); } , breadcrumb: ["插件", "我的插件", "去切换主题"], displayRoot: "插件", go: () => gotoAppearanceTheme() },
  {
    id: "plg-detail", tab: "插件", section: "插件市场", get title() { return i18n("pages.plugins.979a332955c8"); }, aliases: ["插件详情", "简介图", "readme"], get desc() { return i18n("pages.plugins.71ca3a5a5605"); } , breadcrumb: ["插件", "插件市场", "详情"], displayRoot: "插件",
    go: () => {
      requestPluginsView({ view: "market" });
      requestPluginsFocus({ target: "plg-detail", fallbackTarget: "插件市场" });
    },
  },
  {
    id: "plg-mine-market", tab: "插件", section: "我的插件", get title() { return i18n("pages.plugins.55c2c64769e9"); }, aliases: ["插件列表", "插件市场", "视图切换"], get desc() { return i18n("pages.plugins.a25ad69e35b5"); } , breadcrumb: ["插件", "我的插件", "我的插件 / 插件市场"], displayRoot: "插件",
    go: () => {
      /* desc 说“切换”，之前却恒切 mine（点它没反应）；按当前视图取反。 */
      const next = lastPluginsView === "mine" ? "market" : "mine";
      requestPluginsView({ view: next });
      requestPluginsFocus({ target: "plg-mine-market", fallbackTarget: next === "mine" ? "我的插件" : "插件市场" });
    },
  },
  {
    id: "plg-market-search", tab: "插件", section: "插件市场", get title() { return i18n("pages.plugins.a5ea8a597574"); }, aliases: ["搜插件", "插件搜索", "市场搜索框"], get desc() { return i18n("pages.plugins.a13d0dd615ca"); } , breadcrumb: ["插件", "插件市场", "插件市场搜索"], displayRoot: "插件",
    go: () => {
      requestPluginsView({ view: "market" });
      requestPluginsFocus({ target: "plg-market-search", fallbackTarget: "插件市场", note: i18n("pages.plugins.aaffab66fd29") });
    },
    landOn: { section: "插件市场", get note() { return i18n("pages.plugins.3f1000e6f5e1"); } },
  },
  {
    id: "plg-market-cat", tab: "插件", section: "插件市场", get title() { return i18n("pages.plugins.feed82f0b110"); }, aliases: ["全部", "主题", "通用", "插件分类"], get desc() { return i18n("pages.plugins.d6115208d601"); } , breadcrumb: ["插件", "插件市场", "插件分类筛选"], displayRoot: "插件",
    go: () => {
      requestPluginsView({ view: "market" });
      requestPluginsFocus({ target: "plg-market-cat", fallbackTarget: "插件市场", note: i18n("pages.plugins.b8cdc17d21b0") });
    },
    landOn: { section: "插件市场", get note() { return i18n("pages.plugins.1feae7575687"); } },
  },
  {
    id: "plg-install", tab: "插件", section: "我的插件", get title() { return i18n("pages.plugins.edc3f02843ff"); }, aliases: ["装插件", "从仓库安装"], get desc() { return i18n("pages.plugins.5b77bad80d9e"); } , breadcrumb: ["插件", "我的插件", "安装插件"], displayRoot: "插件",
    go: () => {
      requestPluginsView({ view: "mine", install: true });
      requestPluginsFocus({ target: "plg-install", fallbackTarget: "我的插件" });
    },
  },
]);

/** 检索直达的落点器（提外函数，不碰 Hook）：等视图 / 档位 / 安装面板这几次 re-render 落定后定位。
 *  先追主锚点（窗口 ~2.2s），超时落分节根，再不行就 toast 一句解释——绝不静默冒充命中。 */
function schedulePluginsFocus(spec: PluginsFocusSpec | null): void {
  if (!spec) return;
  const total = spec.waitMs ?? 2200;
  const started = Date.now();
  const main = spec.target ?? "";
  const step = (): void => {
    if (main && focusSettingsTarget(main)) return;
    if (Date.now() - started < total) {
      window.setTimeout(step, 180);
      return;
    }
    if (spec.fallbackTarget && focusSettingsTarget(spec.fallbackTarget)) return;
    if (spec.note) showToast(spec.note);
  };
  window.setTimeout(step, 180);
}

/** OH 高级配置里「就地渲染」的那一段：权限与命令概要 + 模型表单 + MCP + 日志。
 *
 *  为什么会单独成一个组件：它原来长在 PluginsPage 里（OH 是插件页的二级子页），
 *  现在实用模式的设置也有 Harness 一段，两处必须是同一份实现——否则模型/MCP 表单就有了
 *  两份真相。`id` 默认就是 OH 自己；将来别的插件要复用同款面板也能直接传 id。 */
export function OhAdvancedPanels({ id = "onethu.harness" }: { id?: string } = {}): ReactNode {
  const allPlugins = useSyncExternalStore(subscribe, installedPlugins);
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot);
  const rec = allPlugins.find((p) => p.manifest.id === id);
  const ownCmds = cmds.filter((c) => c.pluginId === id);
  const perms = (rec?.manifest.permissions ?? []) as string[];
  const dirtyRef = useRef(false);

  /* 不写 fill：这段内容挂在设置页的内容滚动区里（普通块流），fill 的 height:100%
     会把 Stack 锁成 100% 高，flex 子项被压缩 → 行与行、字段与字段互相压字。 */
  return (
    <Stack gap={3}>
      {/* 权限胶囊 + 命令清单：原来长在插件页的 OH 卡片上，现在**就地**放高级配置（卡片区已不许出现 OH） */}
      <SettingsRow title={i18n("pages.plugins.88a430296fa3", { length: String(perms.length) })} sub={perms.length > 0 ? perms.map((p) => PLUGIN_PERMISSIONS.find((x) => x.id === p)?.label ?? p).join(" · ") : i18n("pages.plugins.8db1cbd053a9")} />
      <SettingsRow title={i18n("pages.plugins.4f45939871ad", { length: String(ownCmds.length) })} sub={ownCmds.length > 0 ? ownCmds.map((c) => c.id).join(" · ") : i18n("pages.plugins.ee3360ed4f76")} />
      {/* Harness 的模型表单按设置页的行式排布（sheet：单列字段栈），不用插件弹层的 Grid —— 后者会把 5 个字段挤成一行、标签互相压字。 */}
      {rec ? <SettingsBody id={id} rec={rec} onClose={() => undefined} dirtyRef={dirtyRef} sheet /> : null}
      <McpBody />
      <LogBody id={id} />
    </Stack>
  );
}

export function PluginsPage({ embedded = false }: { embedded?: boolean } = {}): ReactNode {
  const uiLocale = useUiLocale();

  const allPlugins = useSyncExternalStore(subscribe, installedPlugins);
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot);
  const [view, setView] = useState<"mine" | "market">(lastPluginsView); // ⑤ 恢复上次的筛选
  const [cat, setCat] = useState<"all" | "theme" | "general">(lastPluginsCat);
  const [instOpen, setInstOpen] = useState(false);
  const themesSnap = useThemes();
  /* ② 用户拍板：OH（onethu.harness）是**特殊插件**，不出现在普通插件页的卡片区
     ——它的模型/MCP/日志/权限全部搬进「OneTHU Harness」子页的高级配置里就地渲染。 */
  const listPlugins = allPlugins.filter((p) => p.manifest.id !== "onethu.harness");
  /** 分类判定**单一真源**：category==="theme" 或带非空 themes 数组（见 lib/market.ts isThemeEntry） */
  const isTheme = (m: { category?: string; themes?: unknown }): boolean => isThemeEntry(m as { category?: string; themes?: unknown });
  const plugins = cat === "all"
    ? listPlugins
    : listPlugins.filter((p) => (cat === "theme" ? isTheme(p.manifest as { category?: string; themes?: unknown }) : !isTheme(p.manifest as { category?: string; themes?: unknown })));
  const [sheet, setSheet] = useState<{ id: string; mode: "settings" | "log" | "mcp" } | null>(null);
  /* 插件设置 / MCP / 运行日志 Sheet：关闭时多挂 240ms 播完退场，而不是瞬间消失 */
  const sheetHold = useExitHold(sheet, 240);
  /** 市场名单版本（5 分钟缓存内零开销；用于已装卡片「可更新」提示） */
  const [marketVersions, setMarketVersions] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      let map: Record<string, string> = {};
      try {
        const reg = await fetchRegistry();
        if (!alive) return;
        for (const it of reg.plugins) map[it.id] = it.version;
        setMarketVersions(map);
      } catch { /* 名单不可用时维持快照空表 */ }
      // 实时版本：对已安装、有仓库来源的插件逐个拉本地最新 manifest
      // 失败的插件保留名单快照值（网站的说明同步了这一点）
      for (const p of allPlugins) {
        if (!alive) break;
        if (p.manifest.kind === "rust" || p.embedded || p.builtin || p.manifest.id === "onethu.harness") continue;
        if (!p.repo) continue;
        try {
          const ref = parseRepoInput(p.repo);
          const entry = (p.manifest as unknown as { entry?: string }).entry;
          const v = await fetchLiveVersion(ref, entry);
          if (!alive) break;
          if (v) setMarketVersions((prev) => ({ ...prev, [p.manifest.id]: v }));
        } catch { /* 单点失败不阻塞下一项 */ }
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [view]);
  const liveCount = plugins.filter((p) => p.enabled && isLive(p.manifest.id)).length;
  const coreCount = plugins.filter((p) => p.embedded).length;

  /* R23（霖实测）口径保留：视图切换是「我的插件 / 插件市场」的唯一入口，全站同一套分段控件。
     §4.4b：嵌进设置页时保留这个切换器，只去掉页面级大标题。
     data-set-id 锚点给检索直达的落点（sec-视图切换）—— OG Segment 不透传任意属性，走外框承载。 */
  const viewSwitch = (
    <div data-set-id="row-plg-mine-market">
      <Segment
        size="md"
        value={view}
        onChange={(v) => setView(v as "mine" | "market")}
        options={[{ value: "mine", label: i18n("pages.plugins.1b70686b644a") }, { value: "market", label: i18n("pages.plugins.810aff1e6216") }]}
      />
    </div>
  );

  /* ── D（2026-10-11 用户纠正）：OH 是**插件页的二级子页面**（基础设置 / 高级配置），
        不再挂在设置页签下。这里是最小接入：旗标落下 → 同一页壳渲染 OH 子页 + 返回按钮。
        （task-17 抽出 PluginSettingsForm 后，OH 高级档直接接在那边，本段不用再动。） ── */
  const { navigate } = useApp();
  /* ① 唯一状态机：ohOpen **不再是独立 state**，而是由 entry 派生（entry === "oh"）。
     高亮、页面、子页三者同一个来源，不存在"颜色/状态对不上"的可能。 */
  const entry = useEntry();
  const ohOpen = entry === "oh";

  /* ⑤ 记住筛选状态（会话内）：离开插件页再回来不丢 */
  useEffect(() => {
    lastPluginsView = view;
  }, [view]);
  useEffect(() => {
    lastPluginsCat = cat;
  }, [cat]);
  /* ④ 消费跨页请求：挂载时补一次 + 订阅（已挂载时由订阅即时生效） */
  useEffect(() => {
    const apply = (): void => {
      const req = takePluginsView();
      if (req) {
        if (req.view) setView(req.view);
        if (req.category) setCat(req.category);
        if (req.install) setInstOpen(true); // 检索直达「安装插件」：顺路把安装面板展开
      }
      /* 入口态由 requestPluginsView 自己走 goEntry（见该函数）；这里不再有旗标消费 */
    };
    /* 检索聚焦通道：挂载时先取走一次挂起的请求（跨页直达），此后订阅即时生效 */
    const focusApply = (): void => schedulePluginsFocus(takePluginsFocus());
    focusApply();
    const offFocus = subscribePluginsFocus(focusApply);
    apply();
    pluginsViewListeners.add(apply);
    /* ① 「插件」格请求：显式关子页（这就是"点完 OH 回不到插件"的根因） */
      return () => {
      pluginsViewListeners.delete(apply);
      offFocus();
    };
  }, []);
  /** ⑤「安装插件」按层级归位：放页头右侧，不再挤在类别筛选那一行里 */
  const installBtn = (
    <Btn variant="ghost" data-set-id="row-plg-install" onClick={() => setInstOpen((o) => !o)}>
      {instOpen ? i18n("pages.plugins.af8383d6b923") : i18n("pages.plugins.edc3f02843ff")}
    </Btn>
  );
  /* ② OH 的模型/MCP/日志**就地**渲染在子页高级配置里（复用同一批面板实现，不跳 sheet、不复制）。
     面板本体见 OhAdvancedPanels：实用模式的设置页也渲染同一个组件。 */
  const ohAdvancedPanels = <OhAdvancedPanels />;

  if (ohOpen) {
    return (
      /* Harness 与「个人设置」同构（2026-10-24 用户定案）：不再套页头 + LayoutCard，
         直接交给设置浮层的三段式布局（左导航固定 + 右内容独立滚动）。 */
      <OhSettingsPage advancedPanels={ohAdvancedPanels} />
    );
  }

  return (
    <Stack gap={3}>
      {embedded ? (
        <Inline gap={2} wrap>{viewSwitch}{installBtn}</Inline>
      ) : (
        <PageHead
          title={i18n("pages.plugins.e806fbbe8ec6")}
          meta={
            <span>{i18n("pages.plugins.b49395c80847")}<code className="plg-code">onethu.*</code>{i18n("pages.plugins.be93cf140b54")}</span>
          }
          actions={
            <Inline gap={2} wrap>
              {viewSwitch}
              {installBtn}
            </Inline>
          }
        />
      )}

      {/* 电表概览条：StatTile 四格（判例 59b3657同款；LED 脉冲让位于语义） */}
      <Grid min="sm">
        <StatTile label={i18n("pages.plugins.a8b6c39dcabf")} value={String(plugins.length).padStart(2, "0")} />
        <StatTile label={i18n("pages.plugins.1f0eb99b7ed0")} value={String(liveCount).padStart(2, "0")} hint={liveCount > 0 ? i18n("pages.plugins.dedd4ea84562") : i18n("pages.plugins.dae661d17c2d")} />
        <StatTile label={i18n("pages.plugins.33a1770e62be")} value={String(cmds.length).padStart(2, "0")} />
        <StatTile label={i18n("pages.plugins.946d16b17a2b")} value={String(coreCount).padStart(2, "0")} />
      </Grid>


      {/* 主题管理区（安装/卸载）：主题即插件，安装面在插件页。
          切换主题在 设置 → 外观（唯一入口）——2026-02 用户反馈切换入口错位到插件页；
          2026-09-13 原定案「设置页不放」针对的是管理面，与切换入口不冲突。 */}
      {view === "market" ? (
        <MarketView cat={cat} setCat={setCat} />
      ) : (
        <>
      {instOpen ? <InstallPanel onClose={() => setInstOpen(false)} /> : null}

      {/* 我的插件 · 工具行：类别页签（Segment，判例「全部/主题/通用」同口径） */}
      <div data-set-id="sec-我的插件">
        <Segment
          size="sm"
          value={cat}
          onChange={(v) => setCat(v as "all" | "theme" | "general")}
          options={[
            { value: "all", label: i18n("pages.plugins.ec80eda36409", { length: String(listPlugins.length) }) },
            { value: "theme", label: i18n("pages.plugins.8123e79a58ba", { length: String(listPlugins.filter((p) => isTheme(p.manifest as { category?: string; themes?: unknown })).length) }) },
            { value: "general", label: i18n("pages.plugins.35bc0bf5b938", { length: String(listPlugins.filter((p) => !isTheme(p.manifest as { category?: string; themes?: unknown })).length) }) },
          ]}
        />
      </div>


      {plugins.length === 0 && cat !== "theme" ? (
        <EmptyState
          icon={<IconPlug size="lg" />}
          title={i18n("pages.plugins.af23c5048f07")}
          hint={i18n("pages.plugins.ff08afdc6ecc")}
          action={<Btn data-set-id="row-plg-install" variant="solid" tone="brand" onClick={() => setInstOpen(true)}>{i18n("pages.plugins.edc3f02843ff")}</Btn>}
        />
      ) : plugins.length === 0 && cat === "theme" ? (
        <Text as="p" slot="subtitle" tone="quiet">{i18n("pages.plugins.3eb1de52835b")}</Text>
      ) : (
        <Stack gap={2}>
          {plugins.map((p) => (
            <PluginCard key={p.manifest.id} id={p.manifest.id} onOpenSheet={setSheet} marketVersion={marketVersions[p.manifest.id]} onGoMarket={() => setView("market")} />
          ))}
        </Stack>
      )}

      {sheetHold.mounted && sheetHold.held ? (
        <PluginSheet
          id={sheetHold.held.id}
          mode={sheetHold.held.mode}
          closing={sheetHold.closing}
          onClose={() => setSheet(null)}
        />
      ) : null}
        </>
      )}
    </Stack>
  );
}

/* ═══════════════ 模块卡 ═══════════════ */

/** 结构化命令结果渲染：markdown（GFM）+ 条目列表 + 键值对 */
function ResultBlock({ result }: { result: CommandResult }): ReactNode {
  const uiLocale = useUiLocale();

  if (!result.markdown && !result.items?.length && !result.kv?.length) return null;
  return (
    <Surface sunken pad="sm">
      <Stack gap={2} fill>
        {result.markdown ? (
          /* react-markdown 任意 HTML 是排印视口豁免（判例 .gitlab-md / .dock-md；.market-readme 同族保留） */
          <div className="market-readme">
            <Markdown remarkPlugins={[remarkGfm]}>{result.markdown}</Markdown>
          </div>
        ) : null}
        {result.kv?.length ? (
          <KeyValue rows={result.kv.map((x) => ({ k: x.k, v: x.v }))} />
        ) : null}
        {result.items?.length ? (
          <Card flush>
            <List divided>
              {result.items.slice(0, 30).map((it, i) => (
                <Row key={i} flush title={it.title} sub={it.subtitle} meta={it.meta} />
              ))}
            </List>
          </Card>
        ) : null}
      </Stack>
    </Surface>
  );
}

function PluginCard({
  id,
  onOpenSheet,
  marketVersion,
  onGoMarket,
  checkBusy,
  checkMsg,
  checkFailed,
  repoRemote,
  onCheckUpdate,
  onUpdateNow,
}: {
  id: string;
  onOpenSheet: (s: { id: string; mode: "settings" | "log" | "mcp" }) => void;
  /** 市场名单里该插件的版本（有新版时卡片显示「可更新」徽标；本仓检查出更新后以本仓为准，市场徽标隐藏） */
  marketVersion?: string;
  onGoMarket?: () => void;
  /** 「检查更新」进行中 */
  checkBusy?: boolean;
  /** 检查/更新结果的一行反馈（贴在按钮下方） */
  checkMsg?: string | null;
  /** 反馈的语义状态，不能从翻译后的句子推断。 */
  checkFailed?: boolean;
  /** 本体仓库检查出的最新版本（>本机 解锁「更新」按钮；存在时市场徽标让位） */
  repoRemote?: string | null;
  onCheckUpdate?: () => void;
  onUpdateNow?: (remoteVersion: string) => void;
}): ReactNode {
  const uiLocale = useUiLocale();

  const [repoCheck, setRepoCheck] = useState<{ busy: boolean; failed: boolean; msg: string | null; remote: string | null }>({ busy: false, failed: false, msg: null, remote: null });
  /** 公告「知道了」后的重渲染计票器（持久化状态在 localStorage，这里只重载 UI） */
  const [noticeTick, setNoticeTick] = useState(0);
  const plugins = useSyncExternalStore(subscribe, installedPlugins);
  const rec = plugins.find((p) => p.manifest.id === id);
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot).filter((c) => c.pluginId === id);
  const [open, setOpen] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<CommandResult | null>(null);
  const [input, setInput] = useState("");
  if (!rec) return null;
  const m = rec.manifest;
  /** 本插件声明的小组件所占槽位（卡片上标出来，用户才知道该放哪个「OneTHU 插件小组件 N」） */
  const widgetSlots = collectWidgetSlots().filter((x) => x.pluginId === id);
  const active = rec.enabled && isLive(id);
  const failed = rec.enabled && !isLive(id);
  const stateText = active ? i18n("pages.plugins.1f0eb99b7ed0") : failed ? i18n("pages.plugins.d1d044826a45") : i18n("pages.plugins.a8c3698b5b8c"); // ui-copy-lint-ok: 状态标签，同一行操作区就有「日志」按钮

  /** 从插件本体仓库读最新 manifest（本体仓库优先；失败给出面向用户的一行反馈） */
  const checkUpdate = async (): Promise<void> => {
    if (!rec || !rec.repo || m.kind === "rust") return;
    setRepoCheck({ busy: true, failed: false, msg: i18n("pages.plugins.91d07ffe8162"), remote: null });
    try {
      const ref = parseRepoInput(rec.repo);
      const entry = (m as unknown as { entry?: string }).entry;
      const remote = await fetchRemoteManifestFromRepoRef(ref, entry);
      if (remote.id !== m.id) {
        setRepoCheck({ busy: false, failed: true, msg: i18n("pages.plugins.d268b0d673a5"), remote: null });
        return;
      }
      if (compareVersions(remote.version, m.version) > 0) {
        setRepoCheck({ busy: false, failed: false, msg: i18n("pages.plugins.85de54518bcc", { version: String(remote.version), version2: String(m.version) }), remote: remote.version });
      } else {
        setRepoCheck({ busy: false, failed: false, msg: i18n("pages.plugins.337ecb8a91f0", { version: String(remote.version) }), remote: remote.version });
      }
    } catch (e) {
      setRepoCheck({ busy: false, failed: true, msg: i18n("pages.plugins.7af0a2bf2e39", { value: String(String(e instanceof Error ? e.message : e).slice(0, 160)) }), remote: null });
    }
  };
  /** 一键更新：与安装同一管线，覆盖安装并重新激活 */
  const updateNow = async (remoteVersion: string): Promise<void> => {
    setRepoCheck({ busy: true, failed: false, msg: i18n("pages.plugins.b6ef24000dbb", { remoteVersion: String(remoteVersion) }), remote: remoteVersion });
    try {
      const ref = parseRepoInput(rec!.repo!);
      const entry = (m as unknown as { entry?: string }).entry;
      const text = await fetchEntryFromRepo(ref, entry);
      const { installPlugin } = await import("../plugins/loader.js");
      const nm = await installPlugin(text, { repo: normalizeRepoUrl(rec!.repo!) });
      setRepoCheck({ busy: false, failed: false, msg: i18n("pages.plugins.3bf680fcb016", { name: String(nm.name), version: String(nm.version) }), remote: null });
    } catch (e) {
      setRepoCheck({ busy: false, failed: true, msg: i18n("pages.plugins.0e88e176d00f", { value: String(String(e instanceof Error ? e.message : e).slice(0, 160)) }), remote: remoteVersion });
    }
  };

  const doRun = async (cmdId: string): Promise<void> => {
    setRunMsg(i18n("pages.plugins.195f0f04971f"));
    setRunResult(null);
    try {
      const r = (await runCommand(id, cmdId, input)) as CommandResult | string | null;
      if (r == null) {
        setRunMsg(i18n("pages.plugins.c0b3fbff51cc"));
      } else if (typeof r === "string") {
        setRunMsg(r.slice(0, 400));
      } else if (typeof r === "object") {
        setRunResult(r);
        setRunMsg(typeof r.text === "string" ? r.text.slice(0, 200) : null);
      } else {
        setRunMsg(String(r).slice(0, 400));
      }
    } catch (e) {
      setRunMsg(i18n("pages.plugins.7af0a2bf2e39", { value: String(String(e instanceof Error ? e.message : e).slice(0, 300)) }));
    }
  };

  const checkLine = repoCheck.msg ?? checkMsg ?? null;
  const checkLineFailed = repoCheck.msg != null ? repoCheck.failed : !!checkFailed;

  return (
    <div data-vault-catch={JSON.stringify({ type: "payload", title: m.name, sub: i18n("pages.plugins.5dbb87d9720a") + m.version, payload: { kind: "plugin", pluginId: m.id }, source: "插件" })}>
    <Card>
      <Stack gap={2} fill>
        {/* 卡头：针脚 + 名称/徽标/状态 */}
        <Inline gap={3} align="start" fill>
          {/* .plg-pin/.plg-logo 是 PluginLogo 的尺寸槽（共享保留）；内置核心的青蓝框在这里借 is-core 檔位 */}
          <span className={"plg-pin" + (rec.embedded ? " is-core" : "")} aria-hidden="true">
            <PluginLogo id={m.id} fallback={<Text slot="micro" mono weight="bold">{monogram(m.name, m.id)}</Text>} />
          </span>
          <Stack gap={0} fill>
            <Inline gap={2} vAlign="center" wrap>
              <Text slot="subtitle" weight="semibold" nowrap>{m.name}</Text>
              <Text slot="micro" tone="faint" mono>v{m.version}</Text>
              <Tag>{m.kind === "rust" ? "RUST" : "JS"}</Tag>
              {isThemeEntry(m) ? <Tag tone="brand">{i18n("pages.plugins.788db1cfec2a")}</Tag> : null}
              {widgetSlots.length > 0 ? (
                <span
                  title={i18n("pages.plugins.82667774d6fa", { value: String(widgetSlots.map((x) => x.slot).join(" / ")) })}
                >
                  <Tag tone="brand">{i18nRich("pages.plugins.e39742ef4f8c", { value: widgetSlots.map((x) => x.slot).join("/") })}</Tag>
                </span>
              ) : null}
              {rec.embedded ? <span title={i18n("pages.plugins.06d3b7ff47db")}><Tag>{i18n("pages.plugins.95e35aabd9a9")}</Tag></span> : null}
            </Inline>
            <Inline gap={2} vAlign="center" wrap>
              <Tag tone={active ? "success" : failed ? "warning" : "neutral"}>{stateText}</Tag>
              <Text slot="micro" tone="faint" mono nowrap>{m.id}</Text>
            </Inline>
          </Stack>
        </Inline>

        {/* 操作梯队：仓库 / 启停 / 设置 / 日志 / 更新 / 删除 */}
        <Inline gap={1} wrap>
          {rec.repo ? (
            <IconBtn
              variant="ghost"
              size="sm"
              label={i18n("pages.plugins.56abf3607133")}
              aria-label={i18n("pages.plugins.56abf3607133")}
              titleAttr={rec.repo}
              icon={<IconGithub size="sm" />}
              onClick={() => void (async () => {
                try {
                  const { openUrl } = await import("@tauri-apps/plugin-opener");
                  await openUrl(rec.repo!);
                } catch {
                  window.open(rec.repo!, "_blank");
                }
              })()}
            />
          ) : null}
          <Switch
            checked={rec.enabled}
            aria-label={rec.enabled ? i18n("pages.plugins.4e6fd0e28c55") : i18n("pages.plugins.f4f0ead1116b")}
            onChange={() => void (rec.enabled ? disablePlugin(id) : enablePlugin(id)).catch((e: unknown) => setRunMsg(String(e)))}
          />
          {id === "onethu.harness" ? (
            <Btn variant="ghost" titleAttr={i18n("pages.plugins.715e7d2108f7")} onClick={() => onOpenSheet({ id, mode: "mcp" })}>MCP</Btn>
          ) : null}
          {/* 主题类插件：动作行里一处（与检查更新/设置/删除同为纯文字） */}
          {isThemeEntry(m) ? (
            <Btn data-set-id="row-plg-switch-theme" variant="ghost" titleAttr={i18n("pages.plugins.d261c0fe80e6")} onClick={() => gotoAppearanceTheme()}>{i18n("pages.plugins.e6a68608da0c")}</Btn>
          ) : null}
          {rec.repo && m.kind !== "rust" && !rec.embedded && !rec.builtin && id !== "onethu.harness" ? (
            <Btn data-set-id="row-plg-check-update" variant="ghost" titleAttr={i18n("pages.plugins.d0cfe8bf3a7e", { repo: String(rec.repo) })} disabled={checkBusy || repoCheck.busy} onClick={() => { onCheckUpdate?.(); void checkUpdate().catch(() => undefined); }}>{checkBusy || repoCheck.busy ? i18n("pages.plugins.fb11aa6f2982") : i18n("pages.plugins.7f68ebad19ba")}</Btn>
          ) : null}
          {(repoCheck.remote || repoRemote) && compareVersions(repoCheck.remote ?? "", m.version) > 0 ? (
            <Btn variant="solid" tone="brand" titleAttr={i18n("pages.plugins.dd08ecd97ad1", { value: String(repoCheck.remote || repoRemote) })} disabled={repoCheck.busy || checkBusy} onClick={() => {
                const v = repoCheck.remote || repoRemote;
                if (v) void updateNow(v).catch(() => undefined);
              }}>{repoCheck.busy ? i18n("pages.plugins.a0bacec44f47") : i18n("pages.plugins.b59008384c66", { value: String(repoCheck.remote || repoRemote) })}</Btn>
          ) : null}
          {!repoCheck.remote && !repoRemote && marketVersion && compareVersions(marketVersion, m.version) > 0 ? (
            <Btn variant="ghost" titleAttr={i18n("pages.plugins.190d9e29ab5f", { marketVersion: String(marketVersion) })} onClick={() => onGoMarket?.()}>{i18n("pages.plugins.b588afe533c6")}</Btn>
          ) : null}
          <Btn variant="ghost" onClick={() => onOpenSheet({ id, mode: "settings" })}>{i18n("pages.plugins.df3d58c7d84b")}</Btn>
          {m.kind === "rust" ? (
            <Btn variant="ghost" onClick={() => onOpenSheet({ id, mode: "log" })}>{i18n("pages.plugins.7dbac1c20f23")}</Btn>
          ) : null}
          {rec.embedded || rec.builtin || m.id === "onethu.harness" ? null : (
            <Btn variant="solid" tone="error" onClick={() => void uninstallPlugin(id)}>{i18n("pages.plugins.2f9daa828907")}</Btn>
          )}
        </Inline>

        {m.description ? <Text as="p" slot="subtitle" tone="quiet" clamp={2}>{m.description}</Text> : null}

        {(() => {
          if (!rec?.notice?.text) return null;
          const seen = (() => {
            try {
              const acks = JSON.parse(localStorage.getItem("onethu.plugin.notice.ack") ?? "{}") as Record<string, string>;
              return acks[m.id] === rec.notice!.digest;
            } catch { return false; }
          })();
          if (seen) return null;
          const ack = () => {
            try {
              const acks = JSON.parse(localStorage.getItem("onethu.plugin.notice.ack") ?? "{}") as Record<string, string>;
              acks[m.id] = rec.notice!.digest;
              localStorage.setItem("onethu.plugin.notice.ack", JSON.stringify(acks));
              setNoticeTick((v) => v + 1);
            } catch { /* noop */ }
          };
          return (
            <Banner
              tone="info"
              title={i18n("pages.plugins.1c44993e8d35")}
              action={<Btn variant="ghost" size="sm" onClick={ack}>{i18n("pages.plugins.de32e20193ad")}</Btn>}
            >
              <Text as="p" slot="micro" tone="quiet">{rec.notice.text.slice(0, 1600)}</Text>
            </Banner>
          );
        })()}

        {checkLine ? (
          <Text as="p" slot="micro" tone={checkLineFailed ? "error" : "quiet"}>
            {checkLine}
          </Text>
        ) : null}

        {m.permissions.length > 0 ? (
          <Inline gap={1} wrap>
            {m.permissions.map((p) => {
              const meta = PLUGIN_PERMISSIONS.find((x) => x.id === p);
              return (
                <span key={p} title={meta?.desc ?? p}>
                  <Tag>{meta?.label ?? p}</Tag>
                </span>
              );
            })}
          </Inline>
        ) : null}

        {cmds.length > 0 ? (
          /* 命令舱段：AccordionItem（展开态本地 state，与原 plg-cmds-toggle/caret 行为一致） */
          <AccordionItem
            id="cmds"
            title={open ? i18n("pages.plugins.1425da54cba2") : i18n("pages.plugins.32aa051d0a54", { length: String(cmds.length) })}
            open={open}
            onToggle={() => setOpen((o) => !o)}
          >
            <Stack gap={3} fill>
              {cmds.map((c) => (
                <Stack key={c.id} gap={1} fill>
                  <Text slot="subtitle" weight="medium">{c.title}</Text>
                  {c.inputLabel ? (
                    <TextArea
                      rows={2}
                      placeholder={c.inputPlaceholder ?? ""}
                      value={input}
                      onChange={(value) => setInput(value)}
                    />
                  ) : null}
                  <Inline gap={2} wrap>
                    <Btn variant="solid" tone="brand" onClick={() => void doRun(c.id)}>{i18n("pages.plugins.32c8d373afe0")}</Btn>
                  </Inline>
                  {runMsg ? <Text as="p" slot="micro" mono tone="quiet" nowrap={false}>{runMsg}</Text> : null}
                  {runResult && (runResult.markdown || runResult.items?.length || runResult.kv?.length) ? (
                    <ResultBlock result={runResult} />
                  ) : null}
                </Stack>
              ))}
            </Stack>
          </AccordionItem>
        ) : null}

        {runMsg && cmds.length === 0 ? <Text as="p" slot="micro" mono tone="quiet">{runMsg}</Text> : null}
      </Stack>
    </Card>
    </div>
  );
}

/* ═══════════════ 底部 Sheet：设置（显式保存）/ 日志（全高终端） ═══════════════ */

function PluginSheet({
  id,
  mode,
  closing,
  onClose,
}: {
  id: string;
  mode: "settings" | "log" | "mcp";
  /** 退场相位：truthy 时 Sheet open=false 播完退场再由父级卸载（useExitHold 保持挂载） */
  closing: boolean;
  onClose: () => void;
}): ReactNode {
  const uiLocale = useUiLocale();

  const plugins = useSyncExternalStore(subscribe, installedPlugins);
  const rec = plugins.find((p) => p.manifest.id === id);
  // R23（霖实测：设置卡片外误点一下直接关闭丢修改）：
  //  ① 拖拽出界不算点遮罩——OneGUI 的 Shell 已内置「遮罩上按下、遮罩上抬起才关」的原判定；
  //  ② 设置草稿有改动时关闭前 confirmOk，绝不静默丢弃（onClose 的三个出口都过这里）。
  const dirtyRef = useRef(false);
  const requestClose = (): void => {
    if (!dirtyRef.current) return onClose();
    void confirmOk(i18nMsg("pages.plugins.40fc56e18291")).then((ok) => {
      if (ok) onClose();
    });
  };
  /* 日志模式的事件计数（贴底回执行由 Sheet foot 承载，状态一只） */
  const evtCount = useSyncExternalStore(subscribePluginEvents, () => pluginEvents(id)).length;
  if (!rec) return null;
  const title = mode === "settings" ? i18n("pages.plugins.df3d58c7d84b") : mode === "mcp" ? i18n("pages.plugins.a203f86cf6a6") : i18n("pages.plugins.fc08fa260979");
  return (
    <Sheet
      open={!closing}
      onClose={requestClose}
      title={`${title} · ${rec.manifest.name}`}
      size="md"
      foot={mode === "log" ? (
        <Inline gap={2} wrap>
          <Text slot="micro" tone="faint">{i18nRich("pages.plugins.e0d0ddfcb366", { evtCount: evtCount })}</Text>
          <Spacer />
          <Btn variant="ghost" onClick={() => void notifyRust(id, "interrupt").catch(() => undefined)}>{i18n("pages.plugins.fa086d830f50")}</Btn>
          <Btn variant="ghost" onClick={() => clearPluginEvents(id)}>{i18n("pages.plugins.1ef3de06b32e")}</Btn>
        </Inline>
      ) : undefined}
    >
      {mode === "settings" ? (
        <SettingsBody id={id} rec={rec} onClose={onClose} dirtyRef={dirtyRef} sheet />
      ) : mode === "mcp" ? (
        <McpBody />
      ) : (
        <LogBody id={id} />
      )}
    </Sheet>
  );
}

/** OH MCP **服务器**开关（用户 2026-10-15 点名：「OH MCP 是把我们自己暴露成 MCP」）。
 *  开 = harness 在 127.0.0.1:8787 起本机 MCP server（POST /mcp，Streamable-HTTP），
 *  别的 agent / 脚本 / 编辑器插件能直接调 OneTHU 的接口；关 = 连接一律 403。
 *  跟着 MCP 面板走：高级档就地渲染与 Sheet 形态共用这一份实现，不复制第二处。 */
function McpSwitchRow(): ReactNode { return <CliServerSettings/>; }

/** MCP 服务器管理：逐条增删改（表单弹窗），存宿主侧结构化存储，OH 启动对话时经 settings 注入 */
export function McpBody(): ReactNode {
  const uiLocale = useUiLocale();

  const [list, setList] = useState<McpServerEntry[]>(() => loadMcpServers());
  const save = (next: McpServerEntry[]): void => {
    setList(next);
    saveMcpServers(next);
  };
  const edit = async (idx: number): Promise<void> => {
    const cur = list[idx];
    const f = await openFormModal(idx === -1 ? i18nMsg("pages.plugins.c52661984f93") : i18nMsg("pages.plugins.2def3dbabf90", { value: String(cur?.name ?? "") }), [
      { key: "name", label: i18nMsg("pages.plugins.da4d9440dea0"), required: true, default: cur?.name ?? "" },
      { key: "command", label: i18nMsg("pages.plugins.8b76184a7d6e"), required: true, default: cur?.command ?? "", placeholder: "npx / uvx / /usr/bin/node …" },
      { key: "args", label: i18nMsg("pages.plugins.1cb64f961cac"), kind: "textarea", default: cur?.args.join(" ") ?? "", placeholder: '-y @modelcontextprotocol/server-filesystem /Users/me/docs' },
      { key: "env", label: i18nMsg("pages.plugins.e3c1578696ec"), default: Object.entries(cur?.env ?? {}).map(([k, v]) => `${k}=${v}`).join(" ") },
    ]);
    if (!f) return;
    const parseSpaceList = (v: string): string[] =>
      (v.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((x) => x.replace(/^["']|["']$/g, ""));
    const env: Record<string, string> = {};
    for (const pair of parseSpaceList(f.env ?? "")) {
      const i = pair.indexOf("=");
      if (i > 0) env[pair.slice(0, i)] = pair.slice(i + 1);
    }
    const entry: McpServerEntry = { name: f.name?.trim() ?? "", command: f.command?.trim() ?? "", args: parseSpaceList(f.args ?? ""), env };
    if (!entry.name) {
      showToast(i18nMsg("pages.plugins.213723a5cadd"));
      return;
    }
    /* 同名 server → 工具前缀 mcp_<name>_ 撞车：模型侧会出现两个同名函数，调用必错。 */
    if (list.some((x, i) => i !== idx && x.name.trim() === entry.name)) {
      showToast(i18nMsg("pages.plugins.639372d0bac7", { name: String(entry.name), name2: String(entry.name) }));
      return;
    }
    const next = list.slice();
    if (idx === -1) next.push(entry);
    else next[idx] = entry;
    save(next);
  };
  const del = async (idx: number): Promise<void> => {
    const { confirmOk } = await import("../lib/confirm.js");
    const target = list[idx];
    if (!target) return;
    if (!(await confirmOk(i18nMsg("pages.plugins.3f4ca23ed9e4", { name: String(target.name) })))) return;
    save(list.filter((_, i) => i !== idx));
  };
  return (
    <Stack gap={2} fill>
      <McpSwitchRow />
      {/* 使用说明（用户点名要"使用说明"）：只写事实 —— 端点、暴露范围、何时生效。 */}
      <Text as="p" slot="micro" tone="faint">{i18n("pages.plugins.65e85afce9ed")}<code className="plg-code">http://127.0.0.1:8787/mcp</code>{i18n("pages.plugins.e41e77014e1d")}</Text>
      <Text as="p" slot="micro" tone="faint">{i18n("pages.plugins.5123dcec4653")}</Text>
      {/* 反向（OH → 外部 MCP）的检索锚点：设置检索/OH ui_navigate 落到「连接外部 MCP 服务器」这一行 */}
      <div data-set-id="row-oh-mcp-client">
        <Text as="h4" slot="subtitle" weight="semibold">{i18n("pages.plugins.1dda1d69edf9")}</Text>
      </div>
      {list.length === 0 ? (
        <Text as="p" slot="micro" tone="faint">{i18n("pages.plugins.4dbfc40111b5")}</Text>
      ) : (
        <Card flush>
          <List divided>
            {list.map((sv, i) => (
              <Row
                key={`${sv.name}:${i}`}
                flush
                title={sv.name}
                sub={<code className="plg-code">{sv.command} {sv.args.join(" ")}</code>}
                trailing={
                  <Inline gap={1}>
                    <Btn variant="ghost" size="sm" onClick={() => void edit(i)}>{i18n("pages.plugins.051836569928")}</Btn>
                    <Btn variant="solid" tone="error" size="sm" onClick={() => void del(i)}>{i18n("pages.plugins.2f9daa828907")}</Btn>
                  </Inline>
                }
              />
            ))}
          </List>
        </Card>
      )}
      <Btn variant="ghost" onClick={() => void edit(-1)}>{i18n("pages.plugins.aa82a2888412")}</Btn>
    </Stack>
  );
}

/** 设置：本地草稿 + 显式保存 + 已保存回执（设置在插件下一轮运行时实时读取）。
 *  R23：dirtyRef 上报未保存改动（Sheet 关闭前据此确认）；onClose 供无配置项分支直接关闭。
 *  sheet=true（Sheet 内）走单列；inline（OH 高级面板）走 Grid 两列，foot 随内容流。 */
export function SettingsBody({
  id, rec, onClose, dirtyRef, sheet = false,
}: { id: string; rec: any; onClose: () => void; dirtyRef: { current: boolean }; sheet?: boolean }): ReactNode {
  const uiLocale = useUiLocale();

  const fields = rec.manifest.settings ?? [];
  const [draft, setDraft] = useState<Record<string, string>>({ ...rec.settings });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** 草稿改动标记：editDraft 置 true，保存成功复位 */
  const editDraft = (fn: (d: Record<string, string>) => Record<string, string>): void => {
    dirtyRef.current = true;
    setDraft(fn);
  };

  // 自动维护字段（MadModel token 等）永远以**当前实时值**保存：草稿是打开面板那一刻的
  // 快照，泵在此之后签发的 token 会被陈旧草稿覆盖成空 → 免费档静默失效（用户实录 2026-09-20）
  const liveSettings: Record<string, string> = { ...(rec.settings ?? {}) };

  const save = (): void => {
    setSaving(true);
    try {
      const payload: Record<string, string> = { ...draft };
      for (const f of fields as any[]) if (f.auto) payload[f.key] = liveSettings[f.key] ?? "";
      updatePlugin(id, { settings: payload });
      dirtyRef.current = false;
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  if (fields.length === 0) {
    return (
      <Stack gap={2} fill>
        <EmptyState title={i18n("pages.plugins.487edd944895")} />
        <Inline gap={2} wrap>
          <Text slot="micro" tone="faint">—</Text>
          <Spacer />
          <Btn variant="ghost" onClick={onClose}>{i18n("pages.plugins.3fd47edce45b")}</Btn>
        </Inline>
      </Stack>
    );
  }

  const fmap = fields.map((f: any) => (
    <Field key={f.key} label={f.label}>
      {f.auto ? (
        /* 自动维护：只读展示实时值（不受草稿影响），避免手改与误覆盖 */
        <Input readOnly value={liveSettings[f.key] ?? ""} placeholder={i18n("pages.plugins.8fce5ea7e11b")} />
      ) : f.type === "select" ? (
        <Select value={draft[f.key] ?? ""} onChange={(value) => editDraft((d) => ({ ...d, [f.key]: value }))}>{optionsFor(f, liveSettings).map((o: { value: string; label: string }) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}</Select>
      ) : f.type === "textarea" ? (
        <TextArea rows={3} placeholder={f.placeholder ?? ""} value={draft[f.key] ?? ""} onChange={(value) => editDraft((d) => ({ ...d, [f.key]: value }))} />
      ) : (
        <Input type={f.type === "password" ? "password" : "text"} placeholder={f.placeholder ?? ""} value={draft[f.key] ?? ""} onChange={(value) => editDraft((d) => ({ ...d, [f.key]: value }))} />
      )}
    </Field>
  ));
  const hintNode = <Text as="p" slot="micro" tone="faint">{i18n("pages.plugins.d41b8d846ae4")}</Text>;
  const footNode = (
    <Inline gap={2} wrap>
      {savedAt ? (
        <Inline gap={1}>
          <Tag tone="success">{i18n("pages.plugins.1bd91a7d0c53")}</Tag>
          <Text slot="micro" tone="faint">{new Date(savedAt).toLocaleTimeString(getUiLocale(), { hour12: false })}</Text>
        </Inline>
      ) : (
        <Text slot="micro" tone="faint">{i18n("pages.plugins.8af2a0e7fc7c")}</Text>
      )}
      <Spacer />
      <Btn variant="ghost" onClick={() => setDraft({ ...rec.settings })}>{i18n("pages.plugins.b5a929dae5ba")}</Btn>
      <Btn variant="solid" tone="brand" disabled={saving} onClick={save}>{i18n("pages.plugins.a3030bf8f16d")}</Btn>
    </Inline>
  );
  return sheet ? (
    <Stack gap={2} fill>
      {fmap}
      {hintNode}
      {footNode}
    </Stack>
  ) : (
    <Stack gap={2} fill>
      <Grid min="sm">{fmap}</Grid>
      {hintNode}
      {footNode}
    </Stack>
  );
}

/** 运行日志：终端面（时间戳 + 方法符着色 + 语义色）+ 自动贴底（滚动锚点） */
export function LogBody({ id }: { id: string }): ReactNode {
  const uiLocale = useUiLocale();

  const events = useSyncExternalStore(subscribePluginEvents, () => pluginEvents(id));
  const endRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [events.length]);

  // delta/think 是逐 token 流（已进 dock 思考/回答链展示），进日志只会刷屏——只留进度/工具/日志/系统行
  const lines = events
    .filter((e) => !(e.method === "progress" && (e.kind === "delta" || e.kind === "think")))
    .slice(-400);
  return (
    <Stack gap={2} fill>
      <Surface sunken pad="sm">
        <Stack gap={1} fill>
          {lines.length === 0 ? (
            <Text as="span" slot="micro" tone="faint" nowrap={false}>{i18n("pages.plugins.1f2f3c30d1fe")}</Text>
          ) : (
            lines.map((e, i) => {
              const isLog = e.kind === "log";
              const tag = isLog ? "·" : e.kind === "tool" ? "🔧" : e.method === "progress" ? "▶" : e.method === "exit" ? "■" : "…";
              const tone: "error" | "brand" | "faint" | "quiet" = e.method === "exit" ? "error" : e.method === "progress" ? "brand" : isLog ? "faint" : "quiet";
              return (
                <Inline key={i} gap={2} vAlign="start">
                  <Text slot="micro" tone="faint" mono nowrap>{new Date(e.at).toLocaleTimeString(getUiLocale(), { hour12: false })}</Text>
                  <Text slot="micro" tone={e.method === "exit" || e.method === "progress" ? tone : "faint"} nowrap aria-hidden="true">{tag}</Text>
                  <Stack gap={0} fill>
                    <Text as="span" slot="micro" tone={e.method === "exit" ? "error" : "quiet"} mono={isLog} nowrap={false}>
                      {e.text || e.method}
                      {e.step != null ? `（${e.step}${e.total != null ? "/" + e.total : ""}）` : ""}
                    </Text>
                  </Stack>
                </Inline>
              );
            })
          )}
          <span ref={endRef} aria-hidden="true" />
        </Stack>
      </Surface>
    </Stack>
  );
}

/* ═══════════════ 插件市场视图：热度排序 · 搜索 · 一键安装 ═══════════════ */

function MarketView({
  cat,
  setCat,
}: {
  cat: "all" | "theme" | "general";
  setCat: (c: "all" | "theme" | "general") => void;
}): ReactNode {
  const uiLocale = useUiLocale();

  const installed = useSyncExternalStore(subscribe, installedPlugins);
  const installedMap = new Map(installed.map((p) => [p.manifest.id, p.manifest.version]));
  const [items, setItems] = useState<MarketEntry[] | null>(null);
  const [stars, setStars] = useState<Record<string, number | null>>({});
  /** ③ 详情页：点卡片进入（就地渲染，不用弹层） */
  const [detail, setDetail] = useState<MarketEntry | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"stars" | "latest">("stars"); // ② 默认按 star；可切「最新」
  const [msg, setMsg] = useState<PluginMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async (force = false): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await fetchRegistry(force);
      setItems(reg.plugins);
      setLoaded(true);
      // star 数动态拉取（失败沉底），不阻塞列表展示
      fetchStarMap(reg.plugins).then(setStars).catch(() => setStars({}));
    } catch (e) {
      setMsg({ text: i18n("pages.plugins.385852026583", { value: String(String(e instanceof Error ? e.message : e).slice(0, 200)) }), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const install = async (item: MarketEntry): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fetchEntryFromMarket(item);
      const { installPlugin } = await import("../plugins/loader.js");
      const m = await installPlugin(text, { repo: normalizeRepoUrl(item.repo) });
      setMsg({ text: i18n("pages.plugins.53edebb99ee7", { name: String(m.name), version: String(m.version) }), tone: "success" });
    } catch (e) {
      setMsg({ text: i18n("pages.plugins.fa5cae9e9254", { value: String(String(e instanceof Error ? e.message : e).slice(0, 200)) }), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  // 进入市场视图即自动加载：缓存命中（5 分钟内）立即展示，否则拉网络
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = query.trim().toLowerCase();
  const hits = (items ?? [])
    /* ④ 类别筛选也作用于市场：外观与布局的「安装主题」落到 view=market&category=theme 时，
       这里必须真的只列主题条目 */
    .filter((x) => cat === "all" || (cat === "theme" ? isThemeEntry(x) : !isThemeEntry(x)))
    .filter((x) => !q || [x.name, x.description, x.author, ...(x.tags ?? [])].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
    .slice()
    .sort((a, b) => {
      if (sortBy === "latest") return 0; // 「最新」= 市场名单原序（registry 里就是按收录时间倒序维护）
      const sa = stars[a.id] ?? -1;
      const sb = stars[b.id] ?? -1;
      if (sa !== sb) return sb - sa; // star 缺失（null）沉底
      return a.name.localeCompare(b.name);
    });

  /* ③ 详情页（就地渲染，不用弹层）：作者上传的全部简介图 + 详情正文（markdown）+ 主题开关 */
  if (detail) {
    const shots = (detail.screenshots ?? []).map((x) => resolveAssetUrl(x, detail.repo)).filter(Boolean);
    const head = resolveAssetUrl(detail.thumbnail ?? detail.logo, detail.repo);
    const rec = installed.find((p) => p.manifest.id === detail.id);
    const on = !!rec?.enabled;
    return (
      <Stack gap={3}>
        <Inline gap={3} align="start" wrap fill>
          <Btn variant="ghost" onClick={() => setDetail(null)}>{i18n("pages.plugins.572cf45ba436")}</Btn>
          <Avatar name={detail.name} src={head || undefined} tone="neutral" />
          <Stack gap={0} fill>
            <Inline gap={2} vAlign="center" wrap>
              <Text slot="title" weight="bold">{detail.name}</Text>
              {installedMap.has(detail.id) ? <Tag tone="success">{i18n("pages.plugins.a8b6c39dcabf")}</Tag> : null}
              {typeof stars[detail.id] === "number" ? (
                <Inline gap={1} vAlign="center">
                  <IconStar size="sm" />
                  <Text slot="micro" tone="faint">{String(stars[detail.id])}</Text>
                </Inline>
              ) : null}
            </Inline>
            <Text slot="micro" tone="faint">
              v{detail.version}
              {detail.author ? ` · ${detail.author}` : ""}
              {detail.license ? ` · ${detail.license}` : ""}
              {isThemeEntry(detail) ? i18n("pages.plugins.b6b4d7e04dee") : ""}
            </Text>
          </Stack>
          <Inline gap={2} wrap>
            {detail.homepage ? (
              <Btn variant="ghost" onClick={() => void (async () => {
                  try {
                    const { openUrl } = await import("@tauri-apps/plugin-opener");
                    await openUrl(detail.homepage!);
                  } catch {
                    window.open(detail.homepage!, "_blank");
                  }
                })()}>{i18n("pages.plugins.3e0d676d2d85")}</Btn>
            ) : null}
            {/* ④ 主题类插件：详情里直接启用/停用（沿用卡片开关语义） */}
            {rec && isThemeEntry(detail) ? (
              <Btn variant="ghost" onClick={() => void (on ? disablePlugin(detail.id) : enablePlugin(detail.id)).catch((e: unknown) => setMsg({ text: String(e), tone: "error" }))}>{on ? i18n("pages.plugins.1e26db04d877") : i18n("pages.plugins.336e65b39549")}</Btn>
            ) : null}
            {!installedMap.has(detail.id) ? (
              <Btn variant="solid" tone="brand" disabled={busy} onClick={() => void install(detail)}>{i18n("pages.plugins.e8f88f51ccb0")}</Btn>
            ) : null}
          </Inline>
        </Inline>

        {shots.length > 0 ? (
          <Grid min="sm">
            {shots.map((src, i) => (
              <Surface key={i} interactive pad="none" radius="sm" role="button" tabIndex={0} onClick={() => openImageViewer(src, i18n("pages.plugins.77a86d869230", { name: String(detail.name), value: String(i + 1) }))}>
                <img src={src} alt={i18n("pages.plugins.77a86d869230", { name: String(detail.name), value: String(i + 1) })} loading="lazy" />
              </Surface>
            ))}
          </Grid>
        ) : null}

        {detail.readme || detail.description ? (
          <div className="market-readme">
            <Markdown remarkPlugins={[remarkGfm]}>{detail.readme ?? detail.description ?? ""}</Markdown>
          </div>
        ) : null}

        <Text as="p" slot="micro" tone="faint">{i18nRich("pages.plugins.3f518410a068", { value: normalizeRepoUrl(detail.repo) })}</Text>
      </Stack>
    );
  }

  return (
    <Stack gap={2}>
      <Inline gap={2} wrap fill data-set-id="sec-插件市场">
        <Grow>
          <Input id="row-plg-market-search" placeholder={i18n("pages.plugins.3e7e79d7d597")} value={query} onChange={(value) => setQuery(value)} />
        </Grow>
        {/* ④ 排序：与全站同一套分段控件口径 */}
        <Segment size="sm" value={sortBy} onChange={(v) => setSortBy(v as "stars" | "latest")} options={[{ value: "stars", label: "star" }, { value: "latest", label: i18n("pages.plugins.569af1a47dbd") }]} />
        <Btn variant="outline" disabled={busy} onClick={() => void load(true)}>{busy ? i18n("pages.plugins.7f3c8312816f") : i18n("pages.plugins.aee887434131")}</Btn>
      </Inline>
      {/* ④ 市场自己的类别筛选：与「我的插件」同一套分段口径 */}
      <div data-set-id="row-plg-market-cat"><Segment size="sm" value={cat} onChange={(v) => setCat(v as "all" | "theme" | "general")} options={[{ value: "all", label: i18n("pages.plugins.5c55a67935af") }, { value: "theme", label: i18n("pages.plugins.788db1cfec2a") }, { value: "general", label: i18n("pages.plugins.835b700e028c") }]} /></div>

      {!loaded ? (
        msg ? (
          <Banner tone="error" action={<Btn variant="outline" size="sm" disabled={busy} onClick={() => void load(true)}>{i18n("pages.plugins.b8784c8dd563")}</Btn>}>
            {msg.text}
          </Banner>
        ) : busy ? (
          <LoadingBlock rows={3} />
        ) : (
          <Text as="p" slot="subtitle" tone="quiet">{i18n("pages.plugins.871be2654869")}</Text>
        )
      ) : msg ? (
        <Banner tone={msg.tone}>{msg.text}</Banner>
      ) : null}

      {loaded && !hits.length ? <EmptyState title={i18n("pages.plugins.fa01073a720f")} /> : null}

      {hits.length ? (
        <Grid min="md">
          {hits.map((item) => {
            const st = stars[item.id];
            return (
              <Card
                key={item.id}
                flush
                interactive
                role="button"
                tabIndex={0}
                onClick={() => setDetail(item)}
                onKeyDown={(ev) => { if (ev.key === "Enter") setDetail(item); }}
              >
                <Stack gap={1} fill>
                  <Row
                    flush
                    leading={<Avatar name={item.name} src={resolveAssetUrl(item.thumbnail ?? item.logo, item.repo) || undefined} tone="neutral" />}
                    title={item.name}
                    /* 版本/作者走 Row 的第二行（sub），不再与 title 挤同一条 flex 行：
                       实测窄卡片下 title 只分到 49px 而它需要 94px（截成「Hello …」）、
                       连 meta 也被截（「v2.1.1 · …」）——头行三样（title/meta/trailing）
                       争一条行宽，用户点名「有点挤」。sub 是这套 Row 本来就有的第二行。 */
                    sub={<>{`v${item.version}`}{item.author ? ` · ${item.author}` : ""}</>}
                    trailing={
                      <Inline gap={1} vAlign="center">
                        <IconStar size="sm" />
                        <Text slot="micro" tone="faint">{typeof st === "number" ? String(st) : "—"}</Text>
                        {installedMap.has(item.id) ? <Tag tone="success">{i18n("pages.plugins.a8b6c39dcabf")}</Tag> : null}
                      </Inline>
                    }
                  />
                  {/* 正文块统一内缩。这个 Card 是 flush（`--og-c-surface-pad: 0`），头部 Row 靠自己的
                      `og-row--flush`（= `--og-card-pad`）与卡边对齐；而描述 / 标签 / 操作行这三块
                      原来**内缩 0** —— 于是文字、标签贴着左边、`已安装` 贴着右边（用户截图点名
                      「字挤着左边，详情和 tag 挤着左边，已安装也挤着右边」）。
                      这里不写死内缩步长，直接挂设计系统的卡体类 `og-card-body`（padding = --og-card-pad）
                      —— 与头部 Row 吃同一条令牌，密度轴换档（compact 12 / comfortable 16）也同步。 */}
                  <Stack gap={1} className="og-card-body">
                    <Text as="p" slot="subtitle" tone="quiet" clamp={2}>{item.description || item.repo}</Text>
                    {item.tags?.length ? (
                      <Inline gap={1} wrap>
                        {item.tags.map((t) => (
                          <Chip key={t} size="sm">{t}</Chip>
                        ))}
                      </Inline>
                    ) : null}
                    {/* 操作行：用 Inline 的 justify="between" 把主操作推到行尾，**不用 Spacer**
                        ——.og-spacer 是 flex:1 的真 flex item，行一折行它就独占一整行空白
                        （实测窄卡片下操作区折成 4 行、其中第 3 行是空行 = 用户说的「挤」）。
                        space-between 零额外 item：折行时只会 2 行，不会出现幽灵空行。 */}
                    <Inline gap={2} wrap justify="between">
                      <Btn data-set-id="row-plg-detail" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setDetail(item); }}>{i18n("pages.plugins.979a332955c8")}</Btn>
                      {/* 仓库 = 图标钮（repo 全串走 tooltip / aria-label / 详情页）。
                          原来把 `smartThise/OneTHU-plugin-hello` 当按钮文字：实测这个按钮
                          宽 233~243px，**比整张卡的内容区（176~240px）还宽** → 操作行必然折成
                          3 行（旁边那行还只有「详情」两个字），是"挤"的最大来源。 */}
                      <Btn
                        variant="ghost"
                        size="sm"
                        icon={<IconGithub size="sm" />}
                        aria-label={i18n("pages.plugins.f1ae34bf6dad", { repo: String(item.repo) })}
                        titleAttr={i18n("pages.plugins.bd2db6941185", { value: String(normalizeRepoUrl(item.repo)) })}
                        onClick={(e) => {
                          e.stopPropagation();
                          void (async () => {
                            const url = normalizeRepoUrl(item.repo);
                            try {
                              const { openUrl } = await import("@tauri-apps/plugin-opener");
                              await openUrl(url);
                            } catch {
                              window.open(url, "_blank");
                            }
                          })();
                        }}
                      />
                      {(() => {
                        const local = installedMap.get(item.id);
                        if (local && compareVersions(item.version, local) <= 0) {
                          return (
                            <Btn variant="outline" size="sm" disabled titleAttr={i18n("pages.plugins.3963483ec3f1", { local: String(local) })}>{i18n("pages.plugins.a8b6c39dcabf")}</Btn>
                          );
                        }
                        const updating = !!local;
                        return (
                          <Btn variant="solid" tone="brand" size="sm" disabled={busy} titleAttr={updating ? i18n("pages.plugins.2e1eee4a9c24", { local: String(local), version: String(item.version) }) : undefined} onClick={(e) => { e.stopPropagation(); void install(item); }}>{busy ? "…" : updating ? i18n("pages.plugins.3055a035f0eb") : i18n("pages.plugins.e8f88f51ccb0")}</Btn>
                        );
                      })()}
                    </Inline>
                  </Stack>
                </Stack>
              </Card>
            );
          })}
        </Grid>
      ) : null}

      <Text as="p" slot="micro" tone="faint">{i18n("pages.plugins.e601f799d681")}<a href="https://github.com/smartThise/OneTHU-Market" target="_blank" rel="noreferrer">{i18n("pages.plugins.30f1c8a5f18d")}</a>{i18n("pages.plugins.eec62fdf53b6")}</Text>
    </Stack>
  );
}

/* ═══════════════ 安装面板：三路安装（粘贴 JS / JS 文件 / Rust 插件） ═══════════════ */

function InstallPanel({ onClose }: { onClose: () => void }): ReactNode {
  const uiLocale = useUiLocale();

  const [tab, setTab] = useState<"paste" | "jsfile" | "rust" | "github">("paste");
  const [repoInput, setRepoInput] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<PluginMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const install = async (text: string): Promise<void> => {
    if (!text.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const { installPlugin } = await import("../plugins/loader.js");
      const m = await installPlugin(text);
      setMsg({ text: i18n("pages.plugins.19c2811cc125", { name: String(m.name), version: String(m.version) }), tone: "success" });
      setCode("");
    } catch (e) {
      setMsg({ text: i18n("pages.plugins.fa5cae9e9254", { value: String(String(e instanceof Error ? e.message : e).slice(0, 200)) }), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const installFromRepoText = async (input: string, entry?: string): Promise<void> => {
    const ref = parseRepoInput(input);
    const text = await fetchEntryFromRepo(ref, entry);
    const { installPlugin } = await import("../plugins/loader.js");
    const m = await installPlugin(text, { repo: normalizeRepoUrl(input) });
    setMsg({ text: i18n("pages.plugins.19c2811cc125", { name: String(m.name), version: String(m.version) }), tone: "success" });
    setRepoInput("");
  };

  const installRust = async (): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      // Tauri v2 的 webview File 对象没有 .path（v1 特权已移除）——必须走系统文件对话框
      if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
        throw new Error(i18n("pages.plugins.1d4986f12b94"));
      }
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      // R10：整包导入（zip 优先，兼容文件夹）——manifest + 二进制 + logo 整包随行
      const mode = await new Promise<"zip" | "dir" | null>((res) => {
        const z = window.confirm(i18n("pages.plugins.df66136c7ca9"));
        res(z ? "zip" : "dir");
      });
      if (!mode) return;
      if (mode === "zip") {
        const sel = await open({
          multiple: false,
          directory: false,
          title: i18n("pages.plugins.818271a12650"),
          filters: [{ name: i18n("pages.plugins.2f965f0c5a2b"), extensions: ["zip"] }],
        });
        if (!sel) return;
        const out = await invoke<{ kind: string; manifest: any; binPath?: string; code?: string }>(
          "plugin_dir_import_zip",
          { zipPath: typeof sel === "string" ? sel : String(sel) },
        );
        if (out.kind !== "rust" || !out.binPath) throw new Error(i18n("pages.plugins.00c085fc2b1c"));
        addRustPlugin(out.manifest, out.binPath);
        const { enablePlugin } = await import("../plugins/loader.js");
        await enablePlugin(out.manifest.id);
        setMsg({ text: i18n("pages.plugins.54d56dd165af", { name: String(out.manifest.name), version: String(out.manifest.version) }), tone: "success" });
        return;
      }
      // 文件夹形态：选 manifest.json，整目录复制
      const sel = await open({
        multiple: false,
        directory: false,
        title: i18n("pages.plugins.1b568ba90ae3"),
        filters: [{ name: "manifest.json", extensions: ["json"] }],
      });
      if (!sel) return; // 用户取消
      const mpath = typeof sel === "string" ? sel : String(sel);
      const manifest = JSON.parse(await invoke<string>("read_file_text", { path: mpath }));
      if (!manifest?.id || !manifest?.name) throw new Error(i18n("pages.plugins.c3db55f566f3"));
      if (manifest.kind !== "rust" || !manifest.bin) throw new Error(i18n("pages.plugins.ac5214002800"));
      const mdir = mpath.replace(/[^/\\]+$/, "");
      const newBin = await invoke<string>("plugin_dir_install_rust", {
        id: String(manifest.id),
        manifestDir: mdir,
        bin: String(manifest.bin),
      });
      addRustPlugin(manifest, newBin);
      const { enablePlugin } = await import("../plugins/loader.js");
      await enablePlugin(manifest.id);
      setMsg({ text: i18n("pages.plugins.54d56dd165af", { name: String(manifest.name), version: String(manifest.version) }), tone: "success" });
    } catch (e) {
      setMsg({ text: i18n("pages.plugins.fa5cae9e9254", { value: String(String(e instanceof Error ? e.message : e).slice(0, 200)) }), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card pad="md">
      <Stack gap={3} fill>
        <Segment
          size="sm"
          value={tab}
          onChange={(nv) => {
            setTab(nv as typeof tab);
            setMsg(null);
          }}
          options={[
            { value: "paste", label: i18n("pages.plugins.da83088b9429") },
            { value: "jsfile", label: i18n("pages.plugins.915ff99bde6d") },
            { value: "rust", label: i18n("pages.plugins.7230f06b4b8d") },
            { value: "github", label: i18n("pages.plugins.720f02a99a32") },
          ]}
        />

        {tab === "paste" ? (
          <Stack gap={2} fill>
            <TextArea
              mono
              rows={5}
              placeholder={"export const manifest = { id: \"my.plugin\", name: \"…\", version: \"0.1.0\", permissions: [\"info:read\"] };\nexport default async (ctx) => { /* ctx.onethu.* */ }"}
              value={code}
              onChange={(value) => setCode(value)}
            />
            <Inline gap={2} wrap>
              <Text slot="micro" tone="faint">{i18n("pages.plugins.ad7b16c2a298")}</Text>
              <Spacer />
              <Btn variant="solid" tone="brand" disabled={busy || !code.trim()} loading={busy} onClick={() => void install(code)}>{busy ? i18n("pages.plugins.19658d9fa9aa") : i18n("pages.plugins.e8f88f51ccb0")}</Btn>
            </Inline>
          </Stack>
        ) : null}

        {tab === "jsfile" ? (
          <Stack gap={2} fill>
            <Btn variant="outline" block icon={<IconFile size="md" />} onClick={() => fileRef.current?.click()}>{i18n("pages.plugins.8519adb8fed4")}</Btn>
            {/* 裸 file input 仅此一处（触发层换 Btn，读取管线原样）；同 Forum/壁纸库既有模式 */}
            <input
              ref={fileRef}
              type="file"
              accept=".js,.mjs,text/javascript"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then(install);
                e.target.value = "";
              }}
            />
            <Text as="p" slot="micro" tone="faint">{i18n("pages.plugins.303c91500c16")}</Text>
          </Stack>
        ) : null}

        {tab === "rust" ? (
          <Stack gap={2} fill>
            <Btn variant="outline" block loading={busy} onClick={() => void installRust()}>
              {busy ? i18n("pages.plugins.9802c0baac66") : i18n("pages.plugins.4ec0d4869981")}
            </Btn>
            <Text as="p" slot="micro" tone="faint">{i18n("pages.plugins.06b0325a6d14")}</Text>
          </Stack>
        ) : null}

        {tab === "github" ? (
          <Stack gap={2} fill>
            <Input
              placeholder={i18n("pages.plugins.cf4c259c0592")}
              value={repoInput}
              onChange={(value) => setRepoInput(value)}
              onEnter={() => {
                if (!busy && repoInput.trim()) void installFromRepoText(repoInput).catch((e2: unknown) => setMsg({ text: i18n("pages.plugins.fa5cae9e9254", { value: String(String(e2 instanceof Error ? e2.message : e2).slice(0, 200)) }), tone: "error" }));
              }}
            />
            <Inline gap={2} wrap>
              <Text slot="micro" tone="faint">{i18n("pages.plugins.f76ad1b3aaac")}</Text>
              <Spacer />
              <Btn variant="solid" tone="brand" disabled={busy || !repoInput.trim()} loading={busy} onClick={() => void installFromRepoText(repoInput).catch((e2: unknown) => setMsg({ text: i18n("pages.plugins.fa5cae9e9254", { value: String(String(e2 instanceof Error ? e2.message : e2).slice(0, 200)) }), tone: "error" }))}>{busy ? i18n("pages.plugins.19658d9fa9aa") : i18n("pages.plugins.e8f88f51ccb0")}</Btn>
            </Inline>
          </Stack>
        ) : null}

        <Inline gap={2} wrap>
          {msg ? (
            <Text as="p" slot="subtitle" tone={msg.tone}>{msg.text}</Text>
          ) : (
            <Text as="p" slot="micro" tone="faint">{i18n("pages.plugins.c8279d4cc145")}</Text>
          )}
          <Spacer />
          <Btn variant="ghost" onClick={onClose}>{i18n("pages.plugins.c0b3fbff51cc")}</Btn>
        </Inline>
      </Stack>
    </Card>
  );
}

import { Btn, SettingsRow, Text } from "@onethu/gui";
/**
 * OH 独立页（设置 →「OH」页签）：**普通配置 / 高级配置** 两档。
 *
 * 2026-10-11 设置重构（用户拍板）：
 *  - 「高级模式」分层整体退役 → 分档改为**页面自己分**：日常项进普通档，进阶项进高级档；
 *  - 语音合成（音色/语调/语速）与悬浮球开关**从设置页搬到这里**（普通档）；
 *  - IM 通道从设置页搬到这里（完整配置进高级档）；
 *  - OH 自己的模型配置（provider/apiKey/baseUrl/model/thinking/multimodal/预算）由**插件清单**
 *    驱动，渲染在插件页的设置面板里（`pages/Plugins.tsx` 的 settings sheet）——那是 task-17 的域，
 *    这里只给一行状态与跳转入口，不重复实现表单（避免两份真相）。
 *
 * 只做信息架构与入口，不改任何功能语义。
 */
import { defineSearchRows } from "../state/searchRows.js";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../state/context.js";
import { goEntry } from "./Layout.js";
import { requestPluginsFocus } from "../state/pluginsFocus.js";
import { VoiceSettingsSection } from "./VoiceSettingsSection.js";
import { OverlaySettingsSection } from "./OverlaySettingsSection.js";
import { ImSettingsSection } from "./ImSettingsSection.js";
import { isAndroidNavigator } from "../lib/androidHost.js";
import { forceRemint, preflightMadModel, madmodelActive } from "../state/madmodel.js";
import { t as i18n } from "../i18n/index.js";


const isAndroid = isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);

/* ── 页面外的「档位请求」：对话坞的朗读设置深链要停在普通档 ──
   设置页里的 OH 分节是**常驻挂载**的（页签只靠 display 收放），所以不能用"挂载时取一次"，
   必须做成可订阅的小 store：请求到达 → 通知已挂载的实例 → 取走并切档。 */
export type OhTier = "basic" | "advanced";
let pendingTier: OhTier | null = null;
const tierListeners = new Set<() => void>();

/** 请求 OH 页切到某一档（配合 settingsMode 的 requestSettingsTab("OH") 一起用） */

/* ── task-19：本页**独有**的设置行注册（模块加载时执行，不依赖 DOM/是否可见）。
   注意：语音/悬浮球/IM 的行由**它们各自的 section 组件**注册（单一真源），这里不再重复注册
   —— 重复注册会让"搜到的是哪一条"出现歧义（护栏最初就是被这一点抓红的）。 ── */
/* 行锚点口径（2026-10-15 oh-wire 复核，与 focusSettingsTarget 的实现对齐）：
   focusSettingsTarget **自己会补 row-/sec- 前缀**（Layout.tsx:598），所以 target 要传"光名字"——
   SubHead 的 `data-set-id="sec-模型MCP日志"` ← 传「模型MCP日志」；自动打 id 的设置行 ← 传行标题。
   旧值 "sec-模型MCP日志" / "oh-tier-advanced" 会被拼成 `sec-sec-…` / `row-oh-tier-advanced`，
   两处都命中不了 → 落地点名存实亡（用户侧表现=搜到点了没反应）。档位根改用按钮文本
   「高级配置」（focusSettingsTarget 的第三条：动作按钮文本，在 .explorer-settings-body 内）。 */
defineSearchRows([
  { id: "oh-root", tab: "OneTHU Harness", section: "入口", title: "OneTHU Harness / 小OH 设置", aliases: ["小OH", "OH 设置", "OH", "Harness", "助手设置"], desc: "OH 的基础设置与高级配置入口" , breadcrumb: ["插件", "OneTHU Harness", "入口", "OneTHU Harness / 小OH 设置"], displayRoot: "设置" },
  { id: "oh-madmodel", tab: "OneTHU Harness", section: "免费额度", title: "MadModel 免费档", aliases: ["免费额度", "额度", "重新签", "token"], desc: "额度不足或过期时点重新签一次" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "免费额度", "MadModel 免费档"], displayRoot: "设置", go: () => goOhRow("MadModel 免费档", "basic") },
  { id: "oh-multimodal", tab: "OneTHU Harness", section: "模型与多模态", title: "OH 模型 / 多模态开关", aliases: ["多模态", "图片输入", "模型", "provider", "apiKey", "baseUrl", "maxContext", "stream"], desc: "模型来源、Key、模型名与多模态（图片输入）" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "模型与多模态", "OH 模型 / 多模态开关"], displayRoot: "设置", go: () => goOhRow("OH 模型 / 多模态开关", "basic") },
  { id: "oh-contextmode", tab: "OneTHU Harness", section: "模型与多模态", title: "上下文记忆模式", aliases: ["上下文", "记忆", "压缩", "历史", "要点", "压缩内容制"], desc: "历史超长自动收成要点清单，重要内容不再丢" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "模型与多模态", "上下文记忆模式"], displayRoot: "设置", go: () => goOhRow("上下文记忆模式", "basic") },
  { id: "oh-keepalive", tab: "OneTHU Harness", section: "保活", title: "后台保活（华为 / 荣耀）", aliases: ["保活", "自启动", "电池优化", "后台"], desc: "应用启动管理设手动管理并允许自启动/关联启动/后台活动" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "保活", "后台保活（华为 / 荣耀）"], displayRoot: "设置", go: () => goOhRow("后台保活（华为 / 荣耀）", "basic") },
  { id: "oh-adv-plugins", tab: "OneTHU Harness", section: "模型 / MCP / 日志", title: "模型 / 配额预算 / MCP / 命令与日志 / 权限", aliases: ["MCP", "配额", "预算", "日志", "权限", "命令"], breadcrumb: ["插件", "OneTHU Harness", "高级配置", "模型 / MCP / 日志", "模型 / 配额预算 / MCP / 命令与日志 / 权限"], displayRoot: "设置", go: () => { requestOhTier("advanced"); requestPluginsFocus({ target: "模型MCP日志", fallbackTarget: "高级配置", waitMs: 1400 }); } },
  /* 本轮新接线（2026-10-15）：OH MCP **服务器**总闸（把 OneTHU 自己暴露成本机 MCP）。
     控件本体在 pages/Plugins.tsx 的 McpSwitchRow（这是「OH 是插件页子页」的既有事实），
     行注册放这里 = OH 家族唯一注册点；target 传行标题，markSettingsRows 会把它打成 row-<slug>。 */
  { id: "oh-mcp-server", tab: "OneTHU Harness", section: "模型 / MCP / 日志", title: "OH MCP 服务器", aliases: ["MCP 服务器", "本机 MCP", "8787", "外部客户端"], desc: "让本机其它助手连上 OneTHU（默认关闭）" , breadcrumb: ["插件", "OneTHU Harness", "高级配置", "模型 / MCP / 日志", "OH MCP 服务器"], displayRoot: "设置", go: () => { requestOhTier("advanced"); requestPluginsFocus({ target: "OH MCP 服务器", fallbackTarget: "模型MCP日志", waitMs: 2000 }); } },
  /* 反向（OH 当客户端去连别人的 MCP）：管理列表在高级档的「连接外部 MCP 服务器」行。 */
  { id: "oh-mcp-client", tab: "OneTHU Harness", section: "模型 / MCP / 日志", title: "连接外部 MCP 服务器", aliases: ["MCP 客户端", "外部 MCP", "添加 MCP 服务器", "MCP 服务器列表", "filesystem MCP", "stdio MCP"], desc: "让 OH 调用外部 MCP server 的工具（增删改在插件页高级档）" , breadcrumb: ["插件", "OneTHU Harness", "高级配置", "模型 / MCP / 日志", "连接外部 MCP 服务器"], displayRoot: "设置", go: () => { requestOhTier("advanced"); requestPluginsFocus({ target: "连接外部 MCP 服务器", fallbackTarget: "模型MCP日志", waitMs: 2200 }); } },
]);

/* task-22：OH 行级直达的**本地快捷**（三段式的 ②+③）：切档 + 滚到行（找不到行时落档位根）。+
   语音/悬浮球/IM 的行注册也走它（单一实现，避免四处手写切档请求）。
   锚点口径（2026-10-15 oh-wire 复核）：focusSettingsTarget **自己会补** `row-`/`sec-` 前缀，
   所以 target 传**行标题**（自动打 id 的行 / JSX 里钉了 id 的行都命中），fallbackTarget 传
   **档位按钮的文本**（TierSwitch 的 data-set-id 就是 `row-<档位名>`，见下）。旧值
   "row-"+slugOf(title) 与 `oh-tier-${tier}` 会被拼成 `row-row-…` / `row-oh-tier-…`，
   **永远命不中** —— 14 处 goOhRow 调用（OH/语音/悬浮球/IM 的行）全都在"点了没反应"。 */
export function goOhRow(title: string, tier: OhTier, note?: string): void {
  requestOhTier(tier);
  requestPluginsFocus({ target: title, fallbackTarget: tier === "basic" ? "基础设置" : "高级配置", note });
}

export function requestOhTier(t: OhTier): void {
  pendingTier = t;
  for (const f of tierListeners) f();
}
function subscribeOhTier(f: () => void): () => void {
  tierListeners.add(f);
  return () => {
    tierListeners.delete(f);
  };
}
function takeTier(): OhTier | null {
  const t = pendingTier;
  pendingTier = null;
  return t;
}

/* 2026-10-11 用户要求「彻查，给个状态机」：OH 子页的入口态统一由
   components/Layout.tsx 的 goEntry()/useEntry() 管理——这里**不再有任何入口旗标或订阅**。 */

/** 档位根的锚点值（**字面量**，静态审计/grep 能直接看见）：
 *  focusSettingsTarget 补 `row-<slugOf(want)>`，所以调用方传「基础设置」/「高级配置」即命中。 */
const TIER_ANCHOR: Record<"basic" | "advanced", string> = { basic: "row-基础设置", advanced: "row-高级配置" };

/** 档位切换条（分段控件，与设置页页签同形态但更轻） */
function TierSwitch({ tier, onChange }: { tier: "basic" | "advanced"; onChange: (t: "basic" | "advanced") => void }): ReactNode {
  const item = (id: "basic" | "advanced", label: string): ReactNode => (
    <button
      className={"nav-item" + (tier === id ? " is-active" : "")}
      role="tab"
      aria-selected={tier === id}
      /* task-22：档位根锚点——检索直达「找不到行」时落这里再解释（分节根口径）。
         2026-10-15 oh-wire 复核：锚点值必须是**解析器会自己补前缀**的形状
         （focusSettingsTarget 用 `row-<slugOf(want)>` 查 data-set-id）——所以这里写
         `row-基础设置` / `row-高级配置`，调用方传「基础设置」/「高级配置」即可命中。
         （旧值 `oh-tier-basic`/`oh-tier-advanced` 谁都命中不了：传光名字会被补成
         `row-oh-tier-basic`，传全名会被补成 `row-row-…`。） */
      data-set-id={TIER_ANCHOR[id]}
      style={{ flex: 1, justifyContent: "center" }}
      onClick={() => onChange(id)}
    >
      {label}
    </button>
  );
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 4, padding: 4, marginBottom: 12,
        border: "1px solid var(--border)", borderRadius: "var(--md-sys-shape-corner-large, 12px)",
        background: "var(--md-sys-color-surface-container-lowest)",
      }}
      role="tablist"
      aria-label={i18n("auto.components.OhSettingsPage.1")}
    >
      {item("basic", "基础设置")}
      {item("advanced", "高级配置")}
    </div>
  );
}

/** 小节标题：**刻意不用 SectionHead**——设置页的页签显隐是按 `.section-head` 走的，
 *  这里再塞一个会被当成新分节被显隐逻辑收走。 */
function SubHead({ children, id }: { children: ReactNode; id?: string }): ReactNode {
  return (
    /* ② 左内边距对齐行（og-settings-row 的 --og-card-pad）；id（task-22 检索直达）**照挂 data-set-id**，
       供 goSearchRow 的离家行 / 无行控件落地——OneGUI 后仍认这一锚点。 */
    <div className="og-section-titles" data-set-id={id} style={{ paddingInline: "var(--og-card-pad)" }}>
      <Text slot="subtitle" as="h4" weight="semibold">{children}</Text>
    </div>
  );
}

/** MadModel 免费档：状态 + 一键重新签（token 逻辑全在 state/madmodel.ts，这里只调用） */
function MadModelRow(): ReactNode {
  const [warn, setWarn] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let alive = true;
    setChecking(true);
    void preflightMadModel().then((w) => {
      if (alive) setWarn(w);
    }).catch((e) => { if (alive) setWarn(String(e)); })
      .finally(() => { if (alive) setChecking(false); });
    return () => {
      alive = false;
    };
  }, [done]);
  return (
    <SettingsRow
      title={i18n("auto.components.OhSettingsPage.2")}
      sub={busy ? "正在续签…" : checking ? "正在检查免费模型连接…" : !madmodelActive() ? "当前使用自费 API；切换模型源后检查免费档。" : warn ? warn : "自动续签已开（到期前约 1 小时、每 10 分钟巡检）。"}
      control={
        <Btn variant="outline" size="sm" disabled={busy} onClick={() => {
            setBusy(true);
            void forceRemint()
              .catch(() => undefined)
              .finally(() => {
                setBusy(false);
                setDone((v) => !v);
              });
          }}>{i18n("auto.components.OhSettingsPage.3")}</Btn>
      }
    />
  );
}

/**
 * 高级档里**预留给插件设置表单**的位置（task-17 抽出 `pages/Plugins.tsx` 的 settings sheet）。
 *
 * 现在 task-17 已落地：`pages/Plugins.tsx` 组装 advancedPanels 传入（SettingsBody + MCP + 日志），
 * 这个回落分支只在没传时兜底——文案对齐 2026-10-11 的信息架构（插件子页就地配置）。
 */
function OhAdvancedSlot(): ReactNode {
  const { navigate } = useApp();
  return (
    <div className="setting-row">
      <div>
        <div className="setting-title">{i18n("auto.components.OhSettingsPage.4")}</div>
        <div className="setting-desc">
          {i18n("auto.components.OhSettingsPage.5")}</div>
      </div>
      <Btn variant="outline" onClick={() => goEntry("plugins")}>{i18n("auto.components.OhSettingsPage.6")}</Btn>
    </div>
  );
}

/** 保活指引（华为 / 荣耀）：文案 + 跳系统应用设置（安卓才显示按钮，桌面只留说明） */
function KeepAliveRow(): ReactNode {
  const [jumped, setJumped] = useState(false);
  return (
    <div className="setting-row">
      <div>
        <div className="setting-title">{i18n("auto.components.OhSettingsPage.7")}</div>
        <div className="setting-desc">
          {i18n("auto.components.OhSettingsPage.8")}{jumped ? "（已跳转系统应用设置页）" : ""}
        </div>
      </div>
      {isAndroid ? (
        <Btn variant="outline" onClick={() => {
            void import("@tauri-apps/api/core")
              .then((m) => m.invoke("open_app_settings"))
              .catch(() => undefined);
            setJumped(true);
          }}>{i18n("auto.components.OhSettingsPage.9")}</Btn>
      ) : null}
    </div>
  );
}

export function OhSettingsPage({ advancedPanels }: { advancedPanels?: ReactNode } = {}): ReactNode {
  const { navigate } = useApp();
  const [tier, setTier] = useState<"basic" | "advanced">("basic");

  // 页面外请求切档（如对话坞长按朗读图标 → 插件页 → OH → 基础设置）
  useEffect(() => {
    /* 首次挂载先取一次：请求往往发生在组件挂载之前（goEntry("oh") → requestOhTier），
       只订阅不取 = 高级档行从搜索/OH 深链首次进入永远停在基础档。 */
    const first = takeTier();
    if (first) setTier(first);
    return subscribeOhTier(() => {
      const want = takeTier();
      if (want) setTier(want);
    });
  }, []);

  return (
    <>
      <TierSwitch tier={tier} onChange={setTier} />

      {tier === "basic" ? (
        <>
          <SubHead>{i18n("auto.components.OhSettingsPage.10")}</SubHead>
          <VoiceSettingsSection />

          <SubHead>{i18n("auto.components.OhSettingsPage.11")}</SubHead>
          <OverlaySettingsSection />

          <SubHead>{i18n("auto.components.OhSettingsPage.12")}</SubHead>
          <MadModelRow />

          <SubHead>{i18n("auto.components.OhSettingsPage.13")}</SubHead>
          <div className="setting-row">
            <div>
              <div className="setting-title">{i18n("auto.components.OhSettingsPage.14")}</div>
              <div className="setting-desc">
                {i18n("auto.components.OhSettingsPage.15")}</div>
            </div>
            <Btn variant="outline" onClick={() => goEntry("plugins")}>{i18n("auto.components.OhSettingsPage.6")}</Btn>
          </div>

          {/* 2026-10-13 压缩内容制（fa54a9c）：给一行机制说明——历史超长不再裸丢。
              这行只是说明，没有可切换项（机制永远开启；预算大小在插件设置里调）。 */}
          <div className="setting-row">
            <div>
              <div className="setting-title">{i18n("auto.components.OhSettingsPage.16")}</div>
              <div className="setting-desc">
                {i18n("auto.components.OhSettingsPage.17")}</div>
            </div>
          </div>

          <SubHead>{i18n("auto.components.OhSettingsPage.18")}</SubHead>
          {/* 同一份 ImSettingsSection 的 basic 档：扫码创建应用 + 绑定主人（生成码/解绑）+ 连接状态 */}
          <ImSettingsSection tier="basic" />

          <SubHead>{i18n("auto.components.OhSettingsPage.19")}</SubHead>
          <KeepAliveRow />
        </>
      ) : (
        <>
          <SubHead>{i18n("auto.components.OhSettingsPage.20")}</SubHead>
          {/* 同一份实现的 advanced 档：通道开关、手工凭据、微信灰置说明 */}
          <ImSettingsSection tier="advanced" />

          <SubHead>{i18n("auto.components.OhSettingsPage.21")}</SubHead>
          <MadModelRow />

          <SubHead id="sec-模型MCP日志">{i18n("auto.components.OhSettingsPage.22")}</SubHead>
          {advancedPanels ?? <OhAdvancedSlot />}
        </>
      )}
    </>
  );
}

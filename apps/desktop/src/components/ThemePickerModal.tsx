/**
 * 「更改主题」二级菜单（设置 → 外观）。
 *
 * 布局：上「已安装」、下「主题市场」，共用顶部搜索（套用插件市场的匹配口径：名称/描述/作者/标签）。
 * 已安装的社区主题同时出现在两栏（市场栏显示「已安装」，不可重复安装）。
 * 骨架沿用 TabManageModal：portal + mask/panel，PC 右推面板、手机居中弹窗，同款退场动画。
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitPhase } from "../lib/useExitPhase.js";
import { useExpanded } from "../state/usePlatformLayout.js";
import { activateTheme, removeTheme, restoreBuiltins, useThemes, type ThemeDef } from "../state/theme.js";
import { fetchEntryFromMarket, fetchRegistry, normalizeRepoUrl, type MarketEntry } from "../lib/market.js";
import { installedPlugins, subscribe, uninstallPlugin } from "../plugins/loader.js";
import { confirmOk } from "../lib/confirm.js";

const maskStyle: React.CSSProperties = { animation: "m-fade var(--dur-2) var(--ease-out) both", position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
const panelStyle: React.CSSProperties = { animation: "m-spring-in var(--dur-3) var(--ease-out) both", width: "100%", maxWidth: 460, maxHeight: "76vh", display: "flex", flexDirection: "column", background: "var(--surface, #ffffff)", color: "var(--text-1, #1f2329)", borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,.28)" };
const maskOut: React.CSSProperties = { animation: "m-fade-out var(--dur-2) var(--md-sys-motion-easing-emphasized-accelerate) both" };
const panelOut: React.CSSProperties = { animation: "m-pop-out var(--dur-2) var(--md-sys-motion-easing-emphasized-accelerate) both" };
const maskStylePc: React.CSSProperties = { ...maskStyle, background: "rgba(0,0,0,.18)", justifyContent: "flex-end", padding: 0 };
const panelStylePc: React.CSSProperties = { ...panelStyle, animation: "m-slide-right var(--dur-3) var(--ease-ios) both", width: "min(460px, 44vw)", maxWidth: "none", maxHeight: "none", height: "100%", borderRadius: 0, borderLeft: "1px solid var(--border, #e5e7eb)", boxShadow: "-18px 0 48px rgba(0,0,0,.24)" };

/** 主题色卡：从 vars 抽 accent / accent-soft / bg 三色出预览（缺省回退令牌默认）。
 *  只显示名字看不出样式，所以每一行都带这块色卡。 */
export function ThemeSwatch({ vars }: { vars: Record<string, string> }): ReactNode {
  const accent = vars["--accent"] ?? "#4176e6";
  const soft = vars["--accent-soft"] ?? "#edf3fe";
  const bg = vars["--bg"] ?? "#ffffff";
  return (
    <span className="theme-swatch" style={{ background: soft, display: "inline-flex", gap: 3, padding: 3, borderRadius: 8, flex: "none" }}>
      <i style={{ width: 18, height: 18, borderRadius: 5, background: accent }} />
      <i style={{ width: 18, height: 18, borderRadius: 5, background: bg, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)" }} />
    </span>
  );
}

export function ThemePickerModal({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const expanded = useExpanded();
  const snap = useThemes();
  const plugins = useSyncExternalStore(subscribe, installedPlugins);
  const [closing, requestClose] = useExitPhase(onClose, open);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MarketEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  /* Esc 关闭 */
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") requestClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, requestClose]);

  const load = async (force = false): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await fetchRegistry(force);
      /* 只留主题条目：市场名单（MarketEntry）没有 category 字段，主题条目以 tags 含「主题」为准
         （如 onethu.theme.barbie），id 形如 *.theme.* 的兜底一次。 */
      setItems(reg.plugins.filter((x) => (x.tags ?? []).includes("主题") || /[.]theme[.]/.test(x.id)));
    } catch (e) {
      setMsg("主题市场拉取失败：" + String(e instanceof Error ? e.message : e).slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  /* 打开时拉一次；缓存命中（5 分钟内）立即返回 */
  useEffect(() => {
    if (open && !items) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const hit = (fields: Array<string | undefined>): boolean =>
    !q || fields.filter(Boolean).some((v) => String(v).toLowerCase().includes(q));

  const installedThemes = snap.themes.filter((t) => hit([t.name, t.description, t.author]));
  const marketHits = (items ?? []).filter((x) => hit([x.name, x.description, x.author, ...(x.tags ?? [])]));
  const pluginIds = new Set(plugins.map((p) => p.manifest.id));
  const hasInMarket = (x: MarketEntry): boolean =>
    pluginIds.has(x.id) || snap.themes.some((t) => t.id === x.id || t.owner === x.id);

  /* 主题所属插件：优先安装时写入的 owner，退化到「主题 id 与插件 id 同名」约定
     （与插件页原逻辑一致：只删定义会留下孤儿插件卡）。 */
  const ownerOf = (t: ThemeDef): string | null => {
    if (t.owner && pluginIds.has(t.owner)) return t.owner;
    if (pluginIds.has(t.id)) return t.id;
    return null;
  };

  const delTheme = async (t: ThemeDef): Promise<void> => {
    const owner = ownerOf(t);
    if (!owner) {
      removeTheme(t.id);
      setMsg("已删除「" + t.name + "」");
      return;
    }
    const yes = await confirmOk("删除主题「" + t.name + "」将同时卸载插件「" + owner + "」，其设置与命令一并移除。继续？");
    if (!yes) return;
    try {
      await uninstallPlugin(owner);
      setMsg("已删除「" + t.name + "」及插件「" + owner + "」");
    } catch (e) {
      setMsg("删除失败：" + String(e).slice(0, 100));
    }
  };

  const install = async (item: MarketEntry): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fetchEntryFromMarket(item);
      const { installPlugin } = await import("../plugins/loader.js");
      const m = await installPlugin(text, { repo: normalizeRepoUrl(item.repo) });
      setMsg("已安装「" + m.name + "」，可以直接应用了。");
    } catch (e) {
      setMsg("安装失败：" + String(e instanceof Error ? e.message : e).slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  const secHead = (text: string, extra?: ReactNode): ReactNode => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 6px" }}>
      <b style={{ fontSize: "var(--text-sm)" }}>{text}</b>
      <span style={{ flex: 1 }} />
      {extra}
    </div>
  );

  return createPortal(
    <div
      className="theme-pick-mask"
      style={closing ? { ...(expanded ? maskStylePc : maskStyle), ...maskOut } : expanded ? maskStylePc : maskStyle}
      onClick={requestClose}
    >
      <div
        className="theme-pick-panel"
        style={closing ? { ...(expanded ? panelStylePc : panelStyle), ...panelOut } : expanded ? panelStylePc : panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border, #eee)" }}>
          <b>更改主题</b>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={requestClose}>✕</button>
        </div>

        <div style={{ padding: "10px 16px 16px", overflowY: "auto" }}>
          <input
            className="input"
            style={{ width: "100%" }}
            placeholder="搜索主题名称 / 描述 / 标签"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {msg ? <div className="plg-runmsg" style={{ marginTop: 8 }}>{msg}</div> : null}

          {secHead(
            "已安装",
            <button className="btn btn-ghost" onClick={() => setMsg("已恢复 " + restoreBuiltins() + " 个内置主题")}>恢复内置</button>,
          )}
          {installedThemes.length === 0 ? <div className="plg-hint">没有匹配的已安装主题。</div> : null}
          <div style={{ display: "grid", gap: 8 }}>
            {installedThemes.map((t) => {
              const on = snap.activeId === t.id;
              return (
                <div
                  key={t.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                    border: "1px solid " + (on ? "var(--accent)" : "var(--border)"),
                    borderRadius: "var(--r-md)", background: on ? "var(--accent-soft)" : "var(--surface)",
                  }}
                >
                  <ThemeSwatch vars={t.vars} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <b title={t.name} style={{ minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</b>
                      {t.source === "plugin" ? <span className="chip" style={{ height: 16, fontSize: 9.5, padding: "0 6px" }}>社区</span> : null}
                      {on ? <span className="chip" style={{ height: 16, fontSize: 9.5, padding: "0 6px" }}>使用中</span> : null}
                    </div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.description ?? t.id}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flex: "none" }}>
                    {on ? null : <button className="btn btn-primary" onClick={() => { activateTheme(t.id); setMsg("已应用「" + t.name + "」"); }}>应用</button>}
                    {ownerOf(t) ? <button className="btn btn-ghost" title="删除主题并卸载来源插件" onClick={() => void delTheme(t)}>卸载</button> : null}
                  </div>
                </div>
              );
            })}
          </div>

          {secHead(
            "主题市场",
            <button className="btn btn-ghost" disabled={busy} onClick={() => void load(true)}>{busy ? "刷新中…" : "刷新"}</button>,
          )}
          {!items && busy ? <div className="plg-hint">正在拉取主题市场…</div> : null}
          {items && !marketHits.length ? <div className="plg-hint">没有匹配的主题。</div> : null}
          <div style={{ display: "grid", gap: 8 }}>
            {marketHits.map((x) => {
              const has = hasInMarket(x);
              return (
                <div key={x.id} className="market-card" style={{ margin: 0 }}>
                  <div className="market-card-head">
                    <span className="market-card-name">
                      {x.name}
                      {has ? <span className="market-installed-badge">已安装</span> : null}
                    </span>
                  </div>
                  <div className="market-card-meta">v{x.version}{x.author ? " · " + x.author : ""}</div>
                  <div className="market-card-desc">{x.description || x.repo}</div>
                  {x.tags?.length ? (
                    <div className="market-card-tags">
                      {x.tags.map((tag) => <span key={tag} className="market-tag">{tag}</span>)}
                    </div>
                  ) : null}
                  <div className="market-card-foot">
                    <span className="market-repo-link">{x.repo}</span>
                    <button className="btn btn-primary" disabled={busy || has} onClick={() => void install(x)}>
                      {has ? "已安装" : busy ? "…" : "安装"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="plg-hint" style={{ marginTop: 10 }}>
            主题即插件：装完就能在上面直接应用；已安装的社区主题会同时出现在两栏里。
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

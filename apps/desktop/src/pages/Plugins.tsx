/**
 * 插件管理页（/plugins 独立路由，设置页留有入口）：
 * 「机架」视觉——每枚插件是一块模块卡：状态 LED、mono 版本徽标、权限胶囊、
 * 可展开的 设置/命令/运行轨迹 舱段。逻辑与旧内嵌区段完全一致（loader/registry/
 * events/rust 同一套），只重排了皮囊。
 */
import { useSyncExternalStore, useEffect, useRef, useState, type ReactNode } from "react";
import { PageHead } from "../components/Layout.js";
import {
  commandsSnapshot, disablePlugin, enablePlugin, installedPlugins,
  isLive, runCommand, subscribe, subscribeCommands, uninstallPlugin,
} from "../plugins/loader.js";
import { addRustPlugin, updatePlugin } from "../plugins/registry.js";
import { clearPluginEvents, pluginEvents, subscribePluginEvents } from "../plugins/events.js";
import { notifyRust } from "../plugins/rust.js";
import { PLUGIN_PERMISSIONS } from "../plugins/types.js";

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

export function PluginsPage(): ReactNode {
  const plugins = useSyncExternalStore(subscribe, installedPlugins);
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot);
  const [instOpen, setInstOpen] = useState(false);
  const liveCount = plugins.filter((p) => p.enabled && isLive(p.manifest.id)).length;
  const coreCount = plugins.filter((p) => p.embedded).length;

  return (
    <div className="plg-page">
      <PageHead
        title="插件"
        meta={
          <span>
            经 <code className="plg-code">onethu.*</code> 公共接口扩展 OneTHU——权限门禁、会话自愈、
            45s 超时由宿主统一承担
          </span>
        }
        actions={
          <button className="btn btn-primary" onClick={() => setInstOpen((o) => !o)}>
            {instOpen ? "收起安装" : "安装插件"}
          </button>
        }
      />

      {/* 机架电表：安装 / 运行 / 命令 / 内置 */}
      <div className="plg-stats">
        <div className="plg-stat">
          <span className="plg-stat-n">{String(plugins.length).padStart(2, "0")}</span>
          <span className="plg-stat-l">已安装</span>
        </div>
        <div className="plg-stat">
          <span className="plg-stat-n">
            <i className={"plg-led" + (liveCount > 0 ? " is-run" : "")} />
            {String(liveCount).padStart(2, "0")}
          </span>
          <span className="plg-stat-l">运行中</span>
        </div>
        <div className="plg-stat">
          <span className="plg-stat-n">{String(cmds.length).padStart(2, "0")}</span>
          <span className="plg-stat-l">可用命令</span>
        </div>
        <div className="plg-stat">
          <span className="plg-stat-n">{String(coreCount).padStart(2, "0")}</span>
          <span className="plg-stat-l">内置核心</span>
        </div>
      </div>

      {instOpen ? <InstallPanel onClose={() => setInstOpen(false)} /> : null}

      {plugins.length === 0 ? (
        <div className="plg-empty">
          <div className="plg-empty-mark">[ · ]</div>
          <div className="plg-empty-t">机架空空如也</div>
          <div className="plg-empty-d">安装第一个插件，为 OneTHU 挂上新的能力模块。</div>
          <button className="btn btn-primary" onClick={() => setInstOpen(true)}>
            安装插件
          </button>
        </div>
      ) : (
        <div className="plg-rack">
          {plugins.map((p, i) => (
            <PluginCard key={p.manifest.id} id={p.manifest.id} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════ 安装面板：三路安装（粘贴 JS / JS 文件 / Rust 插件） ═══════════════ */

function InstallPanel({ onClose }: { onClose: () => void }): ReactNode {
  const [tab, setTab] = useState<"paste" | "jsfile" | "rust">("paste");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const install = async (text: string): Promise<void> => {
    if (!text.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const { installPlugin } = await import("../plugins/loader.js");
      const m = await installPlugin(text);
      setMsg(`已安装并激活：${m.name} v${m.version}`);
      setCode("");
    } catch (e) {
      setMsg(`安装失败：${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  };

  const installRust = async (mf: File): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const manifest = JSON.parse(await mf.text());
      if (!manifest?.id || !manifest?.name) throw new Error("manifest.json 缺 id/name");
      if (manifest.kind !== "rust" || !manifest.bin) throw new Error("manifest.kind 须为 rust 且声明 bin");
      const binPath = mf.webkitRelativePath || (mf as unknown as { path?: string }).path;
      if (!binPath) throw new Error("取不到本地路径——桌面端请用文件选择器（Tauri 环境）");
      const abs = binPath.replace(/[^/]+$/, manifest.bin);
      addRustPlugin(manifest, abs);
      const { enablePlugin } = await import("../plugins/loader.js");
      await enablePlugin(manifest.id);
      setMsg(`已安装 Rust 插件：${manifest.name} v${manifest.version}`);
    } catch (e) {
      setMsg(`安装失败：${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="plg-install">
      <div className="plg-install-tabs" role="tablist">
        {(
          [
            ["paste", "粘贴 JS 模块"],
            ["jsfile", "选择 .js 文件"],
            ["rust", "Rust 骨干插件"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={"plg-tab" + (tab === k ? " is-on" : "")}
            onClick={() => {
              setTab(k);
              setMsg(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "paste" ? (
        <div className="plg-install-body">
          <textarea
            className="input plg-paste"
            rows={5}
            placeholder={"export const manifest = { id: \"my.plugin\", name: \"…\", version: \"0.1.0\", permissions: [\"info:read\"] };\nexport default async (ctx) => { /* ctx.onethu.* */ }"}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div className="plg-install-foot">
            <span className="plg-hint">粘贴完整模块代码，安装即激活。</span>
            <button className="btn btn-primary" disabled={busy || !code.trim()} onClick={() => void install(code)}>
              {busy ? "安装中…" : "安装"}
            </button>
          </div>
        </div>
      ) : null}

      {tab === "jsfile" ? (
        <div className="plg-install-body">
          <label className="plg-filebox">
            <input
              type="file"
              accept=".js,.mjs,text/javascript"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then(install);
                e.target.value = "";
              }}
            />
            <span className="plg-filebox-t">点击选择 .js / .mjs 插件文件</span>
            <span className="plg-filebox-d">读取文件内容后与「粘贴安装」走同一校验管线</span>
          </label>
        </div>
      ) : null}

      {tab === "rust" ? (
        <div className="plg-install-body">
          <label className="plg-filebox">
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void installRust(f);
                e.target.value = "";
              }}
            />
            <span className="plg-filebox-t">选择插件的 manifest.json</span>
            <span className="plg-filebox-d">二进制须与 manifest.json 同目录（桌面端 sidecar 形态；Android 内置核心无需安装）</span>
          </label>
        </div>
      ) : null}

      <div className="plg-install-foot plg-install-msg">
        {msg ? <span className="plg-msg">{msg}</span> : <span className="plg-hint">安装即代表信任该代码并授予其声明的权限。</span>}
        <button className="btn btn-ghost" onClick={onClose}>
          完成
        </button>
      </div>
    </section>
  );
}

/* ═══════════════ 模块卡 ═══════════════ */

function PluginCard({ id, index }: { id: string; index: number }): ReactNode {
  const plugins = useSyncExternalStore(subscribe, installedPlugins);
  const rec = plugins.find((p) => p.manifest.id === id);
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot).filter((c) => c.pluginId === id);
  const [open, setOpen] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [input, setInput] = useState("");
  if (!rec) return null;
  const m = rec.manifest;
  const active = rec.enabled && isLive(id);
  const failed = rec.enabled && !isLive(id);
  const stateText = active ? "运行中" : failed ? "加载失败" : "已停用";

  const doRun = async (cmdId: string): Promise<void> => {
    setRunMsg("执行中…");
    try {
      const r = await runCommand(id, cmdId, input);
      setRunMsg(r == null ? "完成" : String(typeof r === "string" ? r : JSON.stringify(r)).slice(0, 300));
    } catch (e) {
      setRunMsg(`失败：${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
    }
  };

  return (
    <article
      className={"plg-card" + (active ? " is-on" : failed ? " is-err" : "")}
      style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}
    >
      <div className={"plg-pin" + (rec.embedded ? " is-core" : "")} aria-hidden>
        {monogram(m.name, m.id)}
      </div>

      <div className="plg-main">
        <div className="plg-head">
          <div className="plg-title">
            <b className="plg-name">{m.name}</b>
            <span className="plg-ver">v{m.version}</span>
            <span className="plg-kind">{m.kind === "rust" ? "RUST" : "JS"}</span>
            {rec.embedded ? <span className="plg-core" title="Rust 核心已编进 App，无需二进制">内置</span> : null}
          </div>
          <div className="plg-ops">
            <span className={"plg-state" + (active ? " is-run" : failed ? " is-err" : "")}>
              <i className={"plg-led" + (active ? " is-run" : failed ? " is-err" : "")} />
              {stateText}
            </span>
            <Switch on={rec.enabled} disabled={false} label={rec.enabled ? "停用" : "启用"} onToggle={() => void (rec.enabled ? disablePlugin(id) : enablePlugin(id)).catch((e: unknown) => setRunMsg(String(e)))} />
            <button className={"btn btn-ghost plg-x" + (open ? " is-open" : "")} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              详情
            </button>
            {rec.embedded ? null : (
              <button className="btn btn-ghost plg-danger" onClick={() => void uninstallPlugin(id)}>
                删除
              </button>
            )}
          </div>
        </div>

        {m.description ? <p className="plg-desc">{m.description}</p> : null}

        <div className="plg-perms">
          {m.permissions.map((p) => {
            const meta = PLUGIN_PERMISSIONS.find((x) => x.id === p);
            return (
              <span key={p} className="plg-perm" title={meta?.desc ?? p}>
                {meta?.label ?? p}
              </span>
            );
          })}
        </div>

        <div className={"plg-detail" + (open ? " is-open" : "")}>
          <div className="plg-detail-in">
            {(m.settings?.length ?? 0) > 0 ? (
              <div className="plg-sec">
                <div className="plg-sec-t">设置</div>
                <div className="plg-settings">
                  {m.settings!.map((f) => (
                    <label key={f.key} className="plg-setting">
                      <span>{f.label}</span>
                      {f.type === "textarea" ? (
                        <textarea
                          className="input"
                          rows={2}
                          placeholder={f.placeholder ?? ""}
                          value={rec.settings[f.key] ?? ""}
                          onChange={(e) => updatePlugin(id, { settings: { ...rec.settings, [f.key]: e.target.value } })}
                        />
                      ) : (
                        <input
                          className="input"
                          type={f.type === "password" ? "password" : "text"}
                          placeholder={f.placeholder ?? ""}
                          value={rec.settings[f.key] ?? ""}
                          onChange={(e) => updatePlugin(id, { settings: { ...rec.settings, [f.key]: e.target.value } })}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {cmds.length > 0 ? (
              <div className="plg-sec">
                <div className="plg-sec-t">命令</div>
                <div className="plg-cmds">
                  {cmds.map((c) => (
                    <div key={c.id} className="plg-cmd">
                      <div className="plg-cmd-t">{c.title}</div>
                      {c.inputLabel ? (
                        <textarea
                          className="input"
                          rows={2}
                          placeholder={c.inputPlaceholder ?? ""}
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                        />
                      ) : null}
                      <button className="btn btn-primary" onClick={() => void doRun(c.id)}>
                        执行
                      </button>
                      {runMsg ? <div className="plg-runmsg">{runMsg}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {m.kind === "rust" ? <ProgressPane id={id} /> : null}
          </div>
        </div>

        {runMsg && !open ? <div className="plg-runmsg">{runMsg}</div> : null}
      </div>
    </article>
  );
}

/** 小开关：启停插件（避免又一行文字按钮） */
function Switch({ on, onToggle, label, disabled }: { on: boolean; onToggle: () => void; label: string; disabled?: boolean }): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={"plg-switch" + (on ? " is-on" : "")}
      onClick={onToggle}
    >
      <i />
    </button>
  );
}

/* ═══════════════ 运行轨迹（Rust 插件实时流） ═══════════════ */

function ProgressPane({ id }: { id: string }): ReactNode {
  const events = useSyncExternalStore(subscribePluginEvents, () => pluginEvents(id));
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // 新事件到达贴底滚动（终端习惯）
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const lines = events.slice(-140);
  return (
    <div className="plg-sec">
      <div className="plg-sec-t plg-sec-t-row">
        运行轨迹
        <span className="plg-sec-ops">
          <button className="btn btn-ghost" onClick={() => void notifyRust(id, "interrupt").catch(() => undefined)}>
            打断
          </button>
          <button className="btn btn-ghost" onClick={() => clearPluginEvents(id)}>
            清空
          </button>
        </span>
      </div>
      <div className="plg-term" ref={bodyRef}>
        {lines.length === 0 ? (
          <span className="plg-term-empty">— 尚无输出 —</span>
        ) : (
          lines.map((e, i) => (
            <div key={i} className={"plg-ev plg-ev-" + e.method}>
              <span className="plg-ev-t">
                {new Date(e.at).toLocaleTimeString("zh-CN", { hour12: false })}
              </span>
              <span className="plg-ev-tag">{e.method === "progress" ? "▶" : e.method === "log" ? "·" : e.method === "exit" ? "■" : "…"}</span>
              <span className="plg-ev-text">
                {e.text || e.method}
                {e.step != null ? `（${e.step}${e.total != null ? "/" + e.total : ""}）` : ""}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

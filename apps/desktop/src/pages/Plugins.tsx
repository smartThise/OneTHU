/**
 * 插件管理（设置页内嵌区段）：
 * 列表（启停/设置表单/命令执行/权限展示/删除） + 安装（粘贴代码或选文件）。
 * UI 走既有 Card/SectionHead 件；不新增路由与侧栏项（架构不变）。
 */
import { useSyncExternalStore, useState, type ReactNode } from "react";
import { Card } from "../components/Layout.js";
import {
  commandsSnapshot, disablePlugin, enablePlugin, installedPlugins,
  isLive, runCommand, subscribe, subscribeCommands, uninstallPlugin,
} from "../plugins/loader.js";
import { updatePlugin } from "../plugins/registry.js";
import { PLUGIN_PERMISSIONS } from "../plugins/types.js";

export function PluginsSection(): ReactNode {
  const plugins = useSyncExternalStore(subscribe, installedPlugins);
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
      setMsg(`已安装：${m.name}@${m.version}`);
      setCode("");
    } catch (e) {
      setMsg(`安装失败：${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionHead title="插件" />
      <Card style={{ padding: 14 }}>
        <div className="plugin-hint">
          插件通过公共接口（onethu.*）读取信息、跳转页面、预约图书馆。粘贴插件代码或选择 .js 文件安装；
          安装即代表信任该代码并授予其声明的权限。
        </div>
        {plugins.length === 0 ? (
          <div className="plugin-empty">暂无插件</div>
        ) : (
          plugins.map((p) => <PluginRow key={p.manifest.id} id={p.manifest.id} />)
        )}
        <div className="plugin-install">
          <textarea
            className="input"
            rows={4}
            placeholder="粘贴插件模块代码（export const manifest = …; export default async (ctx) => …）"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div className="plugin-install-row">
            <button className="btn btn-primary" disabled={busy || !code.trim()} onClick={() => void install(code)}>
              {busy ? "安装中…" : "安装插件"}
            </button>
            <input
              type="file"
              accept=".js,.mjs,text/javascript"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then(install);
                e.target.value = "";
              }}
            />
            {msg ? <span className="plugin-msg">{msg}</span> : null}
          </div>
        </div>
      </Card>
    </>
  );
}

function PluginRow({ id }: { id: string }): ReactNode {
  const plugins = useSyncExternalStore(subscribe, installedPlugins);
  const rec = plugins.find((p) => p.manifest.id === id);
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot).filter((c) => c.pluginId === id);
  const [open, setOpen] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [input, setInput] = useState("");
  if (!rec) return null;
  const m = rec.manifest;
  const active = rec.enabled && isLive(id);

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
    <div className="plugin-row">
      <div className="plugin-row-head">
        <div className="plugin-row-title">
          <b>{m.name}</b>
          <span className="plugin-ver">v{m.version}{m.author ? ` · ${m.author}` : ""}</span>
          {active ? <span className="chip chip-green">运行中</span> : rec.enabled ? <span className="chip chip-amber">加载失败</span> : <span className="chip chip-gray">已停用</span>}
        </div>
        <div className="plugin-row-ops">
          <button className="btn" onClick={() => setOpen(!open)}>{open ? "收起" : "展开"}</button>
          <button
            className="btn"
            onClick={() => void (rec.enabled ? disablePlugin(id) : enablePlugin(id)).catch((e: unknown) => setRunMsg(String(e)))}
          >
            {rec.enabled ? "停用" : "启用"}
          </button>
          <button className="btn btn-danger" onClick={() => void uninstallPlugin(id)}>删除</button>
        </div>
      </div>
      {open ? (
        <div className="plugin-detail">
          {m.description ? <div className="plugin-desc">{m.description}</div> : null}
          <div className="plugin-perms">
            {m.permissions.map((p) => {
              const meta = PLUGIN_PERMISSIONS.find((x) => x.id === p);
              return <span key={p} className="chip" title={meta?.desc ?? p}>{meta?.label ?? p}</span>;
            })}
          </div>
          {(m.settings?.length ?? 0) > 0 ? (
            <div className="plugin-settings">
              {m.settings!.map((f) => (
                <label key={f.key} className="plugin-setting">
                  <span>{f.label}</span>
                  {f.type === "textarea" ? (
                    <textarea
                      className="input" rows={2} placeholder={f.placeholder ?? ""}
                      value={rec.settings[f.key] ?? ""}
                      onChange={(e) => updatePlugin(id, { settings: { ...rec.settings, [f.key]: e.target.value } })}
                    />
                  ) : (
                    <input
                      className="input" type={f.type === "password" ? "password" : "text"} placeholder={f.placeholder ?? ""}
                      value={rec.settings[f.key] ?? ""}
                      onChange={(e) => updatePlugin(id, { settings: { ...rec.settings, [f.key]: e.target.value } })}
                    />
                  )}
                </label>
              ))}
            </div>
          ) : null}
          {cmds.length > 0 ? (
            <div className="plugin-cmds">
              {cmds.map((c) => (
                <div key={c.id} className="plugin-cmd">
                  {c.inputLabel ? (
                    <textarea
                      className="input" rows={2} placeholder={c.inputPlaceholder ?? ""}
                      value={input} onChange={(e) => setInput(e.target.value)}
                    />
                  ) : null}
                  <button className="btn btn-primary" onClick={() => void doRun(c.id)}>{c.title}</button>
                </div>
              ))}
              {runMsg ? <div className="plugin-msg plugin-runmsg">{runMsg}</div> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* 本文件局部复用 Layout 的 SectionHead（避免循环依赖走具名导入） */
import { SectionHead } from "../components/Layout.js";

/**
 * 设置页「IM 通道」区块：飞书 bot 配置、连接状态、绑定码与微信通道预告。
 *
 * 口径：
 *   · 凭据只以密文落本机（AES-GCM 本地混淆，见 src/im/store.ts 顶部的诚实声明）；
 *   · 连接状态如实展示（connecting/online/error 原文+时间），不假装已连接；
 *   · P0 单主人模型：设置页生成 6 位绑定码 → 在 IM 里给 bot 发「/bind 码」完成绑定，
 *     未绑定者的消息只会收到限频引导，不进入 OH；
 *   · 微信通道（官方 iLink）适配器未实现——如实灰置标注，不做假开关。
 */
import { useEffect, useState, type ReactNode } from "react";
import { Card } from "./Layout.js"; /* eslint-disable-line @typescript-eslint/no-unused-vars */
import { Switch } from "./Layout.js";
import { loadImConfig, patchImConfig } from "../im/store.js";
import { newBindCode, useChannelStatus } from "../im/registry.js";
import { syncChannels } from "../im/boot.js";
import type { ImConfig } from "../im/store.js";

function fmtAt(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const PHASE_TEXT: Record<string, string> = {
  off: "未启用",
  connecting: "连接中…",
  online: "在线",
  reconnecting: "重连中…",
  suspended: "平台暂停",
  error: "连接失败",
};

export function ImSettingsSection(): ReactNode {
  const [cfg, setCfg] = useState<ImConfig | null>(null);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const fs = useChannelStatus("feishu");
  const wechatStatus = useChannelStatus("wechat");

  useEffect(() => {
    void loadImConfig().then((c) => {
      setCfg(c);
      setAppId(c.channels.feishu?.appId ?? "");
      setAppSecret(c.channels.feishu?.appSecret ?? "");
    });
  }, []);

  const flash = (t: string): void => {
    setMsg(t);
    window.setTimeout(() => setMsg(null), 2_600);
  };

  const saveCreds = async (): Promise<void> => {
    await patchImConfig((c) => {
      c.channels.feishu = { appId: appId.trim(), appSecret: appSecret.trim() };
    });
    setCfg(await loadImConfig());
    await syncChannels();
    flash("飞书凭据已保存（密文落盘）");
  };

  const toggleEnabled = async (v: boolean): Promise<void> => {
    await patchImConfig((c) => {
      c.enabled.feishu = v;
    });
    setCfg(await loadImConfig());
    await syncChannels();
    flash(v ? "已启用，正在连接…" : "已停用");
  };

  const genBind = (): void => {
    setCode(newBindCode());
    flash("绑定码 10 分钟内有效");
  };

  const bound = cfg?.bindings.feishu;

  return (
    <>
      <div className="setting-row">
        <div>
          <div className="setting-title">飞书 bot（P0 通道）</div>
          <div className="setting-desc">
            桌面 App 常驻时 bot 在线：飞书开放平台自建应用（长连接事件订阅，免公网入口）。
            收到的消息直达 OH，回复原路发回；附件后续经云盘归档。
          </div>
        </div>
        <Switch on={Boolean(cfg?.enabled.feishu)} onChange={(v) => void toggleEnabled(v)} label="飞书通道开关" />
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">应用凭据</div>
          <div className="setting-desc">飞书开放平台 → 自建应用 → 凭证与基础信息。仅存本机（密文）。</div>
        </div>
      </div>
      <div className="setting-row">
        <div style={{ flex: 1 }}>
          <input
            className="input"
            placeholder="App ID（cli_ 开头）"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
      </div>
      <div className="setting-row">
        <div style={{ flex: 1 }}>
          <input
            className="input"
            placeholder="App Secret"
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <button className="btn btn-primary" onClick={() => void saveCreds()}>保存并连接</button>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">连接状态</div>
          <div className="setting-desc">
            {PHASE_TEXT[fs.phase] ?? fs.phase}
            {fs.note ? `：${fs.note}` : ""}（最近入站 {fmtAt(fs.lastInboundAt)}）
          </div>
        </div>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">绑定主人</div>
          <div className="setting-desc">
            {bound
              ? `已绑定：${bound.slice(0, 12)}…（单主人模型：仅此人消息进入 OH）`
              : "未绑定。生成绑定码后在飞书里给 bot 发送「/bind 绑定码」。"}
          </div>
        </div>
        <button className="btn" onClick={genBind}>生成绑定码</button>
      </div>
      {code ? (
        <div className="setting-row">
          <div>
            <div className="setting-title" style={{ fontSize: 22, letterSpacing: 4 }}>{code}</div>
            <div className="setting-desc">在飞书私聊里发送：/bind {code}</div>
          </div>
        </div>
      ) : null}

      <div className="setting-row">
        <div>
          <div className="setting-title">微信通道（待实现）</div>
          <div className="setting-desc">
            官方 iLink Bot（扫码授权 + 长轮询）适配器规划中——调研与协议笔记见 docs/im-cloud/。
            当前状态：{PHASE_TEXT[wechatStatus.phase] ?? wechatStatus.phase}（适配器未装配，开关不生效）。
          </div>
        </div>
      </div>

      {msg ? <div className="setting-desc" style={{ opacity: 0.8 }}>{msg}</div> : null}
    </>
  );
}

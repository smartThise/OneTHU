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
import { QRCodeSVG } from "qrcode.react";
import { loadImConfig, patchImConfig } from "../im/store.js";
import { wechatLoginCancel, wechatLoginPoll, wechatLoginStart } from "../im/wechat.js";
import {
  beginFeishuRegistration, pollFeishuRegistration,
  type FeishuRegSession,
} from "../im/feishuReg.js";
import { newBindCode, reportChannelStatus, useChannelStatus } from "../im/registry.js";
import { openExternal } from "../pages/info/openExternal.js";
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
  const [wxQr, setWxQr] = useState<string | null>(null);
  const [wxNote, setWxNote] = useState("");
  const [fsReg, setFsReg] = useState<FeishuRegSession | null>(null);
  const [fsNote, setFsNote] = useState("");
  const [fsDomain, setFsDomain] = useState<"feishu" | "lark">("feishu");
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

  // 飞书扫码创建应用轮询（device-code 流：按服务端 interval 节奏；成功后自动填凭据）
  useEffect(() => {
    if (!fsReg) return;
    const t = window.setInterval(
      () => {
        void pollFeishuRegistration(fsReg, fsDomain)
          .then(async (r) => {
            setFsNote(r.note);
            if (r.status === "pending" && r.note.includes("Lark")) setFsDomain("lark");
            if (r.status === "success" && r.appId && r.appSecret) {
              setAppId(r.appId);
              setAppSecret(r.appSecret);
              await patchImConfig((c) => {
                c.channels.feishu = { appId: r.appId!, appSecret: r.appSecret! };
                c.enabled.feishu = true;
                if (r.openId) c.bindings.feishu = r.openId; // 应用所有者默认即主人
              });
              setCfg(await loadImConfig());
              await syncChannels();
              setFsReg(null);
              flash("飞书应用已创建并连接（扫码建应用成功）");
            } else if (r.status === "access_denied" || r.status === "expired" || r.status === "error") {
              setFsReg(null);
            }
          })
          .catch(() => undefined);
      },
      Math.max(3, fsReg.intervalSec) * 1_000,
    );
    return () => window.clearInterval(t);
  }, [fsReg, fsDomain]);

  const startFsReg = async (): Promise<void> => {
    setMsg(null);
    setFsDomain("feishu");
    try {
      const sess = await beginFeishuRegistration();
      setFsReg(sess);
      setFsNote("请用手机飞书扫码，并在打开页确认创建智能体应用");
    } catch (e) {
      flash(`发起飞书扫码失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 微信扫码登录轮询（登录会话有效期内 1.5s 一次）
  useEffect(() => {
    if (!wxQr) return;
    const t = window.setInterval(() => {
      void wechatLoginPoll()
        .then(async (r) => {
          setWxNote(r.note);
          if (r.done) {
            setWxQr(null);
            setCfg(await loadImConfig());
            await syncChannels();
            // wechat 无 adapter（syncChannels 跳过启动管理）——轮询由 wechat.ts
            // 自有循环承担，这里把真实状态补进状态机（此前恒显「未启用」）
            reportChannelStatus("wechat", "online");
            flash("微信通道已启用（扫码登录成功）");
          } else if (r.status === "expired" || r.status === "verify_code_blocked") {
            setWxQr(null);
            reportChannelStatus("wechat", "off");
          }
        })
        .catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(t);
  }, [wxQr]);

  const startWxLogin = async (): Promise<void> => {
    setMsg(null);
    try {
      const r = await wechatLoginStart();
      setWxQr(r.imgContent || r.qrcode);
      setWxNote("等待扫码…");
    } catch (e) {
      flash(`发起扫码失败：${e instanceof Error ? e.message : String(e)}`);
    }
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
          <div className="setting-title">扫码创建应用（推荐，免手工配置）</div>
          <div className="setting-desc">
            手机飞书扫码 → 打开页确认创建 → 自动拿回 App ID/Secret 并连接（应用所有者自动绑为主人）。
            不想扫码时用下方手工填入。
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => void startFsReg()}>扫码创建</button>
      </div>

      {fsReg ? (
        <div className="setting-row">
          <div>
            <div style={{ background: "#fff", padding: 10, borderRadius: 10, display: "inline-block" }}>
              <QRCodeSVG value={fsReg.qrUrl} size={148} />
            </div>
            <div className="setting-desc" style={{ marginTop: 6 }}>{fsNote || "等待扫码…"}</div>
            <button
              className="btn"
              style={{ marginTop: 6 }}
              onClick={() => void openExternal(fsReg.qrUrl).catch(() => undefined)}
            >
              在本机？直接打开确认页（免扫码）
            </button>
          </div>
          <button className="btn" onClick={() => setFsReg(null)}>取消</button>
        </div>
      ) : null}

      <div className="setting-row">
        <div>
          <div className="setting-title">应用凭据（手工）</div>
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
          <div className="setting-title">微信（iLink 官方 Bot · 扫码即用）</div>
          <div className="setting-desc">
            微信扫码授权后即可对话（无需任何 App ID/Secret）：消息经官方 iLink 通道长轮询到达本机，
            OH 回复原路发回。当前状态：{PHASE_TEXT[wechatStatus.phase] ?? wechatStatus.phase}
            {wechatStatus.note ? `：${wechatStatus.note}` : ""}
            {cfg?.channels.wechat?.botId ? `（bot ${cfg.channels.wechat.botId.slice(0, 10)}…）` : ""}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => void startWxLogin()}>
          {cfg?.channels.wechat?.botToken ? "重新扫码" : "扫码登录"}
        </button>
      </div>

      {wxQr ? (
        <div className="setting-row">
          <div>
            <div style={{ background: "#fff", padding: 10, borderRadius: 10, display: "inline-block" }}>
              <QRCodeSVG value={wxQr} size={148} />
            </div>
            <div className="setting-desc" style={{ marginTop: 6 }}>
              {wxNote || "等待扫码…"}（用微信扫一扫；手机上的 OneTHU 无法自扫，可先用飞书通道）
            </div>
          </div>
          <button
            className="btn"
            onClick={() => {
              wechatLoginCancel();
              setWxQr(null);
            }}
          >
            取消
          </button>
        </div>
      ) : null}

      {msg ? <div className="setting-desc" style={{ opacity: 0.8 }}>{msg}</div> : null}
    </>
  );
}

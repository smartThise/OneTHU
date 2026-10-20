import { Input } from "@onethu/gui";
import { Btn } from "@onethu/gui";
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
import { defineSearchRows } from "../state/searchRows.js";
import { goOhRow } from "./OhSettingsPage.js";
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
import { t as i18n } from "../i18n/index.js";


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

/** 分档（2026-10-11 用户拍板）：OH 设置页的「基础设置 / 高级配置」两档共用这一份实现——
 *  basic    = 扫码绑定 / 解绑（只这两件事 + 当前状态）
 *  advanced = 通道开关、手工凭据、微信灰置等复杂项
 *  all      = 两档都要（旧调用方的默认值，语义不变） */
export type ImTier = "basic" | "advanced" | "all";


/* task-19：IM 设置行注册（基础档 + 高级档） */
defineSearchRows([
  { id: "im-qr", tab: "OneTHU Harness", section: "IM 基础（扫码绑定 / 解绑）", title: "扫码创建应用（推荐，免手工配置）", aliases: ["扫码", "IM", "飞书"], desc: "扫码创建飞书应用并自动绑定" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "IM 基础（扫码绑定 / 解绑）", "扫码创建应用（推荐，免手工配置）"], displayRoot: "设置", go: () => goOhRow("扫码创建应用（推荐，免手工配置）", "basic") },
  { id: "im-owner", tab: "OneTHU Harness", section: "IM 基础（扫码绑定 / 解绑）", title: "绑定主人", aliases: ["绑定码", "解绑"], desc: "生成绑定码 / 解除绑定" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "IM 基础（扫码绑定 / 解绑）", "绑定主人"], displayRoot: "设置", go: () => goOhRow("绑定主人", "basic") },
  { id: "im-wechat", tab: "OneTHU Harness", section: "IM 基础（扫码绑定 / 解绑）", title: "微信（iLink 官方 Bot · 扫码即用）", aliases: ["微信", "iLink"], desc: "微信扫码绑定 / 重新扫码 / 解除绑定" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "IM 基础（扫码绑定 / 解绑）", "微信（iLink 官方 Bot · 扫码即用）"], displayRoot: "设置", go: () => goOhRow("微信（iLink 官方 Bot · 扫码即用）", "basic") },
  { id: "im-status", tab: "OneTHU Harness", section: "IM 基础（扫码绑定 / 解绑）", title: "连接状态", aliases: ["IM 状态"], desc: "通道连接状态" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "IM 基础（扫码绑定 / 解绑）", "连接状态"], displayRoot: "设置", go: () => goOhRow("连接状态", "basic") },
  { id: "im-feishu", tab: "OneTHU Harness", section: "IM 通道（进阶）", title: "飞书 bot（P0 通道）", aliases: ["飞书通道"], desc: "长连接事件订阅" , breadcrumb: ["插件", "OneTHU Harness", "高级配置", "IM 通道（进阶）", "飞书 bot（P0 通道）"], displayRoot: "设置", go: () => goOhRow("飞书 bot（P0 通道）", "advanced") },
  { id: "im-creds", tab: "OneTHU Harness", section: "IM 通道（进阶）", title: "应用凭据（手工）", aliases: ["App ID", "App Secret"], desc: "手工填飞书应用凭据" , breadcrumb: ["插件", "OneTHU Harness", "高级配置", "IM 通道（进阶）", "应用凭据（手工）"], displayRoot: "设置", go: () => goOhRow("应用凭据（手工）", "advanced") },
]);

export function ImSettingsSection({ tier = "all" }: { tier?: ImTier } = {}): ReactNode {
  const showBasic = tier !== "advanced";
  const showAdvanced = tier !== "basic";
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

  /** 解绑：清掉主人绑定（单主人模型）——之后的消息不再进入 OH，通道本身仍可在线 */
  const unbind = async (): Promise<void> => {
    await patchImConfig((c) => {
      c.bindings.feishu = "";
    });
    setCfg(await loadImConfig());
    await syncChannels();
    flash("已解除绑定：之后的消息不再进入 OH");
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
      {/* ── 基础档（OH 设置 → 基础设置）：扫码绑定 / 解绑——**飞书与微信两个通道都在这里** ── */}
      {showBasic ? (
        <>
          <div className="setting-row">
            <div>
              <div className="setting-title">{i18n("auto.components.ImSettingsSection.1")}</div>
              <div className="setting-desc">
                {i18n("auto.components.ImSettingsSection.2")}</div>
            </div>
            <Btn variant="solid" tone="brand" onClick={() => void startFsReg()}>{i18n("auto.components.ImSettingsSection.3")}</Btn>
          </div>

          {fsReg ? (
            <div className="setting-row">
              <div>
                <div style={{ background: "#fff", padding: 10, borderRadius: 10, display: "inline-block" }}>
                  <QRCodeSVG value={fsReg.qrUrl} size={148} />
                </div>
                <div className="setting-desc" style={{ marginTop: 6 }}>{fsNote || "等待扫码…"}</div>
                <Btn variant="outline" onClick={() => void openExternal(fsReg.qrUrl).catch(() => undefined)}>{i18n("auto.components.ImSettingsSection.4")}</Btn>
              </div>
              <Btn variant="outline" onClick={() => setFsReg(null)}>{i18n("auto.components.ImSettingsSection.5")}</Btn>
            </div>
          ) : null}

          <div className="setting-row">
            <div>
              <div className="setting-title">{i18n("auto.components.ImSettingsSection.6")}</div>
              <div className="setting-desc">
                {bound
                  ? `已绑定：${bound.slice(0, 12)}…（单主人模型：仅此人消息进入 OH）`
                  : "未绑定。生成绑定码后在飞书里给 bot 发送「/bind 绑定码」。"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="outline" onClick={genBind}>{i18n("auto.components.ImSettingsSection.7")}</Btn>
              {bound ? (
                <Btn variant="outline" onClick={() => void unbind()}>{i18n("auto.components.ImSettingsSection.8")}</Btn>
              ) : null}
            </div>
          </div>
          {code ? (
            <div className="setting-row">
              <div>
                <div className="setting-title" style={{ fontSize: 22, letterSpacing: 4 }}>{code}</div>
                <div className="setting-desc">{i18n("auto.components.ImSettingsSection.9")}{code}</div>
              </div>
            </div>
          ) : null}

          {/* 微信（iLink 官方 Bot）：扫码绑定/解绑也放基础档——用户要求两个通道都能直接扫码 */}
          <div className="setting-row">
            <div>
              <div className="setting-title">{i18n("auto.components.ImSettingsSection.10")}</div>
              <div className="setting-desc">
                {i18n("auto.components.ImSettingsSection.11")}{PHASE_TEXT[wechatStatus.phase] ?? wechatStatus.phase}
                {wechatStatus.note ? `：${wechatStatus.note}` : ""}
                {cfg?.channels.wechat?.botId ? `（bot ${cfg.channels.wechat.botId.slice(0, 10)}…）` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="solid" tone="brand" onClick={() => void startWxLogin()}>{cfg?.channels.wechat?.botToken ? "重新扫码" : "扫码登录"}</Btn>
              {cfg?.channels.wechat?.botToken ? (
                <Btn variant="outline" onClick={() => {
                    wechatLoginCancel();
                    setWxQr(null);
                  }}>{i18n("auto.components.ImSettingsSection.8")}</Btn>
              ) : null}
            </div>
          </div>

          {wxQr ? (
            <div className="setting-row">
              <div>
                <div style={{ background: "#fff", padding: 10, borderRadius: 10, display: "inline-block" }}>
                  <QRCodeSVG value={wxQr} size={148} />
                </div>
                <div className="setting-desc" style={{ marginTop: 6 }}>
                  {wxNote || "等待扫码…"}{i18n("auto.components.ImSettingsSection.12")}</div>
              </div>
              <Btn variant="outline" onClick={() => setWxQr(null)}>{i18n("auto.components.ImSettingsSection.5")}</Btn>
            </div>
          ) : null}
        </>
      ) : null}

      {/* 连接状态：两档都看得到（一条只读状态行，不做两套实现） */}
      <div className="setting-row">
        <div>
          <div className="setting-title">{i18n("auto.components.ImSettingsSection.13")}</div>
          <div className="setting-desc">
            {PHASE_TEXT[fs.phase] ?? fs.phase}
            {fs.note ? `：${fs.note}` : ""}{i18n("auto.components.ImSettingsSection.14")}{fmtAt(fs.lastInboundAt)}）
          </div>
        </div>
      </div>

      {/* ── 高级档（OH 设置 → 高级配置）：通道开关 + 手工凭据 ── */}
      {showAdvanced ? (
        <>
          <div className="setting-row">
            <div>
              <div className="setting-title">{i18n("auto.components.ImSettingsSection.15")}</div>
              <div className="setting-desc">
                {i18n("auto.components.ImSettingsSection.16")}</div>
            </div>
            <Switch on={Boolean(cfg?.enabled.feishu)} onChange={(v) => void toggleEnabled(v)} label={i18n("auto.components.ImSettingsSection.17")} />
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-title">{i18n("auto.components.ImSettingsSection.18")}</div>
              <div className="setting-desc">{i18n("auto.components.ImSettingsSection.19")}</div>
            </div>
          </div>
          <div className="setting-row">
            <div style={{ flex: 1 }}>
              <Input placeholder={i18n("auto.components.ImSettingsSection.20")} value={appId} onChange={(value) => setAppId(value)} />
            </div>
          </div>
          <div className="setting-row">
            <div style={{ flex: 1 }}>
              <Input placeholder="App Secret" type="password" value={appSecret} onChange={(value) => setAppSecret(value)} />
            </div>
            <Btn variant="solid" tone="brand" onClick={() => void saveCreds()}>{i18n("auto.components.ImSettingsSection.21")}</Btn>
          </div>
        </>
      ) : null}

      {msg ? <div className="setting-desc" style={{ opacity: 0.8 }}>{msg}</div> : null}
    </>
  );
}

/**
 * ConnectGate（§4.3）：业务入口放业务场景——要绑定的功能，就在原地绑。
 *
 * 以前未绑定时只有一条路：把人送去设置页。token 被打断，办完还得自己走回来。
 * 现在在**原地**弹底部弹层（PC 居中卡片）内联完成，成功后就地回调 onDone，
 * 调用方接着把原来那件事做完——上下文不丢。
 *
 * 绑定种类与注册表 @onethu/desktop/state/navigation.ts 的 needBind 字段同名词表
 * （yuketang / tuoj / mail / cloud）。由调用方决定何时开：各页的「未绑定」判据
 * 分散在各自的 store 里，这里不另造一个真源。
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useExpanded } from "../state/usePlatformLayout.js";
import { YktQrPanel, YktWebLoginPanel, saveYuketang } from "./ExtHwLoginModal.js";
import { extHwLogin, refreshExtHw } from "../state/exthw.js";
import { connectCloudDisk, connectMail } from "../state/accountSetup.js";
import { showToast } from "../state/toast.js";

export type BindNeed = "yuketang" | "tuoj" | "mail" | "cloud";

const LABEL: Record<BindNeed, string> = {
  yuketang: "雨课堂",
  tuoj: "TUOJ",
  mail: "清华邮箱",
  cloud: "清华云盘",
};

/** 每种绑定「为什么要绑」的一句话——别只说"未登录" */
const WHY: Record<BindNeed, string> = {
  yuketang: "绑定后把雨课堂作业 DDL 合并到「全部作业」与「今日」。",
  tuoj: "绑定后用清华账号读回 OJ 作业，只读课业信息，不提交任何内容。",
  mail: "绑定后在本机收发清华邮箱；云日历同步用的是同一套登录信息。",
  cloud: "绑定后把清华云盘的文件接进「云盘」页，可浏览与下载。",
};

export function ConnectGate({
  need,
  open,
  onClose,
  onDone,
}: {
  need: BindNeed;
  open: boolean;
  onClose: () => void;
  /** 绑定成功后就地继续原来那件事（调用方接住） */
  onDone?: () => void;
}): React.ReactNode {
  const expanded = useExpanded();
  const [channel, setChannel] = useState<"qr" | "web">("qr");
  const [token, setToken] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const [mailAddr, setMailAddr] = useState("");
  const [mailCode, setMailCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return null;

  const done = (msg: string): void => {
    showToast(msg);
    onDone?.();
    onClose();
  };

  const fail = (e: unknown): void => setErr(String(e).slice(0, 120));

  /** yuketang / tuoj 的落地：保存后刷新外部作业源，再回到原任务 */
  const afterExtHw = (msg: string): void => {
    void refreshExtHw().catch(() => undefined);
    done(msg);
  };

  const tuojLogin = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const { cookie } = await extHwLogin.tuojCas("tuoj");
      if (cookie) afterExtHw("TUOJ 已连接");
      else setErr("没有拿到登录状态，请到设置里重试一次");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const mailConnect = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const st = await connectMail(mailAddr, mailCode);
      void refreshExtHw().catch(() => undefined);
      done(st.mail ? "邮箱已连接（云日历同步共用同一套登录信息）" : "邮箱没连上，请再试一次");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  /** 静默优先：直连爬 profile（id 会话活）→ 落确认页就 InfoClient 确认续用 → 再爬；
   *  仍取不到再回退应用内 WebView。全程零输入。 */
  const cloudTokenFromWebview = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    setAutoMsg("正在自动获取云盘访问口令…");
    const log = async (m: string): Promise<void> => {
      try {
        const { logLine } = await import("../lib/clients.js");
        void logLine(m).catch(() => undefined);
      } catch { /* noop */ }
    };
    try {
      let token = "";
      const { loadRemembered } = await import("../lib/clients.js");
      const rememberedForCloud = await loadRemembered().catch(() => null);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { extractToken } = await import("../state/seafileAuto.js");
        let r = await invoke<{ finalUrl: string; body: string; needConfirm: boolean; plainToken: string }>("cloud_webvpn_profile", {
          username: rememberedForCloud?.username ?? "",
          password: rememberedForCloud?.password ?? "",
        });
        if (r.needConfirm) {
          await log(`[CLOUD-DIRECT] 落确认页（finalUrl=${r.finalUrl.slice(0, 90)}）→ confirmIdCheckSingle`);
          const { info } = await import("../lib/clients.js");
          const ok = await info.confirmIdCheckSingle(r.finalUrl).catch(() => false);
          await log(`[CLOUD-DIRECT] 确认=${ok ? "ok" : "fail"} → 重爬 profile`);
          if (ok) r = await invoke<{ finalUrl: string; body: string; needConfirm: boolean; plainToken: string }>("cloud_webvpn_profile", {
            username: rememberedForCloud?.username ?? "",
            password: rememberedForCloud?.password ?? "",
          });
        }
        token = (r.plainToken && /^[0-9a-f]{40}$/i.test(r.plainToken) ? r.plainToken : "") || extractToken(r.body) || "";
        await log(
          token
            ? `[CLOUD-DIRECT] 静默取到口令（finalUrl=${r.finalUrl.slice(0, 90)} len=${r.body.length}）`
            : `[CLOUD-DIRECT] 页面无口令（finalUrl=${r.finalUrl.slice(0, 90)} len=${r.body.length}）→ 回退窗口`,
        );
      } catch (e) {
        await log(`[CLOUD-DIRECT] 静默爬取失败 ${String(e).slice(0, 100)} → 回退窗口`);
      }
      if (!token) {
        const { readCloudTokenInWebview } = await import("../lib/cloudTokenWebview.js");
        token = await readCloudTokenInWebview();
      }
      await connectCloudDisk(token);
      showToast("云盘已连接");
      onDone?.();
      onClose();
    } catch (e) {
      setAutoMsg(e instanceof Error ? e.message : String(e));
      setManualOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const cloudConnect = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await connectCloudDisk(token);
      showToast("云盘已连接");
      onDone?.();
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  /* 手机：贴底抽屉（B3b 口径）；PC：居中卡片 */
  const maskStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1200,
    background: "rgba(0,0,0,.4)",
    display: "flex",
    alignItems: expanded ? "center" : "flex-end",
    justifyContent: "center",
    padding: expanded ? 24 : 0,
  };
  const panelStyle: React.CSSProperties = {
    width: expanded ? "min(460px, 92vw)" : "100%",
    minWidth: 0,
    maxHeight: expanded ? "86dvh" : "92dvh",
    overflowY: "auto",
    background: "var(--md-sys-color-surface)",
    color: "var(--text-1)",
    borderRadius: expanded ? "var(--r-lg)" : "var(--r-lg) var(--r-lg) 0 0",
    padding: "16px 16px calc(16px + env(safe-area-inset-bottom))",
    boxSizing: "border-box",
  };

  const body = ((): React.ReactNode => {
    if (need === "yuketang") {
      return (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {([["qr", "扫码登录"], ["web", "网页登录"]] as const).map(([k, lbl]) => (
              <button
                key={k}
                className={"btn" + (channel === k ? " primary" : "")}
                onClick={() => setChannel(k)}
              >
                {lbl}
              </button>
            ))}
          </div>
          {channel === "qr" ? (
            <YktQrPanel
              onCancel={onClose}
              onSuccess={(cookie) => {
                void saveYuketang(cookie).then(() => afterExtHw("雨课堂已连接"));
              }}
            />
          ) : (
            <YktWebLoginPanel
              onCancel={onClose}
              onSuccess={(cookie) => {
                void saveYuketang(cookie).then(() => afterExtHw("雨课堂已连接"));
              }}
            />
          )}
        </div>
      );
    }
    if (need === "tuoj") {
      return (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="setting-desc" style={{ margin: 0 }}>
            用清华账号登录一次即可，不需要额外输入。
          </div>
          <button className="btn primary" disabled={busy} onClick={() => void tuojLogin()}>
            {busy ? "登录中…" : "用清华账号登录"}
          </button>
        </div>
      );
    }
    if (need === "cloud") {
      return (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="setting-desc" style={{ margin: 0 }}>
            点击后会在 OneTHU 内打开清华云盘页。
          </div>
          <div className="setting-desc" style={{ margin: 0 }}>
            登录后读取现有访问口令并保存到本机，不会生成或重置。
          </div>
          {autoMsg ? (
            <div className="setting-desc" style={{ margin: 0, color: "var(--state-warn-primary, #b45309)" }}>
              {autoMsg}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn primary" disabled={busy} onClick={() => void cloudTokenFromWebview()}>
              {busy ? "等待云盘页面…" : "在应用内连接云盘"}
            </button>
            <button className="btn" onClick={() => setManualOpen((v) => !v)}>
              {manualOpen ? "收起手动填写" : "手动粘贴访问口令"}
            </button>
          </div>
          {manualOpen ? (
            <>
              <div className="setting-desc" style={{ margin: 0 }}>
                云盘网页端个人资料页：已有访问口令可点眼睛显示后复制。
                没有访问口令时，请手动生成并粘贴到下面（仅存本机）。
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 180 }}
                  placeholder="粘贴云盘访问口令"
                  value={token}
                  onChange={(e) => setToken(e.target.value.trim())}
                />
                <button className="btn primary" disabled={!token || busy} onClick={() => void cloudConnect()}>
                  {busy ? "连接中…" : "连接"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      );
    }
    /* mail：真实输入框——与设置页同一个动作（accountSetup → cloudCal），语义不分叉 */
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div className="setting-desc" style={{ margin: 0 }}>
          密码不是邮箱登录密码，是「客户端专用密码」：网页版邮箱 → 设置 → 客户端专用密码。
        </div>
        <input
          className="input"
          placeholder="完整邮箱地址（如 someone@mails.tsinghua.edu.cn）"
          value={mailAddr}
          onChange={(e) => setMailAddr(e.target.value.trim())}
        />
        <input
          className="input"
          type="password"
          placeholder="客户端专用密码"
          value={mailCode}
          onChange={(e) => setMailCode(e.target.value)}
        />
        <button
          className="btn primary"
          disabled={!/.+@.+/.test(mailAddr) || !mailCode || busy}
          onClick={() => void mailConnect()}
        >
          {busy ? "连接中…" : "保存并验证"}
        </button>
      </div>
    );
  })();

  return createPortal(
    <div style={maskStyle} onClick={onClose}>
      <div className="connect-gate-panel" style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <b style={{ fontSize: "var(--text-lg)" }}>连接{LABEL[need]}</b>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="setting-desc" style={{ margin: "0 0 12px" }}>
          {WHY[need]}
        </div>
        {body}
        {err ? (
          <div style={{ marginTop: 10, fontSize: "var(--text-sm)", color: "var(--red, #c04848)" }}>{err}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

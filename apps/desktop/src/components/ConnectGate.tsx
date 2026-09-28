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
import { setSeafileToken } from "../state/seafile.js";
import { showToast } from "../state/toast.js";
import { useApp } from "../state/context.js";
import { requestSettingsTab } from "../state/settingsMode.js";

export type BindNeed = "yuketang" | "tuoj" | "mail" | "cloud" | "calendar";

const LABEL: Record<BindNeed, string> = {
  yuketang: "雨课堂",
  tuoj: "TUOJ",
  mail: "清华邮箱",
  cloud: "清华云盘",
  calendar: "日程云同步",
};

/** 每种绑定「为什么要绑」的一句话——别只说"未登录" */
const WHY: Record<BindNeed, string> = {
  yuketang: "绑定后把雨课堂作业 DDL 合并到「全部作业」与「今日」。",
  tuoj: "绑定后用清华账号读回 OJ 作业，只读课业信息，不提交任何内容。",
  mail: "绑定后在本机收发清华邮箱，用于作业与通知。",
  cloud: "绑定后把清华云盘的文件接进「云盘」页，可浏览与下载。",
  calendar: "绑定后日程可在多台设备间同步（走清华邮箱日历服务）。",
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
  const { navigate } = useApp();
  const [channel, setChannel] = useState<"qr" | "web">("qr");
  const [token, setToken] = useState("");
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

  const cloudConnect = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const acc = await setSeafileToken(token);
      showToast(`云盘已连接：${acc.name || acc.email}`);
      onDone?.();
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const goSettings = (): void => {
    requestSettingsTab("数据与同步");
    navigate("settings");
    onClose();
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
            在云盘网页端生成一个访问口令（Web API Auth Token），粘贴到下面。口令只存本机。
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
        </div>
      );
    }
    /* mail / calendar：填写项在设置里，这里给步骤 + 直达那一栏 */
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div className="setting-desc" style={{ margin: 0 }}>
          {need === "mail"
            ? "需要邮箱的「客户端专用密码」：网页版邮箱 → 设置 → 客户端专用密码。"
            : "需要邮箱的「客户端专用密码」，在设置里填入即可。"}
        </div>
        <button className="btn primary" onClick={goSettings}>
          去设置里填写
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

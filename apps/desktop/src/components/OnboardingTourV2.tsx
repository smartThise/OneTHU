/**
 * 首启 v2（§4.2，2026-09-28）：只问 3 件事，全部可跳过，完成后直接进「今日」。
 *
 * 与 v1 的差别不只是"少问几步"：v1 问的是界面怎么摆（侧栏 / 页签 / 卡片 / 收藏），
 * 那是**用起来之后**才有意见的问题，第一次打开的人答不上来。v2 只问三件此刻就有答案、
 * 且现在不问以后会挡路的事：提醒权限、统一认证、住哪栋楼。
 * 界面定制交给「我的 → 外观」即时预览——看到效果再调，比隔着一屏文字描述强。
 */
import { useState, type ReactNode } from "react";
import { extHwLogin } from "../state/exthw.js";
import { fetchNotifyStatus } from "../state/notifyBridge.js";
import { getDormBuilding, hasOnboardedV2, markOnboardedV2, setDormBuilding } from "../state/onboarding.js";
import { useApp } from "../state/context.js";

/** 三问 + 一屏收尾 */
const ASKS = 3;

const MASK: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2000,
  background: "rgba(0,0,0,.42)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const PANEL: React.CSSProperties = {
  width: "min(460px, 100%)",
  maxHeight: "88dvh",
  overflowY: "auto",
  background: "var(--surface, #fff)",
  color: "var(--text-1, #222)",
  borderRadius: 14,
  padding: 20,
  boxSizing: "border-box",
};

const H: React.CSSProperties = { margin: "0 0 8px", fontSize: 17 };
const P: React.CSSProperties = { margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.75, color: "var(--text-2, #555)" };

export function OnboardingTourV2(): ReactNode {
  const { navigate } = useApp();
  const [open, setOpen] = useState<boolean>(() => !hasOnboardedV2());
  const [step, setStep] = useState(0);
  const [notify, setNotify] = useState<"idle" | "asking" | "done">("idle");
  const [sso, setSso] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [dorm, setDorm] = useState<string>(() => getDormBuilding());

  if (!open) return null;

  const finish = (): void => {
    try {
      markOnboardedV2();
    } finally {
      setOpen(false);
      navigate("today");
    }
  };

  const askNotify = async (): Promise<void> => {
    setNotify("asking");
    try {
      await fetchNotifyStatus(true);
    } catch {
      /* 请示失败也照常往下走：这不是阻断项，用户可以在设置里再开 */
    } finally {
      setNotify("done");
    }
  };

  const doSso = async (): Promise<void> => {
    setSso("busy");
    try {
      const { cookie } = await extHwLogin.tuojCas("tuoj");
      setSso(cookie ? "ok" : "err");
    } catch {
      setSso("err");
    }
  };

  const body = ((): ReactNode => {
    if (step === 0) {
      return (
        <>
          <h3 style={H}>欢迎使用 OneTHU</h3>
          <p style={P}>
            清华园随身工具箱。先用一分钟设好三件事，之后随时能在设置里改；不设也能直接用。
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-primary" disabled={notify === "asking"} onClick={() => void askNotify()}>
              {notify === "asking" ? "请求中…" : "开启提醒"}
            </button>
            {notify === "done" ? (
              <span style={{ fontSize: 12.5, color: "var(--text-2, #555)" }}>
                已请求权限；没看到弹窗就去系统设置里给 OneTHU 打开通知。
              </span>
            ) : null}
          </div>
        </>
      );
    }
    if (step === 1) {
      return (
        <>
          <h3 style={H}>用清华账号登录一次</h3>
          <p style={P}>
            登录后就能读课表、作业和成绩；需要二次验证时，会在授权页里正常走完。只读课业信息，不会替你提交任何东西。
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-primary" disabled={sso === "busy" || sso === "ok"} onClick={() => void doSso()}>
              {sso === "busy" ? "登录中…" : sso === "ok" ? "已登录" : "用清华账号登录"}
            </button>
            {sso === "ok" ? <span style={{ fontSize: 12.5 }}>登录成功，课表与作业马上就能读。</span> : null}
            {sso === "err" ? (
              <span style={{ fontSize: 12.5, color: "var(--red, #c04848)" }}>
                这次没登上，稍后可在「设置 → 外部作业源」重试。
              </span>
            ) : null}
          </div>
        </>
      );
    }
    if (step === 2) {
      return (
        <>
          <h3 style={H}>你住哪栋楼？</h3>
          <p style={P}>
            洗衣机和宿舍电费要用到楼栋。现在只是记下来，不会发给别人，之后也能在设置里改。
          </p>
          <input
            className="input"
            style={{ width: "100%" }}
            placeholder="比如 紫荆公寓 12 号楼"
            value={dorm}
            onChange={(e) => setDorm(e.target.value)}
          />
        </>
      );
    }
    return (
      <>
        <h3 style={H}>可以开始了</h3>
        <p style={P}>
          没设的都不影响使用：账号随时能绑，提醒随时能开，楼栋随时能改。都放在「我的」里。
        </p>
        <p style={P}>首页卡片可以长按「编辑」调整，界面样式在「我的 → 外观」里看效果调。</p>
      </>
    );
  })();

  const onAskStep = step < ASKS;

  return (
    <div style={MASK}>
      <div style={PANEL}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <span style={{ display: "flex", gap: 5 }}>
            {Array.from({ length: ASKS }, (_, i) => (
              <span
                key={i}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: i <= step ? "var(--accent, #4176e6)" : "var(--border, #e5e6eb)",
                }}
              />
            ))}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={finish}>
            跳过导览
          </button>
        </div>

        {body}

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
          {onAskStep ? (
            <>
              <span style={{ flex: 1 }} />
              <button className="btn" onClick={() => setStep((s) => s + 1)}>
                跳过此步
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (step === 2) setDormBuilding(dorm);
                  setStep((s) => s + 1);
                }}
              >
                下一步
              </button>
            </>
          ) : (
            <>
              <span style={{ flex: 1 }} />
              <button className="btn btn-primary" onClick={finish}>
                进入今日
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 校园网 —— info.getNetworkAccountInfo + getNetworkBalance（thu-info-app
 * network.tsx/networkDetail 移植）。usereg 需验证码登录（用户实测：密码=INFO
 * 密码，图内验证码手输）——检测到验证码门时展示登录面板（验证码图经 core 会话
 * 拉取转 base64，webview 直挂 URL 无会话）。任何失败都静态提示 + 重试，
 * 绝不自动整页刷新、绝不失登自愈。
 */
import { useCallback, useEffect, useState } from "react";
import { Card, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { TabEmpty, logTabErr } from "./tabStates.js";

type LoadState = "loading" | "error" | "ready" | "captcha";
type NetworkRow = [string, string];

const NEED_CAPTCHA = /需要验证码登录/;

export function NetworkTab() {
  const { status } = useApp();
  const [rows, setRows] = useState<NetworkRow[] | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  /* —— 验证码登录面板 —— */
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [code, setCode] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginErr, setLoginErr] = useState<string | null>(null);

  const refreshCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setLoginErr(null);
    try {
      setCaptcha(await info.getNetworkVerificationImage());
    } catch (err) {
      logTabErr("NETWORK-CAPTCHA", err);
      setLoginErr(`验证码拉取失败：${err instanceof Error ? err.message : String(err)}`);
      setCaptcha(null);
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    if (status !== "ready") return;
    setState("loading");
    try {
      // 两路互相独立：任一成功即展示可得信息；全失败才算失败
      const [acc, bal] = await Promise.allSettled([
        info.getNetworkAccountInfo(),
        info.getNetworkBalance(),
      ]);
      const out: NetworkRow[] = [];
      if (acc.status === "fulfilled") {
        const a = acc.value;
        out.push(
          ["账号", a.username || "–"],
          ["姓名", a.realName || "–"],
          ["状态", a.status || "–"],
          ["用户组", a.userGroup || "–"],
          ["位置", a.location || "–"],
          ["允许设备数", String(a.allowedDevices ?? "–")],
          ["联系邮箱", a.contactEmail || "–"],
        );
      }
      if (bal.status === "fulfilled") {
        const b = bal.value;
        out.push(
          ["套餐", b.productName || "–"],
          ["已用流量", b.usedBytes || "–"],
          ["已用时长", b.usedSeconds || "–"],
          ["账户余额", b.accountBalance || "–"],
          ["结算日期", b.settlementDate || "–"],
        );
      }
      const accErr = acc.status === "rejected" ? acc.reason : null;
      const balErr = bal.status === "rejected" ? bal.reason : null;
      if (accErr) logTabErr("NETWORK-ACC", accErr);
      if (balErr) logTabErr("NETWORK-BAL", balErr);
      setRows(out);
      const needCaptcha =
        out.length === 0 &&
        [accErr, balErr].some((e) => e instanceof Error && NEED_CAPTCHA.test(e.message));
      if (needCaptcha) {
        setState("captcha");
        void refreshCaptcha();
      } else {
        setState(out.length > 0 ? "ready" : "error");
      }
    } catch (err) {
      logTabErr("NETWORK", err);
      setRows(null);
      setState("error");
    }
  }, [status, refreshCaptcha]);

  useEffect(() => {
    void load();
  }, [load]);

  const doLogin = useCallback(async () => {
    const c = code.trim();
    if (!c || loginBusy) return;
    setLoginBusy(true);
    setLoginErr(null);
    try {
      await info.loginUsereg(c);
      setCode("");
      setState("loading");
      // 登录成功重拉数据（验证码面板随 ready 态自然消失）
      const [acc, bal] = await Promise.allSettled([
        info.getNetworkAccountInfo(),
        info.getNetworkBalance(),
      ]);
      const out: NetworkRow[] = [];
      if (acc.status === "fulfilled") {
        const a = acc.value;
        out.push(
          ["账号", a.username || "–"],
          ["姓名", a.realName || "–"],
          ["状态", a.status || "–"],
          ["用户组", a.userGroup || "–"],
          ["位置", a.location || "–"],
          ["允许设备数", String(a.allowedDevices ?? "–")],
          ["联系邮箱", a.contactEmail || "–"],
        );
      }
      if (bal.status === "fulfilled") {
        const b = bal.value;
        out.push(
          ["套餐", b.productName || "–"],
          ["已用流量", b.usedBytes || "–"],
          ["已用时长", b.usedSeconds || "–"],
          ["账户余额", b.accountBalance || "–"],
          ["结算日期", b.settlementDate || "–"],
        );
      }
      setRows(out);
      setState(out.length > 0 ? "ready" : "captcha");
      if (out.length === 0) void refreshCaptcha();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoginErr(msg);
      logTabErr("NETWORK-LOGIN", err);
      // 验证码错误等：换一张图
      void refreshCaptcha();
    } finally {
      setLoginBusy(false);
    }
  }, [code, loginBusy, refreshCaptcha]);

  if (status === "demo") {
    return <TabEmpty text="演示模式不提供校园网数据，登录后可尝试查询账号与流量。" />;
  }

  return (
    <>
      <SectionHead title="校园网" aside="账号 · 流量 · 验证码登录" />
      {state === "error" ? (
        <ErrorNote text="该功能暂时不可用（获取失败，可稍后重试）" onRetry={() => void load()} />
      ) : null}

      {state === "captcha" ? (
        <Card style={{ marginBottom: 20, padding: 18 }}>
          <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>usereg 验证码登录</div>
          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 14, lineHeight: 1.6 }}>
            密码与 INFO 密码一致；输入右侧图内验证码后登录（与网页端流程相同）。
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <div
              onClick={() => !captchaLoading && void refreshCaptcha()}
              style={{
                width: 150,
                height: 48,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid var(--border, #ccc)",
                borderRadius: 8,
                cursor: "pointer",
                overflow: "hidden",
                flexShrink: 0,
              }}
              title="点击刷新验证码"
            >
              {captchaLoading ? (
                <span style={{ fontSize: 12, opacity: 0.6 }}>加载中…</span>
              ) : captcha ? (
                <img src={captcha} alt="验证码" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: 12, opacity: 0.6 }}>点击重试</span>
              )}
            </div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doLogin();
              }}
              placeholder="验证码"
              style={{ width: 130, height: 38, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border, #ccc)", fontSize: 14 }}
            />
            <button
              className="btn"
              onClick={() => void doLogin()}
              disabled={loginBusy || !code.trim()}
              style={{ opacity: loginBusy || !code.trim() ? 0.6 : 1 }}
            >
              {loginBusy ? "登录中…" : "登录 usereg"}
            </button>
          </div>
          {loginErr ? (
            <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.5, color: "#d33" }}>{loginErr}</div>
          ) : null}
        </Card>
      ) : null}

      {state === "loading" ? (
        <SkeletonRows rows={3} />
      ) : state === "ready" && rows ? (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>项目</th>
                <th className="num">信息</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([k, v], i) => (
                <tr key={`${k}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                  <td className="cell-title">{k}</td>
                  <td className="num">{v || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </>
  );
}

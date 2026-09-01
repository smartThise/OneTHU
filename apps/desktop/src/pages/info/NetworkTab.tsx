/**
 * 校园网 —— usereg 自服务（thu-info-app network.tsx 移植 + 用户示例页增强）。
 * 数据：账号/状态/用户组（/users+/home）、流量/时长（/home w3 计费组表）、
 * 设备数（/user/online-num）。管理：改终端连接数、改 Tsinghua-Secure 密码、
 * 在线设备下线。usereg 需验证码登录（密码=INFO 密码）——检测到验证码门时展示
 * 登录面板，验证码图经 core 会话拉取转 base64。失败一律静态提示+重试，
 * 绝不自动整页刷新、绝不失登自愈。
 */
import { useCallback, useEffect, useState } from "react";
import { Card, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { TabEmpty, logTabErr, isAuthExpired } from "./tabStates.js";
import type { NetworkDevice } from "@onethu/core";

type LoadState = "loading" | "error" | "ready" | "captcha";
type NetworkRow = [string, string];

const NEED_CAPTCHA = /需要验证码登录/;

export function NetworkTab() {
  const { status } = useApp();
  const [rows, setRows] = useState<NetworkRow[] | null>(null);
  const [devices, setDevices] = useState<NetworkDevice[] | null>(null);
  const [devCount, setDevCount] = useState<number | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  /* —— 验证码登录面板 —— */
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [code, setCode] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);

  /* —— 管理操作 —— */
  const [newCount, setNewCount] = useState("");
  const [countBusy, setCountBusy] = useState(false);
  const [countMsg, setCountMsg] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);

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
      const [acc, bal, devs, cnt] = await Promise.allSettled([
        info.getNetworkAccountInfo(),
        info.getNetworkBalance(),
        info.getOnlineDevices(),
        info.getNetworkDeviceCount(),
      ]);
      const out: NetworkRow[] = [];
      if (acc.status === "fulfilled") {
        const a = acc.value;
        out.push(
          ["账号", a.username || "–"],
          ["姓名", a.realName || "–"],
          ["状态", a.status || "–"],
          ["用户组", a.userGroup || "–"],
        );
      }
      if (bal.status === "fulfilled") {
        const b = bal.value;
        out.push(["已用流量", b.usedBytes || "–"], ["已用时长", b.usedSeconds || "–"]);
      }
      if (cnt.status === "fulfilled") {
        setDevCount(cnt.value);
        out.push(["终端连接数", String(cnt.value)]);
      } else if (acc.status === "fulfilled") {
        const a = acc.value;
        if (a.allowedDevices != null) out.push(["允许设备数", String(a.allowedDevices)]);
      }
      setDevices(devs.status === "fulfilled" ? devs.value : null);
      const accErr = acc.status === "rejected" ? acc.reason : null;
      const balErr = bal.status === "rejected" ? bal.reason : null;
      const cntErr = cnt.status === "rejected" ? cnt.reason : null;
      if (accErr) logTabErr("NETWORK-ACC", accErr);
      if (balErr) logTabErr("NETWORK-BAL", balErr);
      if (cntErr) logTabErr("NETWORK-CNT", cntErr);
      // 校园网与统一身份相互独立：未登录是常态，不是故障
      setNeedLogin([accErr, balErr, cntErr].some((e) => isAuthExpired(e)));
      setRows(out);
      const needCaptcha =
        out.length === 0 &&
        [accErr, balErr, cntErr].some((e) => e instanceof Error && NEED_CAPTCHA.test(e.message));
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

  const doLogin = useCallback(
    async (c: string) => {
      if (!c || loginBusy) return;
      setLoginBusy(true);
      setLoginErr(null);
      try {
        await info.loginUsereg(c);
        setCode("");
        await load();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLoginErr(msg);
        logTabErr("NETWORK-LOGIN", err);
        void refreshCaptcha();
      } finally {
        setLoginBusy(false);
      }
    },
    [loginBusy, load, refreshCaptcha],
  );

  const doSetCount = useCallback(async () => {
    const n = Number(newCount);
    if (!Number.isInteger(n) || n <= 0 || countBusy || devCount == null) return;
    setCountBusy(true);
    setCountMsg(null);
    try {
      await info.setNetworkDeviceCount(n);
      setCountMsg(`已改为 ${n}`);
      setDevCount(n);
    } catch (err) {
      setCountMsg(err instanceof Error ? err.message : String(err));
      logTabErr("NETWORK-SETCNT", err);
    } finally {
      setCountBusy(false);
    }
  }, [newCount, countBusy, devCount]);

  const doChpwd = useCallback(async () => {
    if (pwdBusy) return;
    setPwdMsg(null);
    if (pwd1 !== pwd2) {
      setPwdMsg("两次输入不一致");
      return;
    }
    if (!/^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^*().~])[^\s]{8,19}$/.test(pwd1)) {
      setPwdMsg("格式不符：8~19 位，含字母+数字+特殊字符(!@#$%^*().~)至少各一");
      return;
    }
    setPwdBusy(true);
    try {
      await info.changeNetworkPassword(pwd1);
      setPwdMsg("密码已修改（下次连接 Tsinghua-Secure 用新密码）");
      setPwd1("");
      setPwd2("");
      setShowPwd(false);
    } catch (err) {
      setPwdMsg(err instanceof Error ? err.message : String(err));
      logTabErr("NETWORK-CHPWD", err);
    } finally {
      setPwdBusy(false);
    }
  }, [pwd1, pwd2, pwdBusy]);

  const doLogoutDevice = useCallback(
    async (d: NetworkDevice) => {
      try {
        await info.logoutNetwork(d);
        await load();
      } catch (err) {
        logTabErr("NETWORK-LOGOUT", err);
      }
    },
    [load],
  );

  if (status === "demo") {
    return <TabEmpty text="演示模式不提供校园网数据，登录后可尝试查询账号与流量。" />;
  }

  return (
    <>
      <SectionHead title="校园网" aside="usereg 自服务 · 验证码登录" />
      {state === "error" ? (
        needLogin ? (
          <ErrorNote text="校园网尚未登录（校园网与统一身份认证相互独立，未登录是常态）。可稍后在本页验证码自助登录，或重试查询。" onRetry={() => void load()} />
        ) : (
          <ErrorNote text="该功能暂时不可用（获取失败，可稍后重试）" onRetry={() => void load()} />
        )
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
                if (e.key === "Enter") void doLogin(code.trim());
              }}
              placeholder="验证码"
              style={{ width: 130, height: 38, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border, #ccc)", fontSize: 14 }}
            />
            <button className="btn" onClick={() => void doLogin(code.trim())} disabled={loginBusy || !code.trim()}>
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
        <>
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

          {devices && devices.length > 0 ? (
            <>
              <SectionHead title="在线设备" aside={`${devices.length} 台 · 可下线`} />
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <div className="list">
                  {devices.map((d, i) => (
                    <div className="row" key={`${d.key}-${i}`}>
                      <div className="row-main">
                        <div className="row-title" style={{ fontFamily: "monospace", fontWeight: 600 }}>
                          {d.ip4 || "–"}
                          {d.ip6 ? <span style={{ opacity: 0.6, fontSize: 10 }}> · {d.ip6}</span> : null}
                        </div>
                        <div className="row-sub">
                          {[d.mac ? `MAC ${d.mac}` : "", d.loggedAt ? `登录 ${d.loggedAt}` : ""].filter(Boolean).join(" · ") || "–"}
                        </div>
                      </div>
                      <button className="chip chip-offline" onClick={() => void doLogoutDevice(d)}>
                        下线
                      </button>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : null}

          <SectionHead title="管理" aside="终端连接数 · Tsinghua-Secure 密码" />
          <Card style={{ padding: 18 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13 }}>终端连接数（当前 {devCount ?? "–"}）</span>
              <input
                value={newCount}
                onChange={(e) => setNewCount(e.target.value.replace(/[^\d]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doSetCount();
                }}
                placeholder="新数量"
                type="number"
                min={1}
                style={{ width: 90, height: 34, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border, #ccc)" }}
              />
              <button className="btn" onClick={() => void doSetCount()} disabled={countBusy || !newCount}>
                {countBusy ? "提交中…" : "修改"}
              </button>
              <span style={{ fontSize: 12, opacity: 0.7 }}>账号下每个静态 IP 计一个连接数，谨慎修改</span>
            </div>
            {countMsg ? <div style={{ marginTop: 8, fontSize: 13, color: "#0866c6" }}>{countMsg}</div> : null}

            <div style={{ borderTop: "1px solid var(--border, #eee)", margin: "16px 0", opacity: 0.5 }} />
            {!showPwd ? (
              <button className="btn-ghost" onClick={() => setShowPwd(true)}>
                修改 Tsinghua-Secure 密码
              </button>
            ) : (
              <div style={{ display: "grid", gap: 12, maxWidth: 420 }}>
                <input
                  type="password"
                  value={pwd1}
                  onChange={(e) => setPwd1(e.target.value)}
                  placeholder="新密码"
                  style={{ height: 38, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border, #ccc)" }}
                />
                <input
                  type="password"
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void doChpwd();
                  }}
                  placeholder="确认新密码"
                  style={{ height: 38, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border, #ccc)" }}
                />
                <div style={{ fontSize: 12, opacity: 0.7, lineHeight: 1.6 }}>
                  8~19 位，字母区分大小写，不能与用户名相同，至少含数字、字母、特殊字符(仅限 !@#$%^*().~)中的两种
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="btn" onClick={() => void doChpwd()} disabled={pwdBusy || !pwd1}>
                    {pwdBusy ? "提交中…" : "提交"}
                  </button>
                  <button className="btn-ghost" onClick={() => setShowPwd(false)}>
                    取消
                  </button>
                </div>
              </div>
            )}
            {pwdMsg ? <div style={{ marginTop: 10, fontSize: 13, color: "#0866c6" }}>{pwdMsg}</div> : null}
          </Card>
        </>
      ) : null}
    </>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import type { TwoFactorMethod } from "@onethu/core";
import { isTauri } from "../lib/transport.js";
import { loadRemembered } from "../lib/clients.js";
import { useApp } from "../state/context.js";

export function LoginPage() {
  const { login, enterDemo, status, error } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // 记住密码：默认勾选；已有存档时预填（本机混淆存储，Settings 可清除）
  const [remember, setRemember] = useState(true);
  useEffect(() => {
    void loadRemembered().then((r) => {
      if (r) {
        setUsername(r.username);
        setPassword(r.password);
      }
    });
  }, []);
  const busy = status === "connecting";

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    void login(username.trim(), password, remember);
  };

  return (
    <div className="login-wrap">
      <div className="login-card card">
        <div className="login-mark">
          <span className="brand-mark" aria-hidden>一</span>
          <div>
            <div className="login-title">OneTHU</div>
            <div className="login-sub">清华万物 · 汇合于一体</div>
          </div>
        </div>

        {!isTauri ? (
          <div className="browser-hint">
            浏览器预览无法直连校园网（CORS）。完整功能请运行桌面端：pnpm tauri:dev
          </div>
        ) : null}
        {error ? (
          <div className="login-error" role="alert">
            {error}
          </div>
        ) : null}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="username">学号</label>
            <input
              id="username"
              autoComplete="username"
              inputMode="numeric"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">统一认证密码</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <label className="trust-row">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            记住密码（本机保存，重启后自动登录）
          </label>
          <button
            className="btn btn-primary"
            style={{ width: "100%", height: 40, marginTop: 4 }}
            disabled={busy || !username || !password}
          >
            {busy ? "正在登录统一认证…" : "登录"}
          </button>
        </form>

        <div className="login-foot">
          <span>使用清华大学统一身份认证</span>
          <button className="btn-ghost btn" onClick={enterDemo}>
            演示模式
          </button>
        </div>
      </div>
    </div>
  );
}

const METHOD_NAMES: Record<string, string> = { wechat: "企业微信", mobile: "手机短信", totp: "TOTP 验证器" };

export function TwoFactorPage() {
  const { twoFactor, submit2FA, send2FA, sendLearn2FA, error, status, backToLogin } = useApp();
  const round = twoFactor?.round ?? 1;
  const doSend = round === 2 ? sendLearn2FA : send2FA;
  const [stage, setStage] = useState<"select" | "code">("select");
  const [methods] = useState<TwoFactorMethod[]>(twoFactor?.methods ?? []);
  const [selected, setSelected] = useState<string>("");
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(true);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const busy = status === "connecting";

  if (!twoFactor) return <LoginPage />;

  const current = methods.find((m) => m.type === selected);
  const isTotp = selected === "totp";
  const nameOf = (t: string) => METHOD_NAMES[t] ?? t;

  const onSend = async () => {
    if (!selected) return;
    setSending(true);
    try {
      await doSend(selected);
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !code.trim()) return;
    void submit2FA(selected, code, trust);
  };

  if (stage === "select") {
    return (
      <div className="login-wrap">
        <div className="login-card card">
          <div className="login-mark">
            <span className="brand-mark" aria-hidden>一</span>
            <div>
              <div className="login-title">二次认证</div>
              <div className="login-sub">选择一种方式验证身份 · {twoFactor.username}</div>
            </div>
          </div>

          {error ? <div className="login-error" role="alert">{error}</div> : null}

          <div className="field">
            <div className="method-list">
              {methods.map((m) => (
                <label key={m.type} className={"method-item" + (selected === m.type ? " is-selected" : "")}>
                  <input
                    type="radio"
                    name="twofa-method"
                    value={m.type}
                    checked={selected === m.type}
                    onChange={() => setSelected(m.type)}
                  />
                  <span className="method-radio" aria-hidden />
                  <span className="method-text">
                    <b>{m.name || nameOf(m.type)}</b>
                    {m.detail ? <i>{m.detail}</i> : null}
                  </span>
                </label>
              ))}
              {methods.length === 0 ? <span className="empty" style={{ padding: "8px 0" }}>加载验证方式…</span> : null}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button type="button" className="btn-ghost btn" onClick={backToLogin}>
              返回登录
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!selected}
              onClick={() => setStage("code")}
            >
              下一步
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-card card">
        <div className="login-mark">
          <span className="brand-mark" aria-hidden>一</span>
          <div>
            <div className="login-title">{nameOf(selected)}</div>
            <div className="login-sub">
              {isTotp ? "输入验证器中的 6 位动态码" : sent ? "验证码已发送，请查收" : "点击下方按钮发送验证码"}
            </div>
          </div>
        </div>

        {error ? <div className="login-error" role="alert">{error}</div> : null}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="code">验证码</label>
            <input
              id="code"
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <label className="trust-row">
            <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
            信任此设备，30 天内免二次认证
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            {!isTotp ? (
              <button
                type="button"
                className="btn"
                style={{ flex: "0 0 auto" }}
                onClick={() => void onSend()}
                disabled={sending || !selected}
              >
                {sending ? "发送中…" : sent ? "重新发送" : "发送验证码"}
              </button>
            ) : null}
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={busy || (!isTotp && !sent) || !code.trim()}
            >
              {busy ? "校验中…" : "验证并登录"}
            </button>
          </div>
        </form>

        <div className="login-foot">
          <button className="btn-ghost btn" onClick={() => { setStage("select"); setCode(""); setSent(false); }}>
            ← 更改验证方式
          </button>
          <button className="btn-ghost btn" onClick={backToLogin}>
            返回登录
          </button>
        </div>
      </div>
    </div>
  );
}

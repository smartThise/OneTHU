import { Btn } from "@onethu/gui";
import { BrandLogo, HardRefreshButton, Slogan } from "../components/Layout.js";
import { useEffect, useState, type FormEvent } from "react";
import type { TwoFactorMethod } from "@onethu/core";
import { isTauri } from "../lib/transport.js";
import { loadRemembered } from "../lib/clients.js";
import { useApp } from "../state/context.js";
import { DESENSITIZE_BUILD } from "../lib/privacy.js";
import { t as i18n } from "../i18n/index.js";


export function LoginPage() {
  const { login, status, error } = useApp();
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
      <HardRefreshButton />
      <div className="login-card">
        <div className="login-mark" style={{ flexDirection: "column", alignItems: "flex-start", gap: 12 }}>
          <BrandLogo size={30} />
          <Slogan size={13} />
        </div>

        {!isTauri ? (
          <div className="browser-hint">
            {i18n("auto.pages.Login.1")}</div>
        ) : null}
        {error ? (
          <div className="login-error" role="alert">
            {error}
          </div>
        ) : null}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="username">{i18n("auto.pages.Login.2")}</label>
            <input
              id="username"
              autoComplete="username"
              inputMode="numeric"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">{i18n("auto.pages.Login.3")}</label>
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
            {i18n("auto.pages.Login.4")}</label>
          <Btn type="submit" variant="solid" tone="brand" block disabled={busy || !username || !password}>{busy ? "正在登录统一认证…" : "登录"}</Btn>
        </form>

        <div className="login-foot">
          <span>{i18n("auto.pages.Login.5")}</span>
        </div>
        {DESENSITIZE_BUILD ? (
          <p className="login-note">
            {i18n("auto.pages.Login.6")}</p>
        ) : null}
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
  // 防重复提交：submit2FA（app.tsx）全程不动 status，busy 恒 false——
  // 网络往返期间按钮可点，误触第二下=验证码已被消费→直接报错（用户实录）。
  // 本地闸门：提交瞬间置位，落定前按钮冻结 + onSubmit 防重入。
  const [submitting, setSubmitting] = useState(false);
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
    if (!selected || !code.trim() || submitting || busy) return;
    setSubmitting(true);
    void submit2FA(selected, code, trust).finally(() => setSubmitting(false));
  };

  if (stage === "select") {
    return (
      <div className="login-wrap">
      <HardRefreshButton />
        <div className="login-card">
          <div className="login-mark">
            <BrandLogo size={26} />
            <div>
              <div className="login-title">{i18n("auto.pages.Login.7")}</div>
              <div className="login-sub">{i18n("auto.pages.Login.8")}{twoFactor.username}</div>
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
              {methods.length === 0 ? <span className="empty" style={{ padding: "8px 0" }}>{i18n("auto.pages.Login.9")}</span> : null}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Btn variant="ghost" onClick={backToLogin}>
              {i18n("auto.pages.Login.10")}</Btn>
            <Btn type="submit" variant="solid" tone="brand" block disabled={!selected} onClick={() => setStage("code")}>{i18n("auto.pages.Login.11")}</Btn>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <HardRefreshButton />
      <div className="login-card">
        <div className="login-mark">
          <BrandLogo size={26} />
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
            <label htmlFor="code">{i18n("auto.pages.Login.12")}</label>
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
            {i18n("auto.pages.Login.13")}</label>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            {!isTotp ? (
              <Btn variant="outline" onClick={() => void onSend()} disabled={sending || !selected}>{sending ? "发送中…" : sent ? "重新发送" : "发送验证码"}</Btn>
            ) : null}
            <Btn type="submit" variant="solid" tone="brand" block disabled={busy || submitting || (!isTotp && !sent) || !code.trim()}>{busy || submitting ? "校验中…" : "验证并登录"}</Btn>
          </div>
        </form>

        <div className="login-foot">
          <Btn variant="ghost" onClick={() => { setStage("select"); setCode(""); setSent(false); }}>{i18n("auto.pages.Login.14")}</Btn>
          <Btn variant="ghost" onClick={backToLogin}>
            {i18n("auto.pages.Login.10")}</Btn>
        </div>
      </div>
    </div>
  );
}

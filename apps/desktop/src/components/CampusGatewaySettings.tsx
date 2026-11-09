import { useCallback, useEffect, useRef, useState } from "react";
import { Btn, Inline, Input, SettingsRow } from "@onethu/gui";
import { t, useLocale } from "../i18n/index.js";
import { campusGatewayRequest, type CampusGatewayAction, type CampusGatewayCredentials, type CampusGatewayStatus } from "../lib/campusGateway.js";
import { desktopCliSupported, refreshCliInstallation, type CliInstallation } from "../lib/sharedRuntime.js";
import { openExternal } from "../pages/info/openExternal.js";
import "./CampusGatewaySettings.css";

type GatewayError = { code?: string; copy?: boolean };

function gatewayError(error: unknown): GatewayError {
  // Native errors can contain process output. Display only an error identifier,
  // never a command line, proxy password or a campus credential.
  const raw = typeof error === "object" && error && "code" in error ? String(error.code) : String(error ?? "");
  const code = /\b(?:GATEWAY|CLI|CAMPUS|PROXY|CERTIFICATE)_[A-Z0-9_]+\b/.exec(raw)?.[0];
  return { code };
}

function errorText(error: GatewayError): string {
  if (error.copy) return t("gateway.copyError");
  if (error.code === "GATEWAY_EXISTING_PROXY_ENABLED") return t("gateway.existingProxy");
  if (error.code === "GATEWAY_PROXY_PLAN_CHANGED" || error.code === "GATEWAY_PROXY_SETTINGS_CHANGED") return t("gateway.planChanged");
  if (error.code === "GATEWAY_AUTHENTICATED_PROXY_UNSUPPORTED") return t("gateway.authenticatedProxy");
  if (error.code === "GATEWAY_PROXY_RESTORE_FAILED") return t("gateway.restoreError");
  if (error.code === "GATEWAY_LOGIN_REQUIRED") return t("gateway.loginRequired");
  return error.code ? t("gateway.errorCode", { code: error.code }) : t("gateway.error");
}

export function CampusGatewaySettings() {
  useLocale();
  const ios = typeof navigator !== "undefined" && (/iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  const supported = desktopCliSupported() && !ios;
  const [installation, setInstallation] = useState<CliInstallation | null>(null);
  const [status, setStatus] = useState<CampusGatewayStatus | null>(null);
  const [busy, setBusy] = useState<CampusGatewayAction | "copy" | null>(null);
  const [loading, setLoading] = useState(supported);
  const [error, setError] = useState<GatewayError | null>(null);
  const [notice, setNotice] = useState<"browser" | "password" | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [credentials, setCredentials] = useState<CampusGatewayCredentials | null>(null);
  const active = useRef(true);
  const pending = useRef(false);

  const refresh = useCallback(async () => {
    const nextInstallation = await refreshCliInstallation();
    if (!active.current) return;
    setInstallation(nextInstallation);
    if (!nextInstallation?.available) {
      setStatus(null);
      setCredentials(null);
      return;
    }
    const nextStatus = await campusGatewayRequest<CampusGatewayStatus>("status");
    if (!active.current) return;
    setStatus(nextStatus);
    if (!nextStatus.running) setCredentials(null);
    if (nextStatus.lastError) setError(gatewayError(nextStatus.lastError));
  }, []);

  useEffect(() => {
    active.current = true;
    if (!supported) return () => { active.current = false; };
    const reload = () => {
      if (pending.current) return;
      pending.current = true;
      setLoading(true);
      setError(null);
      void refresh().catch(e => { if (active.current) setError(gatewayError(e)); })
        .finally(() => { pending.current = false; if (active.current) setLoading(false); });
    };
    reload();
    window.addEventListener("onethu-cli-installation", reload);
    window.addEventListener("focus", reload);
    return () => {
      active.current = false;
      window.removeEventListener("onethu-cli-installation", reload);
      window.removeEventListener("focus", reload);
    };
  }, [refresh, supported]);

  useEffect(() => {
    if (!credentials) return;
    const hide = () => { if (document.hidden) setCredentials(null); };
    const timeout = window.setTimeout(() => setCredentials(null), 60_000);
    document.addEventListener("visibilitychange", hide);
    return () => { window.clearTimeout(timeout); document.removeEventListener("visibilitychange", hide); };
  }, [credentials]);

  async function run(action: CampusGatewayAction) {
    if (pending.current) return;
    pending.current = true;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      if (action === "status") await refresh();
      else if (action === "credentials") {
        const result = await campusGatewayRequest<CampusGatewayCredentials>(action);
        if (!result || typeof result.username !== "string" || typeof result.password !== "string") throw new Error("GATEWAY_INVALID_CREDENTIALS_REPLY");
        if (active.current) setCredentials(result);
      } else {
        await campusGatewayRequest(action);
        if (active.current && action === "open-browser") setNotice("browser");
        await refresh();
      }
    } catch (e) { if (active.current) setError(gatewayError(e)); }
    finally { pending.current = false; if (active.current) setBusy(null); }
  }

  async function copyPassword() {
    if (!credentials || pending.current) return;
    pending.current = true;
    setBusy("copy");
    setError(null);
    try {
      await navigator.clipboard.writeText(credentials.password);
      if (active.current) setNotice("password");
    } catch { if (active.current) setError({ copy: true }); }
    finally { pending.current = false; if (active.current) setBusy(null); }
  }

  if (!supported) return <div className="campus-gateway-settings"><SettingsRow id="row-campus-gateway" title={t("gateway.title")} sub={t("gateway.desktopOnly")} /><p className="campus-gateway-message">{t("gateway.platformScope")}</p></div>;

  const disabled = loading || !!busy;
  const ready = installation?.available === true;
  const running = status?.running === true;
  const certificateReady = status?.certificate?.ready === true;
  const systemEnabled = status?.systemProxy?.enabled === true;
  const recoveryRequired = status?.systemProxy?.recoveryRequired === true;
  const systemSupported = status?.systemProxy?.supported === true;
  const activeEndpoint = status?.systemEndpoint ?? status?.endpoint;
  const endpoint = activeEndpoint ? `${activeEndpoint.host}:${activeEndpoint.port}` : "";
  const manualEndpoint = status?.endpoint ? `${status.endpoint.host}:${status.endpoint.port}` : "";
  const managementUrl = /^http:\/\/127\.0\.0\.1:\d{1,5}\/$/.test(status?.managementUrl ?? "") ? status?.managementUrl : null;
  const stateText = loading ? t("gateway.checking") : !ready ? t("gateway.installRequired") : !status ? t("gateway.unavailable")
    : running ? t("gateway.running", { endpoint }) : t("gateway.stopped");

  return <div className="campus-gateway-settings" aria-busy={disabled}>
    <SettingsRow id="row-campus-gateway" title={t("gateway.title")} sub={<>{t("gateway.description")}<br /><span role="status">{stateText}</span></>}
      control={<Inline gap={2} wrap>
        <Btn variant="ghost" disabled={disabled} loading={busy === "status"} onClick={() => void run("status")}>{busy === "status" ? t("gateway.refreshing") : t("gateway.refresh")}</Btn>
        <Btn variant="outline" disabled={disabled || !ready || !status} loading={busy === "start" || busy === "stop"} onClick={() => void run(running ? "stop" : "start")}>
          {busy === "start" ? t("gateway.starting") : busy === "stop" ? t("gateway.stopping") : running ? t("gateway.stop") : t("gateway.start")}
        </Btn>
        {recoveryRequired ? <Btn variant="outline" disabled={disabled} loading={busy === "system-disable"} onClick={() => void run("system-disable")}>{busy === "system-disable" ? t("gateway.systemDisabling") : t("gateway.systemDisable")}</Btn> : null}
      </Inline>} />
    {recoveryRequired ? <p className="campus-gateway-message" role="status">{t("gateway.recoveryRequired")}</p> : null}
    {error ? <p className="campus-gateway-message campus-gateway-error" role="alert">{errorText(error)}</p> : null}
    {notice ? <p className="campus-gateway-message" role="status">{notice === "browser" ? t("gateway.browserOpened") : t("gateway.passwordCopied")}</p> : null}
    {ready && status ? <>
      <div className="campus-gateway-primary">
        <p className="campus-gateway-message campus-gateway-flow">{t("gateway.systemFlow")}</p>
        <SettingsRow title={t("gateway.certificate")} sub={certificateReady ? status.certificate?.trusted === true ? t("gateway.trusted") : status.certificate?.trusted === false ? t("gateway.untrusted") : t("gateway.trustUnknown") : t("gateway.certificateMissing")}
          control={<Inline gap={2} wrap>
            {status.certificate?.trusted !== true ? <Btn variant="outline" disabled={disabled || !certificateReady} loading={busy === "trust"} onClick={() => void run("trust")}>{busy === "trust" ? t("gateway.trusting") : t("gateway.trust")}</Btn> : null}
            {certificateReady ? <Btn variant="ghost" disabled={disabled || status.certificate?.trusted === false || systemEnabled || recoveryRequired} loading={busy === "untrust"} onClick={() => void run("untrust")}>{busy === "untrust" ? t("gateway.untrusting") : t("gateway.untrust")}</Btn> : null}
          </Inline>} />
        <SettingsRow title={t("gateway.systemProxy")} sub={recoveryRequired ? t("gateway.recoveryRequired") : !systemSupported ? t("gateway.systemUnsupported") : systemEnabled ? t("gateway.systemEnabled") : t("gateway.systemDescription")}
          control={!recoveryRequired ? <Btn variant="tonal" disabled={disabled || (!systemEnabled && (!systemSupported || !running || status.certificate?.trusted !== true))} loading={busy === "system-enable" || busy === "system-disable"} onClick={() => void run(systemEnabled ? "system-disable" : "system-enable")}>
            {busy === "system-enable" ? t("gateway.systemEnabling") : busy === "system-disable" ? t("gateway.systemDisabling") : systemEnabled ? t("gateway.systemDisable") : t("gateway.systemEnable")}
          </Btn> : undefined} />
        {systemEnabled && !recoveryRequired && status.systemProxy?.coexistence && status.systemProxy.activeServices?.length ? <p className="campus-gateway-message" role="status">{t("gateway.coexistence", { services: status.systemProxy.activeServices.join(" · ") })}</p> : null}
        {managementUrl ? <SettingsRow title={t("gateway.siteRouting")} sub={<code className="campus-gateway-monospace">{managementUrl}</code>}
          control={<Btn variant="outline" onClick={() => void openExternal(managementUrl)}>{t("gateway.openSiteRouting")}</Btn>} /> : null}
        <p className="campus-gateway-message">{t("gateway.authorizationScope")}</p>
        {status.capabilities?.trustedMiniPrograms ? <SettingsRow title={t("gateway.prepareClients")} sub={t("gateway.prepareClientsDescription")}
          control={<Btn variant="outline" disabled={disabled || !running} loading={busy === "client-prepare"} onClick={() => void run("client-prepare")}>{t("gateway.prepareClients")}</Btn>} /> : null}
      </div>
      <SettingsRow title={t("gateway.account")} sub={status.account?.account || undefined} value={status.account?.authenticated ? t("gateway.accountReady") : t("gateway.accountPending")} />
      <SettingsRow title={t("gateway.advanced")} sub={t("gateway.advancedDescription")}
        control={<Btn variant="ghost" aria-expanded={advanced} aria-controls="campus-gateway-advanced" onClick={() => { setAdvanced(v => !v); setCredentials(null); }}>{advanced ? t("gateway.collapse") : t("gateway.expand")}</Btn>} />
      {advanced ? <div id="campus-gateway-advanced" className="campus-gateway-advanced">
        <SettingsRow title={t("gateway.browserTitle")} sub={t("gateway.browserDescription")}
          control={<Btn variant="outline" disabled={disabled || !running} loading={busy === "open-browser"} onClick={() => void run("open-browser")}>{busy === "open-browser" ? t("gateway.browserOpening") : t("gateway.openBrowser")}</Btn>} />
        <p className="campus-gateway-message">{t("gateway.platformScope")}</p>
        {status.certificate?.fingerprint ? <p className="campus-gateway-message campus-gateway-monospace">{t("gateway.fingerprint", { fingerprint: status.certificate.fingerprint })}</p> : null}
        {status.allowedOrigins?.length ? <p className="campus-gateway-message campus-gateway-monospace">{t("gateway.origins", { origins: status.allowedOrigins.join(" · ") })}</p> : null}
        <SettingsRow title={t("gateway.credentials")} sub={<>{t("gateway.credentialsDescription")}{manualEndpoint ? <><br /><span className="campus-gateway-monospace">{manualEndpoint}</span></> : null}</>}
          control={<Btn variant="ghost" disabled={disabled || !running} loading={busy === "credentials"} onClick={() => credentials ? setCredentials(null) : void run("credentials")}>{busy === "credentials" ? t("gateway.revealing") : credentials ? t("gateway.hideCredentials") : t("gateway.revealCredentials")}</Btn>} />
        {credentials ? <div className="campus-gateway-credentials">
          <label><span>{t("gateway.proxyUsername")}</span><Input value={credentials.username} readOnly autoComplete="off" /></label>
          <label><span>{t("gateway.proxyPassword")}</span><Input value={credentials.password} readOnly autoComplete="off" /></label>
          <Btn variant="outline" disabled={disabled} loading={busy === "copy"} onClick={() => void copyPassword()}>{busy === "copy" ? t("gateway.copying") : t("gateway.copyPassword")}</Btn>
        </div> : null}
      </div> : null}
    </> : null}
  </div>;
}

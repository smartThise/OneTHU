import { Btn, Inline, SettingsRow, Switch } from "@onethu/gui";
import { t, useLocale } from "../i18n/index.js";
import { cliAutoExecuteEnabled, setCliAutoExecute, setMcpServer, subscribeUserExt } from "../state/userext.js";
import { syncCliRuntime, useCliRuntime } from "../state/cliRuntime.js";
import { useEffect, useState, useSyncExternalStore } from "react";
import { changeCliInstallation, refreshCliInstallation, type CliInstallation } from "../lib/sharedRuntime.js";
import { isTauri } from "../lib/transport.js";
import { isAndroidNavigator } from "../lib/androidHost.js";
import { CliTasksSettings } from "./CliTasksSettings.js";
import "./CliTasksSettings.css";

export function CliServerSettings() {
  useLocale();
  const state = useCliRuntime();
  const automatic = useSyncExternalStore(subscribeUserExt, cliAutoExecuteEnabled, () => false);
  const desktop = !isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);
  const [installation,setInstallation]=useState<CliInstallation|null>(null);
  const [busy,setBusy]=useState<"install"|"uninstall"|null>(null),[error,setError]=useState("");
  useEffect(()=>{if(desktop&&isTauri)void refreshCliInstallation().then(setInstallation).catch(()=>setError(t("cli.package.error")));},[desktop]);
  async function manage(action:"install"|"uninstall"){
    if(busy)return;setBusy(action);setError("");
    try{await changeCliInstallation(action);setInstallation(await refreshCliInstallation());await syncCliRuntime();}
    catch(e){const code=/[A-Z][A-Z_]{3,}/.exec(String(e))?.[0];setError(t("cli.package.error")+(code?` · ${code}`:""));}
    finally{setBusy(null);}
  }
  useEffect(() => { void syncCliRuntime(); }, []);
  const message = state.handoffPending ? t("cli.server.handoffPending") : !state.requested ? t("cli.server.off") : !state.authorized ? t("cli.server.authorization")
    : state.phase === "syncing" ? t("cli.server.syncing") : state.reachableNow ? state.background ? t("cli.server.background") : t("cli.server.ready", { endpoint: state.cliEndpoint ?? "http://127.0.0.1:8787/cli/v1" })
    : state.errorCode === "listener-unavailable" ? t("cli.server.portBusy") : state.errorCode === "listener-not-started" ? t("cli.server.desktopOnly") : state.phase === "stopped" ? t("cli.server.stopped") : t("cli.server.error");
  return <>
    {desktop ? <SettingsRow id="row-cli-package" title={t("cli.package.title")}
      sub={error|| (busy?(busy==="install"?t("cli.package.installing"):t("cli.package.removing")):installation?.available?t("cli.package.installed",{version:installation.version??""}):installation?.installed?t("cli.package.upgrade"):t("cli.package.description"))}
      control={<Inline gap={2}>
        {installation?.installed?<Btn variant="ghost" disabled={!!busy} onClick={()=>void manage("uninstall")}>{t("cli.package.uninstall")}</Btn>:null}
        <Btn variant="outline" disabled={!!busy||!isTauri} onClick={()=>void manage("install")}>{(installation?.available?t("cli.package.repair"):installation?.installed?t("cli.package.update"):t("cli.package.install"))}</Btn>
      </Inline>}/> : <SettingsRow title="OH" sub={t("cli.package.mobile")}/>}
    {desktop?<SettingsRow id="row-oh-mcp-server" title={t("cli.package.external")} sub={message} control={<Inline gap={2}>
    {(state.requested || state.handoffPending) && !state.reachableNow && state.phase !== "syncing" ? <Btn variant="ghost" onClick={() => void syncCliRuntime()}>{t("cli.server.retry")}</Btn> : null}
    <Switch checked={state.requested} aria-label="OneTHU CLI" onChange={setMcpServer}/>
  </Inline>}/>:null}
    {desktop ? <SettingsRow id="row-cli-auto-execute" title={t("cli.auto.title")}
      sub={automatic ? t("cli.auto.enabled") : t("cli.auto.description")}
      control={<Switch checked={automatic} aria-label={t("cli.auto.title")}
        disabled={!automatic && (!state.requested || !state.authorized)} onChange={setCliAutoExecute}/>}/> : null}
    {state.authorized ? <CliTasksSettings/> : null}
  </>;
}

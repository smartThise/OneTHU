import { useState } from "react";
import { Btn, Card, Input, Stack, Text, SettingsRow } from "@onethu/gui";
import { ExperienceModeControl } from "./SimpleExperience.js";
import { OhModelSourceCard } from "./OhModelSourceCard.js";
import { ImSettingsSection } from "./ImSettingsSection.js";
import { YktQrPanel, saveYuketang } from "./ExtHwLoginModal.js";
import { getPlugin, updatePlugin } from "../plugins/registry.js";
import { showToast } from "../state/toast.js";
import { useApp } from "../state/context.js";
import { replayOnboarding } from "./OnboardingTour.js";
import { t as i18n } from "../i18n/index.js";


export function OptionalConnections() {
 const [qr,setQr]=useState(false);
 return <Stack gap={3}>
 <Card><SettingsRow title={i18n("auto.components.SimpleSettings.1")} sub={i18n("auto.components.SimpleSettings.2")} control={<Btn variant="outline" onClick={()=>setQr(true)}>{i18n("auto.components.SimpleSettings.3")}</Btn>}/>
 {qr?<YktQrPanel onCancel={()=>setQr(false)} onSuccess={cookie=>{void saveYuketang(cookie).then(()=>{setQr(false);showToast(i18n("auto.components.SimpleSettings.msg1"));}).catch(e=>showToast(String(e)));}}/>:null}</Card>
 <ImSettingsSection tier="basic"/>
 </Stack>;
}
export function SimpleSettings() {
 const { user, logout }=useApp();
 const initial=getPlugin("onethu.harness")?.settings??{};
 const [baseUrl,setBaseUrl]=useState(String(initial.baseUrl??""));
 const [apiKey,setApiKey]=useState(String(initial.apiKey??""));
 const [model,setModel]=useState(String(initial.model??""));
 return <div className="simple-settings"><Stack gap={4}>
 <ExperienceModeControl/>
 <OhModelSourceCard/>
 <Card><SettingsRow title={i18n("auto.components.SimpleSettings.4")} sub={i18n("auto.components.SimpleSettings.5")} control={<Btn variant="outline" onClick={replayOnboarding}>{i18n("auto.components.SimpleSettings.6")}</Btn>}/>
 <SettingsRow title={i18n("auto.components.SimpleSettings.7")} sub={user?.displayName??"已登录"} control={<Btn variant="ghost" onClick={()=>void logout()}>{i18n("auto.components.SimpleSettings.8")}</Btn>}/></Card>
 <Card><Stack gap={3}><Text slot="title">{i18n("auto.components.SimpleSettings.9")}</Text>
 <Input aria-label={i18n("auto.components.SimpleSettings.10")} placeholder={i18n("auto.components.SimpleSettings.11")} value={baseUrl} onChange={setBaseUrl}/>
 <Input aria-label="API Key" placeholder="API Key" type="password" value={apiKey} onChange={setApiKey}/>
 <Input aria-label={i18n("auto.components.SimpleSettings.12")} placeholder={i18n("auto.components.SimpleSettings.12")} value={model} onChange={setModel}/>
 <Btn variant="solid" onClick={()=>{
 const plugin=getPlugin("onethu.harness"); if(!plugin){showToast(i18n("auto.components.SimpleSettings.msg2"));return;}
 try{const u=new URL(baseUrl);if(!["https:","http:"].includes(u.protocol))throw new Error();}catch{showToast(i18n("auto.components.SimpleSettings.msg3"));return;}
 if(!apiKey.trim()||!model.trim()){showToast(i18n("auto.components.SimpleSettings.msg4"));return;}
 updatePlugin("onethu.harness",{settings:{...plugin.settings,provider:"custom",baseUrl:baseUrl.trim(),apiKey:apiKey.trim(),model:model.trim()}});showToast(i18n("auto.components.SimpleSettings.msg5"));
 }}>{i18n("auto.components.SimpleSettings.13")}</Btn></Stack></Card>
 <OptionalConnections/>
 </Stack></div>;
}

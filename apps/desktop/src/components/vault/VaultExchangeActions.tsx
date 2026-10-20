import { useRef, useState } from "react";
import { Btn, Modal, Stack, Text } from "@onethu/gui";
import { QRCodeSVG } from "qrcode.react";
import { useVaultReceive } from "../../lib/useVaultReceive.js";
import { useNfcExchange } from "../../lib/useNfcExchange.js";
import { shareCodeForBox, revokeShare, type VaultSharePayload } from "../../state/vaultShare.js";
import { openTab } from "../../state/explorer.js";
import type { VaultBox } from "../../state/vault.js";
import { showToast } from "../../state/toast.js";
import { t as i18n } from "../../i18n/index.js";


/** One send/receive surface for radar, drawer and full page. */
export function VaultExchangeActions({box}:{box:VaultBox}){
 const receive=useVaultReceive(),nfc=useNfcExchange();
 const [view,setView]=useState<"send"|"receive"|null>(null),[code,setCode]=useState(""),[payload,setPayload]=useState<VaultSharePayload|null>(null),[working,setWorking]=useState(false);
 const [error,setError]=useState("");
 const pending=useRef(false);const busy=working||receive.busy||nfc.busy;
 async function share(){if(pending.current)return;pending.current=true;setWorking(true);setError("");setView("send");setCode("");setPayload(null);try{const r=await shareCodeForBox(box);setCode(r.code);setPayload(r.payload);await navigator.clipboard.writeText(r.code).then(()=>showToast(i18n("auto.components.vault.VaultExchangeActions.msg1"))).catch(()=>undefined);}catch(e){const message=e instanceof Error?e.message:String(e);setError(message);showToast(message);}finally{pending.current=false;setWorking(false);}}
 return <><div className="vault-exchange-actions"><Btn variant="solid" size="sm" disabled={busy||!box.items.length} onClick={()=>void share()}>{working?"正在生成…":"分享口令"}</Btn><Btn variant="outline" size="sm" disabled={busy} onClick={()=>setView("receive")}>{i18n("auto.components.vault.VaultExchangeActions.1")}</Btn></div>
 <Modal open={view!==null} onClose={()=>setView(null)} title={view==="send"?`分享「${box.name}」`:"接收内容"} size="sm">
 <Stack gap={3}>{error && view==="send"?<><div role="alert"><Text>{error}</Text></div><Btn variant="outline" onClick={()=>{setView(null);openTab("cloud");}}>{i18n("auto.components.vault.VaultExchangeActions.2")}</Btn></>:null}{view==="send"?<>
 {working?<Text>{i18n("auto.components.vault.VaultExchangeActions.3")}</Text>:code?<><code className="vault-share-code">{code}</code><div className="vault-qr"><QRCodeSVG value={code} size={200}/></div><div className="name-card-actions"><Btn variant="outline" onClick={()=>void navigator.clipboard.writeText(code).then(()=>showToast(i18n("auto.components.vault.VaultExchangeActions.msg2"))).catch(()=>showToast(i18n("auto.components.vault.VaultExchangeActions.msg3")))}>{i18n("auto.components.vault.VaultExchangeActions.4")}</Btn><Btn variant="outline" disabled={!nfc.available||busy} onClick={()=>void nfc.send(()=>code)}>{i18n("auto.components.vault.VaultExchangeActions.5")}</Btn>{payload?.cloud?.shareToken?<Btn variant="ghost" tone="error" disabled={busy} onClick={()=>{setWorking(true);void revokeShare(payload).then(ok=>{if(ok){setCode("");setView(null);showToast(i18n("auto.components.vault.VaultExchangeActions.msg4"));}else showToast(i18n("auto.components.vault.VaultExchangeActions.msg5"));}).catch(e=>showToast(String(e))).finally(()=>setWorking(false));}}>{i18n("auto.components.vault.VaultExchangeActions.6")}</Btn>:null}</div></>:<Btn variant="outline" disabled={busy} onClick={()=>void share()}>{i18n("auto.components.vault.VaultExchangeActions.7")}</Btn>}
 </>:<div className="name-card-actions"><Btn variant="solid" disabled={busy} onClick={()=>void receive.paste()}>{i18n("auto.components.vault.VaultExchangeActions.8")}</Btn><Btn variant="outline" disabled={busy} onClick={()=>void receive.scan()}>{i18n("auto.components.vault.VaultExchangeActions.9")}</Btn><Btn variant="outline" disabled={!nfc.available||busy} onClick={()=>void nfc.receive()}>{i18n("auto.components.vault.VaultExchangeActions.10")}</Btn></div>}
 <Text slot="micro" tone="faint">{nfc.hint}</Text><Text slot="micro" tone="faint">{i18n("auto.components.vault.VaultExchangeActions.11")}</Text>
 </Stack></Modal>{nfc.feedback}</>;
}

// SPDX-License-Identifier: Apache-2.0
import { useEffect,useState } from "react";
import { authManager } from "../lib/auth/authManager";
import { useT } from "../lib/i18n";
export function ExternalSharingSettings({organizationId}:{organizationId:string}){
 const t=useT();
 const [mode,setMode]=useState<"on"|"off"|"domains">("on"); const [domains,setDomains]=useState("");
 const [loaded,setLoaded]=useState(false);
 const [busy,setBusy]=useState(true); const [message,setMessage]=useState("");
 useEffect(()=>{let live=true;setLoaded(false);setBusy(true);void authManager.api.getExternalSharing(organizationId).then(policy=>{if(live){setLoaded(true);setMode(policy.mode);setDomains(policy.domains.join(", "));}}).catch(()=>{if(live)setMessage(t("Couldn't load sharing settings. Reopen this page to try again."));}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};},[organizationId]);
 return <section className="security-settings-section"><h3>{t("External sharing")}</h3><p>{t("Choose how this vault can be shared with people outside your team.")}</p>
 <label>{t("Sharing")} <select aria-label={t("External sharing")} value={mode} disabled={busy||!loaded} onChange={event=>setMode(event.target.value as typeof mode)}><option value="on">{t("Allow")}</option><option value="domains">{t("Only allowed email domains")}</option><option value="off">{t("Do not allow")}</option></select></label>
 {mode==="domains"&&<label>{t("Allowed email domains")} <input aria-label={t("Allowed email domains")} value={domains} onChange={event=>setDomains(event.target.value)} placeholder="example.com, partner.com" /></label>}
 {mode!=="on"&&<p>{t("Public links stop opening. Existing guests keep their shared items until you remove their access.")}</p>}
 {mode==="domains"&&<p>{t("Guests must use a verified email from an allowed domain. On servers without email, use a verified Google account.")}</p>}
 <button className="primary" disabled={busy||!loaded} onClick={async()=>{setBusy(true);setMessage("");try{const saved=await authManager.api.setExternalSharing(organizationId,{mode,domains:domains.split(/[,\s]+/).filter(Boolean)});setMode(saved.mode);setDomains(saved.domains.join(", "));setMessage(t("Sharing settings saved."));}catch{setMessage(t("Couldn't save. Check the email domains and your connection, then try again."));}finally{setBusy(false);}}}>{t("Save sharing settings")}</button>
 {message&&<p role="status">{message}</p>}</section>;
}

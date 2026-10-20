// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { authManager } from "../lib/auth/authManager";
import { useT } from "../lib/i18n";
import type { ExternalAccessCounts,ExternalRevocation } from "../lib/api";
export function RevokeExternalAccess({organizationId}:{organizationId:string}){
 const t=useT();
 const [preview,setPreview]=useState<ExternalAccessCounts|null>(null);
 const [result,setResult]=useState<ExternalRevocation|null>(null);
 const [operationId,setOperationId]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 const run=async()=>{
  const id=operationId??crypto.randomUUID();setOperationId(id);setBusy(true);setError("");
  try{setResult(await authManager.api.revokeExternalAccess(organizationId,id));setPreview(null);}
  catch{setError(t("Couldn't finish removing access. Try again to check and finish this request."));}
  finally{setBusy(false);}
 };
 return <section className="security-settings-section"><h3>{t("Remove all external access")}</h3><p>{t("Remove every guest, pending guest invitation, public link, and guest AI connection from this vault.")}</p>
 {!preview&&!result&&!operationId&&<button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{setPreview(await authManager.api.externalAccessPreview(organizationId));}catch{setError(t("Couldn't load the people and links. Check your connection and try again."));}finally{setBusy(false);}}}>{t("Review external access")}</button>}
 {preview&&<div role="group" aria-label={t("Confirm removal")}><p>{t("{guests} guests · {invitations} invitations · {publicLinks} public links · {aiConnections} AI connections",{guests:preview.guests,invitations:preview.invitations,publicLinks:preview.publicLinks,aiConnections:preview.aiConnections})}</p><p>{t("Already downloaded content cannot be taken back. Download links already issued may stay open for up to 5 minutes.")}</p><button className="primary danger" disabled={busy} onClick={()=>void run()}>{t("Remove all external access")}</button><button className="link-btn" disabled={busy} onClick={()=>setPreview(null)}>{t("Cancel")}</button></div>}
 {busy&&operationId&&<p role="status">{t("Removing external access…")}</p>}
 {result&&<p role="status">{result.status==="completed"?t("External access removed."):result.status==="partial"?t("Some access couldn't be removed. Try again to finish."):t("Removing external access…")}</p>}
 {(result?.status==="partial"||(!preview&&operationId&&!result))&&<button className="primary" disabled={busy} onClick={()=>void run()}>{t("Try again")}</button>}
 {result?.status==="completed"&&<button className="link-btn" onClick={()=>{setResult(null);setOperationId(null);}}>{t("Done")}</button>}
 {error&&<p role="alert">{error}</p>}</section>;
}

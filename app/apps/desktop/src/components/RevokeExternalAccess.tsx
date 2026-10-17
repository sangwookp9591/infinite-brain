// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { authManager } from "../lib/auth/authManager";
import type { ExternalAccessCounts,ExternalRevocation } from "../lib/api";
export function RevokeExternalAccess({organizationId}:{organizationId:string}){
 const [preview,setPreview]=useState<ExternalAccessCounts|null>(null);
 const [result,setResult]=useState<ExternalRevocation|null>(null);
 const [operationId,setOperationId]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 const run=async()=>{
  const id=operationId??crypto.randomUUID();setOperationId(id);setBusy(true);setError("");
  try{setResult(await authManager.api.revokeExternalAccess(organizationId,id));setPreview(null);}
  catch{setError("Couldn't finish removing access. Try again to check and finish this request.");}
  finally{setBusy(false);}
 };
 return <section className="security-settings-section"><h3>Remove all external access</h3><p>Remove every guest, pending guest invitation, public link, and guest AI connection from this vault.</p>
 {!preview&&!result&&!operationId&&<button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{setPreview(await authManager.api.externalAccessPreview(organizationId));}catch{setError("Couldn't load the people and links. Check your connection and try again.");}finally{setBusy(false);}}}>Review external access</button>}
 {preview&&<div role="group" aria-label="Confirm removal"><p>{preview.guests} guests · {preview.invitations} invitations · {preview.publicLinks} public links · {preview.aiConnections} AI connections</p><p>Already downloaded content cannot be taken back. Download links already issued may stay open for up to 5 minutes.</p><button className="primary danger" disabled={busy} onClick={()=>void run()}>Remove all external access</button><button className="link-btn" disabled={busy} onClick={()=>setPreview(null)}>Cancel</button></div>}
 {result&&<p role="status">{result.status==="completed"?"External access removed.":result.status==="partial"?"Some access couldn't be removed. Try again to finish.":"Removing external access…"}</p>}
 {(result?.status==="partial"||(!preview&&operationId&&!result))&&<button className="primary" disabled={busy} onClick={()=>void run()}>Try again</button>}
 {result?.status==="completed"&&<button className="link-btn" onClick={()=>{setResult(null);setOperationId(null);}}>Done</button>}
 {error&&<p role="alert">{error}</p>}</section>;
}

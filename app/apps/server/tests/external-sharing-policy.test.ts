// SPDX-License-Identifier: Apache-2.0
import { afterAll,beforeEach,expect,it } from "vitest";
import { createApp } from "../src/http/app.js";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { authHeaders } from "./helpers/auth.js";
import { recordingAppDeps } from "./helpers/app.js";
import { requireExternalSharing } from "../src/permissions/external-sharing.js";
const app=createApp(recordingAppDeps().deps); let f:Awaited<ReturnType<typeof guestFixture>>;
beforeEach(async()=>{f=await guestFixture();});afterAll(()=>pool.end());
const policy=(mode:string,domains:string[]=[])=>app.request(`/api/orgs/${f.org}/external-sharing`,{method:"PUT",headers:authHeaders(f.owner),body:JSON.stringify({mode,domains})});
const share=()=>app.request("/api/shares",{method:"POST",headers:authHeaders(f.owner),body:JSON.stringify({resourceType:"file",resourceId:f.visible,principalId:f.guest.userId,permission:"view"})});
it("off refuses guest invites, guest shares and public links",async()=>{
 expect((await policy("off")).status).toBe(200);
 expect((await share()).status).toBe(403);
 expect((await app.request(`/api/notes/${f.visible}/public-link`,{method:"POST",headers:authHeaders(f.owner)})).status).toBe(403);
 const invite=await app.request(`/api/orgs/${f.org}/invitations`,{method:"POST",headers:authHeaders(f.owner),body:JSON.stringify({emails:[f.external.email],role:"guest",targets:[{resourceType:"folder",resourceId:f.shared,permission:"view"}]})});
 expect(JSON.stringify(await invite.json())).toContain("external_sharing_blocked");
});
it("domains accepts only verified allowed domains",async()=>{
 await policy("domains",["guest.test"]);
 expect((await share()).status).toBe(403);
 await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1',[f.guest.userId]);
 expect((await share()).status).toBe(201);
 await pool.query('UPDATE "user" SET email=\'changed@elsewhere.test\' WHERE id=$1',[f.guest.userId]);
 expect((await share()).status).toBe(403);
});
it("domains refuses anonymous public links",async()=>{
 const created=await app.request(`/api/notes/${f.visible}/public-link`,{method:"POST",headers:authHeaders(f.owner)});expect(created.status).toBe(201);
 const token=(await created.json() as any).token;
 await policy("domains",["guest.test"]);
 expect((await app.request(`/p/${token}`)).status).toBe(404);
 expect((await app.request(`/p/${token}/a/image.png`)).status).toBe(404);
});
it("policy precedence is identical on every join path",async()=>{
 await policy("off");
 for(const kind of ["invite","accept","share","public"] as const) await expect(requireExternalSharing(f.org,kind,{email:"unverified@elsewhere.test",verified:false})).rejects.toMatchObject({code:"external_sharing_blocked"});
 await policy("domains",["guest.test"]);
 await expect(requireExternalSharing(f.org,"accept",{email:"guest@guest.test",verified:false})).rejects.toMatchObject({code:"email_verification_required"});
});
it("policy settings require managers and carry CORS headers",async()=>{
 expect((await app.request(`/api/orgs/${f.org}/external-sharing`,{headers:authHeaders(f.member)})).status).toBe(403);
 const headers={...authHeaders(f.owner),origin:"tauri://localhost"};
 const response=await app.request(`/api/orgs/${f.org}/external-sharing`,{headers});
 expect(response.status).toBe(200);expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
});

// SPDX-License-Identifier: Apache-2.0
import { afterAll,beforeEach,expect,it } from "vitest";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { seedShare } from "./helpers/seed.js";
import { createApp } from "../src/http/app.js";
import { authHeaders } from "./helpers/auth.js";
import { recordingAppDeps } from "./helpers/app.js";
import { recordVersion } from "../src/versions/capture.js";
import { restoreNote } from "../src/trash/service.js";
let f:Awaited<ReturnType<typeof guestFixture>>;const app=createApp(recordingAppDeps().deps);
beforeEach(async()=>{f=await guestFixture();});afterAll(()=>pool.end());
it("versions redact other authors for guest",async()=>{
 await recordVersion({vaultId:f.vault,docId:f.visible,content:"Saved content",cause:"idle",authorId:f.member.userId});
 const response=await app.request(`/api/notes/${f.visible}/versions`,{headers:authHeaders(f.guest)});expect(response.status).toBe(200);const body=await response.json() as any;
 expect(body.versions).toHaveLength(1);expect(JSON.stringify(body)).not.toContain(f.member.userId);expect(body.versions[0].authorName??body.versions[0].author_name).toBe("Other user");
});
it("guest cannot list vault checkpoints",async()=>{expect((await app.request(`/api/vaults/${f.vault}/checkpoints`,{headers:authHeaders(f.guest)})).status).toBe(403);});
it("guest restore never recreates folders outside scope",async()=>{
 await seedShare(f.org,"file",f.hidden,f.guest.userId,"edit");
 await pool.query("UPDATE notes SET deleted_at=now(),purge_after=now()+interval '30 days' WHERE id=$1",[f.hidden]);
 await expect(restoreNote(f.guest.userId,f.hidden)).rejects.toMatchObject({status:409,code:"guest_restore_outside_scope"});
 expect((await pool.query("SELECT deleted_at FROM notes WHERE id=$1",[f.hidden])).rows[0].deleted_at).not.toBeNull();
});
it("shrink events are scoped for guest",async()=>{
 for(const docId of [f.visible,f.hidden])await recordVersion({vaultId:f.vault,docId,content:"Before shrinking",cause:"pre-shrink",authorId:f.member.userId});
 const result=await app.request(`/api/vaults/${f.vault}/shrink-events`,{headers:authHeaders(f.guest)});expect(result.status).toBe(200);const body=JSON.stringify(await result.json());expect(body).toContain(f.visible);expect(body).not.toContain(f.hidden);
});
it("AI change history follows guest scope and hides attribution across active vaults",async()=>{
 const {recordAiChange}=await import("../src/ai-changes/store.js");
 for(const doc of [f.visible,f.hidden])await recordAiChange(f.vault,doc,{auth:{userId:f.member.userId,organizationId:f.org,connection:{kind:"token",id:"private-token-id",label:"Private connection name"}},op:"update",beforePath:"Clients/Acme/Shared/visible.md",afterPath:"Clients/Acme/Shared/visible.md",beforeTitle:"Clients/Acme/Shared/visible.md",afterTitle:"Clients/Acme/Shared/visible.md"},"before","after");
 const response=await app.request(`/api/vaults/${f.vault}/ai-changes`,{headers:authHeaders(f.guest)});expect(response.status).toBe(200);const body=await response.json() as any;
 expect(body.items).toHaveLength(1);expect(body.items[0].doc_id).toBe(f.visible);for(const secret of [f.member.userId,"Clients/Acme","Private connection name"])expect(JSON.stringify(body)).not.toContain(secret);
 const {seedOrg,seedMember}=await import("./helpers/seed.js");const team=await seedOrg("Other team","other-team");await seedMember(team,f.guest.userId,"member");
 expect((await app.request("/api/auth/organization/set-active",{method:"POST",headers:authHeaders(f.guest),body:JSON.stringify({organizationId:team})})).status).toBe(200);
 const detail=await app.request(`/api/ai-changes/${body.items[0].id}`,{headers:authHeaders(f.guest)});expect(detail.status).toBe(200);const detailBody=JSON.stringify(await detail.json());
 for(const secret of [f.member.userId,"Clients/Acme","Private connection name"])expect(detailBody).not.toContain(secret);
 const hidden=(await pool.query("SELECT id FROM ai_change_ledger WHERE doc_id=$1",[f.hidden])).rows[0].id;
 expect((await app.request(`/api/ai-changes/${hidden}`,{headers:authHeaders(f.guest)})).status).toBe(404);
});
it("guest can push into a trashed shared note within the window only",async()=>{
 const {syncPermission}=await import("../src/trash/access.js");
 await pool.query("UPDATE notes SET deleted_at=now(),purge_after=now()+interval '30 days' WHERE id=ANY($1::text[])",[[f.visible,f.hidden]]);
 expect(await syncPermission(f.guest.userId,f.visible)).toBe("edit");expect(await syncPermission(f.guest.userId,f.hidden)).toBe("none");
 await pool.query("UPDATE notes SET purge_after=now()-interval '1 second' WHERE id=$1",[f.visible]);expect(await syncPermission(f.guest.userId,f.visible)).toBe("none");
});

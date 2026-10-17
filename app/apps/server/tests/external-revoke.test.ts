// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { afterAll,beforeEach,expect,it } from "vitest";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { recordingAppDeps } from "./helpers/app.js";
import { createApp } from "../src/http/app.js";
import { authHeaders } from "./helpers/auth.js";
import { createGuestInvitation } from "../src/members/guest-invitations.js";
import { externalAccessPreview,revokeExternalAccess } from "../src/permissions/external-revoke.js";
import { auditContext } from "../src/audit/log.js";
let f:Awaited<ReturnType<typeof guestFixture>>;
const recording=recordingAppDeps(); const deps={...recording.deps,billingProvider:undefined};
beforeEach(async()=>{f=await guestFixture();recording.reset();});afterAll(()=>pool.end());
async function seed(){
 const invitation=await createGuestInvitation(f.org,f.owner.userId,f.external.email,[{resourceType:"folder",resourceId:f.shared,permission:"view"}]);
 await pool.query("INSERT INTO public_links (id,org_id,doc_id,token,created_by,vault_id) VALUES ($1,$2,$3,$4,$5,$6)",[randomUUID(),f.org,f.visible,"external-link-token",f.owner.userId,f.vault]);
 await pool.query("INSERT INTO mcp_tokens (id,user_id,organization_id,name,token_hash,token_prefix) VALUES ($1,$2,$3,'legacy','hash','mcp_old')",[randomUUID(),f.guest.userId,f.org]);
 return invitation;
}
it("revokes guests, invites, public links and guest MCP tokens",async()=>{
 const invitation=await seed();expect(await externalAccessPreview(f.org)).toMatchObject({guests:1,invitations:1,publicLinks:1,aiConnections:1});
 const result=await auditContext.run({actorKind:"user",actorUserId:f.owner.userId,requestId:"revoke-test"},()=>revokeExternalAccess(f.org,f.owner.userId,deps));
 expect(result.status).toBe("completed");expect(result.counts).toMatchObject({guests:1,invitations:1,publicLinks:1,aiConnections:1});
 expect(await externalAccessPreview(f.org)).toEqual({guests:0,invitations:0,publicLinks:0,aiConnections:0,bootstrapSessions:0});
 expect((await pool.query("SELECT status FROM invitation WHERE id=$1",[invitation.id])).rows[0].status).toBe("canceled");
 expect((await pool.query("SELECT 1 FROM member WHERE \"organizationId\"=$1 AND \"userId\"=$2",[f.org,f.member.userId])).rowCount).toBe(1);
 expect(recording.disconnected.some(doc=>doc.docId===f.visible)).toBe(true);
 expect((await pool.query("SELECT 1 FROM audit_log WHERE request_id='revoke-test' AND action='external_access.revoke_item'")).rowCount).toBe(3);
});
it("re-running is idempotent",async()=>{
 await seed();const id=randomUUID();const first=await revokeExternalAccess(f.org,f.owner.userId,deps,id);
 const second=await revokeExternalAccess(f.org,f.owner.userId,deps,id);expect(second.counts).toEqual(first.counts);expect(second.errors).toEqual([]);
 const third=await revokeExternalAccess(f.org,f.owner.userId,deps);expect(third.counts).toEqual({});
});
it("partial failure is reported per item",async()=>{
 await seed();const id=randomUUID();const first=await revokeExternalAccess(f.org,f.owner.userId,deps,id,async(type)=>{if(type==="guest")throw new Error("private implementation detail");});
 expect(first.status).toBe("partial");expect(first.errors).toEqual([{type:"guest",id:f.guest.userId,message:"Couldn't remove this access. Try again."}]);
 const retried=await revokeExternalAccess(f.org,f.owner.userId,deps,id);expect(retried.status).toBe("completed");expect(retried.counts).toMatchObject({guests:1,invitations:1,publicLinks:1,aiConnections:1});
});
it("managers confirm revocation and can read its progress",async()=>{
 const app=createApp(recording.deps);const path=`/api/orgs/${f.org}/external-access`;const id=randomUUID();
 expect((await app.request(`${path}/preview`,{headers:authHeaders(f.member)})).status).toBe(403);
 expect((await app.request(`${path}/revoke`,{method:"POST",headers:authHeaders(f.owner),body:JSON.stringify({operationId:id})})).status).toBe(400);
 expect((await app.request(`${path}/revoke`,{method:"POST",headers:authHeaders(f.owner),body:JSON.stringify({operationId:id,confirm:true})})).status).toBe(200);
 expect((await app.request(`${path}/revoke/${id}`,{headers:authHeaders(f.owner)})).status).toBe(200);
});
it("a guest invitation cannot be accepted across bulk revocation",async()=>{
 const invitation=await seed();const {acceptGuestInvitation}=await import("../src/members/guest-invitations.js");
 let acceptance:Promise<unknown>|undefined;
 await revokeExternalAccess(f.org,f.owner.userId,deps,randomUUID(),async()=>{acceptance??=acceptGuestInvitation(invitation.id,{userId:f.external.userId,email:f.external.email}).catch(error=>error);});
 expect(await acceptance).toMatchObject({code:"invitation_unavailable"});expect((await pool.query('SELECT 1 FROM member WHERE "organizationId"=$1 AND "userId"=$2',[f.org,f.external.userId])).rowCount).toBe(0);
});
it("concurrent guest share waits before membership locks and leaves no orphan",async()=>{
 const app=createApp(recording.deps);let shared:Promise<Response>|undefined;
 const result=await revokeExternalAccess(f.org,f.owner.userId,deps,randomUUID(),async()=>{shared??=app.request("/api/shares",{method:"POST",headers:authHeaders(f.owner),body:JSON.stringify({resourceType:"file",resourceId:f.visible,principalId:f.guest.userId,permission:"edit"})});});
 expect(result.status).toBe("completed");expect((await shared)!.status).toBe(400);expect((await pool.query("SELECT 1 FROM shares WHERE principal_id=$1",[f.guest.userId])).rowCount).toBe(0);
});

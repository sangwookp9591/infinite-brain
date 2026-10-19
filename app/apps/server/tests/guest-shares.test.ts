// SPDX-License-Identifier: Apache-2.0
import { afterAll,beforeEach,expect,it } from "vitest";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { seedNote } from "./helpers/seed.js";
import { createApp } from "../src/http/app.js";
import { authHeaders } from "./helpers/auth.js";
import { recordingAppDeps } from "./helpers/app.js";
let f:Awaited<ReturnType<typeof guestFixture>>;const app=createApp(recordingAppDeps().deps);
beforeEach(async()=>{f=await guestFixture();});afterAll(()=>pool.end());
it("guest creator cannot manage shares",async()=>{
 const own=await seedNote(f.vault,f.shared,"Clients/Acme/Shared/guest.md",f.guest.userId);
 const response=await app.request("/api/shares",{method:"POST",headers:authHeaders(f.guest),body:JSON.stringify({resourceType:"file",resourceId:own,principalId:f.member.userId,permission:"view"})});expect(response.status).toBe(403);
 expect((await app.request(`/api/resolve-access?resourceType=file&resourceId=${own}`,{headers:authHeaders(f.guest)})).status).toBe(403);
});
it("removed creator cannot manage shares",async()=>{
 await pool.query('DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2',[f.org,f.member.userId]);
 expect((await app.request("/api/shares",{method:"POST",headers:authHeaders(f.member),body:JSON.stringify({resourceType:"file",resourceId:f.visible,principalId:f.guest.userId,permission:"view"})})).status).toBe(403);
});
it("resolve-access lists guests with their scope",async()=>{
 const response=await app.request(`/api/resolve-access?resourceType=file&resourceId=${f.visible}`,{headers:authHeaders(f.owner)});expect(response.status).toBe(200);const body=JSON.stringify(await response.json());expect(body).toContain(f.guest.userId);expect(body).toContain("guest");
});

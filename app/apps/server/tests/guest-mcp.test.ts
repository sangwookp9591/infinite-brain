// SPDX-License-Identifier: Apache-2.0
import { afterAll,beforeEach,expect,it } from "vitest";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { createMcpToken,verifyMcpToken } from "../src/mcp/tokens.js";
import { createApp } from "../src/http/app.js";
import { authHeaders } from "./helpers/auth.js";
import { recordingAppDeps } from "./helpers/app.js";
let f:Awaited<ReturnType<typeof guestFixture>>;const app=createApp(recordingAppDeps().deps);
beforeEach(async()=>{f=await guestFixture();});afterAll(()=>pool.end());
it("guest cannot mint an MCP token",async()=>{
 expect((await app.request("/api/mcp/tokens",{method:"POST",headers:authHeaders(f.guest),body:JSON.stringify({organizationId:f.org,name:"Guest"})})).status).toBe(403);
});
it("token of a member demoted to guest stops working",async()=>{
 const {token}=await createMcpToken({userId:f.member.userId,organizationId:f.org},"Existing");expect(await verifyMcpToken(token)).not.toBeNull();
 await pool.query("UPDATE member SET role='guest' WHERE \"organizationId\"=$1 AND \"userId\"=$2",[f.org,f.member.userId]);expect(await verifyMcpToken(token)).toBeNull();
});
it("guest token cannot reach any MCP tool or protocol method",async()=>{
 const {token}=await createMcpToken({userId:f.guest.userId,organizationId:f.org},"Legacy");
 for(const method of ["initialize","tools/list","tools/call"]){const result=await app.request("/api/mcp",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json","accept":"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params:{name:"list_folders",arguments:{vault_id:f.vault}}})});expect([401,403]).toContain(result.status);}
});
it("OAuth consent does not offer guest vaults",async()=>{
 const {auth}=await import("../src/auth/auth.js");const ctx=await auth.$context;
 const {seedOrg,seedMember}=await import("./helpers/seed.js");const team=await seedOrg("Team choice","team-choice");await seedMember(team,f.guest.userId,"member");
 await ctx.internalAdapter.createVerificationValue({identifier:"guest-consent",value:JSON.stringify({clientId:"guest-client",userId:f.guest.userId,requireConsent:true,scope:["notes:read"]}),expiresAt:new Date(Date.now()+60000)});
 const response=await app.request("/oauth/consent?consent_code=guest-consent&client_id=guest-client",{headers:authHeaders(f.guest)});
 expect(response.status).toBe(200);const text=await response.text();expect(text).not.toContain('value="'+f.org+'"');expect(text).not.toContain("Guest vault");expect(text).toContain('value="'+team+'"');
});

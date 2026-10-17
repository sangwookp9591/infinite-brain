// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { authHeaders } from "./helpers/auth.js";
import { recordingAppDeps } from "./helpers/app.js";
import { canEditFolder, canCreateIn, canDeleteItem } from "../src/permissions/http-gates.js";
const app = createApp(recordingAppDeps().deps); let f: Awaited<ReturnType<typeof guestFixture>>;
beforeEach(async () => { f = await guestFixture(); }); afterAll(() => pool.end());
it("guest edits only per-user shared folders", async () => {
  expect(await canEditFolder(f.guest.userId,f.shared)).toBe(true);
  expect(await canEditFolder(f.guest.userId,f.beta)).toBe(false);
});
it("guest cannot create at the vault root", async () => {
  expect(await canCreateIn(f.guest.userId,f.vault,null)).toBe(false);
  const res = await app.request("/api/notes", { method:"POST",headers:authHeaders(f.guest),body:JSON.stringify({ vaultId:f.vault,relPath:"root-new.md" }) });
  expect(res.status).toBe(403);
});
it("guest creates only inside an editable shared folder", async () => {
  const res = await app.request("/api/notes", { method:"POST",headers:authHeaders(f.guest),body:JSON.stringify({ vaultId:f.vault,folderId:f.shared,relPath:"Shared/new.md" }) });
  expect(res.status).toBe(201); const body = await res.json() as any;
  expect(body.rel_path ?? body.relPath).toBe("Shared/new.md");
  expect((await pool.query("SELECT rel_path FROM notes WHERE id=$1", [body.id])).rows[0].rel_path).toBe("Clients/Acme/Shared/new.md");
});
it("guest deletes only own items inside scope", async () => {
  expect((await canDeleteItem(pool,{ orgId:f.org,userId:f.guest.userId,kind:"note",id:f.ownOutside })).ok).toBe(false);
});
it("guest is refused every management route", async () => {
  for (const [method,path,body] of [
    ["GET",`/api/vaults/${f.vault}/access-tree`,null], ["GET",`/api/vaults/${f.vault}/access-board`,null],
    ["GET",`/api/vaults/${f.vault}/checkpoints`,null], ["POST",`/api/mcp/tokens`,{ organizationId:f.org,name:"Guest" }],
    ["PATCH",`/api/folders/${f.shared}`,{ name:"Renamed",path:"Renamed" }],
    ["POST","/api/folders",{ vaultId:f.vault,parentId:f.shared,name:"Child",path:"Shared/Child" }],
    ["PATCH",`/api/notes/${f.visible}`,{ relPath:"Shared/renamed.md" }],
  ] as const) expect((await app.request(path,{method,headers:authHeaders(f.guest),...(body?{body:JSON.stringify(body)}:{})})).status,`${method} ${path}`).toBe(403);
});
it("bulk batches agree with single-item gates for guest",async()=>{
 const {seedNote}=await import("./helpers/seed.js");const own=await seedNote(f.vault,f.shared,"Clients/Acme/Shared/own.md",f.guest.userId);
 const response=await app.request(`/api/vaults/${f.vault}/notes/delete-batch`,{method:"POST",headers:authHeaders(f.guest),body:JSON.stringify({docIds:[own,f.visible,f.ownOutside]})});
 expect(response.status).toBe(200);const body=await response.json() as any;expect(body.results.find((r:any)=>r.docId===own).status).toBe("deleted");
 expect(body.results.filter((r:any)=>r.docId!==own).every((r:any)=>r.status!=="deleted")).toBe(true);
});
it("guest content batches use the same per-note permission",async()=>{
 const response=await app.request(`/api/vaults/${f.vault}/docs/batch`,{method:"POST",headers:authHeaders(f.guest),body:JSON.stringify({items:[]})});expect(response.status).toBe(200);
});
it("guest sync tokens and vault tokens agree with per-note scope",async()=>{
 for(const [doc,status] of [[f.visible,200],[f.hidden,403]] as const){const response=await app.request("/api/sync-token",{method:"POST",headers:authHeaders(f.guest),body:JSON.stringify({docId:doc})});expect(response.status).toBe(status);}
 expect((await app.request("/api/vault-sync-token",{method:"POST",headers:authHeaders(f.guest),body:JSON.stringify({vaultId:f.vault})})).status).toBe(200);
 expect((await app.request("/api/vault-sync-token",{method:"POST",headers:authHeaders(f.external),body:JSON.stringify({vaultId:f.vault})})).status).toBe(403);
});
it("guest adopt cannot expose an unreadable existing note",async()=>{
 const {seedShare}=await import("./helpers/seed.js");await seedShare(f.org,"file",f.visible,f.guest.userId,"denied");
 const response=await app.request("/api/notes",{method:"POST",headers:authHeaders(f.guest),body:JSON.stringify({vaultId:f.vault,folderId:f.shared,relPath:"Shared/visible.md"})});expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:"not_readable"});
});
it("guest registration batches map shared paths without allowing moves",async()=>{
 const path=`/api/vaults/${f.vault}/notes/batch`;
 const request=(items:unknown[])=>app.request(path,{method:"POST",headers:authHeaders(f.guest),body:JSON.stringify({items})});
 const created=await request([{relPath:"Shared/batch-new.md",folderPath:"Shared"}]);expect(created.status,await created.clone().text()).toBe(200);const body=await created.json() as any;expect(body.results[0].status,JSON.stringify(body)).toBe("created");expect(body.results[0].relPath).toBe("Shared/batch-new.md");
 expect((await request([{docId:f.visible,relPath:"Shared/moved.md",folderPath:"Shared"}])).status).toBe(403);
 expect((await request([{relPath:"Beta/not-allowed.md",folderPath:"Beta"}])).status).toBe(403);
});

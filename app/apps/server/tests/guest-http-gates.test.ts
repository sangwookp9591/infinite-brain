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

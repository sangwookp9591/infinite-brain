// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { authHeaders } from "./helpers/auth.js";
import { recordingAppDeps } from "./helpers/app.js";
import { seedVault } from "./helpers/seed.js";
const app = createApp(recordingAppDeps().deps); let f: Awaited<ReturnType<typeof guestFixture>>;
beforeEach(async () => { f = await guestFixture(); }); afterAll(() => pool.end());
const get = (path: string) => app.request(path, { headers: authHeaders(f.guest) });
it("guest folder tree omits ancestor names", async () => {
  const res = await get(`/api/folders?vaultId=${f.vault}`); expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.folders.map((row: any) => [row.id,row.path,row.parent_id])).toEqual([[f.shared,"Shared",null]]);
  for (const name of ["Clients", "Acme", "Beta"]) expect(JSON.stringify(body)).not.toContain(name);
});
it("notes listing redacts other people for guest", async () => {
  const body = await (await get(`/api/notes?vaultId=${f.vault}`)).json() as any;
  expect(body.notes.map((row: any) => row.id)).toEqual([f.visible]);
  expect(body.notes[0].rel_path).toBe("Shared/visible.md");
  for (const secret of ["Clients", "Acme", "Beta", f.member.userId, f.member.email]) expect(JSON.stringify(body)).not.toContain(secret);
  expect(body.canCreateRoot).toBe(false);
});
it("GET /vaults hides collections without guest scope", async () => {
  const hiddenVault = await seedVault(f.org, "Hidden collection");
  const body = await (await get("/api/vaults")).json() as any;
  expect(body.vaults.map((row: any) => row.id)).toEqual([f.vault]);
  expect(JSON.stringify(body)).not.toContain(hiddenVault);
});
it("guest cannot read vault storage usage", async () => {
  expect((await get(`/api/vaults/${f.vault}/storage`)).status).toBe(403);
});
it("registry cursors are opaque and scoped to the guest", async () => {
  const first = await get(`/api/notes?vaultId=${f.vault}&limit=1`);
  const body = await first.json() as any;
  expect(first.status).toBe(200);
  if (body.nextAfter) {
    expect(body.nextAfter).not.toContain("Clients");
    const next = await get(`/api/notes?vaultId=${f.vault}&limit=1&after=${encodeURIComponent(body.nextAfter)}`);
    expect(next.status).toBe(200);
  }
  expect((await get(`/api/notes?vaultId=${f.vault}&limit=1&after=Clients%2FAcme`)).status).toBe(400);
});

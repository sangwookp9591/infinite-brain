// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, expect, it } from "vitest";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { effectivePermission, createResolverCache, buildAccessContext, loadAccessIndex, resolveAccessForUser } from "../src/permissions/resolver.js";
import { listReadableDocsInVault, vaultAccess } from "../src/permissions/vault-docs.js";
import { seedShare, seedUserVaultGrant, seedMember } from "./helpers/seed.js";
let f: Awaited<ReturnType<typeof guestFixture>>;
beforeEach(async () => { f = await guestFixture(); }); afterAll(() => pool.end());
it("guest gets only per-user folder/file grants", async () => {
  expect(await effectivePermission(f.guest.userId, f.visible)).toBe("edit");
  for (const id of [f.hidden, f.root, f.ownOutside]) expect(await effectivePermission(f.guest.userId, id)).toBe("none");
  expect(await listReadableDocsInVault(f.guest.userId, f.vault)).toEqual(new Set([f.visible]));
});
it("guest ignores org posture, join snapshot and org item shares", async () => {
  await seedUserVaultGrant(f.org, f.guest.userId, "edit");
  await pool.query("INSERT INTO member_access_snapshots (organization_id,user_id,mode,access_revision,snapshot_at) VALUES ($1,$2,'open',0,now())", [f.org, f.guest.userId]);
  expect(await effectivePermission(f.guest.userId, f.hidden)).toBe("none");
  expect((await vaultAccess(pool, f.guest.userId, f.vault))?.vaultWide).toBe(false);
  expect(await listReadableDocsInVault(f.guest.userId, f.vault)).toEqual(new Set([f.visible]));
});
it("guest keeps no creator edit after moving a note out of scope", async () => {
  await pool.query("UPDATE notes SET created_by=$1,folder_id=$2,rel_path='Clients/Beta/moved.md' WHERE id=$3", [f.guest.userId, f.beta, f.visible]);
  expect(await effectivePermission(f.guest.userId, f.visible)).toBe("none");
});
it("external with a per-user share resolves none", async () => {
  await seedShare(f.org, "file", f.visible, f.external.userId, "edit");
  expect(await effectivePermission(f.external.userId, f.visible)).toBe("none");
});
it("cache and reference agree for a guest", async () => {
  const cache = createResolverCache(); await cache.prefetch(pool, [f.visible, f.hidden, f.ownOutside]);
  const index = await loadAccessIndex(pool, f.org);
  for (const id of [f.visible, f.hidden, f.ownOutside]) {
    const expected = await effectivePermission(f.guest.userId, id);
    expect(await effectivePermission(f.guest.userId, id, pool, cache)).toBe(expected);
    const context = await buildAccessContext("file", id);
    expect((await resolveAccessForUser(context!, f.guest.userId, "guest", pool, undefined, index)).permission).toBe(expected);
  }
});
it("inserting a guest member writes no join snapshot", async () => {
  expect((await pool.query("SELECT * FROM member_access_snapshots WHERE user_id=$1", [f.guest.userId])).rowCount).toBe(0);
});
it("guest is never vault-wide and deleted readable set only covers shared scope",async()=>{
 const {listDeletedReadableDocsInVault}=await import("../src/permissions/vault-docs.js");
 await pool.query("UPDATE notes SET deleted_at=now() WHERE vault_id=$1",[f.vault]);
 expect(await listDeletedReadableDocsInVault(f.guest.userId,f.vault)).toEqual(new Set([f.visible]));
 expect((await vaultAccess(pool,f.guest.userId,f.vault))?.vaultWide).toBe(false);
});
it("readable set equals resolver for every doc (guest), including denies and locks",async()=>{
 const {seedLock}=await import("./helpers/seed.js");await seedLock(f.org,"file",f.visible,{type:"org"});
 expect(await effectivePermission(f.guest.userId,f.visible)).toBe("view");
 const readable=await listReadableDocsInVault(f.guest.userId,f.vault);
 for(const id of [f.visible,f.hidden,f.root,f.ownOutside])expect(readable.has(id)).toBe((await effectivePermission(f.guest.userId,id))!=="none");
 await seedShare(f.org,"file",f.visible,f.guest.userId,"denied");expect(await effectivePermission(f.guest.userId,f.visible)).toBe("none");expect(await listReadableDocsInVault(f.guest.userId,f.vault)).toEqual(new Set());
});

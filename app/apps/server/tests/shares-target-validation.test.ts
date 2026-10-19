// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { pool, resetDb } from "./helpers/db.js";
import { recordingAppDeps } from "./helpers/app.js";
import { authHeaders, createOrg, signUp, type TestUser } from "./helpers/auth.js";
import { seedMember, seedNote, seedOrg, seedVault } from "./helpers/seed.js";

const app = createApp(recordingAppDeps().deps);
let owner: TestUser;
let outsider: TestUser;
let orgId: string;
let docId: string;
beforeEach(async () => {
  await resetDb();
  owner = await signUp("owner@targets.test");
  outsider = await signUp("outsider@targets.test");
  orgId = (await createOrg(owner, "Targets", "targets")).id;
  docId = await seedNote(await seedVault(orgId), null, "note.md", owner.userId);
});
afterAll(() => pool.end());
async function post(principalId: string, permission = "edit", resourceType = "file", resourceId = docId) {
  return app.request("/api/shares", { method: "POST", headers: authHeaders(owner), body: JSON.stringify({ resourceType, resourceId, principalId, permission }) });
}
it("rejects a principal that is not a member of the resource's vault", async () => {
  for (const permission of ["view", "edit", "locked", "denied"]) {
    const res = await post(outsider.userId, permission);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "share_target_not_member" });
  }
});
it("rejects a principal id that does not exist", async () => {
  expect((await post("does-not-exist")).status).toBe(400);
});
it("rejects a member of a different vault even when the caller's active vault matches", async () => {
  await seedMember(await seedOrg("Other", "other"), outsider.userId, "member");
  expect((await post(outsider.userId)).status).toBe(400);
});
it("rejects a vault-level row for a guest", async () => {
  await seedMember(orgId, outsider.userId, "member");
  await pool.query('UPDATE member SET role = \'guest\' WHERE "userId" = $1', [outsider.userId]);
  const res = await post(outsider.userId, "view", "vault", orgId);
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "guest_vault_level_not_allowed" });
});

it("a member creator cannot share with a guest unless allowed (Q13)", async () => {
  await seedMember(orgId, outsider.userId, "member");
  const guest = await signUp("guest@targets.test");
  await seedMember(orgId, guest.userId, "member");
  await pool.query('UPDATE member SET role = \'guest\' WHERE "userId" = $1', [guest.userId]);
  await pool.query("UPDATE notes SET created_by = $1 WHERE id = $2", [outsider.userId, docId]);
  const res = await app.request("/api/shares", { method: "POST", headers: authHeaders(outsider), body: JSON.stringify({ resourceType: "file", resourceId: docId, principalId: guest.userId, permission: "view" }) });
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: "access_manager_required" });
  expect((await post(guest.userId, "view")).status).toBe(201);
});

it("bulk access, team-access and MCP access tools apply the same rules", async () => {
  const { applyBulkAccess } = await import("../src/permissions/access-management.js");
  const { manageAccessTool } = await import("../src/mcp/service.js");
  const deps = recordingAppDeps();
  const resources = [{ resourceType: "file" as const, resourceId: docId }];
  const audience = { type: "users" as const, userIds: [outsider.userId] };
  await expect(applyBulkAccess({ organizationId: orgId, actorUserId: owner.userId, resources, audience, mode: "open" })).rejects.toMatchObject({ code: "share_target_not_member" });
  await expect(manageAccessTool({ auth: { userId: owner.userId, organizationId: orgId }, docWriter: deps.docWriter, disconnectDoc: deps.deps.disconnectDoc }, resources, audience, "open")).rejects.toMatchObject({ code: "share_target_not_member" });
  await seedMember(orgId, outsider.userId, "member");
  await pool.query('UPDATE member SET role = \'guest\' WHERE "userId" = $1', [outsider.userId]);
  const vaultResources = [{ resourceType: "vault" as const, resourceId: orgId }];
  await expect(applyBulkAccess({ organizationId: orgId, actorUserId: owner.userId, resources: vaultResources, audience, mode: "open" })).rejects.toMatchObject({ code: "guest_vault_level_not_allowed" });
  await expect(manageAccessTool({ auth: { userId: owner.userId, organizationId: orgId }, docWriter: deps.docWriter, disconnectDoc: deps.deps.disconnectDoc }, vaultResources, audience, "open")).rejects.toMatchObject({ code: "guest_vault_level_not_allowed" });
  // Team posture writes only an org principal; it cannot create a guest's vault row.
  const team = await app.request(`/api/orgs/${orgId}/team-access`, { method: "PUT", headers: authHeaders(owner), body: JSON.stringify({ mode: "open" }) });
  expect(team.status).toBe(200);
  expect((await pool.query("SELECT id FROM shares WHERE resource_type = 'vault' AND principal_type = 'user' AND principal_id = $1", [outsider.userId])).rowCount).toBe(0);
});

it("concurrent removal and share leave no orphan row", async () => {
  await seedMember(orgId, outsider.userId, "member");
  const remover = await pool.connect();
  try {
    await remover.query("BEGIN");
    await remover.query('DELETE FROM member WHERE "organizationId" = $1 AND "userId" = $2', [orgId, outsider.userId]);
    const pending = post(outsider.userId);
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ORDER BY%FOR SHARE%'");
      if (waiting.rowCount) { blocked = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    // The row remains visible to other transactions until removal commits;
    // a plain membership read would incorrectly allow an orphan insertion.
    await remover.query("DELETE FROM shares WHERE org_id = $1 AND principal_type = 'user' AND principal_id = $2", [orgId, outsider.userId]);
    await remover.query("COMMIT");
    expect((await pending).status).toBe(400);
    expect((await pool.query("SELECT id FROM shares WHERE principal_id = $1", [outsider.userId])).rowCount).toBe(0);
  } finally {
    await remover.query("ROLLBACK");
    remover.release();
  }
});

it("removal after an in-flight share deletes the committed grant", async () => {
  await seedMember(orgId, outsider.userId, "member");
  await pool.query("INSERT INTO organization_access_settings (organization_id) VALUES ($1) ON CONFLICT DO NOTHING", [orgId]);
  const blocker = await pool.connect();
  const waitsFor = async (fragment: string) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1", [`%${fragment}%`]);
      if (result.rowCount) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Expected blocked query: ${fragment}`);
  };
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM organization_access_settings WHERE organization_id = $1 FOR UPDATE", [orgId]);
    const sharing = post(outsider.userId);
    await waitsFor("organization_access_settings");
    const removing = app.request(`/api/orgs/${orgId}/members/${outsider.userId}`, { method: "DELETE", headers: authHeaders(owner) });
    await waitsFor("DELETE FROM member");
    await blocker.query("COMMIT");
    expect((await sharing).status).toBe(201);
    expect((await removing).status).toBe(200);
    expect((await pool.query("SELECT id FROM shares WHERE principal_id = $1", [outsider.userId])).rowCount).toBe(0);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
});


it("target validation rechecks the actor after membership removal or demotion", async () => {
  const { validateShareTargets } = await import("../src/permissions/access-management.js");
  await seedMember(orgId, outsider.userId, "member");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query('UPDATE member SET role = \'member\' WHERE "organizationId" = $1 AND "userId" = $2', [orgId, owner.userId]);
    await expect(validateShareTargets(client, orgId, [outsider.userId], owner.userId, [{ resourceType: "file", resourceId: docId }])).rejects.toMatchObject({ code: "access_manager_required" });
    await client.query('DELETE FROM member WHERE "organizationId" = $1 AND "userId" = $2', [orgId, owner.userId]);
    await expect(validateShareTargets(client, orgId, [outsider.userId], owner.userId, [{ resourceType: "file", resourceId: docId }], true)).rejects.toMatchObject({ code: "access_manager_required" });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

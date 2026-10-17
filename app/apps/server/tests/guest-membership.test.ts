// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { authHeaders, bearerHeaders } from "./helpers/auth.js";
import { auth } from "../src/auth/auth.js";
import { recordingAppDeps } from "./helpers/app.js";
import { seedUserVaultGrant } from "./helpers/seed.js";
const rec = recordingAppDeps(); const app = createApp(rec.deps);
let f: Awaited<ReturnType<typeof guestFixture>>;
beforeEach(async () => { f = await guestFixture(); rec.reset(); }); afterAll(() => pool.end());
it("Better Auth org endpoints never list members to a guest", async () => {
  // M9 reproduction: library API only checks membership, and exposes the roster.
  const raw = await auth.api.listMembers({ headers: bearerHeaders(f.guest), query: { organizationId: f.org } });
  expect(raw.members.length).toBeGreaterThan(1);
  const self = await app.request(`/api/auth/organization/list-members?organizationId=${f.org}`, { headers: authHeaders(f.guest) });
  const json = await self.json() as any;
  expect(json.members.map((member: any) => member.userId)).toEqual([f.guest.userId]);
  for (const endpoint of ["get-full-organization", "list-invitations"]) {
    expect((await app.request(`/api/auth/organization/${endpoint}?organizationId=${f.org}`, { headers: authHeaders(f.guest) })).status).toBe(403);
  }
});
it("guest overview shows only self", async () => {
  const res = await app.request(`/api/orgs/${f.org}/members/overview`, { headers: authHeaders(f.guest) });
  expect(res.status).toBe(200); const json = await res.json() as any;
  expect(json.members.map((member: any) => member.userId)).toEqual([f.guest.userId]);
  expect(JSON.stringify(json)).not.toContain(f.member.email);
});
it("demoting to guest drops snapshot and personal vault level", async () => {
  await seedUserVaultGrant(f.org, f.member.userId, "edit");
  const res = await app.request(`/api/orgs/${f.org}/members/${f.member.userId}`, { method: "PATCH", headers: authHeaders(f.owner), body: JSON.stringify({ role: "guest" }) });
  expect(res.status).toBe(200);
  expect((await pool.query("SELECT 1 FROM member_access_snapshots WHERE user_id=$1", [f.member.userId])).rowCount).toBe(0);
  expect((await pool.query("SELECT 1 FROM shares WHERE resource_type='vault' AND principal_type='user' AND principal_id=$1", [f.member.userId])).rowCount).toBe(0);
});
it("Better Auth leave uses the same grant and socket teardown", async () => {
  const res = await app.request("/api/auth/organization/leave", { method: "POST", headers: authHeaders(f.guest), body: JSON.stringify({ organizationId: f.org }) });
  expect(res.status).toBe(200);
  expect((await pool.query("SELECT 1 FROM shares WHERE principal_type='user' AND principal_id=$1", [f.guest.userId])).rowCount).toBe(0);
  expect(rec.disconnected).toContainEqual({ vaultId: f.vault, docId: f.visible });
});
it("admin invites a guest with explicit targets", async () => {
  const res = await app.request(`/api/orgs/${f.org}/invitations`, { method: "POST", headers: authHeaders(f.owner), body: JSON.stringify({ emails: [f.external.email], role: "guest", targets: [{ resourceType: "folder", resourceId: f.shared, permission: "edit" }] }) });
  expect(res.status).toBe(200);
  const result = await res.json() as any;
  const invitationId = result.results[0].invitationId;
  expect(invitationId).toBeTruthy();
  const accept = await app.request("/api/auth/organization/accept-invitation", { method: "POST", headers: authHeaders(f.external), body: JSON.stringify({ invitationId }) });
  expect(accept.status).toBe(200);
  expect((await pool.query('SELECT role FROM member WHERE "organizationId"=$1 AND "userId"=$2', [f.org, f.external.userId])).rows[0].role).toBe("guest");
  expect((await pool.query("SELECT resource_type,resource_id FROM shares WHERE principal_type='user' AND principal_id=$1", [f.external.userId])).rows).toEqual([{ resource_type: "folder", resource_id: f.shared }]);
});
it("guest invite rejects vault-wide access modes", async () => {
  const res = await app.request(`/api/orgs/${f.org}/invitations`, { method: "POST", headers: authHeaders(f.owner), body: JSON.stringify({ emails: [f.external.email], role: "guest", access: "open", targets: [{ resourceType: "folder", resourceId: f.shared, permission: "edit" }] }) });
  expect(res.status).toBe(400);
});

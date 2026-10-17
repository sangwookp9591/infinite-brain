// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { pool, resetDb } from "./helpers/db.js";
import { recordingAppDeps } from "./helpers/app.js";
import { authHeaders, createOrg, signUp, type TestUser } from "./helpers/auth.js";
import { seedMember, seedNote, seedShare, seedVault } from "./helpers/seed.js";

const app = createApp(recordingAppDeps().deps);
let creator: TestUser;
let orgId: string;
let docId: string;
beforeEach(async () => {
  await resetDb();
  const owner = await signUp("owner@removed.test");
  creator = await signUp("creator@removed.test");
  orgId = (await createOrg(owner, "Removed", "removed")).id;
  await seedMember(orgId, creator.userId, "member");
  docId = await seedNote(await seedVault(orgId), null, "note.md", creator.userId);
  await pool.query('DELETE FROM member WHERE "organizationId" = $1 AND "userId" = $2', [orgId, creator.userId]);
});
afterAll(() => pool.end());
it("removed creator cannot manage shares", async () => {
  const res = await app.request("/api/shares", { method: "POST", headers: authHeaders(creator), body: JSON.stringify({ resourceType: "file", resourceId: docId, principalId: creator.userId, permission: "edit" }) });
  expect(res.status).toBe(403);
  const token = await app.request("/api/sync-token", { method: "POST", headers: authHeaders(creator), body: JSON.stringify({ docId }) });
  expect(token.status).toBe(403);
});
it("removed creator cannot mint a public link", async () => {
  // A historical grant must not revive the creator management shortcut.
  await seedShare(orgId, "file", docId, creator.userId, "view");
  const res = await app.request(`/api/notes/${docId}/public-link`, { method: "POST", headers: authHeaders(creator) });
  expect(res.status).toBe(403);
});

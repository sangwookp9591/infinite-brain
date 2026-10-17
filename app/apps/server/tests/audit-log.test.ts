// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { pool, resetDb } from "./helpers/db.js";
import { recordingAppDeps } from "./helpers/app.js";
import { authHeaders, createOrg, signUp, type TestUser } from "./helpers/auth.js";
import { seedMember, seedNote, seedShare, seedVault } from "./helpers/seed.js";
import { auditContext, sweepAuditLog } from "../src/audit/log.js";
const app = createApp(recordingAppDeps().deps);
let owner: TestUser;
let member: TestUser;
let org: string;
let doc: string;
beforeEach(async () => {
  await resetDb();
  owner = await signUp("owner@audit.test"); member = await signUp("member@audit.test");
  org = (await createOrg(owner, "Audit", "audit")).id;
  await seedMember(org, member.userId, "member");
  doc = await seedNote(await seedVault(org), null, "note.md", owner.userId);
  await pool.query("TRUNCATE audit_log");
});
afterAll(() => pool.end());
const postShare = (principalId: string) => app.request("/api/shares", { method: "POST", headers: authHeaders(owner), body: JSON.stringify({ resourceType: "file", resourceId: doc, principalId, permission: "view" }) });
it("share write and audit row commit together", async () => {
  const client = await pool.connect();
  try {
    await auditContext.run({ requestId: "rollback-check", actorUserId: owner.userId, actorKind: "user" }, async () => {
      await client.query("BEGIN");
      await client.query("INSERT INTO shares (id,org_id,resource_type,resource_id,principal_type,principal_id,permission) VALUES ('rollback',$1,'file',$2,'user',$3,'view')", [org, doc, member.userId]);
      expect((await client.query("SELECT * FROM audit_log WHERE request_id = 'rollback-check'")).rowCount).toBe(1);
      await client.query("ROLLBACK");
    });
    expect((await pool.query("SELECT id FROM shares WHERE id = 'rollback'")).rowCount).toBe(0);
    expect((await pool.query("SELECT id FROM audit_log")).rowCount).toBe(0);
    const res = await postShare(member.userId); expect(res.status).toBe(201);
    const rows = await pool.query("SELECT * FROM audit_log WHERE target_type = 'share'");
    expect(rows.rows[0]).toMatchObject({ actor_user_id: owner.userId, actor_kind: "user", result: "ok", request_id: res.headers.get("X-Request-Id") });
  } finally { client.release(); }
});
it("a refused share write is audited", async () => {
  const res = await postShare("missing"); expect(res.status).toBe(400);
  expect((await pool.query("SELECT * FROM audit_log WHERE result = 'refused'")).rows[0]).toMatchObject({ organization_id: org, actor_user_id: owner.userId });
  expect((await pool.query("SELECT id FROM shares")).rowCount).toBe(0);
});
it("members and guests cannot read the audit log", async () => {
  for (const role of ["member", "guest"]) {
    await pool.query('UPDATE member SET role = $1 WHERE "organizationId" = $2 AND "userId" = $3', [role, org, member.userId]);
    expect((await app.request(`/api/orgs/${org}/audit`, { headers: authHeaders(member) })).status).toBe(403);
  }
  expect((await app.request(`/api/orgs/${org}/audit`, { headers: authHeaders(owner) })).status).toBe(200);
});
it("retention sweep deletes only expired rows", async () => {
  await pool.query("INSERT INTO audit_log (organization_id,actor_kind,action,target_type,result,created_at) VALUES ($1,'system','test','vault','ok',now()-interval '366 days'),($1,'system','test','vault','ok',now())", [org]);
  expect(await sweepAuditLog(pool)).toBe(1);
  expect((await pool.query("SELECT id FROM audit_log")).rowCount).toBe(1);
});
it("missing actor context is system/unknown and pooled connections never leak actors", async () => {
  const client = await pool.connect();
  try {
    await auditContext.run({ requestId: "first", actorUserId: owner.userId, actorKind: "user" }, async () => {
      await client.query("BEGIN");
      await client.query("SAVEPOINT audit_savepoint");
      await client.query("ROLLBACK TO SAVEPOINT audit_savepoint");
      await client.query("RELEASE SAVEPOINT audit_savepoint");
      await client.query("COMMIT");
    });
    expect((await client.query("SELECT NULLIF(current_setting('infinite_brain.audit',true),'') AS context")).rows[0].context).toBeNull();
    await client.query("BEGIN");
    await client.query("INSERT INTO shares (id,org_id,resource_type,resource_id,principal_type,principal_id,permission) VALUES ('unknown',$1,'file',$2,'user',$3,'view')", [org, doc, member.userId]);
    await client.query("COMMIT");
    expect((await client.query("SELECT * FROM audit_log WHERE target_id = 'unknown'")).rows[0]).toMatchObject({ actor_kind: "system", actor_user_id: null, request_id: null });
  } finally { client.release(); }
  await auditContext.run({ requestId: "second", actorUserId: member.userId, actorKind: "user" }, async () => {
    await pool.query("UPDATE shares SET permission = 'edit' WHERE id = 'unknown'");
  });
  expect((await pool.query("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1")).rows[0]).toMatchObject({ actor_user_id: member.userId, request_id: "second" });
});

// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { pool, resetDb } from "./helpers/db.js";
import { recordingAppDeps } from "./helpers/app.js";
import { authHeaders, createOrg, signUp, type TestUser } from "./helpers/auth.js";
import { seedMember } from "./helpers/seed.js";
import { getOrRotateJoinCode, JOIN_ATTEMPT_LIMIT } from "../src/join-codes/service.js";
const app = createApp(recordingAppDeps().deps);
let owner: TestUser; let joiner: TestUser; let org: string; let code: string;
beforeEach(async () => {
  await resetDb(); owner = await signUp("owner@code.test"); joiner = await signUp("joiner@code.test");
  org = (await createOrg(owner, "Codes", "codes")).id;
  code = (await getOrRotateJoinCode(org, owner.userId)).code;
});
afterAll(() => pool.end());
const join = (value = code) => app.request("/api/orgs/join", { method: "POST", headers: authHeaders(joiner), body: JSON.stringify({ code: value }) });
it("expired code is refused with a reason", async () => {
  await pool.query("UPDATE org_join_codes SET expires_at = now()-interval '1 second' WHERE organization_id=$1", [org]);
  const res = await join(); expect(res.status).toBe(410); expect(await res.json()).toMatchObject({ error: "join_code_expired" });
  expect((await pool.query('SELECT 1 FROM member WHERE "userId"=$1', [joiner.userId])).rowCount).toBe(0);
});
it("rotation invalidates the previous code", async () => {
  const rotated = await app.request("/api/orgs/join-code/rotate", { method: "POST", headers: authHeaders(owner) });
  expect(rotated.status).toBe(200);
  const next = await rotated.json() as { code: string; expiresAt: string };
  expect(next.code).not.toBe(code); expect(new Date(next.expiresAt).getTime()).toBeGreaterThan(Date.now());
  expect((await join()).status).toBe(404); expect((await join(next.code)).status).toBe(200);
});
it("attempts beyond the limit are refused", async () => {
  await pool.query("INSERT INTO join_code_attempts (user_id) SELECT $1 FROM generate_series(1,$2)", [joiner.userId, JOIN_ATTEMPT_LIMIT]);
  const res = await join(); expect(res.status).toBe(429); expect(await res.json()).toMatchObject({ error: "join_code_rate_limited" });
});
it("a pending guest invite cannot be redeemed through the join code", async () => {
  await pool.query('INSERT INTO invitation (id,"organizationId",email,role,status,"expiresAt","inviterId","createdAt") VALUES (\'guest-invite\',$1,$2,\'guest\',\'pending\',now()+interval \'1 day\',$3,now())', [org, joiner.email, owner.userId]);
  const res = await join(); expect(res.status).toBe(409); expect(await res.json()).toMatchObject({ error: "guest_invite_pending" });
});
it("redeeming never promotes a guest", async () => {
  await seedMember(org, joiner.userId, "member");
  await pool.query('UPDATE member SET role=\'guest\' WHERE "userId"=$1', [joiner.userId]);
  expect((await join()).status).toBe(200);
  expect((await pool.query('SELECT role FROM member WHERE "userId"=$1', [joiner.userId])).rows[0].role).toBe("guest");
});

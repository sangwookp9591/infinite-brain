// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { testAppDeps } from "./helpers/app.js";
import { createOrg, signUp, type TestUser } from "./helpers/auth.js";
import { pool, resetDb } from "./helpers/db.js";
import { challengeDigest, type Challenge } from "../src/office/protocol.js";
import { OfficePairing, sweepPairings } from "../src/office/pairing.js";
import { seedNote, seedVault } from "./helpers/seed.js";

const app = createApp(testAppDeps());
let owner: TestUser, employee: TestUser, organizationId: string;
const fingerprint = "a".repeat(64);
const host = { serverId: "office-test", generation: "1", fingerprint, audience: "http://localhost:3010/api/office" };
const service = new OfficePairing(host);

async function post(path: string, body: unknown, user?: TestUser) {
  return app.request(`/api${path}`, { method: "POST", headers: { "content-type": "application/json", ...(user ? { authorization: `Bearer ${user.token}` } : {}) }, body: JSON.stringify(body) });
}
async function get(path: string, user?: TestUser, token?: string) {
  return app.request(`/api${path}`, { headers: user || token ? { authorization: `Bearer ${user?.token ?? token}` } : {} });
}
async function begin(user: TestUser | undefined = employee, personId = randomUUID(), alias = "민수") {
  const invitation = await service.invite(organizationId, owner.userId);
  const keys = generateKeyPairSync("ed25519");
  const body = { invitationSecret: invitation.invitationSecret, hubFingerprint: fingerprint, personId, deviceId: randomUUID(),
    displayAlias: alias, deviceLabel: "내 컴퓨터", platform: "macos", clientNonce: randomBytes(32).toString("base64url"),
    publicKey: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url") };
  const response = await post("/office/pairing/challenge", body, user);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  const data = await response.json() as { challenge: Challenge; pairingToken: string };
  const proof = { pairingToken: data.pairingToken, clientNonce: data.challenge.clientNonce, serverNonce: data.challenge.serverNonce,
    signature: sign(null, challengeDigest(data.challenge), keys.privateKey).toString("base64url") };
  return { ...data, proof, body, user, id: data.challenge.sessionId, invitation };
}
async function pending(user: TestUser | undefined = employee, personId?: string, alias?: string) {
  const run = await begin(user, personId, alias);
  expect((await post(`/office/pairing/${run.id}/proof`, run.proof)).status).toBe(200);
  expect((await post(`/office/pairing/${run.id}/request`, { pairingToken: run.pairingToken }, user)).status).toBe(200);
  return run;
}
async function decision(id: string, value: string, user = owner, reasonCode?: string) {
  return post(`/office/pairing/${id}/decision`, { decision: value, reasonCode }, user);
}

beforeEach(async () => {
  process.env.OFFICE_SERVER_ID = host.serverId;
  process.env.OFFICE_HOST_GENERATION = host.generation;
  process.env.OFFICE_HUB_FINGERPRINT = fingerprint;
  // As with all server integration suites, the runner must select a disposable database.
  await resetDb();
  owner = await signUp("office-owner@example.com");
  employee = await signUp("office-person@example.com");
  organizationId = (await createOrg(owner, "회사", "office-test")).id;
  await pool.query('INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,\'member\',now())', [randomUUID(), organizationId, employee.userId]);
});

describe("office identity and pairing", () => {
  it("approves an existing member without creating accounts, membership, vault grants or sessions", async () => {
    const before = (await pool.query('SELECT (SELECT count(*) FROM "user") AS users,(SELECT count(*) FROM member) AS members,(SELECT count(*) FROM session) AS sessions,(SELECT count(*) FROM shares) AS shares')).rows[0];
    const run = await pending();
    const approved = await decision(run.id, "approved");
    expect(approved.status).toBe(200);
    expect((await decision(run.id, "approved")).status).toBe(200);
    expect((await decision(run.id, "rejected")).status).toBe(409);
    const after = (await pool.query('SELECT (SELECT count(*) FROM "user") AS users,(SELECT count(*) FROM member) AS members,(SELECT count(*) FROM session) AS sessions,(SELECT count(*) FROM shares) AS shares')).rows[0];
    expect(after).toEqual(before);
    expect((await pool.query("SELECT linked_user_id FROM person_identity")).rows[0].linked_user_id).toBe(employee.userId);
    const audited = (await pool.query("SELECT actor_user_id,request_id,organization_id,refs FROM audit_log WHERE action='office.pairing.approve'")).rows[0];
    expect(audited).toMatchObject({ actor_user_id: owner.userId, request_id: approved.headers.get("X-Request-Id"), organization_id: organizationId, refs: { deviceId: run.challenge.deviceId } });
    const directory = await get(`/office/organizations/${organizationId}/directory`, employee);
    expect(directory.status).toBe(200);
    expect(await directory.json()).toEqual({ people: [{ personId: run.challenge.personId, displayAlias: "민수", displayName: "민수" }] });
  });

  it("exposes only minimum applicant and queue fields, denies pairing credentials on all protected surfaces", async () => {
    const run = await pending();
    const response = await post(`/office/pairing/${run.id}/status`, { pairingToken: run.pairingToken });
    expect(Object.keys(await response.json()).sort()).toEqual(["displayAlias", "expiresAt", "sessionId", "state"]);
    expect((await get(`/office/organizations/${organizationId}/directory`, employee)).status).toBe(403);
    const queue = await get(`/office/organizations/${organizationId}/requests`, owner);
    const rows = (await queue.json()).requests;
    expect(Object.keys(rows[0]).sort()).toEqual(["accountLinked", "comparisonCode", "deviceLabel", "displayAlias", "platform", "proofVerified", "requestedAt", "sessionId"]);
    expect((await get(`/office/organizations/${organizationId}/requests`, employee)).status).toBe(403);
    const vaultId = await seedVault(organizationId), docId = await seedNote(vaultId, null, "비공개.md", owner.userId);
    for (const path of [`/office/organizations/${organizationId}/directory`, "/vaults", `/notes?vaultId=${vaultId}`, `/folders?vaultId=${vaultId}`, "/blobs/private-blob", "/mcp/tokens"]) {
      expect((await get(path, undefined, run.pairingToken)).status, path).toBe(401);
    }
    for (const path of ["/sync-token", "/vault-sync-token", "/mcp"]) {
      const response = await app.request(`/api${path}`, { method: "POST", headers: { authorization: `Bearer ${run.pairingToken}`, "content-type": "application/json" }, body: JSON.stringify({ docId, vaultId }) });
      expect(response.status, path).toBe(401);
    }
    const audit = JSON.stringify((await pool.query("SELECT before,after,refs FROM audit_log WHERE action LIKE 'office.%'")).rows);
    for (const material of [run.pairingToken, run.proof.signature, run.proof.clientNonce, run.proof.serverNonce, run.body.publicKey, run.invitation.invitationSecret]) expect(audit).not.toContain(material);
  });

  it("rejects replayed proof, reused invitation and client nonce, forged proof and foreign capability", async () => {
    const run = await begin();
    expect((await post(`/office/pairing/${run.id}/proof`, { ...run.proof, signature: randomBytes(64).toString("base64url") })).status).toBe(403);
    expect((await post(`/office/pairing/${run.id}/proof`, { ...run.proof, pairingToken: randomBytes(32).toString("base64url") })).status).toBe(403);
    expect((await post(`/office/pairing/${run.id}/proof`, run.proof)).status).toBe(200);
    expect((await post(`/office/pairing/${run.id}/proof`, run.proof)).status).toBe(409);
    expect((await post("/office/pairing/challenge", run.body, employee)).status).toBe(410);
    const invitation = await service.invite(organizationId, owner.userId);
    const keys = generateKeyPairSync("ed25519");
    expect((await post("/office/pairing/challenge", { ...run.body, invitationSecret: invitation.invitationSecret, deviceId: randomUUID(), publicKey: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url") }, employee)).status).toBe(409);
  });

  it("binds host pin, account, audience and generation and refuses claimed existing people", async () => {
    const run = await begin();
    process.env.OFFICE_HOST_GENERATION = "2";
    expect((await post(`/office/pairing/${run.id}/proof`, run.proof)).status).toBe(403);
    process.env.OFFICE_HOST_GENERATION = "1";
    await pool.query("UPDATE pairing_session SET audience='another-audience' WHERE id=$1", [run.id]);
    expect((await post(`/office/pairing/${run.id}/proof`, run.proof)).status).toBe(403);
    await pool.query("UPDATE pairing_session SET audience=$2 WHERE id=$1", [run.id, host.audience]);
    expect((await post(`/office/pairing/${run.id}/proof`, run.proof)).status).toBe(200);
    expect((await post(`/office/pairing/${run.id}/request`, { pairingToken: run.pairingToken }, owner)).status).toBe(403);
    expect((await post(`/office/pairing/${run.id}/request`, { pairingToken: run.pairingToken }, employee)).status).toBe(200);
    const other = await begin(owner, run.challenge.personId);
    expect((await post(`/office/pairing/${other.id}/proof`, other.proof)).status).toBe(200);
    expect((await post(`/office/pairing/${other.id}/request`, { pairingToken: other.pairingToken }, owner)).status).toBe(403);
    const invitation = await service.invite(organizationId, owner.userId);
    expect((await post("/office/pairing/challenge", { ...other.body, invitationSecret: invitation.invitationSecret, hubFingerprint: "b".repeat(64) }, owner)).status).toBe(403);
  });

  it("persists challenge attempt limits and denies expired proof or approval", async () => {
    const run = await begin();
    for (let i = 0; i < 5; i++) expect((await post(`/office/pairing/${run.id}/proof`, { ...run.proof, signature: "invalid" })).status).toBe(403);
    expect((await post(`/office/pairing/${run.id}/proof`, run.proof)).status).toBe(409);
    const expired = await begin();
    await pool.query("UPDATE pairing_session SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.id]);
    expect((await post(`/office/pairing/${expired.id}/proof`, expired.proof)).status).toBe(410);
    expect((await pool.query("SELECT state FROM pairing_session WHERE id=$1", [expired.id])).rows[0].state).toBe("expired");
    const waiting = await pending();
    await pool.query("UPDATE pairing_session SET expires_at=now()-interval '1 second' WHERE id=$1", [waiting.id]);
    expect((await decision(waiting.id, "approved")).status).toBe(410);
  });

  it("forbids self approval and rechecks both manager and applicant memberships", async () => {
    const own = await pending(owner);
    expect((await decision(own.id, "approved")).status).toBe(403);
    const run = await pending();
    expect((await decision(run.id, "approved", employee)).status).toBe(403);
    await pool.query('DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2', [organizationId, employee.userId]);
    expect((await decision(run.id, "approved")).status).toBe(403);
    expect((await pool.query("SELECT state FROM pairing_session WHERE id=$1", [run.id])).rows[0].state).toBe("pending_approval");
    await pool.query('UPDATE member SET role=\'member\' WHERE "organizationId"=$1 AND "userId"=$2', [organizationId, owner.userId]);
    expect((await decision(run.id, "rejected")).status).toBe(403);
  });

  it("keeps anonymous device-only profiles without inventing accounts and cannot approve them", async () => {
    // Explicit undefined would trigger begin's default; anonymous challenge uses service directly.
    const invitation = await service.invite(organizationId, owner.userId), keys = generateKeyPairSync("ed25519");
    const data = await service.challenge({ invitationSecret: invitation.invitationSecret, hubFingerprint: fingerprint,
      personId: randomUUID(), deviceId: randomUUID(), displayAlias: "새 동료", deviceLabel: "내 컴퓨터", platform: "windows",
      clientNonce: randomBytes(32).toString("base64url"), publicKey: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url") }, null);
    await service.proof(data.challenge.sessionId, { pairingToken: data.pairingToken, clientNonce: data.challenge.clientNonce, serverNonce: data.challenge.serverNonce, signature: sign(null, challengeDigest(data.challenge), keys.privateKey).toString("base64url") });
    await service.request(data.challenge.sessionId, data.pairingToken, null);
    expect((await decision(data.challenge.sessionId, "approved")).status).toBe(403);
    expect((await pool.query('SELECT count(*)::int AS n FROM "user"')).rows[0].n).toBe(2);
    expect((await pool.query("SELECT linked_user_id FROM person_identity")).rows[0].linked_user_id).toBeNull();
  });

  it("serializes conflicting decisions, preserves retries and allows audited device revocation", async () => {
    const run = await pending();
    const responses = await Promise.all([decision(run.id, "approved"), decision(run.id, "rejected")]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const state = (await pool.query("SELECT state FROM pairing_session WHERE id=$1", [run.id])).rows[0].state;
    expect((await decision(run.id, state)).status).toBe(200);
    if (state === "approved") {
      expect((await decision(run.id, "cancelled", owner, "device_revoked")).status).toBe(200);
      expect((await get(`/office/organizations/${organizationId}/directory`, employee)).status).toBe(403);
    }
  });

  it("cancels before or during approval and refuses all subsequent reuse", async () => {
    const run = await pending();
    expect((await post(`/office/pairing/${run.id}/cancel`, { pairingToken: run.pairingToken })).status).toBe(200);
    expect((await decision(run.id, "approved")).status).toBe(409);
    const invited = await begin();
    expect((await post(`/office/invitations/${invited.invitation.invitationId}/cancel`, {}, owner)).status).toBe(200);
    expect((await post(`/office/pairing/${invited.id}/proof`, invited.proof)).status).toBe(409);
    const invitation = await service.invite(organizationId, owner.userId);
    await service.cancelInvitation(invitation.invitationId, owner.userId);
    expect((await post("/office/pairing/challenge", { ...invited.body, invitationSecret: invitation.invitationSecret }, employee)).status).toBe(410);
  });

  it("does not merge duplicate aliases and extends colliding UUID-derived display codes", async () => {
    const first = await pending(employee, "00000000-0000-4000-8000-000000000001");
    expect((await decision(first.id, "approved")).status).toBe(200);
    const other = await signUp("other-person@example.com");
    await pool.query('INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,\'member\',now())', [randomUUID(), organizationId, other.userId]);
    const second = await pending(other, "00000000-0000-4000-8000-000000000002");
    expect((await decision(second.id, "approved")).status).toBe(200);
    const directory = await get(`/office/organizations/${organizationId}/directory`, employee);
    const people = (await directory.json()).people;
    expect(people).toHaveLength(2);
    expect(people[0].displayName).toMatch(/^민수 · /);
    expect(people[0].displayName).not.toBe(people[1].displayName);
    const codes = (await pool.query("SELECT alias_disambiguator FROM person_identity")).rows;
    expect(codes.every((p) => p.alias_disambiguator.length > 4)).toBe(true);
    await pool.query('DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2', [organizationId, other.userId]);
    expect((await (await get(`/office/organizations/${organizationId}/directory`, employee)).json()).people).toHaveLength(1);
  });

  it("expires bounded pending sessions under system audit and enforces database identity constraints", async () => {
    const run = await pending();
    await pool.query("UPDATE pairing_session SET expires_at=now()-interval '1 second' WHERE id=$1", [run.id]);
    expect(await sweepPairings()).toBe(1);
    expect((await pool.query("SELECT actor_kind FROM audit_log WHERE action='office.pairing.expire'")).rows[0].actor_kind).toBe("system");
    await expect(pool.query("UPDATE person_device SET key_algorithm='RSA' WHERE id=$1", [run.challenge.deviceId])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("INSERT INTO office_person_membership(person_id,organization_id,user_id,status) VALUES ($1,$2,$3,'active')", [run.challenge.personId, organizationId, owner.userId])).rejects.toMatchObject({ code: "23503" });
    await expect(pool.query("UPDATE person_identity SET linked_user_id='missing-account' WHERE id=$1", [run.challenge.personId])).rejects.toMatchObject({ code: "23503" });
    expect((await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_name='user' AND column_name='email'")).rows[0].is_nullable).toBe("NO");
  });

  it("rolls back approval if its audit event cannot commit", async () => {
    const run = await pending();
    await pool.query(`CREATE FUNCTION office_test_refuse_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='office.pairing.approve' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER office_test_refuse_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION office_test_refuse_audit()`);
    try {
      expect((await decision(run.id, "approved")).status).toBe(503);
      expect((await pool.query("SELECT state FROM pairing_session WHERE id=$1", [run.id])).rows[0].state).toBe("pending_approval");
      expect((await pool.query("SELECT status FROM person_device WHERE id=$1", [run.challenge.deviceId])).rows[0].status).toBe("pending");
      expect((await pool.query("SELECT * FROM office_person_membership")).rowCount).toBe(0);
    } finally {
      await pool.query("DROP TRIGGER office_test_refuse_audit ON audit_log; DROP FUNCTION office_test_refuse_audit()");
    }
  });

  it("does not admit guests to the company directory and does not reuse an account for another person", async () => {
    const run = await pending();
    await pool.query('UPDATE member SET role=\'guest\' WHERE "organizationId"=$1 AND "userId"=$2', [organizationId, employee.userId]);
    expect((await decision(run.id, "approved")).status).toBe(403);
    expect((await get(`/office/organizations/${organizationId}/directory`, employee)).status).toBe(403);
    const other = await begin();
    expect((await post(`/office/pairing/${other.id}/proof`, other.proof)).status).toBe(200);
    expect((await post(`/office/pairing/${other.id}/request`, { pairingToken: other.pairingToken }, employee)).status).toBe(409);
    expect((await pool.query("SELECT * FROM person_identity")).rowCount).toBe(1);
  });

  it("fails closed without host trust configuration and bounds request bodies", async () => {
    delete process.env.OFFICE_HUB_FINGERPRINT;
    expect((await post("/office/pairing/challenge", {})).status).toBe(503);
    process.env.OFFICE_HUB_FINGERPRINT = fingerprint;
    expect((await post("/office/pairing/challenge", { oversized: "x".repeat(9000) })).status).toBe(413);
    expect((await post("/office/pairing/challenge", { publicKey: "invalid" })).status).toBe(400);
  });
});

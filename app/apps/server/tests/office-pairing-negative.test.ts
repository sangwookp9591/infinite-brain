// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { challengeDigest, type Challenge } from "../src/office/protocol.js";
import { OfficePairing } from "../src/office/pairing.js";
import { testAppDeps } from "./helpers/app.js";
import { createOrg, signUp, type TestUser } from "./helpers/auth.js";
import { pool, resetDb } from "./helpers/db.js";
import { seedNote, seedVault } from "./helpers/seed.js";

const app = createApp(testAppDeps());
const fingerprint = "a".repeat(64);
const host = { serverId: "office-negative-test", generation: "41", fingerprint, audience: "http://localhost:3010/api/office" };
const pairing = new OfficePairing(host);
let owner: TestUser, employee: TestUser, organizationId: string;

async function request(path: string, method: "GET" | "POST" = "GET", body?: unknown, token?: string) {
  return app.request(`/api${path}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function begin() {
  const invitation = await pairing.invite(organizationId, owner.userId);
  const keys = generateKeyPairSync("ed25519");
  const body = { invitationSecret: invitation.invitationSecret, hubFingerprint: fingerprint, personId: randomUUID(), deviceId: randomUUID(),
    displayAlias: "별명만", deviceLabel: "기기", platform: "macos", clientNonce: randomBytes(32).toString("base64url"),
    publicKey: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url") };
  const result = await pairing.challenge(body, employee.userId);
  const challenge = result.challenge;
  const proof = { pairingToken: result.pairingToken, clientNonce: challenge.clientNonce, serverNonce: challenge.serverNonce,
    signature: sign(null, challengeDigest(challenge), keys.privateKey).toString("base64url") };
  return { invitation, keys, body, challenge, pairingToken: result.pairingToken, proof };
}

async function makePending() {
  const run = await begin();
  expect((await request(`/office/pairing/${run.challenge.sessionId}/proof`, "POST", run.proof)).status).toBe(200);
  expect((await request(`/office/pairing/${run.challenge.sessionId}/request`, "POST", { pairingToken: run.pairingToken }, employee.token)).status).toBe(200);
  return run;
}

beforeEach(async () => {
  process.env.OFFICE_SERVER_ID = host.serverId;
  process.env.OFFICE_HOST_GENERATION = host.generation;
  process.env.OFFICE_HUB_FINGERPRINT = fingerprint;
  await resetDb();
  owner = await signUp("office-negative-owner@example.com");
  employee = await signUp("office-negative-member@example.com");
  organizationId = (await createOrg(owner, "Negative tests", "office-negative")).id;
  await pool.query('INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,\'member\',now())', [randomUUID(), organizationId, employee.userId]);
});

describe("office pairing negative security cases", () => {
  it("does not treat an alias as authentication, session authority, or a status capability", async () => {
    const signIn = await request("/auth/sign-in/email", "POST", { email: "별명만", password: "anything" });
    expect([400, 401, 403]).toContain(signIn.status);
    expect(signIn.headers.get("set-auth-token")).toBeNull();

    const run = await begin();
    const status = await request(`/office/pairing/${run.challenge.sessionId}/status`, "POST", { pairingToken: "별명만" });
    expect([400, 403]).toContain(status.status);
    expect((await pool.query('SELECT count(*)::int AS n FROM session WHERE "userId"=$1', ["별명만"])).rows[0].n).toBe(0);
  });

  it("rejects proof, request, and status capability reuse immediately after requester cancellation", async () => {
    const run = await makePending();
    const id = run.challenge.sessionId;
    expect((await request(`/office/pairing/${id}/cancel`, "POST", { pairingToken: run.pairingToken })).status).toBe(200);
    expect((await request(`/office/pairing/${id}/proof`, "POST", run.proof)).status).toBe(409);
    expect((await request(`/office/pairing/${id}/request`, "POST", { pairingToken: run.pairingToken }, employee.token)).status).toBe(409);
    expect((await request(`/office/pairing/${id}/status`, "POST", { pairingToken: run.pairingToken })).status).toBe(409);
  });

  it("rejects capability and authentication reuse after an approved device is revoked", async () => {
    const run = await makePending();
    const id = run.challenge.sessionId;
    expect((await request(`/office/pairing/${id}/decision`, "POST", { decision: "approved" }, owner.token)).status).toBe(200);
    expect((await request(`/office/pairing/${id}/decision`, "POST", { decision: "cancelled", reasonCode: "device_revoked" }, owner.token)).status).toBe(200);
    expect((await request(`/office/pairing/${id}/proof`, "POST", run.proof)).status).toBe(409);
    expect((await request(`/office/pairing/${id}/request`, "POST", { pairingToken: run.pairingToken }, employee.token)).status).toBe(409);
    expect((await request(`/office/pairing/${id}/status`, "POST", { pairingToken: run.pairingToken })).status).toBe(409);
    expect((await request(`/office/organizations/${organizationId}/directory`, "GET", undefined, employee.token)).status).toBe(403);
  });

  it("rejects a proof signed by a different device key", async () => {
    const run = await begin();
    const foreign = generateKeyPairSync("ed25519");
    const forged = { ...run.proof, signature: sign(null, challengeDigest(run.challenge), foreign.privateKey).toString("base64url") };
    expect((await request(`/office/pairing/${run.challenge.sessionId}/proof`, "POST", forged)).status).toBe(403);
    expect((await pool.query("SELECT state FROM pairing_session WHERE id=$1", [run.challenge.sessionId])).rows[0].state).toBe("challenge_issued");
  });

  it("rejects a proof that claims a different server identity or hub generation", async () => {
    const run = await begin();
    const foreignServer = { ...run.challenge, serverId: "other-server" } as Challenge;
    const forgedServer = { ...run.proof, signature: sign(null, challengeDigest(foreignServer), run.keys.privateKey).toString("base64url") };
    expect((await request(`/office/pairing/${run.challenge.sessionId}/proof`, "POST", forgedServer)).status).toBe(403);

    const changedGeneration = { ...run.challenge, hostGeneration: "42" } as Challenge;
    const forgedGeneration = { ...run.proof, signature: sign(null, challengeDigest(changedGeneration), run.keys.privateKey).toString("base64url") };
    expect((await request(`/office/pairing/${run.challenge.sessionId}/proof`, "POST", forgedGeneration)).status).toBe(403);
    expect((await pool.query("SELECT state FROM pairing_session WHERE id=$1", [run.challenge.sessionId])).rows[0].state).toBe("challenge_issued");
  });

  it("does not expose seeded note data through protected HTTP APIs before approval", async () => {
    const run = await makePending();
    const vaultId = await seedVault(organizationId);
    const marker = "PRIVATE_OFFICE_PAIRING_NEGATIVE_SENTINEL";
    const docId = await seedNote(vaultId, null, `${marker}.md`, owner.userId);
    const protectedReads = [
      `/office/organizations/${organizationId}/requests`, `/office/organizations/${organizationId}/directory`,
      "/vaults", `/notes?vaultId=${vaultId}`, `/folders?vaultId=${vaultId}`, "/blobs/private-blob", "/mcp/tokens",
      `/vaults/${vaultId}/blobs`,
    ];
    for (const path of protectedReads) {
      const response = await request(path, "GET", undefined, run.pairingToken);
      expect(response.status, path).toBe(401);
      expect(await response.text(), path).not.toContain(marker);
    }
    for (const [path, body] of [["/sync-token", { docId, vaultId }], ["/vault-sync-token", { vaultId }], ["/mcp", { docId, vaultId }]] as const) {
      const response = await request(path, "POST", body, run.pairingToken);
      expect(response.status, path).toBe(401);
      expect(await response.text(), path).not.toContain(marker);
    }
  });
});

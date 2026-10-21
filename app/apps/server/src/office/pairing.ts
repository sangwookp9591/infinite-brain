// SPDX-License-Identifier: Apache-2.0
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { auditContext, recordAudit } from "../audit/log.js";
import { isTeamRole, isManagerRole } from "../permissions/roles.js";
import { PairingError, base64, challengeDigest, deviceKey, digest, normalizeAlias, personCode, text, uuid, verifyProof, type Challenge } from "./protocol.js";

export interface OfficeHost { serverId: string; generation: string; fingerprint: string; audience: string }
export function officeHost(): OfficeHost {
  const serverId = process.env.OFFICE_SERVER_ID;
  const generation = process.env.OFFICE_HOST_GENERATION;
  const fingerprint = process.env.OFFICE_HUB_FINGERPRINT;
  const origin = new URL(config.betterAuthUrl);
  if (origin.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) throw new PairingError("unavailable", 503);
  if (!serverId || !/^[A-Za-z0-9_-]{1,128}$/.test(serverId) || !generation || !/^[1-9]\d{0,14}$/.test(generation) || !fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new PairingError("unavailable", 503);
  return { serverId, generation, fingerprint, audience: `${config.betterAuthUrl}/api/office` };
}
type State = "challenge_issued" | "proof_verified" | "pending_approval" | "approved" | "rejected" | "cancelled" | "expired";
interface Session {
  id: string; organization_id: string; device_id: string; person_id: string | null;
  requested_person_id: string; requester_user_id: string | null; display_alias: string;
  state: State; expires_at: Date; proof_expires_at: Date; proof_used_at: Date | null;
  challenge_hash: Buffer; nonce_hash: Buffer; server_nonce_hash: Buffer; capability_hash: Buffer;
  public_key: Buffer; key_fingerprint: Buffer; server_id: string; audience: string;
  host_generation: string; protocol_version: number; failed_attempts: number;
  decided_by_user_id: string | null; decision_reason_code: string | null;
}
const terminal = new Set<State>(["approved", "rejected", "cancelled", "expired"]);
const live = ["challenge_issued", "proof_verified", "pending_approval"];
const secret = () => randomBytes(32).toString("base64url");
const hashSecret = (value: unknown) => digest(base64(value, 32));
const same = (left: Buffer, right: Buffer) => left.length === right.length && timingSafeEqual(left, right);

/** All writes and their audit events share the existing AuditClient transaction. */
async function transaction<T>(action: string, organizationId: string | undefined, run: (db: pg.PoolClient) => Promise<T | PairingError>): Promise<T> {
  const db = await pool.connect();
  let open = false;
  try {
    await db.query("BEGIN");
    open = true;
    const result = await run(db);
    await db.query("COMMIT");
    open = false;
    if (result instanceof PairingError) throw result;
    return result;
  } catch (error) {
    if (open) await db.query("ROLLBACK");
    const safe = error instanceof PairingError ? error : (error as { code?: string }).code === "23505" ? new PairingError("conflict", 409) : null;
    if (safe) {
      // A refused write is recorded after rollback, never inside an aborted transaction.
      await recordAudit(db, { action, organizationId, targetType: "pairing_session", result: "refused", refs: { code: safe.code } });
      safe.audited = true;
      throw safe;
    }
    throw error;
  } finally { db.release(); }
}
async function event(db: pg.PoolClient, action: string, row: Pick<Session, "id" | "organization_id" | "device_id">, before?: State, after?: State): Promise<void> {
  await recordAudit(db, { action, organizationId: row.organization_id, targetType: "pairing_session", targetId: row.id,
    before: before ? { state: before } : undefined, after: after ? { state: after } : undefined,
    refs: { deviceId: row.device_id } });
}
async function member(db: pg.PoolClient, organizationId: string, userId: string | null, manager = false): Promise<void> {
  if (!userId) throw new PairingError("account_required", 403);
  // Row locks keep membership removal/role changes from racing a decision.
  const row = (await db.query<{ role: string }>('SELECT role FROM member WHERE "organizationId"=$1 AND "userId"=$2 FOR SHARE', [organizationId, userId])).rows[0];
  if (!(manager ? isManagerRole(row?.role) : isTeamRole(row?.role))) throw new PairingError("not_allowed", 403);
}
async function load(db: pg.PoolClient, id: string): Promise<Session> {
  const row = (await db.query<Session>(`SELECT s.*, d.public_key, d.key_fingerprint FROM pairing_session s
    JOIN person_device d ON d.id=s.device_id WHERE s.id=$1 FOR UPDATE OF s, d`, [uuid(id)])).rows[0];
  if (!row) throw new PairingError("not_found", 404);
  const context = auditContext.getStore(); if (context) context.organizationId = row.organization_id;
  return row;
}
function hostMatches(row: Session, host: OfficeHost): void {
  if (row.server_id !== host.serverId || row.host_generation !== host.generation || row.audience !== host.audience) throw new PairingError("wrong_workspace", 403);
}
function capability(row: Session, value: unknown): void {
  if (!same(row.capability_hash, hashSecret(value))) throw new PairingError("not_allowed", 403);
}
async function expire(db: pg.PoolClient, row: Session): Promise<boolean> {
  if (!terminal.has(row.state) && row.expires_at.getTime() <= Date.now()) {
    await db.query("UPDATE pairing_session SET state='expired', updated_at=now() WHERE id=$1 AND state=$2", [row.id, row.state]);
    await db.query("UPDATE person_device SET status='revoked', revoked_at=now(), updated_at=now() WHERE id=$1", [row.device_id]);
    await event(db, "office.pairing.expire", row, row.state, "expired"); row.state = "expired";
  }
  return row.state === "expired";
}
function minimal(row: Session) {
  return { sessionId: row.id, state: row.state, displayAlias: row.display_alias, expiresAt: row.expires_at.toISOString() };
}

export class OfficePairing {
  constructor(readonly host: OfficeHost) {}

  async invite(organizationId: string, userId: string) {
    return transaction("office.pairing.invite", organizationId, async (db) => {
      await member(db, organizationId, userId, true);
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`office-pairing:${organizationId}`]);
      const count = (await db.query(`SELECT count(*)::int AS n FROM office_pairing_invitation WHERE organization_id=$1 AND expires_at>now() AND used_at IS NULL AND cancelled_at IS NULL`, [organizationId])).rows[0].n;
      if (count >= 20) throw new PairingError("try_later", 429);
      const id = randomUUID(), invitationSecret = secret();
      const row = (await db.query(`INSERT INTO office_pairing_invitation
        (id,organization_id,secret_hash,server_id,hub_fingerprint,host_generation,created_by_user_id,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '5 minutes') RETURNING expires_at`,
      [id, organizationId, hashSecret(invitationSecret), this.host.serverId, this.host.fingerprint, this.host.generation, userId])).rows[0];
      await recordAudit(db, { action: "office.pairing.invite", organizationId, targetType: "pairing_session", targetId: id });
      return { invitationId: id, invitationSecret, serverId: this.host.serverId, hubFingerprint: this.host.fingerprint, hostGeneration: this.host.generation, expiresAt: row.expires_at.toISOString() };
    });
  }

  async challenge(input: Record<string, unknown>, userId: string | null) {
    const key = deviceKey(input.publicKey), deviceId = uuid(input.deviceId), personId = uuid(input.personId);
    const alias = text(input.displayAlias, 40), label = text(input.deviceLabel, 80);
    if (!["windows", "macos", "linux", "other"].includes(String(input.platform))) throw new PairingError("invalid_request");
    const clientNonce = base64(input.clientNonce, 32).toString("base64url");
    return transaction("office.pairing.challenge", undefined, async (db) => {
      const invitation = (await db.query(`SELECT * FROM office_pairing_invitation WHERE secret_hash=$1 FOR UPDATE`, [hashSecret(input.invitationSecret)])).rows[0];
      if (!invitation || invitation.used_at || invitation.cancelled_at || invitation.expires_at.getTime() <= Date.now()) throw new PairingError("invitation_unavailable", 410);
      if (input.hubFingerprint !== this.host.fingerprint || invitation.hub_fingerprint !== this.host.fingerprint || invitation.server_id !== this.host.serverId || invitation.host_generation !== this.host.generation) throw new PairingError("wrong_workspace", 403);
      const organizationId: string = invitation.organization_id;
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`office-pairing:${organizationId}`]);
      const count = (await db.query("SELECT count(*)::int AS n FROM pairing_session WHERE organization_id=$1 AND state=ANY($2::text[]) AND expires_at>now()", [organizationId, live])).rows[0].n;
      if (count >= 100) throw new PairingError("try_later", 429);
      const id = randomUUID(), token = secret(), serverNonce = secret();
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      const challenge: Challenge = { serverId: this.host.serverId, organizationId, sessionId: id, deviceId,
        keyFingerprint: digest(key).toString("hex"), clientNonce, serverNonce, audience: this.host.audience,
        hostGeneration: this.host.generation, protocolVersion: 1, expiresAt, requesterUserId: userId,
        personId, displayAlias: alias };
      await db.query(`INSERT INTO person_device(id,public_key,key_algorithm,key_fingerprint,device_label,platform)
        VALUES ($1,$2,'Ed25519',$3,$4,$5)`, [deviceId, key, digest(key), label, input.platform]);
      await db.query(`INSERT INTO pairing_session
        (id,organization_id,invitation_id,device_id,requested_person_id,requester_user_id,display_alias,challenge_hash,nonce_hash,
         server_nonce_hash,capability_hash,server_id,protocol_version,audience,host_generation,proof_expires_at,expires_at,state)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14,$15,$15,'challenge_issued')`,
      [id, organizationId, invitation.id, deviceId, personId, userId, alias, challengeDigest(challenge), digest(base64(clientNonce, 32)),
        digest(base64(serverNonce, 32)), hashSecret(token), this.host.serverId, this.host.audience, this.host.generation, expiresAt]);
      const consumed = await db.query("UPDATE office_pairing_invitation SET used_at=now(), updated_at=now() WHERE id=$1 AND used_at IS NULL AND cancelled_at IS NULL AND expires_at>now()", [invitation.id]);
      if (consumed.rowCount !== 1) throw new PairingError("invitation_unavailable", 410);
      await recordAudit(db, { action: "office.device.register", organizationId, targetType: "device", targetId: deviceId, after: { status: "unpaired" }, refs: { pairingSessionId: id } });
      await event(db, "office.pairing.challenge", { id, organization_id: organizationId, device_id: deviceId }, undefined, "challenge_issued");
      return { challenge, pairingToken: token };
    });
  }

  async proof(id: string, input: Record<string, unknown>) {
    return transaction("office.pairing.proof", undefined, async (db) => {
      const row = await load(db, id); capability(row, input.pairingToken); hostMatches(row, this.host);
      if (await expire(db, row)) return new PairingError("expired", 410);
      if (row.state !== "challenge_issued" || row.proof_used_at) throw new PairingError("already_used", 409);
      const value: Challenge = { serverId: row.server_id, organizationId: row.organization_id, sessionId: row.id, deviceId: row.device_id,
        keyFingerprint: row.key_fingerprint.toString("hex"), clientNonce: String(input.clientNonce), serverNonce: String(input.serverNonce),
        audience: row.audience, hostGeneration: row.host_generation, protocolVersion: row.protocol_version,
        expiresAt: row.proof_expires_at.toISOString(), requesterUserId: row.requester_user_id, personId: row.requested_person_id, displayAlias: row.display_alias };
      let valid = false;
      try { valid = same(row.nonce_hash, digest(base64(input.clientNonce, 32))) && same(row.server_nonce_hash, digest(base64(input.serverNonce, 32))) && same(row.challenge_hash, challengeDigest(value)) && verifyProof(row.public_key, row.challenge_hash, input.signature); } catch { /* Invalid proof counts toward the persisted attempt limit. */ }
      if (!valid) {
        const state = row.failed_attempts >= 4 ? "cancelled" : row.state;
        await db.query("UPDATE pairing_session SET failed_attempts=failed_attempts+1, state=$2, updated_at=now() WHERE id=$1 AND state='challenge_issued'", [row.id, state]);
        if (state === "cancelled") {
          await db.query("UPDATE person_device SET status='revoked', revoked_at=now(), updated_at=now() WHERE id=$1", [row.device_id]);
          await event(db, "office.pairing.cancel", row, row.state, state);
        }
        return new PairingError("invalid_proof", 403);
      }
      const verified = await db.query("UPDATE pairing_session SET state='proof_verified', proof_used_at=now(), updated_at=now() WHERE id=$1 AND state='challenge_issued' AND proof_used_at IS NULL AND expires_at>now()", [row.id]);
      if (verified.rowCount !== 1) { await expire(db, row); return new PairingError("expired", 410); }
      await event(db, "office.pairing.proof", row, row.state, "proof_verified"); row.state = "proof_verified";
      return minimal(row);
    });
  }

  async request(id: string, token: unknown, userId: string | null) {
    return transaction("office.pairing.request", undefined, async (db) => {
      const row = await load(db, id); capability(row, token); hostMatches(row, this.host);
      if (await expire(db, row)) return new PairingError("expired", 410);
      if (row.state !== "proof_verified") throw new PairingError("conflict", 409);
      if (row.requester_user_id !== userId) throw new PairingError("account_mismatch", 403);
      // A pre-existing profile can only be claimed by its already linked account.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`office-person:${row.requested_person_id}`]);
      const person = (await db.query("SELECT * FROM person_identity WHERE id=$1 FOR UPDATE", [row.requested_person_id])).rows[0];
      if (person && (!userId || person.linked_user_id !== userId || person.disabled_at)) throw new PairingError("account_mismatch", 403);
      if (!person) {
        await db.query(`INSERT INTO person_identity(id,display_alias,alias_normalized,alias_disambiguator,linked_user_id)
          VALUES ($1,$2,$3,$4,$5)`, [row.requested_person_id, row.display_alias, normalizeAlias(row.display_alias), personCode(row.requested_person_id).slice(0, 4), userId]);
        if (userId) await recordAudit(db, { action: "office.person.link", organizationId: row.organization_id, targetType: "person", targetId: row.requested_person_id, refs: { pairingSessionId: row.id, deviceId: row.device_id } });
      } else if (person.display_alias !== row.display_alias) {
        throw new PairingError("profile_mismatch", 409);
      }
      await db.query("UPDATE person_device SET person_id=$2,status='pending',updated_at=now() WHERE id=$1 AND status='unpaired'", [row.device_id, row.requested_person_id]);
      const updated = (await db.query<Session>(`UPDATE pairing_session SET person_id=$2,state='pending_approval',expires_at=now()+interval '24 hours',updated_at=now()
        WHERE id=$1 AND state='proof_verified' AND expires_at>now() RETURNING *`, [row.id, row.requested_person_id])).rows[0];
      if (!updated) throw new PairingError("expired", 410);
      await event(db, "office.pairing.request", row, row.state, "pending_approval");
      return minimal(updated);
    });
  }

  async status(id: string, token: unknown) {
    return transaction("office.pairing.status", undefined, async (db) => {
      const row = await load(db, id); capability(row, token); hostMatches(row, this.host);
      if (await expire(db, row)) return new PairingError("expired", 410);
      if (row.state === "cancelled" || row.state === "rejected") throw new PairingError("conflict", 409);
      return minimal(row);
    });
  }

  async decide(id: string, userId: string, decision: "approved" | "rejected" | "cancelled", reason: string | null) {
    if (reason !== null && !["not_recognized", "request_cancelled", "policy", "device_revoked"].includes(reason)) throw new PairingError("invalid_request");
    return transaction(`office.pairing.${decision}`, undefined, async (db) => {
      const row = await load(db, id); hostMatches(row, this.host);
      await member(db, row.organization_id, userId, true);
      if (await expire(db, row)) return new PairingError("expired", 410);
      if (decision === "approved" && row.requester_user_id === userId) throw new PairingError("self_approval", 403);
      if (row.state === decision && row.decided_by_user_id === userId && row.decision_reason_code === reason) return minimal(row);
      if (decision === "cancelled" ? terminal.has(row.state) && row.state !== "approved" : row.state !== "pending_approval") throw new PairingError("conflict", 409);
      if (decision === "approved") {
        await member(db, row.organization_id, row.requester_user_id);
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`office-directory:${row.organization_id}`]);
        const person = (await db.query("SELECT * FROM person_identity WHERE id=$1 FOR UPDATE", [row.person_id])).rows[0];
        if (!person || person.disabled_at || person.linked_user_id !== row.requester_user_id) throw new PairingError("account_required", 403);
        // The full UUID-derived code is injective. Extend stored prefixes on collisions, never merge people.
        const people = (await db.query<{ id: string; alias_disambiguator: string }>(`SELECT p.id,p.alias_disambiguator FROM person_identity p
          WHERE p.id=$1 OR EXISTS(SELECT 1 FROM office_person_membership m WHERE m.person_id=p.id AND m.organization_id=$2)
          ORDER BY p.id FOR UPDATE OF p`, [row.person_id, row.organization_id])).rows;
        for (const item of people) {
          const full = personCode(item.id);
          let length = Math.max(4, item.alias_disambiguator.length);
          while (people.some((other) => other.id !== item.id && personCode(other.id).slice(0, length) === full.slice(0, length))) length++;
          await db.query("UPDATE person_identity SET alias_disambiguator=$2,updated_at=now() WHERE id=$1", [item.id, full.slice(0, length)]);
        }
        const existing = (await db.query("SELECT status FROM office_person_membership WHERE person_id=$1 AND organization_id=$2 FOR UPDATE", [row.person_id, row.organization_id])).rows[0];
        if (existing && existing.status !== "active") throw new PairingError("not_allowed", 403);
        await db.query(`INSERT INTO office_person_membership(person_id,organization_id,user_id,status,approved_by_user_id)
          VALUES ($1,$2,$3,'active',$4) ON CONFLICT (person_id,organization_id) DO NOTHING`, [row.person_id, row.organization_id, row.requester_user_id, userId]);
      }
      const deviceState = decision === "approved" ? "approved" : decision === "rejected" ? "rejected" : "revoked";
      await db.query(`UPDATE person_device SET status=$2,updated_at=now(),approved_at=CASE WHEN $2='approved' THEN now() ELSE approved_at END,
        revoked_at=CASE WHEN $2='revoked' THEN now() ELSE revoked_at END WHERE id=$1`, [row.device_id, deviceState]);
      const updated = (await db.query<Session>(`UPDATE pairing_session SET state=$2,decided_at=now(),decided_by_user_id=$3,decision_reason_code=$4,updated_at=now()
        WHERE id=$1 AND state=$5 AND (expires_at>now() OR state='approved') RETURNING *`, [row.id, decision, userId, reason, row.state])).rows[0];
      if (!updated) throw new PairingError("conflict", 409);
      await event(db, decision === "approved" ? "office.pairing.approve" : decision === "rejected" ? "office.pairing.reject" : "office.pairing.cancel", row, row.state, decision);
      if (decision === "cancelled" && row.state === "approved") await recordAudit(db, { action: "office.device.revoke", organizationId: row.organization_id, targetType: "device", targetId: row.device_id, refs: { pairingSessionId: row.id } });
      return minimal(updated);
    });
  }

  async cancel(id: string, token: unknown) {
    return transaction("office.pairing.cancel", undefined, async (db) => {
      const row = await load(db, id); capability(row, token); hostMatches(row, this.host);
      if (await expire(db, row)) return new PairingError("expired", 410);
      if (row.state === "cancelled") return minimal(row);
      if (terminal.has(row.state)) throw new PairingError("conflict", 409);
      await db.query("UPDATE pairing_session SET state='cancelled',updated_at=now(),decided_at=now() WHERE id=$1 AND state=$2", [row.id, row.state]);
      await db.query("UPDATE person_device SET status='revoked',updated_at=now(),revoked_at=now() WHERE id=$1", [row.device_id]);
      await event(db, "office.pairing.cancel", row, row.state, "cancelled"); row.state = "cancelled";
      return minimal(row);
    });
  }

  async cancelInvitation(id: string, userId: string) {
    return transaction("office.pairing.cancel", undefined, async (db) => {
      const invitation = (await db.query("SELECT * FROM office_pairing_invitation WHERE id=$1 FOR UPDATE", [uuid(id)])).rows[0];
      if (!invitation) throw new PairingError("not_found", 404);
      await member(db, invitation.organization_id, userId, true);
      await db.query("UPDATE office_pairing_invitation SET cancelled_at=COALESCE(cancelled_at,now()),updated_at=now() WHERE id=$1", [id]);
      const rows = (await db.query<Session>("SELECT * FROM pairing_session WHERE invitation_id=$1 AND state=ANY($2::text[]) FOR UPDATE", [id, live])).rows;
      for (const row of rows) {
        await db.query("UPDATE pairing_session SET state='cancelled',updated_at=now() WHERE id=$1", [row.id]);
        await db.query("UPDATE person_device SET status='revoked',revoked_at=now(),updated_at=now() WHERE id=$1", [row.device_id]);
        await event(db, "office.pairing.cancel", row, row.state, "cancelled");
      }
      await recordAudit(db, { action: "office.pairing.cancel", organizationId: invitation.organization_id, targetType: "pairing_session", targetId: id });
      return { cancelled: true };
    });
  }

  async queue(organizationId: string, userId: string) {
    return transaction("office.pairing.queue", organizationId, async (db) => {
      await member(db, organizationId, userId, true);
      return (await db.query(`SELECT s.id AS "sessionId",s.display_alias AS "displayAlias",d.device_label AS "deviceLabel",d.platform,
        substr(encode(d.key_fingerprint,'hex'),1,12) AS "comparisonCode",s.created_at AS "requestedAt",true AS "proofVerified",
        (s.requester_user_id IS NOT NULL) AS "accountLinked" FROM pairing_session s JOIN person_device d ON d.id=s.device_id
        WHERE s.organization_id=$1 AND s.state='pending_approval' AND s.expires_at>now() ORDER BY s.created_at LIMIT 100`, [organizationId])).rows;
    });
  }

  async directory(organizationId: string, userId: string) {
    return transaction("office.directory.read", organizationId, async (db) => {
      await member(db, organizationId, userId);
      const own = (await db.query(`SELECT 1 FROM office_person_membership m JOIN person_identity p ON p.id=m.person_id
        WHERE m.organization_id=$1 AND m.user_id=$2 AND m.status='active' AND p.disabled_at IS NULL
        AND EXISTS(SELECT 1 FROM person_device d JOIN pairing_session s ON s.device_id=d.id WHERE d.person_id=p.id AND d.status='approved' AND s.state='approved' AND s.organization_id=$1)`, [organizationId, userId])).rowCount;
      if (!own) throw new PairingError("approval_required", 403);
      const people = (await db.query<{ personId: string; displayAlias: string; normalized: string; code: string; role: string }>(`SELECT p.id AS "personId",p.display_alias AS "displayAlias",p.alias_normalized AS normalized,p.alias_disambiguator AS code,b.role
        FROM person_identity p JOIN office_person_membership m ON m.person_id=p.id JOIN member b ON b."organizationId"=m.organization_id AND b."userId"=m.user_id
        WHERE m.organization_id=$1 AND m.status='active' AND p.disabled_at IS NULL AND EXISTS(SELECT 1 FROM person_device d JOIN pairing_session s ON s.device_id=d.id WHERE d.person_id=p.id AND d.status='approved' AND s.state='approved' AND s.organization_id=$1)
        ORDER BY p.id`, [organizationId])).rows;
      const active = people.filter((p) => isTeamRole(p.role));
      return active.map((p) => ({ personId: p.personId, displayAlias: p.displayAlias,
        displayName: active.some((other) => other.personId !== p.personId && other.normalized === p.normalized) ? `${p.displayAlias} · ${p.code}` : p.displayAlias }));
    });
  }
}

/** Maintenance entry point; callers schedule this alongside existing retention work. */
export async function sweepPairings(limit = 100): Promise<number> {
  return auditContext.run({ actorKind: "system", requestId: randomUUID() }, () => transaction("office.pairing.expire", undefined, async (db) => {
    const rows = (await db.query<Session>("SELECT * FROM pairing_session WHERE state=ANY($1::text[]) AND expires_at<=now() ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED", [live, Math.max(1, Math.min(1000, limit))])).rows;
    for (const row of rows) await expire(db, row);
    return rows.length;
  }));
}

// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
export const JOIN_ATTEMPT_LIMIT = 10;
export const JOIN_ATTEMPT_WINDOW_MINUTES = 15;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const generate = () => Array.from(randomBytes(8), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
export async function getOrRotateJoinCode(organizationId: string, actorUserId: string, rotate = false) {
  for (let tries = 0; tries < 5; tries++) {
    try {
      const { rows } = await pool.query<{ code: string; expires_at: Date }>(
        rotate ? `INSERT INTO org_join_codes (organization_id, code, created_by, rotated_at)
          VALUES ($1,$2,$3,now()) ON CONFLICT (organization_id) DO UPDATE
          SET code = EXCLUDED.code, expires_at = now() + interval '7 days', rotated_at = now(), created_by = $3
          RETURNING code, expires_at` :
          `INSERT INTO org_join_codes (organization_id,code,created_by) VALUES ($1,$2,$3)
           ON CONFLICT (organization_id) DO UPDATE SET organization_id = EXCLUDED.organization_id
           RETURNING code, expires_at`, [organizationId, generate(), actorUserId],
      );
      return { code: rows[0].code, expiresAt: rows[0].expires_at.toISOString() };
    } catch (error) { if ((error as { code?: string }).code !== "23505") throw error; }
  }
  throw new Error("Could not generate a join code");
}
/** Per-account advisory lock serializes concurrent requests across instances. */
export async function claimJoinAttempt(userId: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`join-attempt:${userId}`]);
    const { rows } = await client.query<{ count: string }>(
      "SELECT count(*) FROM join_code_attempts WHERE user_id = $1 AND attempted_at > now() - interval '15 minutes'", [userId],
    );
    if (Number(rows[0].count) >= JOIN_ATTEMPT_LIMIT) { await client.query("ROLLBACK"); return null; }
    const result = await client.query<{ id: string }>("INSERT INTO join_code_attempts (user_id) VALUES ($1) RETURNING id", [userId]);
    await client.query("COMMIT"); return String(result.rows[0].id);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

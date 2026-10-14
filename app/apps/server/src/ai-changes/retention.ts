// SPDX-License-Identifier: Apache-2.0
import { pool } from "../db/pool.js";
import { config } from "../config.js";

/** Bounded, instance-serialized deletion of expired plaintext and audit metadata. */
export async function pruneAiChanges(now = new Date()): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock(hashtextextended('ai-ledger-retention', 0)) AS ok");
    if (!lock.rows[0].ok) { await client.query("COMMIT"); return 0; }
    const result = await client.query(
      `DELETE FROM ai_change_ledger WHERE id IN (
         SELECT id FROM ai_change_ledger WHERE created_at < $1::timestamptz - $2 * interval '1 day'
         ORDER BY created_at LIMIT 5000
       )`, [now, config.aiChangesRetentionDays],
    );
    await client.query("COMMIT");
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

let timer: ReturnType<typeof setInterval> | null = null;
async function tick() {
  try {
    for (let i = 0; i < 20; i++) if (await pruneAiChanges() < 5000) break;
  } catch (error) { console.error("[ai-changes] retention failed:", error); }
}
export function startAiChangesRetention() {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick(), 60 * 60 * 1000);
  timer.unref();
}
export function stopAiChangesRetention() {
  if (timer) clearInterval(timer);
  timer = null;
}

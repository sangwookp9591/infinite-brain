// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { appendUpdate, compact } from "../yjs/persistence.js";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import type { McpAuth } from "../mcp/tokens.js";

export type AiChangeOp = "create" | "update" | "append" | "edit" | "delete" | "move";
export interface AiChangeActor {
  auth: McpAuth;
  op: AiChangeOp;
  tool?: string;
  beforePath: string;
  afterPath: string;
  beforeTitle?: string | null;
  afterTitle?: string | null;
}
export const LEDGER_TEXT_MAX_BYTES = 1024 * 1024;
export const textHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Same plaintext-at-rest boundary as note_texts; oversized bodies retain hashes only. */
export async function recordAiChange(
  vaultId: string, docId: string, actor: AiChangeActor, before: string, after: string,
  db: Pick<typeof pool, "query"> = pool,
): Promise<void> {
  const { auth, op } = actor;
  const connection = auth.connection;
  // Non-MCP writers (versions, recovery, tests) have no connection to attribute.
  if (!connection) return;
  // Standalone creates need the same transaction/lock as CRDT and structural writes.
  if (db === pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await recordAiChange(vaultId, docId, actor, before, after, client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    return;
  }
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('ai-ledger:' || $1, 0))", [vaultId]);
  const { rows: usage } = await db.query<{ bytes: string }>(
    `SELECT COALESCE(sum(COALESCE(octet_length(before_text), 0) + COALESCE(octet_length(after_text), 0)), 0)::text AS bytes
       FROM ai_change_ledger WHERE vault_id = $1`, [vaultId],
  );
  const bounded = (text: string) => Buffer.byteLength(text, "utf8") <= LEDGER_TEXT_MAX_BYTES ? text : null;
  const overBudget = config.aiChangesMaxBytes === 0 || Number(usage[0].bytes) + Buffer.byteLength(bounded(before) ?? "") + Buffer.byteLength(bounded(after) ?? "") > config.aiChangesMaxBytes;
  await db.query(
    `INSERT INTO ai_change_ledger
       (id, org_id, vault_id, doc_id, actor_user_id, connection_kind, connection_id,
        connection_label, tool, op, before_text_hash, after_text_hash, before_text, after_text,
        before_path, after_path, before_title, after_title, diff_summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [randomUUID(), auth.organizationId, vaultId, docId, auth.userId, connection.kind,
      connection.id, connection.label.slice(0, 200), actor.tool ?? `${op}_note`, op, textHash(before), textHash(after),
      overBudget ? null : bounded(before), overBudget ? null : bounded(after), actor.beforePath, actor.afterPath,
      actor.beforeTitle ?? null, actor.afterTitle ?? null,
      { beforeBytes: Buffer.byteLength(before), afterBytes: Buffer.byteLength(after),
        oversized: bounded(before) === null || bounded(after) === null, quotaExceeded: overBudget }],
  );
}

/** Commit the binary update and its audit row together before acknowledging MCP. */
export async function persistAiChange(vaultId: string, docId: string, update: Uint8Array,
  actor: AiChangeActor, before: string, after: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await appendUpdate(docId, update, client, Number.MAX_SAFE_INTEGER);
    await recordAiChange(vaultId, docId, actor, before, after, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  // Compaction owns its own locks/transaction, after the ledger commit.
  try {
    const { rows } = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM doc_updates WHERE doc_id = $1", [docId]);
    if (Number(rows[0]?.count) > config.compactionThreshold) await compact(docId);
  } catch { /* The update and ledger are already durable; compaction can retry later. */ }
}

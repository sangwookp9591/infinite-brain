// SPDX-License-Identifier: Apache-2.0
import { createResolverCache, type Permission } from "../permissions/resolver.js";
import { pool } from "../db/pool.js";
import { orgRole, vaultOrg } from "../permissions/lookup.js";
import { trashedNotePermission } from "../trash/access.js";
import { restoreNote } from "../trash/service.js";
import { softDeleteSet } from "../trash/retention.js";
import { trashChanged } from "../trash/activity.js";
import { purgeNoteIndex, scheduleIndex } from "../index/indexer.js";
import { moveNote, planNoteMove } from "../registry/tree-ops.js";
import { canEditFolder, vaultRootWritable } from "../permissions/http-gates.js";
import { withDocLock } from "../sync/doc-batch.js";
import { replacementOp, type DocWriter } from "../mcp/doc-writer.js";
import { textHash, type AiChangeOp } from "./store.js";

export interface AiChangeRow {
  id: string; org_id: string; vault_id: string; doc_id: string; actor_user_id: string;
  connection_kind: "oauth" | "token"; connection_id: string; connection_label: string;
  tool: string; op: AiChangeOp; before_text_hash: string; after_text_hash: string;
  before_text: string | null; after_text: string | null;
  before_path: string; after_path: string; before_title: string | null; after_title: string | null;
  created_at: Date | string; reverted_at: Date | null;
}

export class AiChangeError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 413, readonly code: string,
    message: string, readonly diff?: unknown) { super(message); }
}

export interface AiChangeDeps {
  docWriter: DocWriter;
  disconnectDoc: (vaultId: string, docId: string) => void;
  onRegistryChanged?: (vaultId: string, originId: string | null) => void;
}

async function requireVault(userId: string, vaultId: string) {
  const org = await vaultOrg(vaultId);
  if (!org || !(await orgRole(org, userId))) {
    throw new AiChangeError(404, "unknown_vault", "Unknown vault");
  }
}

export async function getAiChange(userId: string, id: string): Promise<AiChangeRow> {
  const { rows } = await pool.query<AiChangeRow>("SELECT * FROM ai_change_ledger WHERE id = $1", [id]);
  const row = rows[0];
  if (!row || (await trashedNotePermission(userId, row.doc_id)) === "none") {
    throw new AiChangeError(404, "unknown_change", "Unknown change");
  }
  return row;
}

/** Keyset scan bounds response bodies while filtering BEFORE the visible limit. */
export async function listAiChanges(userId: string, vaultId: string,
  opts: { connection?: string; doc?: string; limit?: number; since?: string; unreverted?: boolean } = {}) {
  await requireVault(userId, vaultId);
  const limit = opts.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new AiChangeError(400, "invalid_limit", "limit must be between 1 and 200");
  }
  const items: Omit<AiChangeRow, "before_text" | "after_text">[] = [];
  const resolverCache = createResolverCache();
  const permissions = new Map<string, Permission>();
  let cursor: { created_at: Date | string; id: string } | undefined;
  // shortcut: scan at most 2000 rows per request; narrow by connection/doc for older history.
  for (let scanned = 0; scanned < 2000; scanned += 200) {
    const { rows } = await pool.query<Omit<AiChangeRow, "before_text" | "after_text">>(
      `SELECT id, org_id, vault_id, doc_id, actor_user_id, connection_kind, connection_id,
              connection_label, tool, op, before_text_hash, after_text_hash, before_path, after_path,
              before_title, after_title, diff_summary,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              reverted_at, reverted_by
         FROM ai_change_ledger WHERE vault_id = $1
          AND ($2::text IS NULL OR connection_id = $2) AND ($3::text IS NULL OR doc_id = $3)
          AND ($4::timestamptz IS NULL OR created_at >= $4)
          AND ($5::timestamptz IS NULL OR (created_at, id) < ($5, $6))
          AND (NOT $7::boolean OR reverted_at IS NULL)
        ORDER BY ai_change_ledger.created_at DESC, id DESC LIMIT 200`,
      [vaultId, opts.connection ?? null, opts.doc ?? null, opts.since ?? null,
        cursor?.created_at ?? null, cursor?.id ?? null, opts.unreverted === true],
    );
    for (const row of rows) {
      let access = permissions.get(row.doc_id);
      if (access === undefined) {
        access = await trashedNotePermission(userId, row.doc_id, pool, resolverCache);
        permissions.set(row.doc_id, access);
      }
      if (access === "none") continue;
      items.push(row);
      if (items.length > limit) return { items: items.slice(0, limit), truncated: true };
    }
    if (rows.length < 200) return { items, truncated: false };
    cursor = rows[rows.length - 1];
  }
  return { items, truncated: true };
}

function conflict(row: AiChangeRow, current: string, currentPath?: string): never {
  throw new AiChangeError(409, "conflict", "The note changed after this AI edit. Review the diff before editing it.", {
    expected: row.after_text, current, before: row.before_text,
    expectedPath: row.after_path, currentPath,
  });
}

export async function revertAiChange(userId: string, id: string, deps: AiChangeDeps) {
  // Repeated requests serialize on the ledger row; different entries on one doc
  // still use DocWriter's shared doc lock and revision guard.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<AiChangeRow>("SELECT * FROM ai_change_ledger WHERE id = $1 FOR UPDATE", [id]);
    const row = rows[0];
    const access = row ? await trashedNotePermission(userId, row.doc_id) : "none";
    if (!row || access === "none") {
      throw new AiChangeError(404, "unknown_change", "Unknown change");
    }
    if (access !== "edit") {
      throw new AiChangeError(403, "no_edit_permission", "Edit permission is required");
    }
    if (row.reverted_at) { await client.query("COMMIT"); return { id, status: "already_reverted" }; }
    if (row.before_text === null || row.after_text === null) {
      throw new AiChangeError(413, "snapshot_too_large", "This change exceeds the 1 MiB undo snapshot limit");
    }
    const { rows: notes } = await client.query<{
      rel_path: string; title: string | null; deleted_at: Date | null; purged_at: Date | null;
    }>("SELECT rel_path, title, deleted_at, purged_at FROM notes WHERE id = $1", [row.doc_id]);
    const note = notes[0];
    if (!note || note.purged_at) throw new AiChangeError(409, "purged", "The note was permanently removed");
    const structural = row.op === "create" || row.op === "delete" || row.op === "move";
    if (!structural) {
      if (note.deleted_at) conflict(row, await deps.docWriter.readContent(row.vault_id, row.doc_id), note.rel_path);
      await deps.docWriter.editContent(row.vault_id, row.doc_id, (current) => {
        if (textHash(current) !== row.after_text_hash) conflict(row, current);
        return replacementOp(current, row.before_text!);
      }, { userId, source: "ai-revert" });
      await client.query("UPDATE notes SET updated_at = now() WHERE id = $1", [row.doc_id]);
    } else {
      await withDocLock(row.doc_id, async () => {
        const { rows: fresh } = await client.query<typeof note>(
          "SELECT rel_path, title, deleted_at, purged_at FROM notes WHERE id = $1", [row.doc_id]);
        const currentNote = fresh[0];
        const current = await deps.docWriter.readContent(row.vault_id, row.doc_id);
        if (!currentNote || currentNote.purged_at || textHash(current) !== row.after_text_hash || currentNote.rel_path !== row.after_path ||
            currentNote.title !== row.after_title || Boolean(currentNote.deleted_at) !== (row.op === "delete")) {
          conflict(row, current, currentNote?.rel_path);
        }
        if (row.op === "delete") {
          await restoreNote(userId, row.doc_id);
          scheduleIndex(row.doc_id, 0);
        } else if (row.op === "create") {
          await client.query(`UPDATE notes SET ${softDeleteSet("$2")} WHERE id = $1`, [row.doc_id, userId]);
          await purgeNoteIndex([row.doc_id], client);
        } else {
          const { rows: currentRows } = await client.query<{ folder_id: string | null }>(
            "SELECT folder_id FROM notes WHERE id = $1 FOR UPDATE", [row.doc_id]);
          const input = { relPath: row.before_path, title: row.before_title };
          const plan = await planNoteMove(client, { id: row.doc_id, vault_id: row.vault_id,
            folder_id: currentRows[0].folder_id, rel_path: note.rel_path, title: note.title }, input);
          if (plan.folderId !== currentRows[0].folder_id) {
            const allowed = plan.folderId
              ? await canEditFolder(userId, plan.folderId, client)
              : await vaultRootWritable(userId, row.org_id, client);
            if (!allowed) throw new AiChangeError(403, "no_destination_permission", "Cannot move into the original folder");
            if (!plan.folderId) {
              const frozen = await client.query<{ root_frozen: boolean }>("SELECT root_frozen FROM vaults WHERE id = $1", [row.vault_id]);
              if (frozen.rows[0]?.root_frozen) throw new AiChangeError(403, "root_frozen", "The vault root is frozen");
            }
          }
          await moveNote(client, row.doc_id, input);
        }
      });
    }
    await client.query("UPDATE ai_change_ledger SET reverted_at = now(), reverted_by = $2 WHERE id = $1", [id, userId]);
    await client.query("COMMIT");
    if (structural) {
      if (row.op === "create") deps.disconnectDoc(row.vault_id, row.doc_id);
      deps.onRegistryChanged?.(row.vault_id, null);
      trashChanged(row.vault_id);
    }
    return { id, status: "reverted" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

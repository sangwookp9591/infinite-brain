// SPDX-License-Identifier: Apache-2.0
import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";

type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;
export interface AuditContext {
  requestId: string;
  actorUserId?: string;
  organizationId?: string;
  actorKind: "user" | "system" | "mcp";
}
export const auditContext = new AsyncLocalStorage<AuditContext>();
export interface AuditEntry {
  organizationId?: string | null;
  actorUserId?: string | null;
  actorKind?: AuditContext["actorKind"];
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  result?: "ok" | "refused" | "failed";
  refs?: Record<string, unknown>;
}

/** Call with the mutation's client before COMMIT. A refusal uses its own transaction. */
export async function recordAudit(db: Queryable, entry: AuditEntry): Promise<void> {
  const context = auditContext.getStore();
  await db.query(
    `INSERT INTO audit_log
       (organization_id, actor_user_id, actor_kind, action, target_type, target_id,
        before, after, result, request_id, refs)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb)`,
    [entry.organizationId ?? context?.organizationId ?? null,
      entry.actorUserId ?? context?.actorUserId ?? null,
      entry.actorKind ?? context?.actorKind ?? "system", entry.action, entry.targetType,
      entry.targetId ?? null, JSON.stringify(entry.before ?? null), JSON.stringify(entry.after ?? null),
      entry.result ?? "ok", context?.requestId ?? null, JSON.stringify(entry.refs ?? {})],
  );
}

/** Bounded deletion, so a busy vault cannot monopolize a maintenance tick. */
export async function sweepAuditLog(db: Queryable, limit = 5000): Promise<number> {
  const result = await db.query(
    `DELETE FROM audit_log WHERE id IN (
       SELECT a.id FROM audit_log a LEFT JOIN organization_access_settings s
         ON s.organization_id = a.organization_id
       WHERE a.created_at < now() - make_interval(days => COALESCE(s.audit_retention_days, 365))
       ORDER BY a.created_at LIMIT $1
     )`, [Math.max(1, Math.min(5000, limit))],
  );
  return result.rowCount ?? 0;
}

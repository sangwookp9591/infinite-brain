// SPDX-License-Identifier: Apache-2.0
import { Hono } from "hono";
import { pool } from "../../db/pool.js";
import { orgRole } from "../../permissions/lookup.js";
import { isManagerRole } from "../../permissions/roles.js";
import { getSession } from "../session.js";

export const auditRoutes = new Hono();
auditRoutes.get("/orgs/:orgId/audit", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Authentication required" }, 401);
  const orgId = c.req.param("orgId");
  if (!isManagerRole(await orgRole(orgId, session.userId))) return c.json({ error: "access_manager_required" }, 403);
  const cursor = c.req.query("before");
  if (cursor && !/^\d+$/.test(cursor)) return c.json({ error: "invalid_cursor" }, 400);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 50));
  const { rows } = await pool.query(
    `SELECT a.*, COALESCE(u.name, 'Unknown') AS actor_name FROM audit_log a
       LEFT JOIN "user" u ON u.id = a.actor_user_id
      WHERE organization_id = $1 AND ($2::bigint IS NULL OR a.id < $2::bigint)
      ORDER BY a.id DESC LIMIT $3`, [orgId, cursor ?? null, limit + 1],
  );
  const more = rows.length > limit;
  const events = rows.slice(0, limit);
  return c.json({ events, nextBefore: more ? String(events.at(-1)?.id) : null });
});

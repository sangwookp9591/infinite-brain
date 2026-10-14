// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { nextAccessRevision, type AccessChangeDeps } from "../../permissions/access-management.js";
import { createResolverCache, effectivePermission } from "../../permissions/resolver.js";
import { Hono } from "hono";
import { pool } from "../../db/pool.js";
import { orgRole } from "../../permissions/lookup.js";
import { parseAppearance } from "../../appearance/schema.js";
import { announceAppearanceChanged } from "../../sync/member-events.js";
import { getSession } from "../session.js";

/**
 * Vault-level appearance (migration 053).
 *
 *  - GET /api/orgs/:orgId/appearance (any member) → `{ settings, updatedAt,
 *    updatedBy }`; `{}` settings and nulls when nothing was ever saved.
 *  - PUT /api/orgs/:orgId/appearance `{ settings }` (owner/admin) REPLACES the
 *    whole object, then announces `appearance-changed` on the vault channel
 *    with the settings inline, the same org-wide fan-out a vault rename/icon
 *    change uses (`announceOrgChanged`). PATCH merges supplied settings, or
 *    atomically toggles a `togglePin` item. No plan gate.
 */
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

type Row = { settings: Record<string, unknown>; updated_by: string | null; updated_at: Date };

function body(row: Row | undefined) {
  return {
    settings: row?.settings ?? {},
    updatedAt: row ? row.updated_at.toISOString() : null,
    updatedBy: row?.updated_by ?? null,
  };
}

export function createAppearanceRoutes(deps: AccessChangeDeps = {}): Hono {
  const appearanceRoutes = new Hono();

  appearanceRoutes.get("/orgs/:orgId/appearance", async (c) => {
    const session = await getSession(c);
    if (!session) return c.json({ error: "Authentication required" }, 401);
    const orgId = c.req.param("orgId");
    if (!ID_RE.test(orgId)) return c.json({ error: "not_member" }, 404);
    const role = await orgRole(orgId, session.userId);
    if (!role) return c.json({ error: "not_member" }, 404);
    const { rows } = await pool.query<Row>(
      "SELECT settings, updated_by, updated_at FROM vault_appearance WHERE organization_id = $1",
      [orgId],
    );
    return c.json(body(rows[0]));
  });

  appearanceRoutes.on(["PUT", "PATCH"], "/orgs/:orgId/appearance", async (c) => {
    const session = await getSession(c);
    if (!session) return c.json({ error: "Authentication required" }, 401);
    const orgId = c.req.param("orgId");
    if (!ID_RE.test(orgId)) return c.json({ error: "not_member" }, 404);
    const role = await orgRole(orgId, session.userId);
    if (!role) return c.json({ error: "not_member" }, 404);
    if (role !== "owner" && role !== "admin") {
      return c.json({ error: "access_manager_required" }, 403);
    }
    const raw = (await c.req.json().catch(() => null)) as { settings?: unknown; togglePin?: unknown } | null;
    if (c.req.method === "PATCH" && raw?.togglePin !== undefined) {
      const check = parseAppearance({ pinnedItems: [raw.togglePin] });
      if (!check.ok) return c.json({ error: "invalid_appearance", key: "pinnedItems" }, 400);
      let pin = check.settings.pinnedItems![0];
      const db = await pool.connect();
      let row: Row | undefined;
      try {
        await db.query("BEGIN");
        if (pin.kind === "folder") {
          // Keep the folder stable until the pin is saved. Folder moves lock the
          // folder before rewriting appearance, so both operations share that
          // lock order and a stale path cannot resurrect an old folder pin.
          const folder = await db.query<{ path: string }>(
            `SELECT path FROM folders WHERE vault_id IN
               (SELECT id FROM vaults WHERE organization_id = $1)
               AND vault_path_key(path) = vault_path_key($2) FOR SHARE`, [orgId, pin.path],
          );
          if (!folder.rows[0]) {
            await db.query("ROLLBACK");
            return c.json({ error: "folder_not_found" }, 404);
          }
          pin = { kind: "folder", path: folder.rows[0].path };
        }
        const samePin = `(p->>'kind' = $2::jsonb->>'kind' AND CASE WHEN p->>'kind' = 'folder'
          THEN lower(p->>'path') = lower($2::jsonb->>'path') ELSE p->>'docId' = $2::jsonb->>'docId' END)`;
        const { rows } = await db.query<Row>(
          `INSERT INTO vault_appearance (organization_id, settings, updated_by, updated_at)
             VALUES ($1, jsonb_build_object('pinnedItems', jsonb_build_array($2::jsonb)), $3, now())
           ON CONFLICT (organization_id) DO UPDATE SET
             settings = jsonb_set(vault_appearance.settings, '{pinnedItems}', CASE
               WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(vault_appearance.settings->'pinnedItems', '[]'::jsonb)) p
                 WHERE ${samePin}) THEN
                 (SELECT COALESCE(jsonb_agg(p ORDER BY ordinal), '[]'::jsonb)
                   FROM jsonb_array_elements(vault_appearance.settings->'pinnedItems') WITH ORDINALITY items(p, ordinal)
                   WHERE NOT ${samePin})
               ELSE COALESCE(vault_appearance.settings->'pinnedItems', '[]'::jsonb) || jsonb_build_array($2::jsonb)
             END), updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
           WHERE COALESCE(jsonb_array_length(vault_appearance.settings->'pinnedItems'), 0) < 200
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(vault_appearance.settings->'pinnedItems') p WHERE ${samePin})
           RETURNING settings, updated_by, updated_at`,
          [orgId, JSON.stringify(pin), session.userId],
        );
        row = rows[0];
        await db.query("COMMIT");
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      } finally { db.release(); }
      if (!row) return c.json({ error: "pin_limit_reached" }, 400);
      const out = body(row);
      await announceAppearanceChanged({ orgId, settings: out.settings, updatedAt: out.updatedAt as string });
      return c.json(out);
    }
    const parsed = parseAppearance(raw?.settings);
    if (!parsed.ok) {
      return c.json({ error: "invalid_appearance", ...(parsed.key ? { key: parsed.key } : {}) }, 400);
    }
    const db = await pool.connect();
    let row: Row | undefined;
    let protectedHome: { vaultId: string; docId: string } | undefined;
    try {
      await db.query("BEGIN");
      const homeDocId = parsed.settings.homeDocId;
      if (homeDocId) {
        // Share access and the Home pointer commit together under the ordinary
        // ACL ordering lock. Publishing Home also makes this file readable to
        // members excluded by file, folder, or vault permissions.
        const revision = await nextAccessRevision(db, orgId);
        const note = await db.query<{ vault_id: string }>(
          `SELECT n.vault_id FROM notes n JOIN vaults v ON v.id = n.vault_id
            WHERE n.id = $1 AND v.organization_id = $2 AND n.deleted_at IS NULL FOR SHARE OF n`, [homeDocId, orgId],
        );
        if (!note.rows[0]) {
          await db.query("ROLLBACK");
          return c.json({ error: "note_not_found" }, 404);
        }
        // A view grant adds visibility without locking owners, admins or
        // existing editors. Explicit readonly/locked shares still apply.
        const inserted = await db.query(
          `INSERT INTO shares (id, org_id, resource_type, resource_id, principal_type,
                               principal_id, permission, created_by, access_revision)
           SELECT $1, $2, 'file', $3, 'org', $2, 'view', $4, $5
            WHERE NOT EXISTS (SELECT 1 FROM shares WHERE org_id = $2
              AND resource_type = 'file' AND resource_id = $3)
              AND NOT EXISTS (SELECT 1 FROM vault_appearance WHERE organization_id = $2
                AND settings->>'homeDocId' = $3)
           ON CONFLICT DO NOTHING`,
          [randomUUID(), orgId, homeDocId, session.userId, revision],
        );
        if (inserted.rowCount) protectedHome = { vaultId: note.rows[0].vault_id, docId: homeDocId };
        const members = await db.query<{ user_id: string }>(
          `SELECT "userId" AS user_id FROM member WHERE "organizationId" = $1`, [orgId],
        );
        const cache = createResolverCache();
        await cache.prefetch(db, [homeDocId]);
        for (const member of members.rows) {
          if (await effectivePermission(member.user_id, homeDocId, db, cache) !== "none") continue;
          // A direct personal readonly share overrides an inherited personal
          // deny and grants access through a private folder without sharing
          // that folder or its other files. Existing view/edit access survives.
          await db.query(
            `INSERT INTO shares (id, org_id, resource_type, resource_id, principal_type,
                                 principal_id, permission, created_by, access_revision)
             VALUES ($1, $2, 'file', $3, 'user', $4, 'readonly', $5, $6)
             ON CONFLICT (resource_type, resource_id, principal_type, principal_id)
             DO UPDATE SET permission = EXCLUDED.permission, created_by = EXCLUDED.created_by,
                           access_revision = EXCLUDED.access_revision`,
            [randomUUID(), orgId, homeDocId, member.user_id, session.userId, revision],
          );
          protectedHome = { vaultId: note.rows[0].vault_id, docId: homeDocId };
        }
      }
      const { rows } = await db.query<Row>(
        `INSERT INTO vault_appearance (organization_id, settings, updated_by, updated_at)
            VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (organization_id)
         DO UPDATE SET settings = CASE WHEN $4 THEN vault_appearance.settings || EXCLUDED.settings ELSE EXCLUDED.settings END,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = EXCLUDED.updated_at
       RETURNING settings, updated_by, updated_at`,
        [orgId, JSON.stringify(parsed.settings), session.userId, c.req.method === "PATCH"],
      );
      row = rows[0];
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally { db.release(); }
    if (protectedHome) {
      try { deps.disconnectDoc?.(protectedHome.vaultId, protectedHome.docId); } catch { /* committed ACL survives a transport failure */ }
      deps.onAclChanged?.(protectedHome.vaultId);
    }
    const out = body(row);
    await announceAppearanceChanged({
      orgId,
      settings: out.settings,
      updatedAt: out.updatedAt as string,
    });
    return c.json(out);
  });

  return appearanceRoutes;
}

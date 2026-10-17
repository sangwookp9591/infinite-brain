// SPDX-License-Identifier: Apache-2.0
import type pg from "pg";
import { pool } from "../db/pool.js";
import { listReadableDocsInVault, listVisibleFolders } from "./vault-docs.js";

type Queryable = Pick<pg.Pool, "query">;
const basename = (path: string) => path.replace(/\\/g, "/").split("/").at(-1) ?? "";
/** Display projection only. Canonical paths and stable IDs never change on disk. */
export async function guestView(userId: string, vaultId: string, db: Queryable = pool) {
  const folders = await listVisibleFolders(userId, vaultId, db);
  const folderIds = new Set(folders.map((folder) => folder.id));
  const roots = folders.filter((folder) => !folder.parent_id || !folderIds.has(folder.parent_id));
  const names = new Map<string, string>();
  for (const root of roots) {
    const duplicate = roots.filter((other) => other.name.toLowerCase() === root.name.toLowerCase()).length > 1;
    names.set(root.id, duplicate ? `${root.name}-${root.id.slice(0, 8)}` : root.name);
  }
  const readable = await listReadableDocsInVault(userId, vaultId, db);
  const paths = (await db.query<{ id: string; path: string }>(`SELECT id,rel_path AS path FROM notes WHERE id=ANY($1::text[])
    UNION ALL SELECT id,path FROM files WHERE id=ANY($1::text[])`, [[...readable]])).rows;
  const projectPath = (path: string) => {
    const root = roots.find((folder) => path.toLowerCase() === folder.path.toLowerCase() || path.toLowerCase().startsWith(`${folder.path.toLowerCase()}/`));
    if (root) return names.get(root.id)! + path.slice(root.path.length);
    const leaf = basename(path);
    const own = paths.find((row) => row.path === path);
    const duplicate = paths.filter((row) => basename(row.path).toLowerCase() === leaf.toLowerCase()).length > 1;
    return duplicate && own ? `${own.id.slice(0, 8)}-${leaf}` : leaf;
  };
  const folderShares = (await db.query<{ path: string; permission: string }>(`SELECT COALESCE(f.path,t.path) AS path,s.permission FROM shares s
    LEFT JOIN folders f ON f.id=s.resource_id AND f.vault_id=$2
    LEFT JOIN folder_tombstones t ON t.id=s.resource_id AND t.vault_id=$2
    WHERE s.principal_type='user' AND s.principal_id=$1 AND s.resource_type='folder'
      AND s.permission IN ('view','edit','readonly','denied') AND COALESCE(f.path,t.path) IS NOT NULL
    ORDER BY length(COALESCE(f.path,t.path)) DESC`, [userId,vaultId])).rows;
  const coversPath = (path: string) => {
    const share = folderShares.find((row) => path.toLowerCase()===row.path.toLowerCase() || path.toLowerCase().startsWith(`${row.path.toLowerCase()}/`));
    return !!share && share.permission !== "denied";
  };
  return { folders, folderIds, readable, projectPath, coversPath };
}

/** Strip person metadata, never note content, from guest-facing DTOs. */
export function redactGuestPeople(value: unknown, selfId: string): unknown {
  if (Array.isArray(value)) return value.map((item) => redactGuestPeople(item, selfId));
  if (!value || typeof value !== "object") return value;
  const row = { ...value } as Record<string, unknown>;
  for (const key of ["created_by", "last_edited_by", "author_id", "authorId", "deleted_by", "user_id"]) {
    if (row[key] && row[key] !== selfId) row[key] = null;
  }
  for (const key of ["last_edited_by_name", "author_name", "authorName", "deleted_by_name"]) {
    if (row[key]) row[key] = "Other user";
  }
  for (const key of ["by", "invitedBy"]) if (row[key]) row[key] = null;
  return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, redactGuestPeople(item, selfId)]));
}

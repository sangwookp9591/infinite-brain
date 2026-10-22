// SPDX-License-Identifier: Apache-2.0
import type { MiddlewareHandler } from "hono";
import { pool } from "../db/pool.js";
import { getSession } from "../http/session.js";
import { resolveResource, vaultOrg } from "../permissions/lookup.js";

// Exact content operations only. Credential delegation and management require
// separate account authentication; an unrecognized future route stays closed.
const contentPaths = [
  /^\/api\/(?:notes|folders|files)(?:\/[^/]+)?$/,
  /^\/api\/notes\/[^/]+\/(?:trash-content|restore|crdt-size)$/,
  /^\/api\/(?:sync-token|vault-sync-token)$/,
  /^\/api\/blobs\/[^/]+$/,
  /^\/api\/vaults\/[^/]+\/(?:graph|search|trash|file-tombstones|storage|access-check|upload-health)$/,
  /^\/api\/vaults\/[^/]+\/(?:notes|files|folders|docs)\/batch$/,
  /^\/api\/vaults\/[^/]+\/notes\/(?:confirm-empty|delete-batch)$/,
  /^\/api\/vaults\/[^/]+\/bootstrap(?:\/[^/]+)?$/,
];

/** Device scope narrows access; existing routes still authorize each operation. */
export const officeHttp: MiddlewareHandler = async (c, next) => {
  const bearer = c.req.header("authorization")?.replace(/^Bearer /i, "");
  if (!bearer?.startsWith("office_")) return next();
  const session = await getSession(c);
  if (!session?.officeSessionId) return c.json({error: "회사 연결이 만료됐어요. 작업 공간을 다시 열어 주세요."}, 401);
  const organizationId = session.activeOrganizationId!;
  const path = c.req.path, method = c.req.method;
  const denied = () => c.json({error: "이 작업은 계정으로 로그인한 뒤 사용할 수 있어요.", code: "office_scope_denied"}, 403);
  const input = !["GET", "HEAD"].includes(method)
    ? await c.req.raw.clone().json().catch(() => ({})) as Record<string, unknown> : {};
  if (!input || Array.isArray(input) || typeof input !== "object") return denied();
  const orgClaims = [...(c.req.queries("organizationId") ?? []), ...(input.organizationId === undefined ? [] : [input.organizationId])];
  if (orgClaims.some(id => id !== organizationId)) return denied();
  const pathVault = path.match(/^\/api\/vaults\/([^/]+)/)?.[1];
  const vaultClaims = [pathVault, ...(c.req.queries("vaultId") ?? []), input.vaultId].filter(id => id !== undefined);
  if (vaultClaims.some(id => typeof id !== "string" || !id)) return denied();
  let claimedVaults: string[];
  try { claimedVaults = (vaultClaims as string[]).map(id => decodeURIComponent(id)); } catch { return denied(); }
  if (new Set(claimedVaults).size > 1) return denied();
  for (const id of claimedVaults) if (await vaultOrg(id) !== organizationId) return denied();

  if (path === "/api/auth/get-session" && method === "GET") {
    const user = (await pool.query('SELECT id,email,name,"emailVerified",image FROM "user" WHERE id=$1', [session.userId])).rows[0];
    return c.json({user, session: {activeOrganizationId: organizationId}});
  }
  if (path === "/api/vaults" && method === "GET") {
    await next();
    if (c.res.ok) {
      const data = await c.res.json() as {vaults: Array<{organization_id: string}>};
      c.res = new Response(JSON.stringify({...data, vaults: data.vaults.filter(v => v.organization_id === organizationId)}), c.res);
    }
    return;
  }
  if (path === "/api/auth/organization/list" && method === "GET") {
    return c.json((await pool.query("SELECT * FROM organization WHERE id=$1", [organizationId])).rows);
  }
  if (!contentPaths.some(pattern => pattern.test(path))) return denied();
  // Presigned/multipart capabilities can survive revocation: direct reads only.
  if (path.startsWith("/api/blobs/") && method !== "GET") return denied();
  let vaultId: string | undefined = claimedVaults[0];
  const item = path.match(/^\/api\/(notes|folders|files)\/([^/]+)(?:\/(?:trash-content|restore|crdt-size))?$/);
  if (item) {
    const resource = await resolveResource(item[1] === "folders" ? "folder" : "file", decodeURIComponent(item[2]));
    if (!resource || resource.organizationId !== organizationId) return denied();
    vaultId = resource.vaultId;
  }
  if (path === "/api/sync-token") {
    if (typeof input.docId !== "string") return denied();
    const resource = await resolveResource("file", input.docId);
    if (!resource || resource.organizationId !== organizationId) return denied();
    vaultId = resource.vaultId;
  }
  const blob = path.match(/^\/api\/blobs\/([^/]+)$/);
  if (blob) vaultId = (await pool.query("SELECT vault_id FROM blobs WHERE id=$1", [decodeURIComponent(blob[1])])).rows[0]?.vault_id;
  if (!vaultId || claimedVaults.some(id => id !== vaultId) || await vaultOrg(vaultId) !== organizationId) return denied();
  return next();
};

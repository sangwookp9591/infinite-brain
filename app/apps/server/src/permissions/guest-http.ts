// SPDX-License-Identifier: Apache-2.0
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { getSession } from "../http/session.js";
import { orgRole, vaultOrg, resolveResource } from "./lookup.js";
import { guestView, redactGuestPeople } from "./guest-view.js";
import { canEditFolder } from "./http-gates.js";
import { isTeamRole } from "./roles.js";
const cursorKey = createHash("sha256").update(config.jwtSecret).digest();
function cursor(value: string, scope: string, decode = false): string {
  if (decode) {
    const data = Buffer.from(value, "base64url");
    if (data.length < 29) throw new Error("invalid cursor");
    const decipher = createDecipheriv("aes-256-gcm", cursorKey, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(scope)); decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  }
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", cursorKey, iv);
  cipher.setAAD(Buffer.from(scope)); const text = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), text]).toString("base64url");
}
const refuse = { error: "Ask a vault owner or admin to change folders or sharing.", code: "guest_action_not_available" };

/** Guest DTO boundary, inside compression. Canonical metadata remains server-side. */
export const guestHttp: MiddlewareHandler = async (c, next) => {
  if (!c.req.path.startsWith("/api/")) return next();
  const session = await getSession(c);
  if (!session) return next();
  const path = c.req.path;
  const input = !["GET", "HEAD"].includes(c.req.method) && !/\/blobs(?:\/|$)/.test(path)
    ? await c.req.raw.clone().json().catch(() => ({})) as Record<string, unknown> : {};
  let vaultId = c.req.query("vaultId") ?? (typeof input.vaultId === "string" ? input.vaultId : undefined) ?? path.match(/\/vaults\/([^/]+)/)?.[1];
  const blobId = path.match(/\/blobs\/([^/]+)/)?.[1];
  const blob = blobId ? (await pool.query<{ vault_id: string; created_by: string | null }>("SELECT vault_id,created_by FROM blobs WHERE id=$1", [blobId])).rows[0] : null;
  if (blob?.vault_id) vaultId = blob.vault_id;
  let organizationId = c.req.query("organizationId") ?? (typeof input.organizationId === "string" ? input.organizationId : undefined) ?? path.match(/\/orgs\/([^/]+)/)?.[1];
  if (organizationId === "join" || organizationId === "join-code") organizationId = undefined;
  if (vaultId) organizationId = await vaultOrg(vaultId) ?? undefined;
  const item = path.match(/\/(notes|files|folders)\/([^/]+)/);
  if (item && !["batch", "delete-batch", "push", "diff"].includes(item[2])) {
    const resource = await resolveResource(item[1] === "folders" ? "folder" : "file", item[2]);
    if (resource) { organizationId = resource.organizationId; vaultId = resource.vaultId; }
  }
  const changeId=path.match(/\/ai-changes\/([^/]+)/)?.[1];
  if(changeId && changeId!=="revert-batch"){
    const change=(await pool.query<{org_id:string;vault_id:string}>("SELECT org_id,vault_id FROM ai_change_ledger WHERE id=$1",[changeId])).rows[0];
    if(change){organizationId=change.org_id;vaultId=change.vault_id;}
  }
  if (typeof input.resourceId === "string" && ["file", "folder", "vault"].includes(String(input.resourceType))) {
    const resource = await resolveResource(input.resourceType as "file" | "folder" | "vault", input.resourceId);
    if (resource) { organizationId = resource.organizationId; vaultId = resource.vaultId; }
  }
  if (c.req.query("organizationSlug") || typeof input.organizationSlug === "string") {
    organizationId = (await pool.query<{ id: string }>("SELECT id FROM organization WHERE slug=$1", [c.req.query("organizationSlug") ?? input.organizationSlug])).rows[0]?.id;
  }
  organizationId ??= session.activeOrganizationId ?? undefined;
  if (!organizationId || isTeamRole(await orgRole(organizationId, session.userId))) return next();
  if ((await orgRole(organizationId, session.userId)) !== "guest") return next();
  if (path === "/api/auth/organization/list-members") {
    const row = (await pool.query(`SELECT m.id,m."organizationId",m."userId",m.role,
      json_build_object('id',u.id,'name',u.name,'email',u.email,'image',u.image) AS "user"
      FROM member m JOIN "user" u ON u.id=m."userId" WHERE m."organizationId"=$1 AND m."userId"=$2`, [organizationId, session.userId])).rows[0];
    return c.json({ members: row ? [row] : [], total: row ? 1 : 0 });
  }
  const write = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
  if (/\/mcp(?:\/|$)|\/oauth/.test(path) || /\/(storage|checkpoints|access-tree|access-board|billing|usage|appearance|housekeeper|invitation-expiries)(?:\/|$)/.test(path) ||
    /\/auth\/organization\/(get-full-organization|list-invitations|create-invitation|add-member|update-member-role|remove-member)/.test(path) ||
    (write && (/\/folders(?:\/|$)/.test(path) || /\/(notes|files)\/[^/]+/.test(path) && c.req.method === "PATCH"))) {
    return c.json(refuse, 403);
  }
  if (blob && c.req.method === "DELETE" && blob.created_by !== session.userId) return c.json({ error: "guest_action_not_available", message: "You can only remove attachments you uploaded. Ask an admin for help." }, 403);
  let view = vaultId ? await guestView(session.userId, vaultId) : null;
  // Reverse only note/file registration inside existing shared folders. Guest
  // rename/move and folder creation stay closed until the full Q3 contract.
  const batch=path.match(/\/vaults\/[^/]+\/(notes|files)\/batch$/);
  if(view && batch && write && Array.isArray(input.items)){
    const items=[];
    for(const raw of input.items){
      if(!raw || typeof raw!=="object")return c.json(refuse,403);
      const item=raw as Record<string,unknown>;
      if(typeof item.relPath!=="string")return c.json(refuse,403);
      const display=item.relPath.replace(/\\/g,"/");const split=display.lastIndexOf("/");
      const parent=split<0?null:view.folders.find(folder=>view!.projectPath(folder.path).toLowerCase()===display.slice(0,split).toLowerCase());
      const claimed=batch[1]==="notes"?item.docId:item.fileId;
      const existing=typeof claimed==="string"?(await pool.query<{path:string;vault_id:string}>(batch[1]==="notes"?"SELECT rel_path AS path,vault_id FROM notes WHERE id=$1":"SELECT path,vault_id FROM files WHERE id=$1",[claimed])).rows[0]:null;
      if(existing && (existing.vault_id!==vaultId || !view.readable.has(claimed as string) || view.projectPath(existing.path).toLowerCase()!==display.toLowerCase()))return c.json(refuse,403);
      if(!existing && (!parent || !(await canEditFolder(session.userId,parent.id))))return c.json(refuse,403);
      const canonical=existing?.path??`${parent!.path}/${display.slice(split+1)}`;
      if(typeof item.folderPath==="string" && item.folderPath.toLowerCase()!==display.slice(0,Math.max(split,0)).toLowerCase())return c.json(refuse,403);
      items.push({...item,relPath:canonical,folderPath:canonical.slice(0,canonical.lastIndexOf("/"))});
    }
    c.req.raw=new Request(c.req.raw,{body:JSON.stringify({...input,items})});
  }
  if (view && c.req.query("after")) {
    try {
      const url = new URL(c.req.url); url.searchParams.set("after", cursor(c.req.query("after")!, `${session.userId}:${vaultId}`, true));
      c.req.raw = new Request(url, c.req.raw);
    } catch { return c.json({ error: "invalid_cursor", message: "Reload this list and try again." }, 400); }
  }
  await next();
  if (c.res.status >= 400 && !blob || !c.res.headers.get("content-type")?.includes("application/json")) return;
  let body = await c.res.json() as Record<string, any>;
  if (path.endsWith("/members/overview") && Array.isArray(body.members)) {
    body.members = body.members.filter((member: any) => member.userId === session.userId);
    body.invitations = []; body.canManage = false;
  }
  if (path === "/api/vaults" && Array.isArray(body.vaults)) {
    const visible = [];
    for (const row of body.vaults) {
      const role = await orgRole(row.organization_id, session.userId);
      if (isTeamRole(role)) { visible.push(row); continue; }
      const scoped = await guestView(session.userId, row.id);
      if (scoped.readable.size || scoped.folders.length) visible.push({ ...row, name: (await pool.query("SELECT name FROM organization WHERE id=$1", [row.organization_id])).rows[0]?.name ?? "Shared vault" });
    }
    body.vaults = visible;
  }
  if (view) {
    if (Array.isArray(body.tombstones) && path === "/api/folders") {
      const rows = (await pool.query<{id:string;path:string}>("SELECT id,path FROM folder_tombstones WHERE vault_id=$1 AND id=ANY($2::text[])", [vaultId,body.tombstones])).rows;
      body.tombstones = rows.filter((row) => view!.coversPath(row.path)).map((row) => row.id);
    }
    if (path.endsWith("/file-tombstones") && Array.isArray(body.ids)) {
      const rows = (await pool.query<{id:string;path:string}>("SELECT id,path FROM file_tombstones WHERE vault_id=$1 AND id=ANY($2::text[])", [vaultId,body.ids])).rows;
      const shares = (await pool.query<{resource_id:string;permission:string}>("SELECT resource_id,permission FROM shares WHERE principal_type='user' AND principal_id=$1 AND resource_type='file'", [session.userId])).rows;
      body.ids = rows.filter((row) => { const own=shares.find((share)=>share.resource_id===row.id); return own?.permission==='denied' ? false : ['view','edit','readonly'].includes(own?.permission ?? '') || view!.coversPath(row.path); }).map((row)=>row.id);
    }
    const project = (value: any): any => {
      if (Array.isArray(value)) return value.map(project);
      if (!value || typeof value !== "object") return value;
      const row = { ...value };
      const canonicalPath = row.rel_path ?? row.relPath ?? row.path;
      if (typeof row.title === "string" && row.title === canonicalPath) row.title = view!.projectPath(row.title);
      for (const key of ["path", "rel_path", "relPath", "beforePath", "afterPath", "before_path", "after_path", "originalPath"]) {
        if (typeof row[key] === "string") row[key] = view!.projectPath(row[key]);
      }
      for (const key of ["parent_id", "parentId", "folder_id", "folderId"]) {
        if (row[key] && !view!.folderIds.has(row[key])) row[key] = null;
      }
      if (Array.isArray(row.referencedBy)) row.referencedBy = row.referencedBy.filter((ref: any) => view!.readable.has(typeof ref === "string" ? ref : ref.docId ?? ref.doc_id ?? ref.id));
      return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, project(value)]));
    };
    body = project(body);
    if (typeof body.nextAfter === "string") body.nextAfter = cursor(body.nextAfter, `${session.userId}:${vaultId}`);
    for (const key of ["locks", "denies", "lifts"]) if (Array.isArray(body[key])) body[key] = body[key].filter((row: any) => view!.folderIds.has(row.resource_id ?? row.resourceId) || view!.readable.has(row.resource_id ?? row.resourceId));
  }
  if (path === "/api/auth/organization/set-active") body = { id: body.id, name: body.name };
  body = redactGuestPeople(body, session.userId) as Record<string, any>;
  c.res = new Response(JSON.stringify(body), { status: c.res.status, headers: c.res.headers });
};

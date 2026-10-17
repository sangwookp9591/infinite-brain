// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { AccessManagementError, nextAccessRevision, requireAccessManager, validateShareTargets } from "../permissions/access-management.js";
import { resolveResource } from "../permissions/lookup.js";
import { recordAudit } from "../audit/log.js";
export interface InvitationTarget { resourceType: "folder" | "file"; resourceId: string; permission: "view" | "edit" }
export async function validateInvitationTargets(organizationId: string, targets: unknown): Promise<InvitationTarget[]> {
  if (!Array.isArray(targets) || !targets.length || targets.length > 100) throw new AccessManagementError("Choose folders or notes to share with this guest.", 400, "guest_targets_required");
  for (const target of targets) {
    if (!target || !["folder", "file"].includes(target.resourceType) || typeof target.resourceId !== "string" || !["view", "edit"].includes(target.permission)) throw new AccessManagementError("Choose folders or notes and who can edit them.", 400, "invalid_guest_targets");
    const resource = await resolveResource(target.resourceType, target.resourceId);
    if (!resource || resource.organizationId !== organizationId) throw new AccessManagementError("One of these items is no longer in this vault.", 404, "resource_not_found");
  }
  return targets as InvitationTarget[];
}
export async function createGuestInvitation(organizationId: string, actorUserId: string, email: string, targets: InvitationTarget[]): Promise<{ id: string }> {
  await requireAccessManager(organizationId, actorUserId);
  const client = await pool.connect(); const id = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`guest-invite:${organizationId}:${email.toLowerCase()}`]);
    await requireAccessManager(organizationId, actorUserId, client);
    await client.query(`UPDATE invitation SET status='canceled' WHERE "organizationId"=$1 AND lower(email)=lower($2) AND status='pending'`, [organizationId, email]);
    await client.query(`INSERT INTO invitation (id,"organizationId",email,role,status,"expiresAt","inviterId","createdAt")
      VALUES ($1,$2,$3,'guest','pending',now()+make_interval(secs=>$5),$4,now())`, [id, organizationId, email, actorUserId, config.invitationExpiresInSeconds]);
    for (const target of targets) await client.query("INSERT INTO invitation_shares (invitation_id,resource_type,resource_id,permission) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [id, target.resourceType, target.resourceId, target.permission]);
    await recordAudit(client, { organizationId, actorUserId, action: "invitation.targets", targetType: "invitation", targetId: id, after: targets });
    await client.query("COMMIT"); return { id };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
/** Membership has committed; all guest grants apply together or stay fail-closed. */
export async function applyGuestInvitation(invitationId: string, organizationId: string, userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const invitation = (await client.query<{ inviter_id: string }>('SELECT "inviterId" AS inviter_id FROM invitation WHERE id=$1 AND "organizationId"=$2 FOR SHARE', [invitationId, organizationId])).rows[0];
    const actor = (await client.query<{ id: string }>('SELECT "userId" AS id FROM member WHERE "organizationId"=$1 AND role IN (\'owner\',\'admin\') ORDER BY ("userId"=$2) DESC,(role=\'owner\') DESC LIMIT 1', [organizationId, invitation?.inviter_id])).rows[0]?.id;
    if (!actor) throw new Error("No manager can apply this invitation");
    const targets = (await client.query<{ resource_type: "folder" | "file"; resource_id: string; permission: "view" | "edit" }>("SELECT resource_type,resource_id,permission FROM invitation_shares WHERE invitation_id=$1", [invitationId])).rows;
    if (!targets.length) throw new Error("Guest invitation has no targets");
    await validateShareTargets(client, organizationId, [userId], actor, targets.map((target) => ({ resourceType: target.resource_type, resourceId: target.resource_id })));
    const revision = await nextAccessRevision(client, organizationId);
    for (const target of targets) {
      const resource = await resolveResource(target.resource_type, target.resource_id, client);
      if (!resource || resource.organizationId !== organizationId) throw new Error("Guest invitation target is gone");
      await client.query(`INSERT INTO shares (id,org_id,resource_type,resource_id,principal_type,principal_id,permission,created_by,access_revision)
        VALUES ($1,$2,$3,$4,'user',$5,$6,$7,$8) ON CONFLICT (resource_type,resource_id,principal_type,principal_id)
        DO UPDATE SET permission=EXCLUDED.permission,access_revision=EXCLUDED.access_revision`, [randomUUID(), organizationId,target.resource_type,target.resource_id,userId,target.permission,actor,revision]);
    }
    await client.query("DELETE FROM member_access_snapshots WHERE organization_id=$1 AND user_id=$2", [organizationId,userId]);
    await client.query("DELETE FROM shares WHERE org_id=$1 AND resource_type='vault' AND principal_type='user' AND principal_id=$2", [organizationId,userId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

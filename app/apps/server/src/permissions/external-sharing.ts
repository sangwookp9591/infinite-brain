// SPDX-License-Identifier: Apache-2.0
import { domainToASCII } from "node:url";
import type pg from "pg";
import { pool } from "../db/pool.js";
import { AccessManagementError } from "./access-management.js";
export type ExternalSharingMode = "off" | "domains" | "on";
type Queryable = Pick<pg.Pool,"query">;
export function normalizeDomain(value: string): string | null {
  const raw=value.trim().toLowerCase();
  if (!raw || /[\s/@:*?#]/.test(raw)) return null;
  const domain=domainToASCII(raw);
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(domain) ? domain : null;
}
export async function externalSharing(organizationId: string, db: Queryable=pool) {
  await db.query("INSERT INTO organization_access_settings (organization_id) SELECT id FROM organization WHERE id=$1 ON CONFLICT DO NOTHING",[organizationId]);
  const row=(await db.query<{external_sharing:ExternalSharingMode;external_domains:string[]}>("SELECT external_sharing,external_domains FROM organization_access_settings WHERE organization_id=$1 FOR UPDATE",[organizationId])).rows[0];
  return { mode:row?.external_sharing ?? "on", domains:row?.external_domains ?? [] };
}
/** Policy first, then verified identity. Called inside the grant transaction. */
export async function requireExternalSharing(organizationId:string,kind:"invite"|"accept"|"share"|"public",identity?:{email:string;verified?:boolean},db:Queryable=pool):Promise<void>{
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`external-access:${organizationId}`]);
  const policy=await externalSharing(organizationId,db);
  const blocked=()=>new AccessManagementError("This vault does not allow this sharing. Ask an admin for help.",403,"external_sharing_blocked");
  if(policy.mode==="off") throw blocked();
  if(policy.mode==="on") return;
  if(kind==="public") throw blocked();
  const domain=identity?.email.split("@").at(-1)?.toLowerCase();
  if(!domain || !policy.domains.includes(domainToASCII(domain))) throw blocked();
  if(kind!=="invite" && identity?.verified!==true) throw new AccessManagementError("Verify your email before joining this vault. If this server cannot send email, use a verified Google account.",403,"email_verification_required");
}

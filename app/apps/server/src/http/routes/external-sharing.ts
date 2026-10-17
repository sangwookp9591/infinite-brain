// SPDX-License-Identifier: Apache-2.0
import { Hono } from "hono";
import { pool } from "../../db/pool.js";
import { getSession } from "../session.js";
import { orgRole } from "../../permissions/lookup.js";
import { isManagerRole,isTeamRole } from "../../permissions/roles.js";
import { externalSharing,normalizeDomain,type ExternalSharingMode } from "../../permissions/external-sharing.js";
export const externalSharingRoutes=new Hono();
externalSharingRoutes.get("/orgs/:orgId/sharing-availability",async(c)=>{
 const session=await getSession(c); if(!session)return c.json({error:"Authentication required"},401);
 const org=c.req.param("orgId"); if(!isTeamRole(await orgRole(org,session.userId)))return c.json({error:"Not allowed"},403);
 const policy=await externalSharing(org); return c.json({publicLinks:policy.mode==="on"});
});
externalSharingRoutes.get("/orgs/:orgId/external-sharing",async(c)=>{
 const session=await getSession(c); if(!session)return c.json({error:"Authentication required"},401);
 const org=c.req.param("orgId"); if(!isManagerRole(await orgRole(org,session.userId)))return c.json({error:"access_manager_required"},403);
 return c.json(await externalSharing(org));
});
externalSharingRoutes.put("/orgs/:orgId/external-sharing",async(c)=>{
 const session=await getSession(c); if(!session)return c.json({error:"Authentication required"},401);
 const org=c.req.param("orgId"); if(!isManagerRole(await orgRole(org,session.userId)))return c.json({error:"access_manager_required"},403);
 const body=await c.req.json().catch(()=>({}));
 if(!["on","off","domains"].includes(body.mode)||!Array.isArray(body.domains)||body.domains.length>100||body.domains.some((value:unknown)=>typeof value!=="string"||!normalizeDomain(value)))return c.json({error:"Enter valid email domains, such as example.com."},400);
 const domains=[...new Set((body.domains as string[]).map((value)=>normalizeDomain(value)!))];
 if(body.mode==="domains"&&!domains.length)return c.json({error:"Add at least one allowed email domain."},400);
 await pool.query(`INSERT INTO organization_access_settings (organization_id,external_sharing,external_domains) VALUES ($1,$2,$3)
   ON CONFLICT (organization_id) DO UPDATE SET external_sharing=$2,external_domains=$3,updated_at=now()`,[org,body.mode,domains]);
 return c.json({mode:body.mode as ExternalSharingMode,domains});
});

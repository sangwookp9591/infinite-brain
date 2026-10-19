// SPDX-License-Identifier: Apache-2.0
import { Hono } from "hono";
import { getSession } from "../session.js";
import { requireAccessManager,AccessManagementError } from "../../permissions/access-management.js";
import { externalAccessPreview,getExternalRevocation,revokeExternalAccess,RevocationBusy } from "../../permissions/external-revoke.js";
import type { OrgDeps } from "./orgs.js";
const validId=(id:unknown):id is string=>typeof id==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
export function createExternalRevokeRoutes(deps:OrgDeps){
 const routes=new Hono();
 routes.use("/orgs/:orgId/external-access/*",async(c,next)=>{
  const session=await getSession(c);if(!session)return c.json({error:"Authentication required"},401);
  try{await requireAccessManager(c.req.param("orgId")!,session.userId);await next();}
  catch(error){if(error instanceof AccessManagementError)return c.json({error:error.code,message:error.message},error.status);throw error;}
 });
 routes.get("/orgs/:orgId/external-access/preview",async(c)=>c.json(await externalAccessPreview(c.req.param("orgId"))));
 routes.get("/orgs/:orgId/external-access/revoke/:id",async(c)=>{
  if(!validId(c.req.param("id")))return c.json({error:"Invalid request"},400);
  const result=await getExternalRevocation(c.req.param("orgId"),c.req.param("id"));return result?c.json(result):c.json({error:"Not found"},404);
 });
 routes.post("/orgs/:orgId/external-access/revoke",async(c)=>{
  const body=await c.req.json().catch(()=>({}));if(!validId(body.operationId))return c.json({error:"Invalid request"},400);
  if(body.confirm!==true)return c.json({error:"Confirm that you want to remove all external access."},400);
  const session=(await getSession(c))!;
  try{return c.json(await revokeExternalAccess(c.req.param("orgId"),session.userId,deps,body.operationId));}
  catch(error){if(error instanceof RevocationBusy)return c.json({error:"access_change_in_progress",message:error.message},409);throw error;}
 });
 return routes;
}

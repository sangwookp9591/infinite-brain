// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { pool } from "../db/pool.js";
import { recordAudit } from "../audit/log.js";
import { revokeMembership, type OrgDeps } from "../http/routes/orgs.js";
import { requireAccessManager } from "./access-management.js";

export interface ExternalCounts { guests:number; invitations:number; publicLinks:number; aiConnections:number; bootstrapSessions:number }
export interface ExternalRevocation {
  id:string; organization_id:string; actor_user_id:string; status:"running"|"completed"|"partial";
  counts:Partial<ExternalCounts>; errors:Array<{type:string;id:string;message:string}>; started_at:string; finished_at:string|null;
}
export async function externalAccessPreview(org:string):Promise<ExternalCounts> {
  const {rows:[r]}=await pool.query(`SELECT
    (SELECT count(*)::int FROM member WHERE "organizationId"=$1 AND role='guest') AS guests,
    (SELECT count(*)::int FROM invitation WHERE "organizationId"=$1 AND role='guest' AND status='pending') AS invitations,
    (SELECT count(*)::int FROM public_links WHERE org_id=$1) AS "publicLinks",
    ((SELECT count(*) FROM mcp_tokens t JOIN member m ON m."userId"=t.user_id AND m."organizationId"=t.organization_id WHERE t.organization_id=$1 AND m.role='guest')+
     (SELECT count(*) FROM mcp_oauth_vault t JOIN member m ON m."userId"=t.user_id AND m."organizationId"=t.organization_id WHERE t.organization_id=$1 AND m.role='guest'))::int AS "aiConnections",
    (SELECT count(*)::int FROM bootstrap_sessions b JOIN vaults v ON v.id=b.vault_id JOIN member m ON m."organizationId"=v.organization_id AND m."userId"=b.user_id WHERE v.organization_id=$1 AND m.role='guest') AS "bootstrapSessions"`,[org]);
  return r;
}
export async function getExternalRevocation(org:string,id:string):Promise<ExternalRevocation|null>{
  return (await pool.query<ExternalRevocation>("SELECT * FROM external_revocations WHERE organization_id=$1 AND id=$2",[org,id])).rows[0]??null;
}
/** Increment progress and its audit event in the SAME transaction as the mutation. */
async function progress(client:pg.PoolClient,org:string,actor:string,id:string,type:string,target:string,counts:Partial<ExternalCounts>){
  await client.query(`UPDATE external_revocations r SET counts=r.counts || (SELECT jsonb_object_agg(k,COALESCE((r.counts->>k)::int,0)+v::int) FROM jsonb_each_text($2::jsonb) AS n(k,v)) WHERE id=$1`,[id,JSON.stringify(counts)]);
  await recordAudit(client,{organizationId:org,actorUserId:actor,action:"external_access.revoke_item",targetType:type,targetId:target,refs:{operationId:id,counts}});
}
export class RevocationBusy extends Error {}
export async function revokeExternalAccess(org:string,actor:string,deps:OrgDeps,id=randomUUID(),beforeStep?:(type:string,id:string)=>Promise<void>):Promise<ExternalRevocation>{
  await requireAccessManager(org,actor);
  const lock=await pool.connect(); const key=`external-access:${org}`;
  try {
    const acquired=(await lock.query<{ok:boolean}>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok",[key])).rows[0].ok;
    if(!acquired)throw new RevocationBusy("Another access change is in progress. Try again shortly.");
    const existing=await getExternalRevocation(org,id);
    if(existing?.status==="completed")return existing;
    await lock.query("BEGIN");
    await requireAccessManager(org,actor,lock);
    const started=await lock.query(`INSERT INTO external_revocations (id,organization_id,actor_user_id,status) VALUES ($1,$2,$3,'running') ON CONFLICT(id) DO UPDATE SET status='running',errors='[]',finished_at=NULL WHERE external_revocations.organization_id=$2`,[id,org,actor]);
    if(!started.rowCount)throw new Error("Invalid operation");
    await recordAudit(lock,{organizationId:org,actorUserId:actor,action:"external_access.revoke_started",targetType:"external_access",targetId:id});
    await lock.query("COMMIT");
    const errors:ExternalRevocation["errors"]=[];
    const steps=await pool.query<{type:string;id:string}>(`SELECT 'guest' AS type,"userId" AS id FROM member WHERE "organizationId"=$1 AND role='guest'
      UNION ALL SELECT 'invitation',id FROM invitation WHERE "organizationId"=$1 AND role='guest' AND status='pending'
      UNION ALL SELECT 'public_link',id FROM public_links WHERE org_id=$1`,[org]);
    for(const step of steps.rows){
      try {
        await requireAccessManager(org,actor); await beforeStep?.(step.type,step.id);
        if(step.type==="guest"){
          await revokeMembership(deps,org,step.id,"removed",{expectedRole:"guest",beforeCommit:async(client)=>{
            await requireAccessManager(org,actor,client);
            const tokens=await client.query("DELETE FROM mcp_tokens WHERE organization_id=$1 AND user_id=$2",[org,step.id]);
            const bindings=await client.query("DELETE FROM mcp_oauth_vault WHERE organization_id=$1 AND user_id=$2",[org,step.id]);
            const sessions=await client.query("DELETE FROM bootstrap_sessions WHERE user_id=$2 AND vault_id IN (SELECT id FROM vaults WHERE organization_id=$1)",[org,step.id]);
            await progress(client,org,actor,id,step.type,step.id,{guests:1,aiConnections:(tokens.rowCount??0)+(bindings.rowCount??0),bootstrapSessions:sessions.rowCount??0});
          }});
        }else{
          const client=await pool.connect();
          try{
            await client.query("BEGIN");await requireAccessManager(org,actor,client);
            const result=step.type==="invitation" ? await client.query("UPDATE invitation SET status='canceled' WHERE id=$1 AND \"organizationId\"=$2 AND role='guest' AND status='pending'",[step.id,org]) : await client.query("DELETE FROM public_links WHERE id=$1 AND org_id=$2",[step.id,org]);
            if(result.rowCount)await progress(client,org,actor,id,step.type,step.id,step.type==="invitation"?{invitations:1}:{publicLinks:1});
            await client.query("COMMIT");
          }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
        }
      }catch{
        errors.push({...step,message:"Couldn't remove this access. Try again."});
      }
    }
    await lock.query("BEGIN");
    await lock.query("UPDATE external_revocations SET status=$2,errors=$3,finished_at=now() WHERE id=$1",[id,errors.length?"partial":"completed",JSON.stringify(errors)]);
    await recordAudit(lock,{organizationId:org,actorUserId:actor,action:"external_access.revoke_finished",targetType:"external_access",targetId:id,result:errors.length?"failed":"ok",refs:{failedItems:errors.length}});
    await lock.query("COMMIT");
    return (await getExternalRevocation(org,id))!;
  }catch(error){await lock.query("ROLLBACK");throw error;}finally{
    await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[key]);lock.release();
  }
}

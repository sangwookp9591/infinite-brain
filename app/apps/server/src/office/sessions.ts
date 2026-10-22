// SPDX-License-Identifier: Apache-2.0
import { randomBytes, randomUUID, verify } from "node:crypto";
import type pg from "pg";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { recordAudit } from "../audit/log.js";
import { PairingError, base64, digest, uuid } from "./protocol.js";
import { officeHost, type OfficeHost } from "./pairing.js";
import type { PubSub } from "../sync/pubsub.js";
import { createPublicKey } from "node:crypto";

export interface OfficeSession { id: string; userId: string; organizationId: string; email: string; name: string; expiresAt: Date }
export interface SessionChallenge {
 challengeId: string; deviceId: string; serverId: string; generation: string;
 audience: string; fingerprint: string; nonce: string; expiresAt: string;
}
export function sessionDigest(c: SessionChallenge): Buffer {
 const parts = ["IB-OFFICE-SESSION-1", c.challengeId,c.deviceId,c.serverId,c.generation,c.audience,c.fingerprint,c.nonce,c.expiresAt];
 return digest(Buffer.concat(parts.flatMap(part => {const value=Buffer.from(part);const length=Buffer.alloc(4);length.writeUInt32BE(value.length);return [length,value];})));
}
type DB = Pick<pg.Pool | pg.PoolClient,"query">;
/** Always use current approval AND existing membership; pairing grants nothing. */
async function approved(db: DB, deviceId: string, lock=false) {
 const row=(await db.query(`SELECT s.id AS pairing_id,s.organization_id,p.linked_user_id AS user_id,d.public_key
 FROM person_device d JOIN pairing_session s ON s.device_id=d.id AND s.state='approved'
 JOIN person_identity p ON p.id=d.person_id AND p.id=s.person_id AND p.disabled_at IS NULL
 JOIN office_person_membership o ON o.person_id=p.id AND o.organization_id=s.organization_id AND o.user_id=p.linked_user_id AND o.status='active'
 JOIN member m ON m."organizationId"=s.organization_id AND m."userId"=p.linked_user_id AND m.role IN ('owner','admin','member')
 WHERE d.id=$1 AND d.status='approved' AND d.revoked_at IS NULL AND s.requester_user_id=p.linked_user_id
 ${lock ? 'FOR SHARE OF d,s,p,o,m' : ''}`, [deviceId])).rows[0];
 if(!row)throw new PairingError("approval_required",403);
 return row;
}
async function transaction<T>(action:string, run:(db:pg.PoolClient)=>Promise<T>):Promise<T>{
 const db=await pool.connect();try{await db.query("BEGIN");const result=await run(db);await db.query("COMMIT");return result;}
 catch(error){await db.query("ROLLBACK");if(error instanceof PairingError){await recordAudit(db,{action,targetType:"office_session",result:"refused",refs:{code:error.code}});error.audited=true;}throw error;}
 finally{db.release();}
}
export async function issueSessionChallenge(deviceId:string,host=officeHost()):Promise<SessionChallenge>{
 return transaction("office.session.challenge",async db=>{
  const device=uuid(deviceId);await approved(db,device,true);
  await db.query("DELETE FROM office_session_challenge WHERE expires_at<now()-interval '1 hour'");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`office-session:${device}`]);
  const count=(await db.query("SELECT count(*)::int AS n FROM office_session_challenge WHERE device_id=$1 AND expires_at>now()",[device])).rows[0].n;
  if(count>=8)throw new PairingError("try_later",429);
  const c:SessionChallenge={challengeId:randomUUID(),deviceId:device,serverId:host.serverId,generation:host.generation,audience:host.audience,fingerprint:host.fingerprint,nonce:randomBytes(32).toString("base64url"),expiresAt:new Date(Date.now()+60_000).toISOString()};
  await db.query(`INSERT INTO office_session_challenge(id,device_id,nonce_hash,server_id,host_generation,audience,fingerprint,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[c.challengeId,device,digest(base64(c.nonce,32)),c.serverId,c.generation,c.audience,c.fingerprint,c.expiresAt]);
  await recordAudit(db,{action:"office.session.challenge",targetType:"device",targetId:device});
  return c;
 });
}
function matches(row: {server_id:string;host_generation:string;audience:string;fingerprint:string},host:OfficeHost){return row.server_id===host.serverId && String(row.host_generation)===host.generation && row.audience===host.audience && row.fingerprint===host.fingerprint;}
export async function exchangeDeviceSession(input:Record<string,unknown>,host=officeHost()){
 // Invalid signature consumes the challenge too: commit refusal before throwing.
 const result=await transaction("office.session.issue",async db=>{
  const row=(await db.query("SELECT * FROM office_session_challenge WHERE id=$1 FOR UPDATE",[uuid(input.challengeId)])).rows[0];
  if(!row||row.used_at)throw new PairingError("challenge_replayed",409);
  if(row.expires_at.getTime()<=Date.now())throw new PairingError("expired",410);
  await db.query("UPDATE office_session_challenge SET used_at=now() WHERE id=$1",[row.id]);
  const device=await approved(db,row.device_id,true);
  let valid=false;
  try{
   const c:SessionChallenge={challengeId:row.id,deviceId:row.device_id,serverId:row.server_id,generation:String(row.host_generation),audience:row.audience,fingerprint:row.fingerprint,nonce:String(input.nonce),expiresAt:row.expires_at.toISOString()};
   valid=matches(row,host)&&digest(base64(c.nonce,32)).equals(row.nonce_hash)&&verify(null,sessionDigest(c),createPublicKey({key:device.public_key,format:"der",type:"spki"}),base64(input.signature,64));
  }catch{}
  if(!valid){await recordAudit(db,{action:"office.session.issue",organizationId:device.organization_id,targetType:"device",targetId:row.device_id,result:"refused",refs:{code:"invalid_proof"}});return null;}
  const id=randomUUID(),token=`office_${randomBytes(32).toString("base64url")}`,expiresAt=new Date(Date.now()+Math.min(600,config.syncTokenTtlSeconds)*1000);
  await db.query(`INSERT INTO office_device_session(id,device_id,pairing_id,user_id,organization_id,token_hash,server_id,host_generation,audience,fingerprint,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[id,row.device_id,device.pairing_id,device.user_id,device.organization_id,digest(Buffer.from(token)),host.serverId,host.generation,host.audience,host.fingerprint,expiresAt]);
  await recordAudit(db,{action:"office.session.issue",organizationId:device.organization_id,actorUserId:device.user_id,actorKind:"user",targetType:"office_session",targetId:id,refs:{deviceId:row.device_id,personBinding:"linked-user"}});
  return {token,expiresAt:expiresAt.toISOString(),organizationId:device.organization_id};
 });
 if(!result){const error=new PairingError("invalid_proof",403);error.audited=true;throw error;}return result;
}
export async function resolveOfficeSession(tokenOrId:string,byId=false):Promise<OfficeSession|null>{
 if(revocationFailed)return null;
 let host:OfficeHost;try{host=officeHost();}catch{return null;}
 const row=(await pool.query(`SELECT s.*,u.email,u.name FROM office_device_session s JOIN "user" u ON u.id=s.user_id
 WHERE ${byId?'s.id=$1':'s.token_hash=$1'} AND s.expires_at>now() AND s.revoked_at IS NULL`,[byId?uuid(tokenOrId):digest(Buffer.from(tokenOrId))])).rows[0];
 if(!row||!matches(row,host))return null;
 try{const device=await approved(pool,row.device_id);if(device.user_id!==row.user_id||device.organization_id!==row.organization_id||device.pairing_id!==row.pairing_id)return null;}catch(error){if(error instanceof PairingError)return null;throw error;}
 return {id:row.id,userId:row.user_id,organizationId:row.organization_id,email:row.email,name:row.name,expiresAt:row.expires_at};
}
export async function assertOfficeSync(id:string,userId:string|undefined,vaultId:string){
 const session=await resolveOfficeSession(id,true);
 const org=(await pool.query("SELECT organization_id FROM vaults WHERE id=$1",[vaultId])).rows[0]?.organization_id;
 if(!session||session.userId!==userId||session.organizationId!==org)throw new Error("Office session ended or vault outside approved organization");
 return session;
}
// The same binary PubSub seam as sync/doc-revocations; no per-message DB query.
const topic="authorization:office-device-revocations";
let revocations:PubSub|undefined;
let revocationFailed=false;
const listeners=new Map<string,Set<()=>void>>();
export function watchOfficeSession(id:string,close:()=>void){let set=listeners.get(id);if(!set){set=new Set();listeners.set(id,set);}set.add(close);return()=>{set!.delete(close);if(!set!.size)listeners.delete(id);};}
function closeSession(id:string){for(const close of [...listeners.get(id)??[]])close();}
export async function installOfficeRevocations(pubsub:PubSub){
 revocations=pubsub; revocationFailed=false;
 const unsubscribe=await pubsub.subscribe(topic,bytes=>{try{const ids=JSON.parse(Buffer.from(bytes).toString());if(Array.isArray(ids))for(const id of ids)if(typeof id==="string")closeSession(id);}catch{}});
 const listener=await pool.connect();
 listener.on("notification",message=>{if(message.channel!=="office_session_revoked"||!message.payload)return;closeSession(message.payload);void pubsub.publish(topic,Buffer.from(JSON.stringify([message.payload]))).catch(()=>{for(const id of listeners.keys())closeSession(id);});});
 const failed=()=>{revocationFailed=true;for(const id of listeners.keys())closeSession(id);};
 listener.on("error",failed);
 listener.on("end",failed);
 await listener.query("LISTEN office_session_revoked");
 return async()=>{await unsubscribe();await listener.query("UNLISTEN office_session_revoked");listener.removeListener("error",failed);listener.removeListener("end",failed);listener.release();if(revocations===pubsub)revocations=undefined;};
}
export async function revokeOfficeDevice(deviceId:string){
 const ids=(await pool.query<{id:string}>("SELECT id FROM office_device_session WHERE device_id=$1",[deviceId])).rows.map(row=>row.id);
 for(const id of ids)closeSession(id);
 if(revocations)await revocations.publish(topic,Buffer.from(JSON.stringify(ids)));
}

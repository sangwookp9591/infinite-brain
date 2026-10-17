// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import type { PubSub } from "./pubsub.js";
const topic="authorization:document-revocations";
/** Hocuspocus' Redis extension mirrors documents, but does not mirror socket closes. */
export async function createDocRevocations(pubsub:PubSub,close:(vaultId:string,docId:string)=>void){
 const source=randomUUID();
 const unsubscribe=await pubsub.subscribe(topic,(bytes)=>{
  try{
   const event=JSON.parse(Buffer.from(bytes).toString());
   if(event.source!==source && typeof event.vaultId==="string" && typeof event.docId==="string")close(event.vaultId,event.docId);
  }catch(error){console.error("[authorization] Invalid document revocation",error);}
 });
 return {
  async disconnect(vaultId:string,docId:string){
   close(vaultId,docId);
   await pubsub.publish(topic,Buffer.from(JSON.stringify({source,vaultId,docId})));
  },
  stop:unsubscribe,
 };
}

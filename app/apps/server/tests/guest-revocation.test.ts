// SPDX-License-Identifier: Apache-2.0
import { afterAll,expect,it } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { recordingAppDeps } from "./helpers/app.js";
import { createSyncServer,disconnectDoc } from "../src/sync/hocuspocus.js";
import { createDocRevocations } from "../src/sync/doc-revocations.js";
import { createPubSub,InMemoryPubSub } from "../src/sync/pubsub.js";
import { formatDocName } from "../src/sync/doc-name.js";
import { mintSyncToken } from "../src/tokens/sync-token.js";
import { revokeExternalAccess } from "../src/permissions/external-revoke.js";
afterAll(()=>pool.end());
async function until(check:()=>boolean){const start=Date.now();while(!check()){if(Date.now()-start>8000)throw new Error("condition timed out");await new Promise(resolve=>setTimeout(resolve,20));}}
it("bulk external revoke reaches every instance: revocation reaches sockets on another instance",async()=>{
 const f=await guestFixture();const servers=[createSyncServer(0),createSyncServer(0)];
 const local=new InMemoryPubSub();
 const pubs=process.env.REVOCATION_TEST_REDIS_URL ? await Promise.all([createPubSub(process.env.REVOCATION_TEST_REDIS_URL),createPubSub(process.env.REVOCATION_TEST_REDIS_URL)]) : [local,local];
 const bridges=await Promise.all(servers.map((server,i)=>createDocRevocations(pubs[i],(vault,doc)=>disconnectDoc(server,vault,doc))));
 const providers:HocuspocusProvider[]=[];const docs:Y.Doc[]=[];const sends:Promise<void>[]=[];
 try{
  await Promise.all(servers.map(s=>s.listen()));
  const name=formatDocName(f.vault,f.visible);
  const token=await mintSyncToken({vaultId:f.vault,docId:f.visible,userId:f.guest.userId,readOnly:false});
  for(const server of servers){const document=new Y.Doc();docs.push(document);const provider=new HocuspocusProvider({url:`ws://127.0.0.1:${server.address.port}`,name,token,document,WebSocketPolyfill:WebSocket as unknown as typeof globalThis.WebSocket});providers.push(provider);await until(()=>provider.isSynced);}
  const recording=recordingAppDeps({disconnectDoc:(vault,doc)=>{sends.push(bridges[0].disconnect(vault,doc));}});
  const result=await revokeExternalAccess(f.org,f.owner.userId,recording.deps);expect(result.status).toBe("completed");await Promise.all(sends);
  await until(()=>servers.every(server=>![...(server.hocuspocus.documents.get(name)?.getConnections()??[])].some(c=>c.context.userId===f.guest.userId)));
  expect(servers.every(server=>![...(server.hocuspocus.documents.get(name)?.getConnections()??[])].some(c=>c.context.userId===f.guest.userId))).toBe(true);
 }finally{providers.forEach(p=>p.destroy());docs.forEach(d=>d.destroy());await Promise.all(bridges.map(b=>b.stop()));await Promise.all(pubs.map(p=>p.close()));await Promise.all(servers.map(s=>s.destroy()));}
},30000);
it("revoked guest share disappears from activity listings within TTL",async()=>{
 const {readableDocsForActivity,setReadableCacheTtl,invalidateReadableCache}=await import("../src/permissions/readable-cache.js");
 const f=await guestFixture();setReadableCacheTtl(10000);
 try{expect(await readableDocsForActivity(f.guest.userId,f.vault,pool,100000)).toEqual(new Set([f.visible]));await pool.query("DELETE FROM shares WHERE principal_id=$1",[f.guest.userId]);expect(await readableDocsForActivity(f.guest.userId,f.vault,pool,110001)).toEqual(new Set());}finally{invalidateReadableCache(f.vault);setReadableCacheTtl(0);}
});

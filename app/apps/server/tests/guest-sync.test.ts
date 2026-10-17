// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { HocuspocusProvider } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { appendUpdate } from "../src/yjs/persistence.js";
import { createBootstrapSession, loadBootstrapPage } from "../src/yjs/bootstrap.js";
import { decodeBootstrapPage } from "../src/sync/bulk-protocol.js";
import { createSyncServer, disconnectDoc, type SyncContext } from "../src/sync/hocuspocus.js";
import type { Server } from "@hocuspocus/server";
import { formatDocName } from "../src/sync/doc-name.js";
import { mintSyncToken } from "../src/tokens/sync-token.js";
let f: Awaited<ReturnType<typeof guestFixture>>; let server: Server<SyncContext> | null = null;
const providers: HocuspocusProvider[] = []; const docs: Y.Doc[] = [];
async function until(check: () => boolean, timeout=8000) { const start=Date.now(); while (!check()) { if (Date.now()-start>timeout) throw new Error("condition timed out"); await new Promise((resolve)=>setTimeout(resolve,20)); } }
beforeEach(async()=>{ f=await guestFixture(); });
afterEach(async()=>{ for (const provider of providers.splice(0)) provider.destroy(); for(const doc of docs.splice(0)) doc.destroy(); if(server) await server.destroy(); server=null; });
afterAll(()=>pool.end());
async function seed() { const doc=new Y.Doc(); doc.getText("content").insert(0,"shared content"); await appendUpdate(f.visible,Y.encodeStateAsUpdate(doc)); doc.destroy(); }
it("bootstrap pages drop docs revoked mid-session", async()=>{
  await seed(); const session=await createBootstrapSession({vaultId:f.vault,userId:f.guest.userId});
  const first=await loadBootstrapPage({sessionId:session.sessionId,vaultId:f.vault,userId:f.guest.userId,cursor:0});
  const decoded=decodeBootstrapPage(gunzipSync(first.body));
  expect(decoded.map(doc=>doc.relPath)).toEqual(["Shared/visible.md"]);
  await pool.query("DELETE FROM shares WHERE principal_id=$1",[f.guest.userId]);
  const revoked=await loadBootstrapPage({sessionId:session.sessionId,vaultId:f.vault,userId:f.guest.userId,cursor:0});
  expect(decodeBootstrapPage(gunzipSync(revoked.body))).toEqual([]);
});
it("guest edit socket is rejected after share revoke", async()=>{
  await seed(); server=createSyncServer(0); await server.listen();
  let failed=false; let closed=0;
  const doc=new Y.Doc(); docs.push(doc);
  const token=await mintSyncToken({docId:f.visible,vaultId:f.vault,userId:f.guest.userId,readOnly:false});
  const provider=new HocuspocusProvider({url:`ws://127.0.0.1:${server.address.port}`,name:formatDocName(f.vault,f.visible),token,document:doc,WebSocketPolyfill:WebSocket as unknown as typeof globalThis.WebSocket,onAuthenticationFailed:()=>{failed=true;},onClose:()=>{closed++;}}); providers.push(provider);
  await until(()=>provider.isSynced);
  await pool.query("DELETE FROM shares WHERE principal_id=$1",[f.guest.userId]);
  disconnectDoc(server,f.vault,f.visible);
  await until(()=>![...(server!.hocuspocus.documents.get(formatDocName(f.vault,f.visible))?.getConnections() ?? [])].some((connection)=>connection.context.userId===f.guest.userId));
  provider.destroy();
  const retryDoc=new Y.Doc(); docs.push(retryDoc);
  const retry=new HocuspocusProvider({url:`ws://127.0.0.1:${server.address.port}`,name:formatDocName(f.vault,f.visible),token,document:retryDoc,WebSocketPolyfill:WebSocket as unknown as typeof globalThis.WebSocket,onAuthenticationFailed:()=>{failed=true;}}); providers.push(retry);
  await until(()=>failed);
});
it("raw editor awareness never exposes other people to a guest",async()=>{
  await seed(); server=createSyncServer(0); await server.listen();
  const open=async(userId:string)=>{
    const doc=new Y.Doc(); docs.push(doc);
    const token=await mintSyncToken({docId:f.visible,vaultId:f.vault,userId,readOnly:false});
    const provider=new HocuspocusProvider({url:`ws://127.0.0.1:${server!.address.port}`,name:formatDocName(f.vault,f.visible),token,document:doc,WebSocketPolyfill:WebSocket as unknown as typeof globalThis.WebSocket}); providers.push(provider);
    await until(()=>provider.isSynced); return provider;
  };
  const member=await open(f.member.userId); member.awareness?.setLocalStateField("user",{name:"Private teammate",email:f.member.email});
  const guest=await open(f.guest.userId);
  // A content round trip proves the transport is active while awareness is hidden.
  member.document.getText("content").insert(0,"updated ");
  await until(()=>guest.document.getText("content").toString().startsWith("updated "));
  expect(JSON.stringify([...guest.awareness!.getStates().values()])).not.toContain("Private teammate");
  expect(JSON.stringify([...guest.awareness!.getStates().values()])).not.toContain(f.member.email);
});

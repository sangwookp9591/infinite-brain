// SPDX-License-Identifier: Apache-2.0
import { EventEmitter } from "node:events";
import { afterAll,afterEach,beforeEach,expect,it } from "vitest";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { VaultChannel } from "../src/sync/vault-channel.js";
import { InMemoryPubSub } from "../src/sync/pubsub.js";
import { decodeWsUpdate,encodeVoiceFrame,decodeVoiceFrame } from "../src/sync/vault-protocol.js";
class Socket extends EventEmitter {
 OPEN=1;readyState=1;controls:any[]=[];binary:Uint8Array[]=[];
 send(data:unknown,opts?:{binary?:boolean}){if(opts?.binary)this.binary.push(data as Uint8Array);else this.controls.push(JSON.parse(data as string));}
 close(){this.readyState=3;this.emit("close");}
 frame(value:unknown){this.emit("message",Buffer.from(JSON.stringify(value)),false);}
}
let f:Awaited<ReturnType<typeof guestFixture>>;let pub:InMemoryPubSub;let channel:VaultChannel;let guest:Socket;let member:Socket;const sockets:Socket[]=[];
async function until(check:()=>boolean){const start=Date.now();while(!check()){if(Date.now()-start>4000)throw new Error("condition timed out");await new Promise(resolve=>setTimeout(resolve,5));}}
beforeEach(async()=>{
 f=await guestFixture();pub=new InMemoryPubSub();
 channel=new VaultChannel({pubsub:pub,verifyToken:async(token)=>({userId:token,vaultId:f.vault}),loadDiff:async()=>({update:new Uint8Array([1]),serverStateVector:new Uint8Array(),upToDate:false,clientAhead:true}),listEmpty:async(ids)=>({empty:[...ids],truncated:false})});
 const open=async(userId:string)=>{const socket=new Socket();sockets.push(socket);channel.handleConnection(socket as never);socket.frame({t:"hello",token:userId,manifest:{},caps:["revocation-batches","member-removed","voice"]});await until(()=>socket.controls.some(c=>c.t==="ready"));return socket;};
 guest=await open(f.guest.userId);member=await open(f.member.userId);
});
afterEach(async()=>{sockets.splice(0).forEach(s=>s.close());await pub.close();});afterAll(()=>pool.end());
it("guest receives only shared docs in ready/empty/behind/tombstones",async()=>{
 const ready=guest.controls.find(c=>c.t==="ready");expect(ready.empty).toEqual([f.visible]);expect(ready.behind).toEqual([f.visible]);
 expect(guest.binary.map(bytes=>decodeWsUpdate(bytes)?.docId).filter(Boolean)).toEqual([f.visible]);
 expect(JSON.stringify(guest.controls)).not.toContain(f.hidden);
});
it("guest connection never receives member names",async()=>{
 await channel.publishMemberJoined(f.vault,"Private teammate");expect(JSON.stringify(guest.controls)).not.toContain("Private teammate");expect(JSON.stringify(member.controls)).toContain("Private teammate");
});
it("guest receives vault display name only",async()=>{
 await channel.publishOrgChanged(f.vault,{name:"Display",logo:"private-logo"});await channel.publishAppearanceChanged(f.vault,{orgId:f.org,settings:{secret:"private-setting"},updatedAt:new Date().toISOString()});
 expect(guest.controls.find(c=>c.t==="org")).toEqual({t:"org",name:"Display"});expect(JSON.stringify(guest.controls)).not.toContain("private-setting");
});
it("guest presence frames are scoped and anonymized",async()=>{
 member.frame({t:"presence",docId:null,name:"Private teammate",color:"red",status:"online"});await new Promise(resolve=>setTimeout(resolve,10));expect(guest.controls.filter(c=>c.t==="presence")).toEqual([]);
 member.frame({t:"presence",docId:f.hidden,name:"Private teammate",color:"red",status:"online"});await new Promise(resolve=>setTimeout(resolve,10));expect(guest.controls.filter(c=>c.t==="presence")).toEqual([]);
 member.frame({t:"presence",docId:f.visible,name:"Private teammate",color:"red",status:"online"});await until(()=>guest.controls.some(c=>c.t==="presence"));
 const frames=guest.controls.filter(c=>c.t==="presence");expect(JSON.stringify(frames)).not.toContain("Private teammate");expect(JSON.stringify(frames)).not.toContain(f.member.userId);
 member.frame({t:"presence",docId:null,name:"Private teammate",color:"red",status:"online"});await until(()=>guest.controls.filter(c=>c.t==="presence").length===2);
});
it("voice never reaches or comes from a guest",async()=>{
 const voice=Buffer.from(encodeVoiceFrame({s:"voice-1",n:0,f:1,fmt:"pcm16",sr:16000},new Uint8Array([1,2])));
 const observer=new Socket();sockets.push(observer);channel.handleConnection(observer as never);observer.frame({t:"hello",token:f.owner.userId,manifest:{},caps:["voice"]});await until(()=>observer.controls.some(c=>c.t==="ready"));
 member.emit("message",voice,true);await until(()=>observer.binary.some(b=>decodeVoiceFrame(b)));
 guest.emit("message",voice,true);await new Promise(resolve=>setTimeout(resolve,20));
 expect(observer.binary.map(b=>decodeVoiceFrame(b)).filter(Boolean)).toHaveLength(1);
 expect(guest.binary.map(b=>decodeVoiceFrame(b)).filter(Boolean)).toEqual([]);expect(member.binary.map(b=>decodeVoiceFrame(b)).filter(Boolean)).toEqual([]);
});
it("guest share revoke emits revoked for exactly the lost docs",async()=>{
 await pool.query("DELETE FROM shares WHERE principal_id=$1",[f.guest.userId]);await channel.publishAclChanged(f.vault);
 await until(()=>guest.controls.some(c=>c.t==="revoked"||c.t==="drop"));
 expect(guest.controls.filter(c=>c.t==="revoked"||c.t==="drop").flatMap(c=>c.docIds)).toEqual([f.visible]);
});

it("guest tombstones never name out-of-scope docs",async()=>{
 await pool.query("UPDATE notes SET deleted_at=now(),purge_after=now()+interval '30 days' WHERE id=ANY($1::text[])",[[f.visible,f.hidden]]);
 const socket=new Socket();sockets.push(socket);channel.handleConnection(socket as never);socket.frame({t:"hello",token:f.guest.userId,manifest:{[f.visible]:"",[f.hidden]:""},caps:["revocation-batches"]});await until(()=>socket.controls.some(c=>c.t==="ready"));
 expect(socket.controls.find(c=>c.t==="ready").tombstones).toEqual([f.visible]);
});

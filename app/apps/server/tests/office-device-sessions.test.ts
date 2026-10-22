// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { testAppDeps } from "./helpers/app.js";
import { createOrg, signUp, type TestUser } from "./helpers/auth.js";
import { pool, resetDb } from "./helpers/db.js";
import { challengeDigest, sasCommit, deriveSas, type SasContext, type Challenge } from "../src/office/protocol.js";
import { OfficePairing, sweepPairings } from "../src/office/pairing.js";
import { seedNote, seedVault, seedMember, seedOrg, seedVaultGrant, seedBlob } from "./helpers/seed.js";

const app = createApp(testAppDeps());
let owner: TestUser, employee: TestUser, organizationId: string;
const fingerprint = "a".repeat(64);
const host = { serverId: "office-test", generation: "1", fingerprint, audience: "http://localhost:3010/api/office" };
const service = new OfficePairing(host);

async function post(path: string, body: unknown, user?: TestUser) {
  return app.request(`/api${path}`, { method: "POST", headers: { "content-type": "application/json", ...(user ? { authorization: `Bearer ${user.token}` } : {}) }, body: JSON.stringify(body) });
}
async function get(path: string, user?: TestUser, token?: string) {
  return app.request(`/api${path}`, { headers: user || token ? { authorization: `Bearer ${user?.token ?? token}` } : {} });
}
async function begin(user: TestUser | undefined = employee, personId = randomUUID(), alias = "민수") {
  const invitation = await service.invite(organizationId, owner.userId);
  const keys = generateKeyPairSync("ed25519");
  const body = { invitationSecret: invitation.invitationSecret, hubFingerprint: fingerprint, personId, deviceId: randomUUID(),
    displayAlias: alias, deviceLabel: "내 컴퓨터", platform: "macos",
    publicKey: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url") };
  const response = await post("/office/pairing/challenge", body, user);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  const prepared = await response.json() as { sessionId: string; context: SasContext; pairingToken: string };
  const clientNonce = randomBytes(32).toString("base64url"), commitment = sasCommit(prepared.context, clientNonce);
  const committed = await post(`/office/pairing/${prepared.sessionId}/commit`, { pairingToken: prepared.pairingToken, commitment: commitment.toString("base64url"), signature: sign(null, commitment, keys.privateKey).toString("base64url") });
  expect(committed.status).toBe(200);
  const revealed = await post(`/office/pairing/${prepared.sessionId}/reveal`, { pairingToken: prepared.pairingToken, clientNonce });
  expect(revealed.status).toBe(200);
  const data = { ...await revealed.json() as { challenge: Challenge }, pairingToken: prepared.pairingToken };
  const proof = { pairingToken: data.pairingToken, clientNonce: data.challenge.clientNonce, serverNonce: data.challenge.serverNonce,
    signature: sign(null, challengeDigest(data.challenge), keys.privateKey).toString("base64url") };
  return { ...data, proof, body, user, keys, context: prepared.context, id: data.challenge.sessionId, invitation };
}
async function pending(user: TestUser | undefined = employee, personId?: string, alias?: string) {
  const run = await begin(user, personId, alias);
  expect((await post(`/office/pairing/${run.id}/proof`, run.proof)).status).toBe(200);
  expect((await post(`/office/pairing/${run.id}/sas-confirm`, { pairingToken: run.pairingToken, matches: true })).status).toBe(200);
  expect((await post(`/office/pairing/${run.id}/request`, { pairingToken: run.pairingToken }, user)).status).toBe(200);
  expect((await post(`/office/pairing/${run.id}/sas-confirm`, { matches: true }, owner)).status).toBe(user?.userId === owner.userId ? 403 : 200);
  return run;
}
async function decision(id: string, value: string, user = owner, reasonCode?: string) {
  return post(`/office/pairing/${id}/decision`, { decision: value, reasonCode }, user);
}

beforeEach(async () => {
  process.env.OFFICE_SERVER_ID = host.serverId;
  process.env.OFFICE_HOST_GENERATION = host.generation;
  process.env.OFFICE_HUB_FINGERPRINT = fingerprint;
  // As with all server integration suites, the runner must select a disposable database.
  await resetDb();
  owner = await signUp("office-owner@example.com");
  employee = await signUp("office-person@example.com");
  organizationId = (await createOrg(owner, "회사", "office-test")).id;
  await pool.query('INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,\'member\',now())', [randomUUID(), organizationId, employee.userId]);
});


async function challenge(run: Awaited<ReturnType<typeof pending>>) {
 const response = await post("/office/sessions/challenge", {deviceId: run.body.deviceId});
 expect(response.status).toBe(201);return await response.json() as SessionChallenge;
}
async function exchange(run: Awaited<ReturnType<typeof pending>>, c:SessionChallenge) {
 return post("/office/sessions",{challengeId:c.challengeId,nonce:c.nonce,signature:sign(null,sessionDigest(c),run.keys.privateKey).toString("base64url")});
}
async function approvedDevice() {const run=await pending();expect((await decision(run.id,"approved")).status).toBe(200);return run;}
async function credential(run:Awaited<ReturnType<typeof pending>>) {const response=await exchange(run,await challenge(run));expect(response.status).toBe(201);return (await response.json()).token as string;}
import {sessionDigest, type SessionChallenge, installOfficeRevocations, revokeOfficeDevice, watchOfficeSession} from "../src/office/sessions.js";
import {verifySyncToken} from "../src/tokens/sync-token.js";
import {verifyVaultToken} from "../src/tokens/vault-token.js";
import {InMemoryPubSub} from "../src/sync/pubsub.js";

describe("office device-bound sessions",()=>{
 it("requires current approval, valid one-use proof, audience and fresh nonce",async()=>{
  const run=await pending();
  expect((await post("/office/sessions/challenge",{deviceId:run.body.deviceId})).status).toBe(403);
  await decision(run.id,"approved");
  const c=await challenge(run);
  const forged=await post("/office/sessions",{challengeId:c.challengeId,nonce:c.nonce,signature:randomBytes(64).toString("base64url")});
  expect(forged.status).toBe(403);expect((await exchange(run,c)).status).toBe(409);
  const good=await challenge(run);expect((await exchange(run,good)).status).toBe(201);expect((await exchange(run,good)).status).toBe(409);
  const simultaneous=await challenge(run);expect((await Promise.all([exchange(run,simultaneous),exchange(run,simultaneous)])).map(r=>r.status).sort()).toEqual([201,409]);
  const changed=await challenge(run);process.env.OFFICE_HOST_GENERATION="2";expect((await exchange(run,changed)).status).toBe(403);process.env.OFFICE_HOST_GENERATION="1";
  const expired=await challenge(run);await pool.query("UPDATE office_session_challenge SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.challengeId]);expect((await exchange(run,expired)).status).toBe(410);
 });
 it("uses existing resolver and readable-set, blocks other organizations and credential delegation",async()=>{
  const run=await approvedDevice(),token=await credential(run),device={...employee,token};
  const vault=await seedVault(organizationId);await seedVaultGrant(organizationId,"edit");const doc=await seedNote(vault,null,"office.md",employee.userId);
  const otherOrg=await seedOrg("다른 회사","other-office");await seedMember(otherOrg,employee.userId,"member");await seedVaultGrant(otherOrg,"edit");const otherVault=await seedVault(otherOrg),otherDoc=await seedNote(otherVault,null,"other.md",employee.userId);
  expect((await get(`/notes?vaultId=${vault}`,device)).status).toBe(200);
  const listing=await (await get("/vaults",device)).json();expect(listing.vaults.map((v:{id:string})=>v.id)).toContain(vault);expect(listing.vaults.map((v:{id:string})=>v.id)).not.toContain(otherVault);
  for(const path of [`/notes?vaultId=${otherVault}`,`/vaults/${otherVault}/search?q=other`,`/vaults/${otherVault}/graph`])expect((await get(path,device)).status,path).toBe(403);
  expect((await post("/notes?vaultId="+vault,{vaultId:otherVault,relPath:"confused.md"},device)).status).toBe(403);
  expect((await post(`/notes/${doc}/public-link`,{vaultId:vault},device)).status).toBe(403);
  expect((await get(`/notes/${otherDoc}/versions?vaultId=${vault}`,device)).status).toBe(403);
  expect((await post("/sync-token",{docId:otherDoc},device)).status).toBe(403);
  expect((await post("/vault-sync-token",{vaultId:otherVault},device)).status).toBe(403);
  for(const path of ["/mcp/tokens","/mcp","/auth/organization/create","/office/invitations"])expect((await post(path,{organizationId},device)).status,path).toBe(403);
  const blob=await seedBlob(otherVault,otherOrg,"other.bin");expect((await get(`/blobs/${blob}`,device)).status).toBe(403);
  await pool.query("INSERT INTO shares(id,org_id,resource_type,resource_id,principal_type,principal_id,permission) VALUES($1,$2,'file',$3,'user',$4,'denied')",[randomUUID(),organizationId,doc,employee.userId]);
  expect((await post("/sync-token",{docId:doc},device)).status).toBe(403);
  const notes=await (await get(`/notes?vaultId=${vault}`,device)).json();expect(JSON.stringify(notes)).not.toContain("office.md");
 });
 it("invalidates HTTP and derived sync JWTs at revocation and closes subscribed sessions",async()=>{
  const run=await approvedDevice(),token=await credential(run),device={...employee,token};const vault=await seedVault(organizationId);await seedVaultGrant(organizationId,"edit");const doc=await seedNote(vault,null,"note.md",employee.userId);
  const sync=await (await post("/sync-token",{docId:doc},device)).json();const replication=await(await post("/vault-sync-token",{vaultId:vault},device)).json();
  const claims=await verifySyncToken(sync.token);expect(claims.officeSessionId).toBeTruthy();await verifyVaultToken(replication.token);
  const pubsub=new InMemoryPubSub();const stop=await installOfficeRevocations(pubsub);let closed=0;const off=watchOfficeSession(claims.officeSessionId!,()=>{closed++;});
  expect((await decision(run.id,"cancelled")).status).toBe(200);expect(closed).toBeGreaterThan(0);
  expect((await get(`/notes?vaultId=${vault}`,device)).status).toBe(401);await expect(verifySyncToken(sync.token)).rejects.toThrow();await expect(verifyVaultToken(replication.token)).rejects.toThrow();
  expect((await post("/office/sessions/challenge",{deviceId:run.body.deviceId})).status).toBe(403);off();await stop();await pubsub.close();
  const audit=JSON.stringify((await pool.query("SELECT before,after,refs FROM audit_log WHERE action LIKE 'office.%'")).rows);expect(audit).not.toContain(token);
 });
 it("rechecks person/membership and never treats email-less applicants as users",async()=>{
  const run=await approvedDevice(),token=await credential(run),device={...employee,token};
  await pool.query("UPDATE office_person_membership SET status='suspended' WHERE person_id=$1",[run.body.personId]);expect((await get("/vaults",device)).status).toBe(401);
  await pool.query("UPDATE office_person_membership SET status='active' WHERE person_id=$1",[run.body.personId]);
  await pool.query('DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2',[organizationId,employee.userId]);expect((await get("/vaults",device)).status).toBe(401);
  const rejected=await pending(employee,run.body.personId);expect((await decision(rejected.id,"rejected")).status).toBe(200);expect((await post("/office/sessions/challenge",{deviceId:rejected.body.deviceId})).status).toBe(403);
 });
});

import { HocuspocusProvider } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";
import { createServer } from "node:http";
import { createSyncServer } from "../src/sync/hocuspocus.js";
import { VaultChannel } from "../src/sync/vault-channel.js";
async function until(check:()=>boolean) {const end=Date.now()+8000;while(!check()){if(Date.now()>end)throw new Error("socket condition timed out");await new Promise(r=>setTimeout(r,20));}}
it("closes real document and vault sockets after database-committed withdrawal",async()=>{
 const run=await approvedDevice(),token=await credential(run),device={...employee,token},vault=await seedVault(organizationId);await seedVaultGrant(organizationId,"edit");const docId=await seedNote(vault,null,"socket.md",employee.userId);
 const syncToken=(await(await post("/sync-token",{docId},device)).json()).token;
 const vaultToken=(await(await post("/vault-sync-token",{vaultId:vault},device)).json()).token;
 const pubsub=new InMemoryPubSub(),stop=await installOfficeRevocations(pubsub),server=createSyncServer(0),http=createServer();
 const channel=new VaultChannel({pubsub});const wss=channel.attachUpgrade(http);const doc=new Y.Doc();let provider:HocuspocusProvider|undefined,ws:WebSocket|undefined,docClosed=0,vaultClosed=0,ready=false;
 try{
  await server.listen();await new Promise<void>(resolve=>http.listen(0,"127.0.0.1",resolve));
  provider=new HocuspocusProvider({url:`ws://127.0.0.1:${server.address.port}`,name:`vault:${vault}/note:${docId}`,token:syncToken,document:doc,WebSocketPolyfill:WebSocket as unknown as typeof globalThis.WebSocket,onClose:()=>{docClosed++;}});
  ws=new WebSocket(`ws://127.0.0.1:${(http.address() as {port:number}).port}/vault-sync`);ws.on("open",()=>ws!.send(JSON.stringify({t:"hello",token:vaultToken,manifest:{}})));ws.on("message",bytes=>{try{if(JSON.parse(bytes.toString()).t==="ready")ready=true;}catch{}});ws.on("close",()=>{vaultClosed++;});
  await until(()=>provider!.isSynced&&ready);
  // Direct DB withdrawal exercises commit-only NOTIFY -> PubSub -> both sockets.
  await pool.query("UPDATE office_person_membership SET status='suspended' WHERE person_id=$1",[run.body.personId]);
  await until(()=>docClosed>0&&vaultClosed>0);
  expect(docClosed).toBeGreaterThan(0);expect(vaultClosed).toBeGreaterThan(0);
  await expect(verifySyncToken(syncToken)).rejects.toThrow();await expect(verifyVaultToken(vaultToken)).rejects.toThrow();
 }finally{
  provider?.destroy();doc.destroy();ws?.terminate();for(const client of wss.clients)client.terminate();wss.close();channel.stopHeartbeat();await new Promise<void>(resolve=>http.close(()=>resolve()));await server.destroy();await stop();await pubsub.close();
 }
});

it("rejects every delegation/management route and conflicting path/query/body scope",async()=>{
 const run=await approvedDevice(),token=await credential(run),device={...employee,token};
 const vault=await seedVault(organizationId),other=await seedVault(organizationId);await seedVaultGrant(organizationId,"edit");const doc=await seedNote(vault,null,"delegation.md",employee.userId);
 for(const path of ["/mcp/tokens","/mcp","/oauth/authorize","/auth/oauth2/token","/auth/update-user","/auth/organization/create-invitation","/auth/organization/add-member","/auth/organization/update-member-role","/office/invitations",`/notes/${doc}/public-link`,`/orgs/${organizationId}/team-access`,"/shares",`/vaults/${vault}/blobs/intent`,`/vaults/${vault}/billing/checkout`]){
  const response=await post(path,{vaultId:vault,organizationId},device);expect(response.status,path).toBe(403);expect((await response.json()).code,path).toBe("office_scope_denied");
 }
 expect((await post(`/vaults/${vault}/notes/batch?vaultId=${other}`,{vaultId:vault,items:[]},device)).status).toBe(403);
 expect((await post(`/vaults/${vault}/notes/batch`,{vaultId:other,items:[]},device)).status).toBe(403);
 expect((await get(`/notes?vaultId=${vault}&vaultId=${other}`,device)).status).toBe(403);
 expect((await get(`/notes?vaultId=${vault}&organizationId=foreign`,device)).status).toBe(403);
 expect((await post("/notes",{vaultId:vault,organizationId:"foreign",relPath:"bad.md"},device)).status).toBe(403);
 expect((await post(`/vaults/${vault}/docs/batch`,{items:[]},device)).status).toBe(200);
 expect((await post(`/vaults/${vault}/folders/batch`,{items:[]},device)).status).toBe(200);
 expect((await post(`/vaults/${vault}/notes/delete-batch`,{docIds:[]},device)).status).not.toBe(403);
});

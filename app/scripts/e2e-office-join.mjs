// SPDX-License-Identifier: Apache-2.0
/** README: same-Mac office join E2E (macOS arm64, real Rust and bundled hub).
 * From app/: CMAKE=<cmake path> OFFICE_RUNTIME_ROOT=<prepared bundle> node scripts/e2e-office-join.mjs
 * Defaults to apps/desktop/src-tauri/office-runtime/darwin-arm64; never prepares
 * or modifies the bundle. Requires Cargo, private LAN NIC, multicast and unlocked
 * OS keychain. No existing accounts, server, .env or DB are used. Cargo compiles
 * one ignored test driver, then runs it directly without concurrent Cargo.
 * Runtime owns bundled Node/PG/migrations/HTTPS; Rust uses production native
 * begin/confirm/status, DNS-SD parser and candidate resolution, real keyring.
 * Requester confirm/request precedes admin inbox SAS comparison by protocol.
 * Tokens/keys never appear in arguments or output; stdin and TLS carry secrets.
 * Negative fixtures change throwaway invitations and a TLS fixture only.
 * Failures and signals clean test keychain namespaces, stop hub/PG and remove
 * temp data. Any FAIL exits 1. Two-PC, Windows, signed installer untested.
 */
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { request as httpsRequest, createServer as createHttpsServer } from 'node:https';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(process.env.OFFICE_RUNTIME_ROOT ?? join(app, 'apps/desktop/src-tauri/office-runtime/darwin-arm64'));
const rust = join(app, 'apps/desktop/src-tauri');
const namespace = `com.infinitebrain.e2e-office-${randomUUID()}`;
const secret = () => randomBytes(32).toString('base64url');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const rows = [], keychainEntries = [];
let directory, runtime, driver, tlsFixture, database, cleanupPromise, driverCall, driverExited, compileChild;
const syncProviders = [], syncDocs = [];
function check(name, ok, detail = '') {
  rows.push({ name, ok: Boolean(ok), detail });
  console.log(`| ${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail || '확인'} |`);
}
function requireOk(response, label) {
  if (!response.ok) throw new Error(`${label}: ${response.code ?? '응답 실패'}`);
  return response.value;
}
function expectStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label}: HTTP ${response.status}, ${response.data.code ?? '응답 오류'}`);
  return response.data;
}
async function deadline(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 시간 초과`)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function compileDriver() {
  let executable, stderr = '';
  compileChild = spawn('cargo', ['test', '--lib', '--no-run', '--message-format=json'], { cwd: rust, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  createInterface({ input: compileChild.stdout }).on('line', (line) => {
    try {
      const event = JSON.parse(line);
      if (event.reason === 'compiler-artifact' && event.target.name === 'desktop_lib' && event.executable) executable = event.executable;
      if (event.reason === 'compiler-message' && event.message.level === 'error') stderr += event.message.rendered ?? '';
    } catch {}
  });
  compileChild.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-16_000); });
  const code = await deadline(new Promise((done, fail) => { compileChild.once('error', fail); compileChild.once('exit', done); }), 600_000, 'Rust 빌드');
  if (code !== 0 || !executable) { console.error(stderr); throw new Error('Rust E2E 드라이버 빌드 실패'); }
  compileChild = null;
  return executable;
}
function startDriver(executable) {
  driver = spawn(executable, ['--exact', 'office_device::tests::bundled_office_join_e2e_driver', '--ignored', '--nocapture', '--test-threads=1'], {
    cwd: rust, env: { ...process.env, OFFICE_E2E_KEYCHAIN_NAMESPACE: namespace }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let pending;
  createInterface({ input: driver.stdout }).on('line', (line) => {
    const marker = line.indexOf('IB_E2E ');
    if (marker < 0 || !pending) return;
    const current = pending; pending = null;
    try { current.resolve(JSON.parse(line.slice(marker + 7))); } catch { current.reject(new Error('Rust 응답 형식 오류')); }
  });
  driver.stderr.resume();
  driverExited = new Promise((done) => driver.once('exit', (code) => { pending?.reject(new Error(`Rust 종료 (${code})`)); pending = null; done(code); }));
  driver.on('error', (error) => pending?.reject(error));
  driverCall = async (command) => {
    if (pending || driver.exitCode !== null || driver.signalCode !== null) throw new Error('Rust 드라이버가 준비되지 않음');
    return deadline(new Promise((resolveReply, reject) => {
      pending = { resolve: resolveReply, reject }; driver.stdin.write(`${JSON.stringify(command)}\n`);
    }), 30_000, `Rust ${command.op}`);
  };
}
// Pin before request.end: no HTTP bytes are sent to an unverified certificate.
function api(ready, path, { method = 'GET', token, body } = {}) {
  return new Promise((resolveReply, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = httpsRequest(`${ready.endpoint}/api${path}`, { method, agent: false, rejectUnauthorized: false, timeout: 10_000,
      headers: { origin: ready.endpoint, ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }) } });
    request.on('socket', (socket) => socket.once('secureConnect', () => {
      if (socket.getPeerCertificate().fingerprint256?.replaceAll(':', '').toLowerCase() !== ready.certificateFingerprint) { request.destroy(new Error('관리자 TLS pin 불일치')); return; }
      request.end(payload);
    }));
    request.once('response', (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; if (data.length > 65_536) request.destroy(new Error('응답 크기 초과')); });
      response.once('end', () => {
        try { resolveReply({ status: response.statusCode, data: JSON.parse(data), token: response.headers['set-auth-token'] }); }
        catch { reject(new Error('API JSON 응답 오류')); }
      });
    });
    request.once('timeout', () => request.destroy(new Error('API 시간 초과'))); request.once('error', reject);
  });
}
async function runQuiet(executable, args) {
  return new Promise((done) => { const proc = spawn(executable, args, { stdio: 'ignore' }); proc.once('error', () => done(-1)); proc.once('exit', done); });
}
async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    for (const provider of syncProviders) provider.destroy();
    for (const doc of syncDocs) doc.destroy();
    if (compileChild) { compileChild.kill('SIGTERM'); compileChild = null; }
    let nativeClean = false;
    if (driver && driver.exitCode === null && driver.signalCode === null) {
      try { nativeClean = requireOk(await driverCall({ op: 'cleanup' }), '키체인 정리').cleaned === true; } catch { driver.stdin.end(); }
      try { await deadline(driverExited, 5000, 'Rust 종료'); } catch { driver.kill('SIGKILL'); try { await deadline(driverExited, 5000, 'Rust 강제 종료'); } catch { check('Rust 드라이버 종료', false); } }
    }
    // Only known test service/account pairs; no secrets are printed or read.
    let keychainClean = !driver || nativeClean;
    for (const [service, account] of keychainEntries) {
      const removed = await runQuiet('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', account]);
      const absent = await runQuiet('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account]);
      keychainClean &&= [0, 44].includes(removed) && absent === 44;
    }
    check('테스트 전용 OS 키체인 항목 삭제', keychainClean);
    if (database) { try { await database.end(); } catch { check('임시 DB 연결 종료', false); } database = null; }
    if (tlsFixture) { tlsFixture.closeAllConnections(); await new Promise((done) => tlsFixture.close(done)); tlsFixture = null; }
    if (runtime) {
      try { await runtime.stop(); } catch { check('허브 종료', false); }
      const pidPresent = await stat(join(directory, 'postgres/postmaster.pid')).then(() => true, () => false);
      check('허브·PostgreSQL 정상 종료', runtime.children.size === 0 && !pidPresent);
    }
    if (directory && (!runtime || runtime.children.size === 0)) { await rm(directory, { recursive: true, force: true }); check('임시 데이터 디렉터리 삭제', await stat(directory).then(() => false, () => true)); }
  })();
  return cleanupPromise;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  check('실행 중단', false, signal); void cleanup().then(() => process.exit(signal === 'SIGINT' ? 130 : 143), () => process.exit(1));
});
async function main() {
  console.log('Infinite Brain · 실제 번들 허브와 Rust 합류 E2E\n\n| 결과 | 단계 | 확인 내용 |\n| --- | --- | --- |');
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('현재 E2E는 macOS arm64 전용입니다.');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('번들 플랫폼 불일치');
  const executable = await compileDriver(); check('Rust 실제 합류 경로 드라이버 빌드', true);
  const { OfficeHostRuntime } = await import(pathToFileURL(join(root, 'control/runtime.mjs')).href);
  const invitation = await import(pathToFileURL(join(root, 'server/dist/office/invitation.js')).href);
  const bundledRequire = createRequire(join(root, 'server/package.json'));
  const { Client } = bundledRequire('pg');
  directory = await mkdtemp(join(tmpdir(), 'ib-office-join-e2e-'));
  let ready;
  runtime = new OfficeHostRuntime({ root, readinessMs: 30_000, emit(event) { if (event.phase === 'ready') ready = event; } });
  const databasePassword = secret();
  await runtime.start({ protocol: 1, scope: 'lan', dataDirectory: directory, databasePassword, authSecret: secret() });
  check('번들 office-host LAN HTTPS 준비', ready?.lanExposed && ready.scope === 'lan' && /^[a-f0-9]{64}$/.test(ready.certificateFingerprint) && Boolean(ready.serverId));
  database = new Client({ host: '127.0.0.1', port: runtime.databasePort, user: 'infinitebrain', password: databasePassword, database: 'postgres' }); await database.connect();
  const signup = async (role) => {
    const response = await api(ready, '/auth/sign-up/email', { method: 'POST', body: { email: `${role}-${randomUUID()}@e2e.invalid`, password: secret(), name: `E2E ${role}` } });
    if (![200, 201].includes(response.status) || !response.token) throw new Error(`임시 계정 생성: HTTP ${response.status}`);
    return { token: response.token, userId: response.data.user.id };
  };
  const admin = await signup('admin'), member = await signup('member');
  const memberPersonId = randomUUID();
  const organization = expectStatus(await api(ready, '/auth/organization/create', { method: 'POST', token: admin.token, body: { name: 'E2E 임시 회사', slug: `e2e-${randomUUID()}` } }), 200, '임시 조직 생성');
  const organizationId = organization.id ?? organization.organization?.id;
  if (!organizationId) throw new Error('임시 조직 ID 없음');
  await database.query('INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,$4,now())', [randomUUID(), organizationId, member.userId, 'member']);
  check('서로 다른 관리자·합류자 계정과 조직 세션 생성', admin.userId !== member.userId);
  startDriver(executable);
  const found = requireOk(await driverCall({ op: 'discover', serverId: ready.serverId, generation: ready.hostGeneration, port: ready.port }), 'mDNS 광고·발견');
  check('실제 mDNS 광고·발견·후보 해석', found.serverId === ready.serverId && found.trust === 'untrusted');
  const invite = async () => expectStatus(await api(ready, '/office/invitations', { method: 'POST', token: admin.token, body: { organizationId, linkAccount: true } }), 201, '초대 생성');
  const begin = async (inv, device, overrides = {}) => {
    const decoded = invitation.parseOfficeInvitation(inv.invitationCode), scoped = `${namespace}-${device}`;
    keychainEntries.push([`${scoped}.office-device.v1`, 'device'], [`${scoped}.office-device.v1`, `hub:${decoded.serverId}`], [`${scoped}.office-e2e-session.v1`, `session-v2:${decoded.origin}`], [`${scoped}.office-device.v1`, `office-session-v1:${decoded.origin}`]);
    return driverCall({ op: 'begin', invitation: inv.invitationCode, device, personId: memberPersonId, accountToken: member.token, ...overrides });
  };
  const good = await invite(); check('관리자 API에서 IB1 초대 코드 발급', good.invitationCode.startsWith('IB1.'));
  const joined = requireOk(await begin(good, 'success'), 'Rust begin'); check('Rust begin → TLS pin·commit/reveal·서명·SAS', /^\d{6}$/.test(joined.sas));
  const pending = requireOk(await driverCall({ op: 'confirm', sessionId: joined.sessionId }), 'Rust confirm'); check('Rust confirm → 참여 요청', pending.state === 'pending_approval');
  const queue = expectStatus(await api(ready, `/office/organizations/${organizationId}/requests`, { token: admin.token }), 200, '승인함');
  const row = queue.requests.find((item) => item.sessionId === joined.sessionId); check('관리자 승인함과 Rust SAS 일치', Boolean(row) && row.sas === joined.sas);
  expectStatus(await api(ready, `/office/pairing/${joined.sessionId}/sas-confirm`, { method: 'POST', token: admin.token, body: { matches: row?.sas === joined.sas } }), 200, '관리자 SAS 확인');
  const approved = expectStatus(await api(ready, `/office/pairing/${joined.sessionId}/decision`, { method: 'POST', token: admin.token, body: { decision: 'approved' } }), 200, '관리자 승인'); check('관리자 숫자 확인 → approved', approved.state === 'approved');
  let status;
  for (let attempt = 0; attempt < 10; attempt++) {
    status = requireOk(await driverCall({ op: 'status', sessionId: joined.sessionId }), 'Rust status'); if (status.state === 'approved') break; await delay(200);
  }
  check('Rust status 폴링 → approved·OS 키체인 pin 저장', status.state === 'approved' && status.pinSaved);
  // Every HTTP operation below is authenticated in native Rust. JS sees only a
  // short-lived loopback capability, never the device-session token.
  const localRequire = createRequire(join(app,'apps/server/package.json'));
  const { HocuspocusProvider } = localRequire('@hocuspocus/provider');
  const Y = localRequire('yjs'), WebSocket = localRequire('ws');
  const relay = requireOk(await driverCall({op:'relay',device:'success',origin:ready.endpoint,serverId:ready.serverId}), 'Rust 기기 세션 relay');
  const relayApi = async(path, {method='GET',body}={}) => {
    const response=await fetch(`${relay.httpBaseUrl}/api${path}`,{method,headers:{origin:'http://tauri.localhost',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json()};
  };
  const vaultId=randomUUID();
  await database.query('INSERT INTO vaults(id,organization_id,name) VALUES($1,$2,$3)',[vaultId,organizationId,'기기 동기화 vault']);
  await database.query("INSERT INTO shares(id,org_id,resource_type,resource_id,principal_type,principal_id,permission) VALUES($1,$2,'vault',$2,'org',$2,'edit') ON CONFLICT DO NOTHING",[randomUUID(),organizationId]);
  const documentId=randomUUID();
  const registered=expectStatus(await relayApi('/notes',{method:'POST',body:{vaultId,docId:documentId,relPath:'office-session.md',title:'office-session'}}),201,'기기 A 노트 등록');
  check('승인 후 Rust 기기 키 세션 → relay HTTP 노트 등록', registered.docId===documentId || registered.id===documentId);
  const deviceToken=expectStatus(await relayApi('/sync-token',{method:'POST',body:{docId:documentId}}),200,'기기 A sync JWT');
  const adminToken=expectStatus(await api(ready,'/sync-token',{method:'POST',token:admin.token,body:{docId:documentId}}),200,'관리자 sync JWT');
  const until=async(probe,label)=>{const end=Date.now()+15_000;while(!probe()){if(Date.now()>end)throw new Error(`${label} 시간 초과`);await delay(25);}};
  const docA=new Y.Doc(),docB=new Y.Doc();syncDocs.push(docA,docB);
  const url=relay.httpBaseUrl.replace(/^http:/,'ws:')+'/sync';
  const name=`vault:${vaultId}/note:${documentId}`;
  // Both use the pinned native transport; B uses an account sync JWT, issued
  // separately through the pinned admin API, on this same real bundled hub.
  class RelaySocket extends WebSocket {constructor(address,protocols){super(address,protocols,{origin:'http://tauri.localhost'});}}
  let closedA=0;
  const a=new HocuspocusProvider({url,name,token:deviceToken.token,document:docA,WebSocketPolyfill:RelaySocket,onClose:()=>closedA++});
  const b=new HocuspocusProvider({url,name,token:adminToken.token,document:docB,WebSocketPolyfill:RelaySocket});syncProviders.push(a,b);
  await until(()=>a.isSynced&&b.isSynced,'Yjs 연결');
  docA.getText('content').insert(0,'승인된 기기에서 보낸 바이너리 Yjs 업데이트');
  await until(()=>docB.getText('content').toString()===docA.getText('content').toString()&&docB.getText('content').length>0,'Yjs 수렴');
  await until(()=>a.unsyncedChanges===0,'허브 저장 확인');
  check('기기 A → 관리자 클라이언트 Yjs 바이너리 업데이트 수렴',Buffer.from(Y.encodeStateAsUpdate(docA)).equals(Buffer.from(Y.encodeStateAsUpdate(docB))));
  const outside=expectStatus(await api(ready,'/auth/organization/create',{method:'POST',token:admin.token,body:{name:'허용하지 않은 회사',slug:`outside-${randomUUID()}`}}),200,'다른 조직');
  const outsideOrg=outside.id??outside.organization?.id,outsideVault=randomUUID();
  await database.query('INSERT INTO vaults(id,organization_id,name) VALUES($1,$2,$3)',[outsideVault,outsideOrg,'허용 안 된 vault']);
  await database.query('INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,\'member\',now())',[randomUUID(),outsideOrg,member.userId]);
  check('같은 계정의 허용 안 된 vault 접근 차단',(await relayApi(`/notes?vaultId=${outsideVault}`)).status===403);
  // The exact issuance request is replayed by native test driver below; no
  // session credential leaves Rust. The server must reject its spent challenge.
  const replay=requireOk(await driverCall({op:'replay',origin:ready.endpoint,serverId:ready.serverId,device:'success'}),'세션 proof 재생');
  check('기기 세션 서명 challenge 재생 거절',replay.replayed===false);
  const beforeClose=closedA;
  expectStatus(await api(ready,`/office/pairing/${joined.sessionId}/decision`,{method:'POST',token:admin.token,body:{decision:'cancelled',reasonCode:'device_revoked'}}),200,'기기 회수');
  await until(()=>closedA>beforeClose,'회수 socket 종료');
  check('회수 즉시 기존 socket 종료·HTTP 세션 거절',(await relayApi(`/notes?vaultId=${vaultId}`)).status===401);
  const retired=await driverCall({op:'relay',device:'success',origin:ready.endpoint,serverId:ready.serverId});
  check('회수한 기기의 새 세션 발급 거절',!retired.ok);
  const reused = await begin(good, 'reuse'); check('단회 초대 재사용 거절', !reused.ok && reused.code === 'office_invite_invalid', reused.code);
  const mismatch = requireOk(await begin(await invite(), 'mismatch'), '불일치 준비'); requireOk(await driverCall({ op: 'confirm', sessionId: mismatch.sessionId }), '불일치 참여 요청');
  const attempts = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await delay(attempt === 1 ? 1100 : 2100);
    const response = await api(ready, `/office/pairing/${mismatch.sessionId}/sas-confirm`, { method: 'POST', token: admin.token, body: { matches: false } }); attempts.push(response.status === 403 && response.data.code === 'sas_mismatch');
  }
  const cancelled = (await database.query('SELECT state,failed_attempts,sas_code,sas_commit,sas_server_nonce FROM pairing_session WHERE id=$1', [mismatch.sessionId])).rows[0];
  const blocked = await driverCall({ op: 'status', sessionId: mismatch.sessionId });
  const cannotApprove = await api(ready, `/office/pairing/${mismatch.sessionId}/decision`, { method: 'POST', token: admin.token, body: { decision: 'approved' } });
  check('관리자 SAS 불일치 3회 → 세션·숫자 폐기', attempts.every(Boolean) && cancelled.state === 'cancelled' && cancelled.failed_attempts === 3 && cancelled.sas_code === null && cancelled.sas_commit === null && cancelled.sas_server_nonce === null && !blocked.ok && cannotApprove.status === 409,
    `시도 ${attempts.filter(Boolean).length}/3, 상태 ${cancelled.state}, 승인 HTTP ${cannotApprove.status}`);
  const foreign = await invite(), foreignDecoded = invitation.parseOfficeInvitation(foreign.invitationCode);
  foreign.invitationCode = invitation.encodeOfficeInvitation({ ...foreignDecoded, serverId: `other-${randomUUID()}` });
  const wrongHub = await begin(foreign, 'foreign'); check('다른 serverId 초대와 mDNS 후보 결합 거절', !wrongHub.ok && wrongHub.code === 'office_hub_pin_mismatch', wrongHub.code);
  const expired = await invite(); await database.query("UPDATE office_pairing_invitation SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.invitationId]);
  const expiredResult = await begin(expired, 'expired'); check('서버에서 만료된 초대 거절', !expiredResult.ok && expiredResult.code === 'office_invite_invalid', expiredResult.code);
  const expiredDecoded = invitation.parseOfficeInvitation(expired.invitationCode);
  const expiredCode = invitation.encodeOfficeInvitation({ ...expiredDecoded, expiresAt: new Date(Date.now() - 10_000).toISOString() });
  const localExpired = await driverCall({ op: 'begin', invitation: expiredCode, device: 'localexpired', personId: randomUUID() }); check('Rust에서 만료된 IB1 코드 거절', !localExpired.ok && localExpired.code === 'office_invite_expired', localExpired.code);
  const { generate } = bundledRequire('selfsigned');
  const changed = await generate([{ name: 'commonName', value: 'E2E changed hub' }], { keySize: 2048, algorithm: 'sha256' });
  let leakedRequests = 0;
  tlsFixture = createHttpsServer({ key: changed.private, cert: changed.cert }, (_request, response) => { leakedRequests++; response.end('{}'); });
  await new Promise((done) => tlsFixture.listen(0, '127.0.0.1', done));
  const changedInvite = await invite(), changedDecoded = invitation.parseOfficeInvitation(changedInvite.invitationCode);
  changedInvite.invitationCode = invitation.encodeOfficeInvitation({ ...changedDecoded, origin: `https://127.0.0.1:${tlsFixture.address().port}` });
  const pin = await begin(changedInvite, 'success', { useDiscovery: false }); check('바뀐 허브 인증서 pin 거절·HTTP 전송 0건', !pin.ok && pin.code === 'office_hub_pin_mismatch' && leakedRequests === 0, `${pin.code}, HTTP ${leakedRequests}건`);
}
try { await main(); } catch (error) { check('E2E 실행', false, error.message); }
finally { try { await cleanup(); } catch (error) { check('종료·정리', false, error.message); } }
console.log(`\n결과: ${rows.filter((row) => row.ok).length}/${rows.length} PASS`);
process.exitCode = rows.length > 0 && rows.every((row) => row.ok) ? 0 : 1;

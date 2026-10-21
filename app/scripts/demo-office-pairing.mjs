// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(repo, 'apps/desktop/src-tauri/office-runtime/darwin-arm64');
const server = join(repo, 'apps/server');
const bundledNode = join(runtime, 'node');
const pgBin = join(runtime, 'postgres/native/bin');
const readyTimeoutMs = 30_000;
let workDir, dbChild, serverChild, stopping = false, cleanupPromise;
const results = [];

function say(message = '') { console.log(message); }
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function secret(bytes = 32) { return randomBytes(bytes).toString('base64url'); }
function child(executable, args, options = {}) {
  const proc = spawn(executable, args, { stdio: ['ignore', 'ignore', 'ignore'], ...options });
  proc.on('error', (error) => { if (!stopping) say(`프로그램 실행 오류: ${error.message}`); });
  return proc;
}
function ended(proc) {
  if (!proc) return Promise.resolve();
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => proc.once('exit', resolveExit));
}
async function freePort() {
  const socket = createServer();
  await new Promise((ok, fail) => { socket.once('error', fail); socket.listen(0, '127.0.0.1', ok); });
  const port = socket.address().port;
  await new Promise((ok, fail) => socket.close((e) => e ? fail(e) : ok()));
  return port;
}
async function waitFor(probe, label) {
  const end = Date.now() + readyTimeoutMs;
  while (Date.now() < end) {
    if (stopping) throw new Error('중단 요청');
    try { if (await probe()) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} 준비 시간 초과`);
}
async function run(executable, args, options = {}) {
  await new Promise((resolveExit, reject) => {
    const proc = spawn(executable, args, { stdio: 'ignore', ...options });
    proc.once('error', reject);
    proc.once('exit', (code) => code === 0 ? resolveExit() : reject(new Error(`${executable} 실패 (${code})`)));
  });
}
async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  stopping = true;
  cleanupPromise = (async () => {
    for (const proc of [serverChild, dbChild]) {
      if (!proc || proc.exitCode !== null || proc.signalCode !== null) continue;
      proc.kill('SIGTERM');
      const stopped = await Promise.race([ended(proc), new Promise((r) => setTimeout(() => r('timeout'), 8000))]);
      if (stopped === 'timeout' && proc.exitCode === null && proc.signalCode === null) {
        proc.kill('SIGKILL'); await ended(proc);
      }
    }
    if (workDir) await rm(workDir, { recursive: true, force: true });
  })();
  return cleanupPromise;
}
process.once('SIGINT', () => { say('\n중단 요청을 받았습니다. 임시 서버와 데이터베이스를 정리합니다.'); void cleanup().then(() => process.exit(130)); });
process.once('SIGTERM', () => { void cleanup().then(() => process.exit(143)); });

async function main() {
  say('Infinite Brain · 기기 참여 승인 데모');
  say('이 데모는 임시 PostgreSQL과 임의 테스트 계정만 사용합니다. 비밀번호와 개인키는 출력하지 않습니다.\n');
  const manifestPath = join(runtime, 'manifest.json');
  const needed = [bundledNode, join(pgBin, 'initdb'), join(pgBin, 'postgres'), manifestPath,
    join(server, 'dist/index.js'), join(server, 'dist/db/migrate.js'), join(server, 'migrations/067_office_identity_pairing.sql')];
  for (const path of needed) await readFile(path).catch(() => {
    throw new Error('office 런타임 또는 서버 빌드 파일이 없습니다. 저장소 안내에 따라 office:prepare된 런타임을 준비한 뒤 다시 실행해 주세요.');
  });
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('현재 준비된 office 번들은 macOS Apple Silicon(darwin-arm64)용입니다.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('office 번들이 현재 컴퓨터와 맞지 않습니다.');
  const databasePassword = secret(), jwtSecret = secret(), generation = String(1 + randomBytes(3).readUIntBE(0, 3));
  const serverId = `demo-${randomUUID()}`, fingerprint = randomBytes(32).toString('hex');
  const dbPort = await freePort(), httpPort = await freePort();
  workDir = await mkdtemp(join(tmpdir(), 'infinite-brain-office-pairing-'));
  const cluster = join(workDir, 'postgres');
  const pgEnv = { ...process.env, DYLD_LIBRARY_PATH: join(runtime, 'postgres/native/lib') };
  const passwordFile = join(workDir, 'init-password');
  await writeFile(passwordFile, `${databasePassword}\n`, { mode: 0o600, flag: 'wx' });
  await run(join(pgBin, 'initdb'), ['-D', cluster, '-U', 'infinitebrain', '--encoding=UTF8', '--locale=C', '--auth=scram-sha-256', `--pwfile=${passwordFile}`], { env: pgEnv });
  await rm(passwordFile, { force: true });
  dbChild = child(join(pgBin, 'postgres'), ['-D', cluster, '-h', '127.0.0.1', '-p', String(dbPort), '-c', 'unix_socket_directories=', '-c', 'fsync=on'], { env: pgEnv });
  const dbUrl = `postgres://infinitebrain:${databasePassword}@127.0.0.1:${dbPort}/postgres`;
  const require = createRequire(join(server, 'package.json'));
  const { Client } = require('pg');
  await waitFor(async () => {
    const probe = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 700, query_timeout: 700 });
    try { await probe.connect(); await probe.query('SELECT 1'); return true; }
    finally { await probe.end().catch(() => {}); }
  }, 'PostgreSQL');

  const baseUrl = `http://127.0.0.1:${httpPort}`;
  const env = { ...process.env, NODE_ENV: 'production', DATABASE_URL: dbUrl, JWT_SECRET: jwtSecret,
    BETTER_AUTH_URL: baseUrl, HOST: '127.0.0.1', PORT: String(httpPort), HOCUSPOCUS_HOST: '127.0.0.1',
    HOCUSPOCUS_PORT: '0', RELEASE_MANIFEST_URL: 'off', RELEASE_POLL_MINUTES: '0', BLOB_PROVIDER: 'postgres',
    OFFICE_SERVER_ID: serverId, OFFICE_HOST_GENERATION: generation, OFFICE_HUB_FINGERPRINT: fingerprint };
  say('1/3  임시 데이터베이스를 만들고 001~067 마이그레이션을 적용합니다…');
  await run(bundledNode, [join(server, 'dist/db/migrate.js')], { cwd: server, env });
  serverChild = child(bundledNode, [join(server, 'dist/index.js')], { cwd: server, env });
  await waitFor(async () => { const response = await fetch(`${baseUrl}/health`); return response.ok; }, 'HTTP 서버');
  say('2/3  실제 서버 API를 시작했습니다. 이제 pairing 과정을 확인합니다.\n');

  const request = async (path, { method = 'GET', body, token } = {}) => {
    const response = await fetch(`${baseUrl}/api${path}`, { method,
      headers: { origin: baseUrl, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let data; try { data = await response.json(); } catch { data = {}; }
    return { status: response.status, data, token: response.headers.get('set-auth-token') };
  };
  const signup = async (email, name) => {
    const res = await request('/auth/sign-up/email', { method: 'POST', body: { email, password: secret(18), name } });
    if (res.status !== 200 && res.status !== 201) throw new Error(`테스트 계정 생성 실패 (${res.status}${res.data.code ? `, ${res.data.code}` : ''}${res.data.message ? `: ${res.data.message}` : ''})`);
    const token = res.token;
    if (!token) throw new Error('테스트 계정 세션 토큰을 받지 못했습니다.');
    return { token, userId: res.data.user.id };
  };
  const admin = await signup(`admin-${randomUUID()}@demo.invalid`, '데모 관리자');
  const memberA = await signup(`a-${randomUUID()}@demo.invalid`, '민수 A');
  const memberB = await signup(`b-${randomUUID()}@demo.invalid`, '민수 B');
  const orgRes = await request('/auth/organization/create', { method: 'POST', token: admin.token,
    body: { name: 'pairing 데모 회사', slug: `pairing-${randomUUID().slice(0, 8)}` } });
  if (orgRes.status !== 200 && orgRes.status !== 201) throw new Error(`데모 회사 생성 실패 (${orgRes.status})`);
  const organizationId = orgRes.data.id ?? orgRes.data.organization?.id;
  if (!organizationId) throw new Error('데모 회사 ID를 받지 못했습니다.');
  const dbConn = new Client({ connectionString: dbUrl }); await dbConn.connect();
  try {
    for (const person of [memberA, memberB]) await dbConn.query(
      'INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,$4,now())',
      [randomUUID(), organizationId, person.userId, 'member']);
  } finally { await dbConn.end(); }

  const protocol = await import(pathToFileURL(join(server, 'dist/office/protocol.js')).href);
  async function begin(person, deviceName) {
    const inv = await request('/office/invitations', { method: 'POST', token: admin.token, body: { organizationId } });
    if (inv.status !== 201) throw new Error(`초대 발급 실패 (${inv.status})`);
    const keys = generateKeyPairSync('ed25519');
    const personId = randomUUID(), deviceId = randomUUID();
    const body = { invitationSecret: inv.data.invitationSecret, hubFingerprint: fingerprint, personId, deviceId,
      displayAlias: '민수', deviceLabel: deviceName, platform: 'macos', clientNonce: secret(),
      publicKey: keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url') };
    const started = await request('/office/pairing/challenge', { method: 'POST', body, token: person.token });
    if (started.status !== 201) throw new Error(`참여 요청 준비 실패 (${started.status})`);
    const challenge = started.data.challenge;
    const signature = sign(null, protocol.challengeDigest(challenge), keys.privateKey).toString('base64url');
    return { id: challenge.sessionId, token: started.data.pairingToken, challenge, signature, person };
  }
  const proveAndRequest = async (run) => {
    const proof = await request(`/office/pairing/${run.id}/proof`, { method: 'POST', body: {
      pairingToken: run.token, clientNonce: run.challenge.clientNonce, serverNonce: run.challenge.serverNonce, signature: run.signature } });
    if (proof.status !== 200) throw new Error(`기기 서명 확인 실패 (${proof.status})`);
    return request(`/office/pairing/${run.id}/request`, { method: 'POST', token: run.person.token, body: { pairingToken: run.token } });
  };
  say('3/3  단계별 결과');
  const a = await begin(memberA, '기기 A');
  const requestA = await proveAndRequest(a);
  check('초대 발급 → 기기 A 참여 요청(별명 민수)', requestA.status === 200, requestA.status === 200 ? '승인 대기 상태' : `HTTP ${requestA.status}`);
  const denied = await request(`/office/organizations/${organizationId}/directory`, { token: memberA.token });
  check('승인 전 디렉터리 접근 차단', denied.status === 403, `HTTP ${denied.status}`);

  const b = await begin(memberB, '기기 B');
  const requestB = await proveAndRequest(b);
  const queue = await request(`/office/organizations/${organizationId}/requests`, { token: admin.token });
  const rows = queue.data.requests ?? [];
  const rowA = rows.find((row) => row.sessionId === a.id), rowB = rows.find((row) => row.sessionId === b.id);
  const marked = rowA && rowB && rowA.displayAlias === rowB.displayAlias && rowA.comparisonCode !== rowB.comparisonCode;
  check('같은 별명 두 요청을 표식으로 구분', requestB.status === 200 && marked,
    marked ? `${rowA.displayAlias} · ${rowA.comparisonCode} / ${rowB.displayAlias} · ${rowB.comparisonCode}` : `요청 HTTP ${requestB.status}, 대기열 표식 확인 실패`);

  const approved = await request(`/office/pairing/${a.id}/decision`, { method: 'POST', token: admin.token, body: { decision: 'approved' } });
  const statusA = await request(`/office/pairing/${a.id}/status`, { method: 'POST', body: { pairingToken: a.token } });
  const directory = await request(`/office/organizations/${organizationId}/directory`, { token: memberA.token });
  check('관리자 승인 후 기기 A 승인 상태 확인', approved.status === 200 && statusA.data.state === 'approved' && directory.status === 200,
    `승인 HTTP ${approved.status}, 상태 ${statusA.data.state ?? '확인 불가'}`);

  const rejected = await request(`/office/pairing/${b.id}/decision`, { method: 'POST', token: admin.token, body: { decision: 'rejected', reasonCode: 'not_recognized' } });
  const reuseB = await request(`/office/pairing/${b.id}/proof`, { method: 'POST', body: { pairingToken: b.token,
    clientNonce: b.challenge.clientNonce, serverNonce: b.challenge.serverNonce, signature: b.signature } });
  check('거절한 기기 B의 참여 자격 재사용 차단', rejected.status === 200 && reuseB.status === 409,
    `거절 HTTP ${rejected.status}, 재사용 HTTP ${reuseB.status}`);
  const cancelledInvite = await request('/office/invitations', { method: 'POST', token: admin.token, body: { organizationId } });
  const cancel = await request(`/office/invitations/${cancelledInvite.data.invitationId}/cancel`, { method: 'POST', token: admin.token, body: {} });
  const spareKeys = generateKeyPairSync('ed25519');
  const reusedInvite = await request('/office/pairing/challenge', { method: 'POST', token: memberB.token, body: {
    invitationSecret: cancelledInvite.data.invitationSecret, hubFingerprint: fingerprint, personId: randomUUID(), deviceId: randomUUID(),
    displayAlias: '다른 참여자', deviceLabel: '재사용 확인용', platform: 'macos', clientNonce: secret(),
    publicKey: spareKeys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url') } });
  // The cancelled invitation is independently checked through the invitation API path.
  check('취소한 초대 재사용 차단', cancel.status === 200 && reusedInvite.status === 410,
    `취소 HTTP ${cancel.status}, 재사용 HTTP ${reusedInvite.status}`);

  const forged = await begin(memberB, '위조 서명 확인용');
  const forgedProof = await request(`/office/pairing/${forged.id}/proof`, { method: 'POST', body: { pairingToken: forged.token,
    clientNonce: forged.challenge.clientNonce, serverNonce: forged.challenge.serverNonce, signature: secret(64) } });
  check('위조 서명 거절', forgedProof.status === 403, `HTTP ${forgedProof.status}`);
  const goodProof = await request(`/office/pairing/${forged.id}/proof`, { method: 'POST', body: { pairingToken: forged.token,
    clientNonce: forged.challenge.clientNonce, serverNonce: forged.challenge.serverNonce, signature: forged.signature } });
  const replayProof = await request(`/office/pairing/${forged.id}/proof`, { method: 'POST', body: { pairingToken: forged.token,
    clientNonce: forged.challenge.clientNonce, serverNonce: forged.challenge.serverNonce, signature: forged.signature } });
  check('nonce/증명 재사용 거절', goodProof.status === 200 && replayProof.status === 409, `첫 확인 ${goodProof.status}, 재사용 ${replayProof.status}`);
  const expiring = await begin(memberB, '만료 확인용');
  const expireDb = new Client({ connectionString: dbUrl }); await expireDb.connect();
  try { await expireDb.query("UPDATE pairing_session SET expires_at=now()-interval '1 second' WHERE id=$1", [expiring.id]); }
  finally { await expireDb.end(); }
  const expiredProof = await request(`/office/pairing/${expiring.id}/proof`, { method: 'POST', body: { pairingToken: expiring.token,
    clientNonce: expiring.challenge.clientNonce, serverNonce: expiring.challenge.serverNonce, signature: expiring.signature } });
  check('만료된 참여 요청 거절', expiredProof.status === 410, `HTTP ${expiredProof.status}`);
  say('');
  say(`결과: ${results.filter((r) => r.ok).length}/${results.length} PASS`);
  return results.every((r) => r.ok) ? 0 : 1;
}

let exitCode = 1;
try { exitCode = await main(); }
catch (error) { say(`\n데모를 실행하지 못했습니다: ${error.message}`); say('README의 준비 항목을 확인해 주세요.'); }
finally { await cleanup(); }
process.exitCode = exitCode;

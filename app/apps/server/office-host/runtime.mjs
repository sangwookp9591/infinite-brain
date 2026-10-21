// SPDX-License-Identifier: Apache-2.0
// Product-owned server supervisor. No shell, global database, .env or PATH lookup.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, X509Certificate, createPrivateKey } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const exited = (child) => child.exitCode !== null || child.signalCode !== null;
const runtimeError = (code, message) => Object.assign(new Error(message), { code });

async function deadline(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function livePostmaster(cluster) {
  let pid;
  try { pid = Number((await readFile(join(cluster, 'postmaster.pid'), 'utf8')).split('\n')[0]); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw runtimeError('database-recovery-required', 'office database PID is invalid; explicit recovery is required');
  }
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    throw runtimeError('database-recovery-required', 'office database process cannot be verified; explicit recovery is required');
  }
}

export function childEnvironment(source = process.env) {
  // In particular, never inherit DATABASE_URL, cloud credentials, NODE_OPTIONS,
  // dotenv paths, preload hooks, PG service settings, or dynamic-loader overrides.
  const env = {};
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TZ']) {
    if (source[key]) env[key] = source[key];
  }
  return env;
}

export function validateProfile(value) {
  if (!value || value.protocol !== 1 || typeof value.dataDirectory !== 'string'
      || !value.dataDirectory || !isAbsolute(value.dataDirectory)) {
    throw new Error('invalid office host profile');
  }
  for (const key of ['databasePassword', 'authSecret']) {
    if (typeof value[key] !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(value[key])) {
      throw new Error('invalid office host credentials');
    }
  }
  if (value.scope !== undefined && !['loopback', 'lan'].includes(value.scope)) throw new Error('invalid office host scope');
  if (value.tls !== undefined && (!value.tls || typeof value.tls !== 'object'
      || !(value.tls.certificateFingerprint === null || typeof value.tls.certificateFingerprint === 'string'))) {
    throw new Error('invalid office host TLS profile');
  }
  return value;
}

function lanAddress() {
  const interfaces = Object.entries(networkInterfaces());
  const preferred = interfaces.filter(([name]) => /^(en\d+|eth\d+|wlan\d+|wlp|wi-?fi|ethernet)/i.test(name));
  const candidates = [...preferred, ...interfaces.filter(([name]) => !preferred.some(([preferredName]) => preferredName === name)
    && !/^(bridge|docker|utun|awdl|llw|lo)/i.test(name))];
  for (const [, addresses] of candidates) {
    for (const entry of addresses ?? []) {
      if (entry.internal || entry.family !== 'IPv4') continue;
      const address = entry.address;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(address)) return address;
    }
  }
  throw new Error('office host has no private network address');
}

async function freePort() {
  const socket = createServer();
  await new Promise((ok, fail) => { socket.once('error', fail); socket.listen(0, '127.0.0.1', ok); });
  const port = socket.address().port;
  await new Promise((ok, fail) => socket.close((error) => error ? fail(error) : ok()));
  return port;
}

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

/** One atomic, private bundle avoids a partially installed key/certificate pair.
 * Never renew silently: certificate renewal changes the approved device pins. */
export async function hostIdentity(directory, generate) {
  const path = join(directory, 'tls-identity.json');
  let identity;
  try { identity = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const pems = await generate([{ name: 'commonName', value: 'Infinite Brain Office Hub' }], {
      keySize: 2048, algorithm: 'sha256', notAfterDate: new Date(Date.now() + 365 * 86_400_000),
      extensions: [{ name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true }],
    });
    identity = { serverId: randomUUID(), generation: 0, certificate: pems.cert, privateKey: pems.private };
  }
  const certificate = new X509Certificate(identity.certificate);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(identity.serverId) || !Number.isSafeInteger(identity.generation)
      || identity.generation < 0 || identity.generation >= 999999999999999
      || !certificate.checkPrivateKey(createPrivateKey(identity.privateKey))
      || !certificate.verify(certificate.publicKey)) throw new Error('invalid office TLS identity');
  if (Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) {
    throw runtimeError('tls-renewal-required', 'office TLS certificate requires approved renewal');
  }
  identity.generation++;
  const temporary = `${path}.${randomBytes(16).toString('hex')}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(identity)); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
    await chmod(path, 0o600);
    if (process.platform !== 'win32') {
      const parent = await open(directory, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    }
  } finally { await rm(temporary, { force: true }); }
  return { ...identity, path, fingerprint: certificate.fingerprint256.replaceAll(':', '').toLowerCase(), expiresAt: certificate.validTo };
}

/** Private readiness probe: a per-request pin, never a process-wide TLS bypass.
 * No HTTP application bytes are sent before the certificate pin is checked. */
export function pinnedHealth(endpoint, fingerprint) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(`${endpoint}/health`, { rejectUnauthorized: false, agent: false, timeout: 500 });
    request.on('socket', (socket) => socket.once('secureConnect', () => {
      const actual = socket.getPeerCertificate().fingerprint256?.replaceAll(':', '').toLowerCase();
      if (actual !== fingerprint) { request.destroy(runtimeError('hub-pin-mismatch', 'office hub certificate changed')); return; }
      request.end();
    }));
    request.once('response', (response) => {
      let body = '';
      response.on('data', (bytes) => { body += bytes; if (body.length > 4096) request.destroy(new Error('invalid health response')); });
      response.once('end', () => { try { resolve(response.statusCode === 200 && JSON.parse(body).ok === true); } catch (error) { reject(error); } });
    });
    request.once('timeout', () => request.destroy(new Error('health timeout')));
    request.once('error', reject);
  });
}

export class OfficeHostRuntime {
  constructor({ root = ROOT, emit = () => {}, spawnProcess = spawn, platform = process.platform,
    readinessMs = 15_000, helperMs = 16_000, shutdownMs = 15_000, killMs = 2_000 } = {}) {
    this.root = root;
    this.spawnProcess = spawnProcess;
    this.platform = platform;
    this.readinessMs = readinessMs;
    this.helperMs = helperMs;
    this.shutdownMs = shutdownMs;
    this.killMs = killMs;
    this.emit = emit;
    this.children = new Set();
    this.stopping = false;
    this.stopPromise = null;
    this.lock = null;
  }

  phase(phase) { this.emit({ protocol: 1, phase }); }

  launch(executable, args, env, { cwd = this.root, ipc = false, timeoutMs = 60_000 } = {}) {
    if (this.stopping) throw new Error('office host is stopping');
    const child = this.spawnProcess(executable, args, { cwd, env, stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.children.add(child);
    child.once('exit', () => this.children.delete(child));
    child.once('error', () => this.children.delete(child));
    const deadline = timeoutMs > 0 ? setTimeout(() => child.kill('SIGKILL'), timeoutMs) : null;
    const clearDeadline = () => { if (deadline) clearTimeout(deadline); };
    child.once('exit', clearDeadline);
    child.once('error', clearDeadline);
    // Drain output without forwarding possible credentials, content or SQL.
    // The structured phase/error channel is the public diagnostic surface.
    child.stdout.resume();
    child.stderr.resume();
    const ended = new Promise((ok, fail) => {
      child.once('error', fail);
      child.once('exit', (code, signal) => code === 0 ? ok() : fail(new Error(`host child exited (${code ?? signal})`)));
    });
    // Long-running children can exit while we are awaiting readiness elsewhere.
    ended.catch(() => {});
    return { child, ended };
  }

  async acquire(directory) {
    if (this.stopping) throw new Error('office host is stopping');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lockPath = join(directory, 'runtime.lock');
    try {
      this.lock = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // No read/check/unlink takeover: two contenders could otherwise remove
      // the new owner's lock. Recovery is explicit even when the PID is dead.
      let old;
      try { old = JSON.parse(await readFile(lockPath, 'utf8')); } catch { /* incomplete lock is also recovery-only */ }
      if (Number.isSafeInteger(old?.pid) && old.pid > 0) {
        try { process.kill(old.pid, 0); throw runtimeError('already-running', 'office host is already running'); }
        catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
      }
      if (await livePostmaster(join(directory, 'postgres'))) {
        throw runtimeError('database-orphaned', 'office database is still running without this supervisor; stop it explicitly before recovery');
      }
      throw runtimeError('runtime-lock-recovery-required', 'office runtime lock requires explicit recovery after verifying all owned processes have stopped');
    }
    this.lockPath = lockPath;
    await this.lock.writeFile(JSON.stringify({ pid: process.pid }));
    await this.lock.sync();
    if (this.stopping) throw new Error('office host is stopping');
  }

  start(input) {
    if (this.startPromise || this.stopping) return Promise.reject(new Error('office host is already starting or stopping'));
    this.startPromise = this.startRuntime(input);
    return this.startPromise;
  }

  async startRuntime(input) {
    const profile = validateProfile(input);
    const scope = profile.scope ?? 'loopback';
    this.phase('checking');
    const manifest = JSON.parse(await readFile(join(this.root, 'manifest.json'), 'utf8'));
    if (manifest.protocol !== 1 || manifest.platform !== process.platform || manifest.arch !== process.arch) {
      throw new Error('office runtime does not match this computer');
    }
    await this.acquire(profile.dataDirectory);
    if (this.stopping) throw new Error('office host is stopping');
    const env = childEnvironment();
    const { generate } = createRequire(join(this.root, 'server', 'package.json'))('selfsigned');
    const identity = await hostIdentity(profile.dataDirectory, generate);
    const extension = process.platform === 'win32' ? '.exe' : '';
    const pgBin = join(this.root, 'postgres', 'native', 'bin');
    const cluster = join(profile.dataDirectory, 'postgres');
    const node = join(this.root, `node${extension}`);
    if (!await exists(join(cluster, 'PG_VERSION'))) {
      // Interrupted initialization is never mistaken for an empty new cluster.
      if (await exists(cluster)) throw new Error('office database initialization is incomplete');
      this.phase('initializing');
      const passwordFile = join(profile.dataDirectory, `init-${randomBytes(16).toString('hex')}`);
      await writeFile(passwordFile, profile.databasePassword, { mode: 0o600, flag: 'wx' });
      try {
        await this.launch(join(pgBin, `initdb${extension}`), [
          '-D', cluster, '-U', 'infinitebrain', '--encoding=UTF8', '--locale=C',
          '--auth=scram-sha-256', `--pwfile=${passwordFile}`,
        ], env).ended;
      } finally { await rm(passwordFile, { force: true }); }
    }
    const major = (await readFile(join(cluster, 'PG_VERSION'), 'utf8')).trim();
    if (major !== manifest.postgresMajor) throw new Error('office database requires a separate upgrade');
    // PostgreSQL owns crash recovery and postmaster.pid validation. Never unlink
    // its PID file or attach to an existing server from the supervisor.
    if (await livePostmaster(cluster)) {
      throw runtimeError('database-orphaned', 'office database is already running; attaching or reusing its PID is forbidden');
    }
    const pgPort = await freePort();
    this.databasePort = pgPort;
    this.phase('starting-database');
    this.database = this.launch(join(pgBin, `postgres${extension}`), [
      '-D', cluster, '-h', '127.0.0.1', '-p', String(pgPort),
      '-c', "unix_socket_directories=", '-c', 'fsync=on', '-c', 'synchronous_commit=on',
    ], env, { timeoutMs: 0 });
    const { Client } = createRequire(join(this.root, 'server', 'package.json'))('pg');
    await this.waitReady(async () => {
      const probe = new Client({
        host: '127.0.0.1', port: pgPort, user: 'infinitebrain', database: 'postgres',
        password: profile.databasePassword, connectionTimeoutMillis: 500, query_timeout: 500,
      });
      try { await probe.connect(); await probe.query('SELECT 1'); return true; }
      finally { await probe.end().catch(() => {}); }
    }, this.database, 'database');
    const httpPort = await freePort();
    const bindHost = scope === 'lan' ? '0.0.0.0' : '127.0.0.1';
    const advertisedHost = scope === 'lan' ? lanAddress() : '127.0.0.1';
    const endpoint = `${scope === 'lan' ? 'https' : 'http'}://${advertisedHost}:${httpPort}`;
    const serverEnv = {
      ...env, NODE_ENV: 'production', DATABASE_URL: `postgres://infinitebrain:${profile.databasePassword}@127.0.0.1:${pgPort}/postgres`,
      JWT_SECRET: profile.authSecret, BETTER_AUTH_URL: endpoint,
      OFFICE_SERVER_ID: identity.serverId, OFFICE_HOST_GENERATION: String(identity.generation),
      OFFICE_HUB_FINGERPRINT: identity.fingerprint,
      ...(scope === 'lan' ? { OFFICE_TLS_IDENTITY_FILE: identity.path } : {}),
      HOST: bindHost, HOCUSPOCUS_HOST: '127.0.0.1', PORT: String(httpPort), HOCUSPOCUS_PORT: '0',
      RELEASE_MANIFEST_URL: 'off', RELEASE_POLL_MINUTES: '0', BLOB_PROVIDER: 'postgres',
    };
    this.phase('migrating');
    await this.launch(node, ['dist/db/migrate.js'], serverEnv, { cwd: join(this.root, 'server') }).ended;
    this.phase('starting-server');
    this.server = this.launch(node, ['dist/index.js'], serverEnv, { cwd: join(this.root, 'server'), ipc: true, timeoutMs: 0 });
    await this.waitReady(async () => {
      if (scope === 'lan') return pinnedHealth(endpoint, identity.fingerprint);
      const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(500) });
      return response.ok && (await response.json()).ok === true;
    }, this.server, 'server');
    if (this.stopping) throw new Error('office host is stopping');
    this.emit({ protocol: 1, phase: 'ready', endpoint,
      scope, port: httpPort, lanExposed: scope === 'lan', certificateFingerprint: identity.fingerprint,
      serverId: identity.serverId, hostGeneration: String(identity.generation), certificateExpiresAt: identity.expiresAt });
    for (const running of [this.database, this.server]) {
      running.ended.then(() => this.failed(), () => this.failed()).catch(() => {});
    }
  }

  async waitReady(probe, running, name) {
    const until = Date.now() + this.readinessMs;
    while (!this.stopping && !exited(running.child)) {
      const remaining = until - Date.now();
      if (remaining <= 0) break;
      try {
        if (await deadline(probe(), remaining, 'readiness deadline expired')) return;
      } catch { /* retry within the single wall-clock readiness deadline */ }
      await sleep(Math.min(100, Math.max(0, until - Date.now())));
    }
    if (this.stopping) throw new Error('office host is stopping');
    throw new Error(`office ${name} did not become ready before its deadline`);
  }

  failed(code = 'child-exited') {
    if (this.stopping) return this.stopPromise;
    this.emit({ protocol: 1, phase: 'failed', code });
    return this.stop();
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    // Defer shutdown so reentrant emit/close handlers see the same promise.
    this.stopPromise = Promise.resolve().then(() => this.shutdown());
    return this.stopPromise;
  }

  async shutdown() {
    this.phase('stopping');
    // Interrupt existing startup children first, then wait for all in-flight
    // filesystem work before releasing the lock or reporting stopped.
    const remaining = [...this.children].filter((child) => child !== this.database?.child);
    for (const child of remaining) await this.endChild(child, 'SIGTERM');
    await this.startPromise?.catch(() => {});
    for (const child of [...this.children].filter((child) => child !== this.database?.child)) {
      await this.endChild(child, 'SIGTERM');
    }
    if (this.database) await this.endChild(this.database.child, 'SIGINT');
    if (this.lock) {
      await this.lock.close();
      await rm(this.lockPath, { force: true });
      this.lock = null;
    }
    this.phase('stopped');
  }

  async waitChild(child, ms) {
    const until = Date.now() + ms;
    while (!exited(child) && Date.now() < until) await sleep(Math.min(50, Math.max(1, until - Date.now())));
    return exited(child);
  }

  async endChild(child, signal) {
    if (exited(child)) return;
    let helperUnconfirmed = false;
    if (this.platform === 'win32' && child === this.database?.child) {
      // pg_ctl's own -t does not bound a hung helper; enforce our own deadline.
      const pgCtl = join(this.root, 'postgres', 'native', 'bin', 'pg_ctl.exe');
      const cluster = join(dirname(this.lockPath), 'postgres');
      const control = this.spawnProcess(pgCtl, ['stop', '-D', cluster, '-m', 'fast', '-w', '-t', '15'], {
        env: childEnvironment(), stdio: 'ignore', windowsHide: true,
      });
      const ended = new Promise((done) => { control.once('error', done); control.once('exit', done); });
      try { await deadline(ended, this.helperMs, 'pg_ctl shutdown deadline expired'); }
      catch {
        control.kill('SIGKILL');
        try { await deadline(ended, this.killMs, 'pg_ctl did not exit after termination'); }
        catch { helperUnconfirmed = true; control.unref?.(); }
      }
    } else if (child === this.server?.child && child.connected) {
      child.send({ type: 'office-host:stop' }, () => {});
    } else { child.kill(signal); }
    if (!await this.waitChild(child, this.shutdownMs)) {
      child.kill('SIGKILL');
      if (!await this.waitChild(child, this.killMs)) throw new Error('office child did not exit after termination');
    }
    if (helperUnconfirmed) throw new Error('pg_ctl termination could not be confirmed; explicit recovery is required');
  }
}

export async function runControlChannel({ input = process.stdin, output = process.stdout,
  runtime = new OfficeHostRuntime() } = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  let starting = null;
  let configured = false;
  let finishing = null;
  const finish = () => {
    if (finishing) return finishing;
    finishing = Promise.resolve().then(async () => {
      try { await runtime.stop(); await starting?.catch(() => {}); }
      catch { process.exitCode = 1; }
      finally {
        lines.close();
        // readline.close alone leaves a parent-owned pipe referenced and open.
        input.destroy();
        process.removeListener('SIGTERM', finish);
        process.removeListener('SIGINT', finish);
      }
    });
    return finishing;
  };
  runtime.emit = (event) => {
    output.write(`${JSON.stringify(event)}\n`);
    if (event.phase === 'failed') { process.exitCode = 1; void finish(); }
    if (event.phase === 'stopped') void finish();
  };
  lines.on('line', (line) => {
    if (line === 'stop') { void finish(); return; }
    if (configured || runtime.stopping || finishing) return;
    configured = true;
    starting = Promise.resolve().then(() => runtime.start(JSON.parse(line)));
    void starting.catch(async (error) => {
      // A deliberate stop during startup is successful cancellation.
      if (!runtime.stopping) {
        runtime.emit({ protocol: 1, phase: 'failed', code: [
          'database-orphaned', 'database-recovery-required', 'runtime-lock-recovery-required', 'already-running', 'tls-renewal-required',
        ].includes(error.code) ? error.code : 'startup-failed' });
      }
      await finish();
    });
  });
  lines.on('close', () => { void finish(); });
  process.once('SIGTERM', finish);
  process.once('SIGINT', finish);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runControlChannel();
}

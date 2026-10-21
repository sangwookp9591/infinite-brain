// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { randomBytes, X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, access, writeFile, mkdir, stat, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import selfsigned from 'selfsigned';
import WebSocket from 'ws';
import { childEnvironment, hostIdentity, pinnedHealth, OfficeHostRuntime, validateProfile } from './runtime.mjs';

const runtimeUrl = new URL('./runtime.mjs', import.meta.url).href;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

const credentials = () => ({ databasePassword: randomBytes(32).toString('base64url'), authSecret: randomBytes(32).toString('base64url') });

test('host children cannot inherit a development database, preload or remote credentials', () => {
  assert.deepEqual(childEnvironment({
    DATABASE_URL: 'never-use-this-db', JWT_SECRET: 'never-use-this-secret', NODE_OPTIONS: '--require=untrusted',
    DOTENV_CONFIG_PATH: '/private/.env', S3_SECRET_ACCESS_KEY: 'private', PGHOST: 'remote',
    DYLD_INSERT_LIBRARIES: 'untrusted', SystemRoot: 'C:\\Windows', LANG: 'ko_KR.UTF-8',
  }), { SystemRoot: 'C:\\Windows', LANG: 'ko_KR.UTF-8' });
});

test('invalid/relative profiles and credentials fail before any database starts', () => {
  const profile = { protocol: 1, dataDirectory: resolve(tmpdir(), 'office-test'), ...credentials() };
  assert.equal(validateProfile(profile), profile);
  assert.equal(validateProfile({ ...profile, scope: 'lan', tls: { certificateFingerprint: null } }).scope, 'lan');
  for (const value of [null, {}, { ...profile, protocol: 2 }, { ...profile, dataDirectory: '../existing-db' },
    { ...profile, databasePassword: 'x\npassword' }, { ...profile, authSecret: 'short' },
    { ...profile, scope: 'public' }, { ...profile, tls: { certificateFingerprint: 7 } }]) {
    assert.throws(() => validateProfile(value));
  }
});

test('migration entrypoint runs from a path with spaces, non-ASCII and a symlink', async () => {
  // Regression: `import.meta.url === file://${argv[1]}` never matched such a path, so an app
  // installed at "/Applications/Infinite Brain.app" silently applied no migrations.
  const server = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const base = await mkdtemp(join(tmpdir(), 'ib 마이그레이션 '));
  try {
    await mkdir(join(base, 'real dir', 'server'), { recursive: true });
    await cp(join(server, 'dist'), join(base, 'real dir', 'server', 'dist'), { recursive: true });
    await symlink(join(server, 'node_modules'), join(base, 'real dir', 'server', 'node_modules'));
    await symlink(join(base, 'real dir'), join(base, 'link'));
    for (const entry of [join(base, 'real dir'), join(base, 'link')]) {
      const result = await new Promise((done) => {
        const child = spawn(process.execPath, [join(entry, 'server', 'dist', 'db', 'migrate.js')], {
          env: { PATH: process.env.PATH, DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (d) => { output += d; });
        child.stderr.on('data', (d) => { output += d; });
        child.on('close', (code) => done({ code, output }));
      });
      // A skipped entrypoint exits 0 silently; a running one tries to connect and fails.
      assert.equal(result.code, 1, `migrate.js did not run from ${entry}: ${result.output}`);
      assert.match(result.output, /ECONNREFUSED/);
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('another host cannot take or remove a live runtime lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ib-office-lock-'));
  const first = new OfficeHostRuntime();
  const second = new OfficeHostRuntime();
  try {
    await first.acquire(directory);
    await assert.rejects(second.acquire(directory), /already running/);
    await second.stop();
    assert.equal(JSON.parse(await readFile(join(directory, 'runtime.lock'), 'utf8')).pid, process.pid);
  } finally {
    await first.stop();
    await second.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('TLS identity persists with mode 0600; an incorrect pin sends zero HTTP requests', { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ib-office-tls-'));
  let server;
  try {
    const first = await hostIdentity(directory, selfsigned.generate);
    const second = await hostIdentity(directory, () => { throw new Error('must reuse identity'); });
    assert.equal(first.serverId, second.serverId);
    assert.equal(first.fingerprint, second.fingerprint);
    assert.equal(second.generation, first.generation + 1);
    if (process.platform !== 'win32') assert.equal((await stat(first.path)).mode & 0o777, 0o600);
    assert.equal(first.fingerprint, new X509Certificate(first.certificate).fingerprint256.replaceAll(':', '').toLowerCase());
    let requests = 0;
    server = createHttpsServer({ cert: first.certificate, key: first.privateKey, minVersion: 'TLSv1.2' }, (_, response) => {
      requests++; response.end(JSON.stringify({ ok: true }));
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const endpoint = `https://127.0.0.1:${server.address().port}`;
    assert.equal(await pinnedHealth(endpoint, first.fingerprint), true);
    assert.equal(requests, 1);
    await assert.rejects(pinnedHealth(endpoint, '0'.repeat(64)), (error) => error.code === 'hub-pin-mismatch');
    assert.equal(requests, 1, 'TLS mismatch must close before sending the HTTP request');
    const expired = await selfsigned.generate(null, { notBeforeDate: new Date('2020-01-01'), notAfterDate: new Date('2020-01-02') });
    await writeFile(first.path, JSON.stringify({ serverId: first.serverId, generation: 1, certificate: expired.cert, privateKey: expired.private }), { mode: 0o600 });
    await assert.rejects(hostIdentity(directory, selfsigned.generate), (error) => error.code === 'tls-renewal-required');
  } finally {
    await new Promise((done) => server ? server.close(done) : done());
    await rm(directory, { recursive: true, force: true });
  }
});

function tlsJson(endpoint, certificate) {
  return new Promise((done, fail) => {
    const request = httpsRequest(endpoint, { ca: certificate, checkServerIdentity: () => undefined, timeout: 2000 }, (response) => {
      let body = ''; response.on('data', (bytes) => { body += bytes; });
      response.on('end', () => { try { done(JSON.parse(body)); } catch (error) { fail(error); } });
    });
    request.on('error', fail); request.on('timeout', () => request.destroy(new Error('timeout'))); request.end();
  });
}

const root = process.env.OFFICE_RUNTIME_ROOT;
test('bundled Postgres/server: migrations, durable restart, exclusivity and child-failure cleanup', {
  skip: !root, timeout: 120_000,
}, async () => {
  // A NEW temporary cluster only. Does not import server test helpers, load
  // .env, use DATABASE_URL or touch the developer's Postgres.
  const pg = await import('pg');
  const directory = await mkdtemp(join(tmpdir(), 'ib-office-smoke-'));
  const profile = { protocol: 1, dataDirectory: directory, ...credentials() };
  const events = [];
  const runtime = () => new OfficeHostRuntime({ root: resolve(root), emit: (event) => events.push(event) });
  const first = runtime();
  const second = runtime();
  const competitor = runtime();
  const lanEvents = [];
  const lanHost = new OfficeHostRuntime({ root: resolve(root), emit: (event) => lanEvents.push(event) });
  let db;
  const connect = (host) => new pg.default.Client({
    host: '127.0.0.1', port: host.databasePort, user: 'infinitebrain', database: 'postgres', password: profile.databasePassword,
  });
  try {
    await first.start(profile);
    const ready = events.findLast((event) => event.phase === 'ready');
    assert.equal(ready.scope, 'loopback');
    assert.match(ready.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await (await fetch(`${ready.endpoint}/health`)).json()).ok, true);
    const officeInfo = await (await fetch(`${ready.endpoint}/api/office`)).json();
    assert.equal(officeInfo.serverId, ready.serverId);
    assert.equal(officeInfo.fingerprint, ready.certificateFingerprint);
    assert.equal(officeInfo.audience, `${ready.endpoint}/api/office`);
    await assert.rejects(competitor.start(profile), /already running/);
    await competitor.stop();
    db = connect(first);
    await db.connect();
    const expectedMigrations = (await readdir(join(resolve(root), 'server/migrations'))).filter((name) => name.endsWith('.sql')).sort();
    assert.deepEqual((await db.query('SELECT name FROM _migrations ORDER BY name')).rows.map((row) => row.name), expectedMigrations);
    assert.equal((await db.query('SHOW listen_addresses')).rows[0].listen_addresses, '127.0.0.1');
    assert.equal((await db.query('SHOW fsync')).rows[0].fsync, 'on');
    await db.query('CREATE TABLE office_smoke (value text PRIMARY KEY)');
    await db.query('INSERT INTO office_smoke VALUES ($1)', ['survives-restart']);
    await db.end();
    db = null;
    if (process.env.OFFICE_HOST_SYNC_REGRESSIONS === '1') {
      const serverRoot = fileURLToPath(new URL('..', import.meta.url));
      const regression = spawn(process.execPath, [join(serverRoot, 'node_modules/vitest/vitest.mjs'),
        'run', 'tests/sync-http-upgrade.test.ts', 'tests/office-pairing.test.ts', 'tests/office-pairing-migration.test.ts', 'tests/office-pairing-negative.test.ts'], {
        cwd: serverRoot,
        env: { ...process.env,
          DATABASE_URL: `postgres://infinitebrain:${profile.databasePassword}@127.0.0.1:${first.databasePort}/postgres`,
          JWT_SECRET: profile.authSecret, BETTER_AUTH_URL: 'http://localhost:3010',
        }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      regression.stdout.on('data', (chunk) => { output += chunk; });
      regression.stderr.on('data', (chunk) => { output += chunk; });
      const code = await new Promise((done, fail) => { regression.once('exit', done); regression.once('error', fail); });
      assert.equal(code, 0, `single-port sync regressions on disposable bundled DB:\n${output}`);
    }
    await first.stop();
    assert.equal(first.server.child.exitCode, 0, 'server flushed and exited gracefully');
    assert.equal(first.database.child.exitCode, 0, 'database completed fast shutdown');
    await assert.rejects(access(join(directory, 'runtime.lock')));
    await second.start(profile);
    assert.equal(events.findLast((event) => event.phase === 'ready').serverId, ready.serverId);
    assert.equal(events.findLast((event) => event.phase === 'ready').certificateFingerprint, ready.certificateFingerprint);
    db = connect(second);
    await db.connect();
    assert.equal((await db.query('SELECT value FROM office_smoke')).rows[0].value, 'survives-restart');
    await db.end();
    db = null;
    second.server.child.kill('SIGKILL');
    for (let i = 0; i < 200 && !second.stopPromise; i++) await new Promise((done) => setTimeout(done, 50));
    await second.stop();
    assert.ok(events.some((event) => event.phase === 'failed' && event.code === 'child-exited'));
    await assert.rejects(access(join(directory, 'postgres/postmaster.pid')));
    assert.ok(!JSON.stringify(events).includes(profile.databasePassword));
    assert.ok(!JSON.stringify(events).includes(profile.authSecret));
    await lanHost.start({ ...profile, scope: 'lan', tls: { certificateFingerprint: null } });
    const lanReady = lanEvents.findLast((event) => event.phase === 'ready');
    assert.equal(lanReady.scope, 'lan');
    assert.equal(lanReady.lanExposed, true);
    assert.equal(Number(new URL(lanReady.endpoint).port), lanReady.port);
    assert.match(lanReady.endpoint, /^https:\/\//);
    assert.equal(await pinnedHealth(lanReady.endpoint, lanReady.certificateFingerprint), true);
    await assert.rejects(pinnedHealth(lanReady.endpoint, '0'.repeat(64)), (error) => error.code === 'hub-pin-mismatch');
    await assert.rejects(fetch(`${lanReady.endpoint.replace('https:', 'http:')}/health`), /fetch failed/);
    const identity = JSON.parse(await readFile(join(directory, 'tls-identity.json'), 'utf8'));
    const lanOffice = await tlsJson(`${lanReady.endpoint}/api/office`, identity.certificate);
    assert.equal(lanOffice.serverId, ready.serverId);
    assert.equal(lanOffice.fingerprint, lanReady.certificateFingerprint);
    assert.equal(lanOffice.audience, `${lanReady.endpoint}/api/office`);
    await new Promise((done, fail) => {
      const socket = new WebSocket(`${lanReady.endpoint.replace('https:', 'wss:')}/sync`, { ca: identity.certificate, checkServerIdentity: () => undefined });
      socket.once('open', () => { socket.close(); done(); }); socket.once('error', fail);
    });
    db = connect(lanHost);
    await db.connect();
    assert.equal((await db.query('SHOW listen_addresses')).rows[0].listen_addresses, '127.0.0.1');
    await db.end();
    db = null;
    assert.ok(!JSON.stringify(lanEvents).includes(profile.databasePassword));
    assert.ok(!JSON.stringify(lanEvents).includes(profile.authSecret));
  } finally {
    await db?.end();
    await first.stop(); await second.stop(); await competitor.stop(); await lanHost.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('closing the parent control pipe stops the supervisor and its owned processes', {
  skip: !root, timeout: 90_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ib-office-pipe-'));
  const extension = process.platform === 'win32' ? '.exe' : '';
  const child = spawn(join(resolve(root), `node${extension}`), ['--input-type=module', '-e', `import { runControlChannel, OfficeHostRuntime } from ${JSON.stringify(runtimeUrl)}; runControlChannel({runtime:new OfficeHostRuntime({root:${JSON.stringify(resolve(root))}})});`], {
    env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (bytes) => { output += bytes; });
  child.stderr.resume();
  const ended = new Promise((done, fail) => { child.once('exit', done); child.once('error', fail); });
  child.stdin.write(`${JSON.stringify({ protocol: 1, dataDirectory: directory, ...credentials() })}\n`);
  try {
    for (let i = 0; !output.includes('"phase":"ready"') && i < 600; i++) {
      if (child.exitCode !== null) throw new Error('supervisor exited before ready');
      await new Promise((done) => setTimeout(done, 50));
    }
    assert.ok(output.includes('"phase":"ready"'), 'supervisor became ready');
    child.stdin.end();
    assert.equal(await ended, 0);
    assert.ok(output.includes('"phase":"stopped"'));
    await assert.rejects(access(join(directory, 'postgres/postmaster.pid')));
  } finally {
    if (child.exitCode === null) { child.stdin.end(); await ended; }
    await rm(directory, { recursive: true, force: true });
  }
});

function supervised(code) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  child.stdout.on('data', (bytes) => { output += bytes; });
  child.stderr.on('data', (bytes) => { errors += bytes; });
  const ended = new Promise((done, fail) => {
    child.once('error', fail);
    child.once('close', (code) => done(code));
  });
  return {
    child, ended, output: () => output,
    async until(text, timeoutMs = 3_000) {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until && !output.includes(text)) {
        if (child.exitCode !== null) break;
        await pause(10);
      }
      assert.ok(output.includes(text), `expected ${text}: ${output} ${errors}`);
    },
  };
}

const fakeSupervisor = `
  import { OfficeHostRuntime, runControlChannel } from ${JSON.stringify(runtimeUrl)};
  class Runtime extends OfficeHostRuntime {
    async startRuntime(profile) {
      await this.acquire(profile.dataDirectory);
      this.server = this.launch(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {}, {timeoutMs:0});
      this.phase('starting-server');
      await this.waitReady(async () => profile.mode === 'crash', this.server, 'server');
      this.phase('ready');
      this.server.ended.then(() => this.failed(), () => this.failed()).catch(() => {});
      setTimeout(() => this.server.child.kill('SIGKILL'), 25);
    }
  }
  runControlChannel({runtime:new Runtime({readinessMs:150, shutdownMs:100, killMs:500})});
`;

for (const mode of ['stop', 'eof', 'deadline', 'crash']) {
  test(`control lifecycle: ${mode} cleans children and closes supervisor`, { timeout: 10_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ib-office-control-'));
    const run = supervised(fakeSupervisor);
    try {
      run.child.stdin.write(`${JSON.stringify({ dataDirectory: directory, mode })}\n`);
      await run.until('"phase":"starting-server"');
      if (mode === 'stop') run.child.stdin.write('stop\nstop\n');
      if (mode === 'eof') run.child.stdin.end();
      // Keep stdin open for deadline/crash: failure must close it itself.
      assert.equal(await run.ended, ['deadline', 'crash'].includes(mode) ? 1 : 0);
      const phases = run.output().trim().split('\n').map((line) => JSON.parse(line).phase);
      assert.equal(phases.filter((phase) => phase === 'stopping').length, 1);
      assert.equal(phases.filter((phase) => phase === 'stopped').length, 1);
      assert.equal(phases.at(-1), 'stopped');
      if (mode === 'crash') assert.deepEqual(phases.slice(-4), ['ready', 'failed', 'stopping', 'stopped']);
      if (['stop', 'eof'].includes(mode)) assert.ok(!phases.includes('failed'));
      await assert.rejects(access(join(directory, 'runtime.lock')));
    } finally {
      if (run.child.exitCode === null) { run.child.kill('SIGKILL'); await run.ended; }
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const input of ['{malformed\n', null, 'stop\n']) {
  test(`control before configuration: ${JSON.stringify(input)}`, { timeout: 5_000 }, async () => {
    const run = supervised(`import { runControlChannel } from ${JSON.stringify(runtimeUrl)}; runControlChannel();`);
    try {
      if (input === null) run.child.stdin.end();
      else run.child.stdin.write(input);
      assert.equal(await run.ended, input?.startsWith('{') ? 1 : 0);
      assert.equal((run.output().match(/"phase":"stopped"/g) || []).length, 1);
    } finally {
      if (run.child.exitCode === null) { run.child.kill('SIGKILL'); await run.ended; }
    }
  });
}

test('a hanging readiness probe is bounded by a wall-clock deadline', async () => {
  const runtime = new OfficeHostRuntime({ readinessMs: 30 });
  const before = Date.now();
  await assert.rejects(runtime.waitReady(() => new Promise(() => {}), {
    child: { exitCode: null, signalCode: null },
  }, 'server'), /deadline/);
  assert.ok(Date.now() - before < 1_000);
});

test('Windows pg_ctl helper hang is terminated before bounded database cleanup', async () => {
  const calls = [];
  const helper = Object.assign(new EventEmitter(), {
    exitCode: null, signalCode: null,
    kill(signal) { calls.push(`helper:${signal}`); this.signalCode = signal; this.emit('exit', null, signal); },
  });
  const database = {
    exitCode: null, signalCode: null,
    kill(signal) { calls.push(`database:${signal}`); this.signalCode = signal; },
  };
  const runtime = new OfficeHostRuntime({ platform: 'win32', helperMs: 20, shutdownMs: 20, killMs: 50,
    spawnProcess(executable, args) {
      assert.ok(executable.endsWith('pg_ctl.exe'));
      assert.deepEqual(args.slice(0, 2), ['stop', '-D']);
      return helper;
    },
  });
  runtime.lockPath = join(tmpdir(), 'unused-office-test', 'runtime.lock');
  runtime.database = { child: database };
  const before = Date.now();
  await runtime.endChild(database, 'SIGINT');
  assert.deepEqual(calls, ['helper:SIGKILL', 'database:SIGKILL']);
  assert.ok(Date.now() - before < 1_000);
});

test('two separate processes cannot replace a live lock or take over a stale lock', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ib-office-race-'));
  const locker = `
    import {OfficeHostRuntime} from ${JSON.stringify(runtimeUrl)};
    const runtime = new OfficeHostRuntime();
    try {
      await runtime.acquire(${JSON.stringify(directory)});
      console.log('acquired');
      process.stdin.resume();
      process.stdin.once('end', async () => { await runtime.stop(); });
    } catch (error) { console.log(error.code); process.exitCode = 1; }
  `;
  const first = supervised(locker);
  const second = supervised(locker);
  try {
    for (let i = 0; i < 300 && ![first, second].some((run) => run.output().includes('acquired')); i++) await pause(10);
    const winner = first.output().includes('acquired') ? first : second;
    const loser = winner === first ? second : first;
    assert.equal(await loser.ended, 1);
    assert.match(loser.output(), /already-running|runtime-lock-recovery-required/);
    assert.equal(JSON.parse(await readFile(join(directory, 'runtime.lock'), 'utf8')).pid, winner.child.pid);
    winner.child.kill('SIGKILL');
    await winner.ended;
    const stale = await readFile(join(directory, 'runtime.lock'), 'utf8');
    const contenders = [supervised(locker), supervised(locker)];
    for (const contender of contenders) {
      assert.equal(await contender.ended, 1);
      assert.match(contender.output(), /runtime-lock-recovery-required/);
    }
    assert.equal(await readFile(join(directory, 'runtime.lock'), 'utf8'), stale);
    await mkdir(join(directory, 'postgres'));
    await writeFile(join(directory, 'postgres/postmaster.pid'), `${process.pid}\n`);
    const orphan = supervised(locker);
    assert.equal(await orphan.ended, 1);
    assert.match(orphan.output(), /database-orphaned/);
    assert.equal(await readFile(join(directory, 'postgres/postmaster.pid'), 'utf8'), `${process.pid}\n`);
  } finally {
    for (const run of [first, second]) {
      if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL');
      await run.ended;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('real supervisor failure exits 1; SIGKILL leaves an explicitly rejected PG orphan', {
  skip: !root, timeout: 90_000,
}, async () => {
  const runtimeRoot = resolve(root);
  const code = `
    import {OfficeHostRuntime,runControlChannel} from ${JSON.stringify(runtimeUrl)};
    class Runtime extends OfficeHostRuntime {
      async startRuntime(profile) {
        await super.startRuntime(profile);
        this.emit({protocol:1,phase:'owned',databasePid:this.database.child.pid,serverPid:this.server.child.pid});
        if (profile.crash) setTimeout(() => this.server.child.kill('SIGKILL'), 25);
      }
    }
    runControlChannel({runtime:new Runtime({root:${JSON.stringify(runtimeRoot)}})});
  `;
  for (const crash of [true, false]) {
    const directory = await mkdtemp(join(tmpdir(), 'ib-office-supervisor-'));
    const profile = { protocol: 1, dataDirectory: directory, crash, ...credentials() };
    const run = supervised(code);
    let owned;
    let replacement;
    try {
      run.child.stdin.write(`${JSON.stringify(profile)}\n`);
      await run.until('"phase":"owned"', 30_000);
      owned = run.output().trim().split('\n').map((line) => JSON.parse(line)).find((event) => event.phase === 'owned');
      if (crash) {
        assert.equal(await run.ended, 1);
        const phases = run.output().trim().split('\n').map((line) => JSON.parse(line).phase);
        assert.deepEqual(phases.slice(-3), ['failed', 'stopping', 'stopped']);
        assert.equal(phases.filter((phase) => phase === 'stopped').length, 1);
        await assert.rejects(access(join(directory, 'runtime.lock')));
        await assert.rejects(access(join(directory, 'postgres/postmaster.pid')));
      } else {
        run.child.kill('SIGKILL');
        await run.ended;
        process.kill(owned.databasePid, 0);
        const pidFile = await readFile(join(directory, 'postgres/postmaster.pid'), 'utf8');
        replacement = supervised(code);
        replacement.child.stdin.write(`${JSON.stringify(profile)}\n`);
        assert.equal(await replacement.ended, 1);
        assert.match(replacement.output(), /"code":"database-orphaned"/);
        assert.ok(!replacement.output().includes('"phase":"starting-database"'));
        assert.equal(await readFile(join(directory, 'postgres/postmaster.pid'), 'utf8'), pidFile);
      }
    } finally {
      for (const current of [run, replacement].filter(Boolean)) {
        if (current.child.exitCode === null && current.child.signalCode === null) current.child.stdin.end();
        await current.ended;
      }
      if (!crash && owned) {
        // Only these owned disposable fixture processes, never a development DB.
        try { process.kill(owned.serverPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        const extension = process.platform === 'win32' ? '.exe' : '';
        const cleanup = new OfficeHostRuntime({ root: runtimeRoot });
        await cleanup.launch(join(runtimeRoot, 'postgres/native/bin', `pg_ctl${extension}`), [
          'stop', '-D', join(directory, 'postgres'), '-m', 'fast', '-w', '-t', '5',
        ], childEnvironment(), { timeoutMs: 10_000 }).ended;
      }
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('an unconfirmed helper termination still bounds and cleans the database child', async () => {
  const calls = [];
  const helper = Object.assign(new EventEmitter(), {
    kill() { calls.push('helper-kill'); },
    unref() { calls.push('helper-unref'); },
  });
  const database = { exitCode: null, signalCode: null,
    kill(signal) { this.signalCode = signal; calls.push('database-kill'); },
  };
  const runtime = new OfficeHostRuntime({ platform: 'win32', helperMs: 10, shutdownMs: 10, killMs: 10,
    spawnProcess: () => helper,
  });
  runtime.database = { child: database };
  runtime.lockPath = join(tmpdir(), 'unused-office-test', 'runtime.lock');
  await assert.rejects(runtime.endChild(database, 'SIGINT'), /termination could not be confirmed/);
  assert.deepEqual(calls, ['helper-kill', 'helper-unref', 'database-kill']);
});

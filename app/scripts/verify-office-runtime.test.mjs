// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { lockedServerVersions, verifyRoot as verifyRuntimeRoot } from './verify-office-runtime.mjs';

const fixtureLockfile = `lockfileVersion: '9.0'
importers:
  apps/server:
    dependencies:
      better-auth:
        specifier: ^1.6.23
        version: 1.6.23(pg@8.22.0)
    devDependencies:
      vitest:
        specifier: ^4.1.11
        version: 4.1.11
packages:
  ignored: {}
`;
const verifyRoot = (root) => verifyRuntimeRoot(root, { lockfilePath: join(root, '../pnpm-lock.yaml') });

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'office-runtime-verify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'runtime');
  await mkdir(join(root, 'postgres/native/bin'), { recursive: true });
  await writeFile(join(directory, 'pnpm-lock.yaml'), fixtureLockfile);
  await mkdir(join(root, 'server/node_modules/better-auth'), { recursive: true });
  await writeFile(join(root, 'server/node_modules/better-auth/package.json'), JSON.stringify({ version: '1.6.23' }));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ platform: 'darwin', arch: 'arm64' }));
  await writeFile(join(root, 'node'), 'node fixture');
  await writeFile(join(root, 'postgres/native/bin/postgres'), 'postgres fixture');
  return root;
}

test('accepts a prepared runtime and reports stable file hashes without modifying it', async (t) => {
  const root = await fixture(t);
  const before = await readFile(join(root, 'node'));
  const result = await verifyRoot(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.files.length, 4);
  assert.deepEqual(result.dependencies, [{ name: 'better-auth', expected: '1.6.23', actual: '1.6.23' }]);
  assert.match(result.files.find((file) => file.path === 'node').sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await readFile(join(root, 'node')), before);
});

test('rejects missing required runtime files', async (t) => {
  const root = await fixture(t);
  await rm(join(root, 'node'));
  const result = await verifyRoot(root);
  assert.ok(result.errors.some((error) => error.includes('Missing required executable: node')));
});

test('rejects deployed tests, environment files, and development credentials', async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, 'server/tests'), { recursive: true });
  await writeFile(join(root, 'server/tests/auth.test.js'), 'test');
  await writeFile(join(root, 'server/.env'), 'DATABASE_URL=postgres://dev:secret@localhost/db');
  await writeFile(join(root, 'server/dev-credentials.json'), '{}');
  const result = await verifyRoot(root);
  assert.ok(result.errors.some((error) => error.includes('Forbidden path: server/tests/auth.test.js')));
  assert.ok(result.errors.some((error) => error.includes('Forbidden path: server/.env')));
  assert.ok(result.errors.some((error) => error.includes('Forbidden path: server/dev-credentials.json')));
});

test('reports an absent root as a validation failure', async () => {
  const result = await verifyRoot(join(tmpdir(), `missing-office-runtime-${Date.now()}`));
  assert.equal(result.files.length, 0);
  assert.equal(result.errors.length, 1);
});

test('rejects file, directory, and dangling symbolic links without following them', async (t) => {
  const root = await fixture(t);
  await symlink('node', join(root, 'node-alias'));
  await symlink('postgres', join(root, 'postgres-alias'), 'dir');
  await symlink('missing', join(root, 'dangling-alias'));
  // A directory alias back to the root must fail without recursing forever.
  await symlink('.', join(root, 'cycle-alias'), 'dir');
  const result = await verifyRoot(root);
  assert.deepEqual(result.errors, [
    'Symbolic link is not allowed: cycle-alias',
    'Symbolic link is not allowed: dangling-alias',
    'Symbolic link is not allowed: node-alias',
    'Symbolic link is not allowed: postgres-alias',
  ]);
  assert.equal(result.files.filter((file) => file.type === 'symlink').length, 4);
});

test('reads scoped/catalog production versions with peer suffixes and excludes development dependencies', () => {
  const lockfile = fixtureLockfile.replace('      better-auth:', "      '@hocuspocus/server':").replace('specifier: ^1.6.23', "specifier: 'catalog:'");
  assert.deepEqual([...lockedServerVersions(lockfile)], [['@hocuspocus/server', '1.6.23']]);
  assert.throws(() => lockedServerVersions('lockfileVersion: 8.0'), /Expected pnpm lockfile v9/);
  assert.throws(() => lockedServerVersions("lockfileVersion: '9.0'"), /Missing server production dependencies/);
  assert.throws(() => lockedServerVersions(fixtureLockfile.replace('        version: 1.6.23(pg@8.22.0)', '')), /Incomplete server production dependencies/);
});

test('rejects missing and drifted production dependency versions', async (t) => {
  const root = await fixture(t);
  const packagePath = join(root, 'server/node_modules/better-auth/package.json');
  await writeFile(packagePath, JSON.stringify({ version: '1.7.12' }));
  assert.deepEqual((await verifyRoot(root)).errors, ['Dependency version mismatch: better-auth: expected 1.6.23, found 1.7.12']);
  await rm(packagePath);
  assert.deepEqual((await verifyRoot(root)).errors, ['Dependency version mismatch: better-auth: expected 1.6.23, found missing']);
});

test('fails closed when the workspace lockfile cannot be read', async (t) => {
  const root = await fixture(t);
  await rm(join(root, '../pnpm-lock.yaml'));
  assert.match((await verifyRoot(root)).errors[0], /Cannot verify locked server dependencies/);
});

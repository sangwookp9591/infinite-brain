// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inventoryFor, lockedPackageVersions, lockedServerVersions, verifyRoot as verifyRuntimeRoot } from './verify-office-runtime.mjs';

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
  better-auth@1.6.23: {}
`;
const verifyRoot = (root, options = {}) => verifyRuntimeRoot(root, { lockfilePath: join(root, '../pnpm-lock.yaml'), ...options });

function macho(arch = 'arm64') {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
  bytes.writeUInt32LE(arch === 'arm64' ? 0 : 3, 8);
  bytes.writeUInt32LE(2, 12);
  return bytes;
}

async function seal(root, arch = 'arm64') {
  const result = await verifyRoot(root, { checkInventory: false });
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ platform: 'darwin', arch, manifestVersion: 2, inventory: inventoryFor(result.files) }));
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'office-runtime-verify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'runtime');
  await mkdir(join(root, 'postgres/native/bin'), { recursive: true });
  await writeFile(join(directory, 'pnpm-lock.yaml'), fixtureLockfile);
  await mkdir(join(root, 'server/node_modules/better-auth'), { recursive: true });
  await writeFile(join(root, 'server/node_modules/better-auth/package.json'), JSON.stringify({ name: 'better-auth', version: '1.6.23' }));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ platform: 'darwin', arch: 'arm64' }));
  await writeFile(join(root, 'node'), macho());
  await writeFile(join(root, 'postgres/native/bin/postgres'), macho());
  await seal(root);
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
  assert.deepEqual(result.errors.filter((error) => error.startsWith('Symbolic')), [
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
  await writeFile(packagePath, JSON.stringify({ name: 'better-auth', version: '1.7.12' }));
  assert.ok((await verifyRoot(root)).errors.includes('Dependency version mismatch: better-auth: expected 1.6.23, found 1.7.12'));
  await rm(packagePath);
  assert.ok((await verifyRoot(root)).errors.includes('Dependency version mismatch: better-auth: expected 1.6.23, found missing'));
});

test('fails closed when the workspace lockfile cannot be read', async (t) => {
  const root = await fixture(t);
  await rm(join(root, '../pnpm-lock.yaml'));
  assert.match((await verifyRoot(root)).errors[0], /Cannot verify locked server dependencies/);
});


test('x64 static verification accepts x86_64 and explicitly reports no execution', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'node'), macho('x64'));
  await writeFile(join(root, 'postgres/native/bin/postgres'), macho('x64'));
  await seal(root, 'x64');
  const result = await verifyRoot(root);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.binaries.map(({ architectures }) => architectures), [['x86_64'], ['x86_64']]);
  if (process.arch !== 'x64' || process.platform !== 'darwin') assert.equal(result.execution, 'not executed (cross-target)');
});

test('x64 static verification rejects arm64 even in a non-executable, extensionless file', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'node'), macho('x64'));
  await writeFile(join(root, 'postgres/native/bin/postgres'), macho('x64'));
  await writeFile(join(root, 'hidden-native'), macho('arm64'));
  await seal(root, 'x64');
  assert.ok((await verifyRoot(root)).errors.some((error) => error.includes('Mach-O architecture mismatch: hidden-native')));
});

test('static verification refuses a native extension that is not Mach-O', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'wrong.node'), Buffer.from('7f454c46', 'hex'));
  assert.ok((await verifyRoot(root)).errors.includes('Expected Mach-O binary: wrong.node'));
});

test('manifest inventory detects modified, removed and added files', async (t) => {
  const root = await fixture(t);
  const packagePath = join(root, 'server/node_modules/better-auth/package.json');
  await writeFile(packagePath, JSON.stringify({ name: 'better-auth', version: '1.6.23', extra: true }));
  assert.ok((await verifyRoot(root)).errors.includes('Manifest inventory hash mismatch'));
  await seal(root);
  await rm(packagePath);
  assert.ok((await verifyRoot(root)).errors.includes('Manifest inventory hash mismatch'));
  await seal(root);
  await writeFile(join(root, 'added.txt'), 'extra');
  assert.ok((await verifyRoot(root)).errors.includes('Manifest inventory hash mismatch'));
});

test('versioned manifest cannot omit its inventory', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ platform: 'darwin', arch: 'arm64', manifestVersion: 2 }));
  assert.ok((await verifyRoot(root)).errors.includes('Manifest inventory hash mismatch'));
});

test('checks transitive native optional dependency versions against package lock entries', async (t) => {
  const root = await fixture(t);
  const lockPath = join(root, '../pnpm-lock.yaml');
  await writeFile(lockPath, fixtureLockfile + "  '@node-rs/argon2-darwin-arm64@2.0.2':\n    optional: true\n");
  const directory = join(root, 'server/node_modules/@node-rs/argon2-darwin-arm64');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'package.json');
  await writeFile(path, JSON.stringify({ name: '@node-rs/argon2-darwin-arm64', version: '2.0.2' }));
  await seal(root);
  assert.deepEqual((await verifyRoot(root)).errors, []);
  await writeFile(path, JSON.stringify({ name: '@node-rs/argon2-darwin-arm64', version: '2.0.3' }));
  assert.ok((await verifyRoot(root)).errors.some((error) => error.includes('Package is not locked:')));
  assert.ok(lockedPackageVersions(await readFile(lockPath, 'utf8')).has('@node-rs/argon2-darwin-arm64@2.0.2'));
});


test('x64 static verification refuses a universal file containing an arm64 slice', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'node'), macho('x64'));
  await writeFile(join(root, 'postgres/native/bin/postgres'), macho('x64'));
  const fat = Buffer.alloc(112);
  fat.writeUInt32BE(0xcafebabe, 0);
  fat.writeUInt32BE(2, 4);
  for (const [index, arch] of ['x64', 'arm64'].entries()) {
    const record = 8 + index * 20;
    fat.writeUInt32BE(arch === 'x64' ? 0x01000007 : 0x0100000c, record);
    fat.writeUInt32BE(arch === 'x64' ? 3 : 0, record + 4);
    fat.writeUInt32BE(48 + index * 32, record + 8);
    fat.writeUInt32BE(32, record + 12);
    macho(arch).copy(fat, 48 + index * 32);
  }
  await writeFile(join(root, 'universal.node'), fat);
  await seal(root, 'x64');
  assert.ok((await verifyRoot(root)).errors.some((error) => error.includes('Mach-O architecture mismatch: universal.node')));
});

test('refuses a missing native optional variant even when the manifest is resealed', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'server/node_modules/better-auth/package.json'), JSON.stringify({
    name: 'better-auth', version: '1.6.23', optionalDependencies: { '@example/native-darwin-arm64': '1.0.0' },
  }));
  await seal(root);
  assert.ok((await verifyRoot(root)).errors.includes('Missing target optional dependency: better-auth: @example/native-darwin-arm64'));
});


test('rejects unsupported manifest targets instead of skipping native architecture checks', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...manifest, platform: 'unknown' }));
  assert.ok((await verifyRoot(root)).errors.includes('Unsupported manifest platform/architecture'));
});

// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyRoot } from './verify-office-runtime.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'office-runtime-verify-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'postgres/native/bin'), { recursive: true });
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
  assert.equal(result.files.length, 3);
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

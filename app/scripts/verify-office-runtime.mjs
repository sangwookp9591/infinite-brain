// SPDX-License-Identifier: Apache-2.0
// Read-only validation for a prepared, platform-specific office runtime.
import { createHash } from 'node:crypto';
import { lstat, readlink, readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(fileURLToPath(new URL('../apps/desktop/src-tauri/office-runtime/', import.meta.url)), process.argv[2] ?? `${process.platform}-${process.arch}`);

const bannedPathPatterns = [
  /(^|\/)\.env(?:\.|$)/i,
  /^server\/tests?\/.+\.(?:test|spec)\.[^/]+$/i,
  /^server\/(?!node_modules\/)(?:[^/]*?(?:dev[-_])?(?:credential|secret)[^/]*|[^/]*\.(?:pem|key))$/i,
  /(^|\/)id_(?:rsa|ed25519)(?:\.pub)?$/i,
];

function isBannedPath(path) {
  return bannedPathPatterns.some((pattern) => pattern.test(path));
}

async function walk(root, current = root, entries = []) {
  for (const name of (await readdir(current)).sort()) {
    const absolute = join(current, name);
    const path = relative(root, absolute).split(sep).join('/');
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      entries.push({ path, absolute, type: 'symlink' });
    } else if (stat.isDirectory()) {
      entries.push({ path, absolute, type: 'directory' });
      await walk(root, absolute, entries);
    } else if (stat.isFile()) {
      entries.push({ path, absolute, type: 'file' });
    } else {
      entries.push({ path, absolute, type: 'other' });
    }
  }
  return entries;
}

export async function verifyRoot(rootPath) {
  const root = resolve(rootPath);
  const errors = [];
  let entries;
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory()) throw new Error('runtime root is not a directory');
    entries = await walk(root);
  } catch (error) {
    return { root, errors: [`Cannot read runtime root: ${error.message}`], files: [], directories: 0 };
  }

  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const required of ['manifest.json']) {
    if (byPath.get(required)?.type !== 'file') errors.push(`Missing required file: ${required}`);
  }

  const manifest = byPath.get('manifest.json');
  let platform;
  if (manifest?.type === 'file') {
    try { platform = JSON.parse(await readFile(manifest.absolute, 'utf8')).platform; }
    catch { errors.push('Invalid manifest.json'); }
  }
  const windows = platform === 'win32';
  const nodePath = windows ? 'node.exe' : 'node';
  const postgresPath = windows ? 'postgres/native/bin/postgres.exe' : 'postgres/native/bin/postgres';
  for (const required of [nodePath, postgresPath]) {
    if (byPath.get(required)?.type !== 'file') errors.push(`Missing required executable: ${required}`);
  }

  const files = [];
  for (const entry of entries) {
    if (isBannedPath(entry.path)) errors.push(`Forbidden path: ${entry.path}`);
    if (entry.type === 'file') {
      const bytes = await readFile(entry.absolute);
      files.push({ path: entry.path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    } else if (entry.type === 'symlink') {
      const target = await readlink(entry.absolute);
      files.push({ path: entry.path, size: Buffer.byteLength(target), sha256: createHash('sha256').update(target).digest('hex'), type: 'symlink' });
    } else if (entry.type === 'other') {
      errors.push(`Unexpected filesystem entry: ${entry.path}`);
    }
  }
  return { root, errors, files, directories: entries.filter((entry) => entry.type === 'directory').length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyRoot(defaultRoot);
  console.log(`Office runtime root: ${result.root}`);
  const inventory = createHash('sha256').update(result.files.map(({ path, sha256 }) => `${path}\0${sha256}\n`).join('')).digest('hex');
  console.log(`Summary: ${result.files.length} files/symlinks, ${result.directories} directories; inventory sha256 ${inventory}`);
  for (const path of ['manifest.json', process.platform === 'win32' ? 'node.exe' : 'node', process.platform === 'win32' ? 'postgres/native/bin/postgres.exe' : 'postgres/native/bin/postgres']) {
    const file = result.files.find((entry) => entry.path === path);
    if (file) console.log(`${file.sha256}  ${file.size}  ${file.path}`);
  }
  for (const error of result.errors) console.error(`ERROR: ${error}`);
  if (result.errors.length) process.exitCode = 1;
  else console.log('Office runtime verification passed.');
}

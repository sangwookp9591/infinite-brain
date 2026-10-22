// SPDX-License-Identifier: Apache-2.0
// Read-only validation for a prepared, platform-specific office runtime.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { lstat, readlink, readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(fileURLToPath(new URL('../apps/desktop/src-tauri/office-runtime/', import.meta.url)), process.argv[2] ?? process.env.OFFICE_RUNTIME_TARGET ?? `${process.platform}-${process.arch}`);
const defaultLockfile = fileURLToPath(new URL('../pnpm-lock.yaml', import.meta.url));
const supportedTargets = new Set(Object.keys(JSON.parse(await readFile(new URL('./office-runtime-sources.json', import.meta.url), 'utf8')).targets));

// Read only pnpm v9's server production importer, without loading dependencies
// from the runtime being verified. Peer suffixes identify snapshots, not versions.
export function lockedServerVersions(lockfile) {
  if (!/^lockfileVersion: ['"]?9\.0['"]?\s*$/m.test(lockfile)) throw new Error('Expected pnpm lockfile v9');
  const server = lockfile.match(/^  apps\/server:\r?\n([\s\S]*?)(?=^  \S|^\S|(?![\s\S]))/m)?.[1];
  const dependencies = server?.match(/^    dependencies:\r?\n([\s\S]*?)(?=^    \S|(?![\s\S]))/m)?.[1];
  if (!dependencies) throw new Error('Missing server production dependencies in lockfile');
  const versions = new Map();
  let name;
  for (const line of dependencies.split(/\r?\n/)) {
    const key = line.match(/^      (?:'([^']+)'|"([^"]+)"|([^\s:]+)):\s*$/);
    if (key) {
      if (name) throw new Error(`Missing locked version: ${name}`);
      name = key[1] ?? key[2] ?? key[3];
    }
    const value = line.match(/^        version: ['"]?([^'"\s]+)['"]?\s*$/);
    if (value && name) {
      const version = value[1].split('(')[0];
      if (!/^[\w@/-]+$/.test(name) || name.split('/').includes('..') || !/^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(version)) {
        throw new Error(`Unsupported locked dependency: ${name}`);
      }
      versions.set(name, version);
      name = undefined;
    }
  }
  if (name || !versions.size) throw new Error('Incomplete server production dependencies in lockfile');
  return versions;
}

// Includes transitive native optional packages, not just the server importer.
export function lockedPackageVersions(lockfile) {
  const packages = lockfile.match(/^packages:\r?\n([\s\S]*?)(?=^snapshots:|(?![\s\S]))/m)?.[1] ?? '';
  const versions = new Set();
  for (const line of packages.split(/\r?\n/)) {
    const match = line.match(/^  ['"]?((?:@[^/]+\/)?[^@\s]+@\d+\.\d+\.\d+[^:'"\s]*)['"]?:(?:\s*\{\})?$/);
    if (match) versions.add(match[1]);
  }
  return versions;
}

export function isMachO(bytes) {
  return bytes.length >= 4 && new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe',
    'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']).has(bytes.subarray(0, 4).toString('hex'));
}

export async function machOArchitectures(path) {
  // Inspect only: neither tool loads or executes the target binary.
  if (process.platform === 'darwin') {
    const { stdout } = await promisify(execFile)('lipo', ['-archs', path]);
    return stdout.trim().split(/\s+/).sort();
  }
  const { stdout } = await promisify(execFile)('file', ['-b', path]);
  if (!stdout.includes('Mach-O')) throw new Error('file did not identify Mach-O');
  return [...new Set(stdout.match(/\b(?:x86_64|arm64|i386|ppc64|ppc)\b/g) ?? [])].sort();
}

export function inventoryFor(files) {
  return files.filter(({ path, type }) => path !== 'manifest.json' && type !== 'symlink')
    .map(({ path, size, sha256 }) => ({ path, size, sha256 }));
}

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
      entries.push({ path, absolute, type: 'file', executable: (stat.mode & 0o111) !== 0 });
    } else {
      entries.push({ path, absolute, type: 'other' });
    }
  }
  return entries;
}

export async function verifyRoot(rootPath, { lockfilePath = defaultLockfile, checkInventory = true } = {}) {
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
  let metadata;
  if (manifest?.type === 'file') {
    try { metadata = JSON.parse(await readFile(manifest.absolute, 'utf8')); platform = metadata.platform; }
    catch { errors.push('Invalid manifest.json'); }
  }
  if (metadata && !supportedTargets.has(`${platform}-${metadata.arch}`)) errors.push('Unsupported manifest platform/architecture');
  const windows = platform === 'win32';
  const nodePath = windows ? 'node.exe' : 'node';
  const postgresPath = windows ? 'postgres/native/bin/postgres.exe' : 'postgres/native/bin/postgres';
  for (const required of [nodePath, postgresPath]) {
    if (byPath.get(required)?.type !== 'file') errors.push(`Missing required executable: ${required}`);
  }

  const files = [];
  const binaries = [];
  const expectedArch = { arm64: 'arm64', x64: 'x86_64' }[metadata?.arch];
  if (platform === 'darwin' && !expectedArch) errors.push('Unsupported Darwin manifest architecture');
  for (const entry of entries) {
    if (isBannedPath(entry.path)) errors.push(`Forbidden path: ${entry.path}`);
    if (entry.type === 'file') {
      const bytes = await readFile(entry.absolute);
      files.push({ path: entry.path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      if (platform === 'darwin') {
        const macho = isMachO(bytes);
        const nativeRequired = [nodePath, postgresPath].includes(entry.path) || /\.(?:node|dylib|so)(?:\.\d+)*$/.test(entry.path);
        if (macho) {
          try {
            const architectures = await machOArchitectures(entry.absolute);
            binaries.push({ path: entry.path, architectures });
            // Existing arm64 runtimes can carry upstream universal fsevents.
            // An x64 runtime must contain no arm64 slice, including universal files.
            if (!architectures.includes(expectedArch) || (metadata.arch === 'x64' && architectures.some((arch) => arch !== expectedArch))) {
              errors.push(`Mach-O architecture mismatch: ${entry.path}: expected ${expectedArch}, found ${architectures.join(',')}`);
            }
          } catch (error) { errors.push(`Cannot inspect Mach-O: ${entry.path}: ${error.message}`); }
        } else if (nativeRequired) errors.push(`Expected Mach-O binary: ${entry.path}`);
        else if (entry.executable) {
          // Published npm packages sometimes mark JSON, licenses and JS executable.
          // Inspect those too, without mistaking a mode bit for a native binary.
          try {
            const { stdout } = await promisify(execFile)('file', ['-b', entry.absolute]);
            if (/ELF|PE32|MS-DOS executable|Mach-O/.test(stdout)) errors.push(`Unexpected executable format: ${entry.path}: ${stdout.trim()}`);
          } catch (error) { errors.push(`Cannot inspect executable: ${entry.path}: ${error.message}`); }
        }
      }
    } else if (entry.type === 'symlink') {
      errors.push(`Symbolic link is not allowed: ${entry.path}`);
      const target = await readlink(entry.absolute);
      files.push({ path: entry.path, size: Buffer.byteLength(target), sha256: createHash('sha256').update(target).digest('hex'), type: 'symlink' });
    } else if (entry.type === 'other') {
      errors.push(`Unexpected filesystem entry: ${entry.path}`);
    }
  }
  const dependencies = [];
  try {
    const lockfile = await readFile(lockfilePath, 'utf8');
    const locked = lockedServerVersions(lockfile);
    for (const [name, expected] of locked) {
      const entry = byPath.get(`server/node_modules/${name}/package.json`);
      let actual;
      if (entry?.type === 'file') actual = JSON.parse(await readFile(entry.absolute, 'utf8')).version;
      dependencies.push({ name, expected, actual: actual ?? null });
      if (actual !== expected) errors.push(`Dependency version mismatch: ${name}: expected ${expected}, found ${actual ?? 'missing'}`);
    }
    const packages = lockedPackageVersions(lockfile);
    for (const entry of entries) {
      if (entry.type !== 'file' || !/\/node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(entry.path)) continue;
      const pkg = JSON.parse(await readFile(entry.absolute, 'utf8'));
      if (!packages.has(`${pkg.name}@${pkg.version}`)) errors.push(`Package is not locked: ${entry.path}: ${pkg.name}@${pkg.version}`);
      if (platform === 'darwin') {
        for (const name of Object.keys(pkg.optionalDependencies ?? {}).filter((name) => name.endsWith(`darwin-${metadata.arch}`))) {
          // Match Node resolution from this package in a hoisted dependency tree.
          let current = entry.path.slice(0, -'/package.json'.length);
          let found = false;
          while (current) {
            if (byPath.get(`${current}/node_modules/${name}/package.json`)?.type === 'file') { found = true; break; }
            current = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '';
          }
          if (!found) errors.push(`Missing target optional dependency: ${pkg.name}: ${name}`);
        }
      }
    }
  } catch (error) {
    errors.push(`Cannot verify locked server dependencies: ${error.message}`);
  }
  if (checkInventory && (metadata?.manifestVersion === 2 || metadata?.inventory !== undefined)) {
    if (JSON.stringify(metadata.inventory) !== JSON.stringify(inventoryFor(files))) errors.push('Manifest inventory hash mismatch');
  } else if (checkInventory && `${platform}-${metadata?.arch}` !== `${process.platform}-${process.arch}`) {
    errors.push('Cross-target runtime requires manifest inventory hashes');
  }
  return { root, errors, files, dependencies, binaries, execution: `${platform}-${metadata?.arch}` === `${process.platform}-${process.arch}`
    ? 'not performed by static verifier' : 'not executed (cross-target)', directories: entries.filter((entry) => entry.type === 'directory').length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyRoot(defaultRoot);
  console.log(`Office runtime root: ${result.root}`);
  const inventory = createHash('sha256').update(result.files.map(({ path, sha256 }) => `${path}\0${sha256}\n`).join('')).digest('hex');
  console.log(`Summary: ${result.files.length} files/symlinks, ${result.directories} directories; inventory sha256 ${inventory}`);
  console.log(`Mach-O binaries: ${result.binaries?.length ?? 0}; execution: ${result.execution}`);
  console.log(`Symbolic links: ${result.files.filter((entry) => entry.type === 'symlink').length}`);
  for (const path of ['manifest.json', process.platform === 'win32' ? 'node.exe' : 'node', process.platform === 'win32' ? 'postgres/native/bin/postgres.exe' : 'postgres/native/bin/postgres']) {
    const file = result.files.find((entry) => entry.path === path);
    if (file) console.log(`${file.sha256}  ${file.size}  ${file.path}`);
  }
  for (const error of result.errors) console.error(`ERROR: ${error}`);
  for (const dependency of result.dependencies ?? []) {
    console.log(`Dependency: ${dependency.name} locked=${dependency.expected} installed=${dependency.actual ?? 'missing'}`);
  }
  if (result.errors.length) process.exitCode = 1;
  else console.log('Office runtime verification passed.');
}

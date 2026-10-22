// SPDX-License-Identifier: Apache-2.0
// Build-time only downloads. Installed users never need Node, pnpm or Postgres.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile, chmod } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventoryFor, isMachO, machOArchitectures, verifyRoot } from './verify-office-runtime.mjs';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = JSON.parse(await readFile(join(app, 'scripts/office-runtime-sources.json'), 'utf8'));
const target = process.argv[2] ?? process.env.OFFICE_RUNTIME_TARGET ?? `${process.platform}-${process.arch}`;
const source = sources.targets[target];
if (!source) throw new Error(`Unsupported office runtime target: ${target}`);
const [platform, arch] = target.split('-');
const crossTarget = target !== `${process.platform}-${process.arch}`;
if (platform !== process.platform) throw new Error('Cross-OS runtime preparation is not supported; use a host with the target OS');
const output = join(app, 'apps/desktop/src-tauri/office-runtime', target);
await mkdir(dirname(output), { recursive: true });
const stage = await mkdtemp(join(dirname(output), '.preparing-'));
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli || !/pnpm\.(c?js|mjs)$/.test(pnpmCli)) throw new Error('Run this script through pnpm run office:prepare');

function run(command, args, cwd = app) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false });
    child.once('error', fail);
    child.once('exit', (code) => code === 0 ? done() : fail(new Error(`${command} exited (${code})`)));
  });
}

async function download(url, algorithm, expected, encoding = 'hex') {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash(algorithm).update(bytes).digest(encoding);
  if (actual !== expected) throw new Error('Office runtime archive integrity check failed');
  return bytes;
}

// Hoisted deploy has no dependency-directory links, but pnpm can still create
// executable aliases. Tauri drops symlinks when copying resources, so replace
// these aliases with their actual files before publishing the runtime.
async function materializeFileLinks(root, current = root) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) await materializeFileLinks(root, path);
    else if (entry.isSymbolicLink()) {
      const sourcePath = await realpath(path);
      if (!sourcePath.startsWith(`${root}${sep}`) || !(await lstat(sourcePath)).isFile()) {
        throw new Error(`Expected an internal file alias in hoisted runtime: ${path}`);
      }
      await rm(path);
      await cp(sourcePath, path);
    }
  }
}

try {
  const nodeArchive = await download(`https://nodejs.org/dist/v${sources.nodeVersion}/${source.nodeFile}`, 'sha256', source.nodeSha256);
  if (process.platform === 'win32') {
    const archive = join(stage, 'node.zip');
    const folder = `node-v${sources.nodeVersion}-win-x64`;
    await writeFile(archive, nodeArchive);
    await run('tar', ['-xf', archive, '-C', stage, `${folder}/node.exe`, `${folder}/LICENSE`]);
    await rename(join(stage, folder, 'node.exe'), join(stage, 'node.exe'));
    await rename(join(stage, folder, 'LICENSE'), join(stage, 'NODE-LICENSE'));
    await rm(join(stage, folder), { recursive: true });
    await rm(archive);
  } else {
    const archive = join(stage, 'node.tgz');
    await writeFile(archive, nodeArchive);
    await run('tar', ['-xzf', archive, '-C', stage, '--strip-components=1', `node-v${sources.nodeVersion}-${target}/bin/node`, `node-v${sources.nodeVersion}-${target}/LICENSE`]);
    await rename(join(stage, 'bin/node'), join(stage, 'node'));
    await rename(join(stage, 'LICENSE'), join(stage, 'NODE-LICENSE'));
    await rm(join(stage, 'bin'), { recursive: true });
    await rm(archive);
  }
  const pgBytes = await download(
    `https://registry.npmjs.org/@embedded-postgres/${source.postgresPackage}/-/${source.postgresPackage}-${sources.postgresVersion}.tgz`,
    'sha512', source.postgresIntegrity.slice('sha512-'.length), 'base64',
  );
  const pgArchive = join(stage, 'postgres.tgz');
  await writeFile(pgArchive, pgBytes);
  await mkdir(join(stage, 'postgres'));
  // npm's package contains native bin/lib/share directly under package/native.
  await run('tar', ['-xzf', pgArchive, '-C', join(stage, 'postgres'), '--strip-components=1']);
  await rm(pgArchive);
  if (process.platform !== 'win32') {
    const base = join(stage, 'postgres');
    const links = JSON.parse(await readFile(join(base, 'native/pg-symlinks.json'), 'utf8'));
    for (const link of links) {
      const sourcePath = resolve(base, link.source);
      const targetPath = resolve(base, link.target);
      if (![sourcePath, targetPath].every((path) => path.startsWith(`${base}${sep}native${sep}`))) {
        throw new Error('Unexpected Postgres library link');
      }
      // These dylib aliases must survive Tauri's resource copy too.
      await cp(sourcePath, targetPath);
    }
  }
  await run(process.execPath, [pnpmCli, '--filter', 'server', 'build']);
  // Modern deploy derives a frozen, package-specific lockfile from the shared
  // workspace lock. Legacy hoisted deploy ignores that lock and resolves newer
  // versions, which can break the already-built server.
  const lockPath = join(app, 'pnpm-lock.yaml');
  const lockBefore = await readFile(lockPath);
  // pnpm's --config.cpu/os override supportedArchitectures with singleton arrays.
  // Do not include `current`: the deploy must never copy the host's native variant.
  // Cross-target install scripts could run a foreign esbuild/fsevents binary.
  await run(process.execPath, [pnpmCli, '--filter', 'server', '--prod',
    `--config.cpu=${arch}`, `--config.os=${platform}`, ...(crossTarget ? ['--ignore-scripts'] : []), '--config.node-linker=hoisted', '--config.inject-workspace-packages=true', 'deploy', join(stage, 'server')]);
  if (!(await readFile(lockPath)).equals(lockBefore)) throw new Error('Workspace lockfile changed during runtime deploy');
  await materializeFileLinks(stage);
  if (platform === 'darwin' && arch === 'x64') {
    // fsevents ships a universal .node. Select its x64 slice, just as pnpm
    // selects x64 optional packages; preserve every package and runtime file.
    async function selectSlices(current) {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) await selectSlices(path);
        else if (entry.isFile() && isMachO(await readFile(path))) {
          const architectures = await machOArchitectures(path);
          if (architectures.includes('x86_64') && architectures.length > 1) {
            const thin = `${path}.x64-slice`;
            await run('lipo', [path, '-thin', 'x86_64', '-output', thin]);
            await chmod(thin, (await lstat(path)).mode & 0o777);
            await rename(thin, path);
          }
        }
      }
    }
    await selectSlices(stage);
  }
  await mkdir(join(stage, 'control'));
  await cp(join(app, 'apps/server/office-host/runtime.mjs'), join(stage, 'control/runtime.mjs'));
  const manifest = {
    manifestVersion: 2, protocol: 1, platform, arch,
    nodeVersion: sources.nodeVersion, postgresVersion: sources.postgresVersion, postgresMajor: sources.postgresMajor,
  };
  const manifestPath = join(stage, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (process.platform !== 'win32') await chmod(join(stage, 'node'), 0o755);
  const verification = await verifyRoot(stage, { checkInventory: false });
  if (verification.errors.length) throw new Error(`Invalid office runtime:\n${verification.errors.join('\n')}`);
  manifest.inventory = inventoryFor(verification.files);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const finalVerification = await verifyRoot(stage);
  if (finalVerification.errors.length) throw new Error(`Invalid office runtime:\n${finalVerification.errors.join('\n')}`);
  console.log(`Static verification: ${verification.binaries.length} Mach-O files; manifest inventory hashes verified`);
  console.log(crossTarget ? 'Execution validation: NOT EXECUTED (cross-target; no target binaries or migrations run)'
    : 'Execution validation: run runtime.test.mjs with OFFICE_RUNTIME_ROOT for migration/startup checks');
  // A failed prepare preserves the previously prepared resources. Build jobs
  // must not prepare while a dev runtime is using these files.
  const previous = `${output}.previous`;
  await rm(previous, { recursive: true, force: true });
  try { await rename(output, previous); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await rename(stage, output); } catch (error) {
    await rename(previous, output).catch(() => {});
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
  console.log(`Prepared office runtime: ${target}`);
} finally { await rm(stage, { recursive: true, force: true }); }

// SPDX-License-Identifier: Apache-2.0
// Build-time only downloads. Installed users never need Node, pnpm or Postgres.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile, chmod, symlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = JSON.parse(await readFile(join(app, 'scripts/office-runtime-sources.json'), 'utf8'));
const target = process.argv[2] ?? `${process.platform}-${process.arch}`;
const source = sources.targets[target];
if (!source) throw new Error(`Unsupported office runtime target: ${target}`);
// Native dependencies are materialized by pnpm on the target machine. Universal
// builds prepare each architecture in its matching build job before combining.
if (target !== `${process.platform}-${process.arch}`) {
  throw new Error('Prepare the office runtime on the target OS/architecture to include matching native dependencies');
}
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
      await symlink(relative(dirname(targetPath), sourcePath), targetPath);
    }
  }
  await run(process.execPath, [pnpmCli, '--filter', 'server', 'build']);
  await run(process.execPath, [pnpmCli, '--filter', 'server', '--prod', 'deploy', '--legacy', join(stage, 'server')]);
  await mkdir(join(stage, 'control'));
  await cp(join(app, 'apps/server/office-host/runtime.mjs'), join(stage, 'control/runtime.mjs'));
  await writeFile(join(stage, 'manifest.json'), `${JSON.stringify({
    protocol: 1, platform: process.platform, arch: process.arch,
    nodeVersion: sources.nodeVersion, postgresVersion: sources.postgresVersion, postgresMajor: sources.postgresMajor,
  }, null, 2)}\n`);
  if (process.platform !== 'win32') await chmod(join(stage, 'node'), 0o755);
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

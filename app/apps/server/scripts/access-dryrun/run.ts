/**
 * Access dry run: OLD resolver (origin/main copy in ./old-resolver) vs NEW
 * resolver (this branch's src/permissions) over every (member, live note /
 * file / folder) pair of every org in DATABASE_URL, plus the NEW creator-only
 * delete rule. Read-only: it issues SELECTs only. Ids only in the output.
 *
 *   DATABASE_URL=... pnpm exec tsx scripts/access-dryrun/run.ts [--org <id>] [--limit N]
 *        [--out <file.json>] [--exact-sample N] [--no-folder-gates] [--no-delete]
 *
 * See README.md. Exit code is always 0; the summary is the product.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../../src/db/pool.js";
import * as NEW_R from "../../src/permissions/resolver.js";
import * as NEW_G from "../../src/permissions/http-gates.js";
import * as OLD_R from "./old-resolver/permissions/resolver.js";
import * as OLD_G from "./old-resolver/permissions/http-gates.js";
import * as NEW_V from "../../src/permissions/vault-docs.js";
import * as OLD_V from "./old-resolver/permissions/vault-docs.js";

type Perm = "edit" | "view" | "none";
type Kind = "note" | "file" | "folder";
const RANK: Record<Perm, number> = { none: 0, view: 1, edit: 2 };

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const onlyOrg = arg("--org");
const limit = arg("--limit") ? Number(arg("--limit")) : Infinity;
const exactSample = arg("--exact-sample") ? Number(arg("--exact-sample")) : 500;
const folderGates = !argv.includes("--no-folder-gates");
const doDelete = !argv.includes("--no-delete");
const readableSets = !argv.includes("--no-readable-sets");
const dumpPairs = argv.includes("--pairs"); // every pair in the JSON (small DBs only)
const here = dirname(fileURLToPath(import.meta.url));
const dbName = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "unknown";
const outPath =
  arg("--out") ?? join(here, "out", `dryrun-${dbName}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const MAX_EXAMPLES = 20;

// ── small helpers ─────────────────────────────────────────────────────────────
async function pooled<T>(items: T[], width: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}
const isManager = (role: string | null) =>
  !!role && role.split(",").some((r) => ["owner", "admin"].includes(r.trim()));

interface Resource {
  kind: Kind;
  id: string;
  folderId: string | null; // the folder itself for kind=folder
  createdBy: string | null;
}
interface Member {
  userId: string;
  role: string;
}
interface Bucket {
  pairs: number;
  same: number;
  lost: number; // NEW < OLD
  gained: number; // NEW > OLD
  transitions: Record<string, number>; // "edit->view": n
}
const bucket = (): Bucket => ({ pairs: 0, same: 0, lost: 0, gained: 0, transitions: {} });
function tally(b: Bucket, oldP: Perm, newP: Perm) {
  b.pairs++;
  if (oldP === newP) b.same++;
  else {
    if (RANK[newP] < RANK[oldP]) b.lost++;
    else b.gained++;
    const k = `${oldP}->${newP}`;
    b.transitions[k] = (b.transitions[k] ?? 0) + 1;
  }
}

// ── per-org facts ─────────────────────────────────────────────────────────────
async function orgFacts(orgId: string) {
  const vaultRow = await pool.query<{ permission: string }>(
    `SELECT permission FROM shares
      WHERE resource_type='vault' AND resource_id=$1 AND principal_type='org' AND principal_id=$1
        AND permission IN ('edit','view','denied') LIMIT 1`,
    [orgId],
  );
  const p = vaultRow.rows[0]?.permission ?? null;
  const everyoneRow = p === "edit" ? "open" : p === "view" ? "readonly" : "private";
  const posture = p === "edit" ? "edit" : p === "view" ? "view" : p === "denied" ? "sealed" : "none";
  const settings = await pool.query<{ join_default: string }>(
    "SELECT join_default FROM organization_access_settings WHERE organization_id=$1",
    [orgId],
  );
  const orgItem = await pool.query<{ resource_type: string; permission: string; n: string }>(
    `SELECT s.resource_type, s.permission, count(*)::text AS n FROM shares s
      WHERE s.principal_type='org' AND s.principal_id=$1 AND s.resource_type IN ('folder','file')
        AND (s.resource_id IN (SELECT f.id FROM folders f JOIN vaults v ON v.id=f.vault_id WHERE v.organization_id=$1)
          OR s.resource_id IN (SELECT n.id FROM notes n JOIN vaults v ON v.id=n.vault_id WHERE v.organization_id=$1)
          OR s.resource_id IN (SELECT fi.id FROM files fi JOIN vaults v ON v.id=fi.vault_id WHERE v.organization_id=$1))
      GROUP BY 1,2`,
    [orgId],
  );
  const perUserVault = await pool.query<{ permission: string; role: string | null; n: string }>(
    `SELECT s.permission, m.role, count(*)::text AS n FROM shares s
       LEFT JOIN member m ON m."organizationId"=$1 AND m."userId"=s.principal_id
      WHERE s.resource_type='vault' AND s.resource_id=$1 AND s.principal_type='user'
      GROUP BY 1,2`,
    [orgId],
  );
  const snapshots = await pool.query<{ mode: string; n: string }>(
    "SELECT mode, count(*)::text AS n FROM member_access_snapshots WHERE organization_id=$1 GROUP BY 1",
    [orgId],
  );
  const deletedNotes = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM notes n JOIN vaults v ON v.id=n.vault_id
      WHERE v.organization_id=$1 AND n.deleted_at IS NOT NULL`,
    [orgId],
  );
  const group = <R extends { n: string }>(rows: R[], key: (r: R) => string) =>
    rows.reduce<Record<string, number>>((acc, r) => ((acc[key(r)] = (acc[key(r)] ?? 0) + Number(r.n)), acc), {});
  return {
    everyoneRowNewUi: everyoneRow,
    posture,
    joinDefault: settings.rows[0]?.join_default ?? null,
    orgPrincipalItemRows: {
      total: orgItem.rows.reduce((s, r) => s + Number(r.n), 0),
      byTypeAndPermission: group(orgItem.rows, (r) => `${r.resource_type}:${r.permission}`),
      note: "invisible in the new UI; cleared by PUT team-access when the Everyone row changes",
    },
    perUserVaultRows: {
      total: perUserVault.rows.reduce((s, r) => s + Number(r.n), 0),
      byPermission: group(perUserVault.rows, (r) => r.permission),
      byPermissionAndRole: group(perUserVault.rows, (r) => `${r.permission}:${r.role ?? "not-a-member"}`),
      note: "now an ABSOLUTE level for that person (replaces posture, snapshot, admin shortcut, authorship)",
    },
    joinSnapshots: group(snapshots.rows, (r) => r.mode),
    softDeletedNotesExcluded: Number(deletedNotes.rows[0]?.n ?? 0),
  };
}

/** Descriptive context for an example row: what each resolver could see. */
function why(
  idx: NEW_R.AccessIndex,
  r: Resource,
  m: Member,
  chain: string[],
  personal: string | null,
  posture: string,
  snapshot: string | null,
): string {
  const rows: string[] = [];
  const look = (type: string, id: string, label: string) => {
    for (const s of idx.shares.get(`${type}\u0000${id}`) ?? []) {
      if (s.principal_type === "user" && s.principal_id !== m.userId) continue;
      rows.push(`${s.principal_type}-${label}:${s.permission}`);
    }
  };
  if (r.kind !== "folder") look("file", r.id, "item");
  chain.forEach((f, i) => look("folder", f, i === 0 && r.kind === "folder" ? "item" : `anc${i}`));
  const creator = r.createdBy === m.userId ? "yes" : r.createdBy === null ? "null" : "other";
  return [
    `role=${m.role}`,
    `personalVault=${personal ?? "-"}`,
    `posture=${posture}`,
    `snapshot=${snapshot ?? "-"}`,
    `creator=${creator}`,
    `rows=[${rows.join(",")}]`,
  ].join(" ");
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const started = Date.now();
  const orgs = (
    await pool.query<{ id: string }>(
      // Most shares, then most members first: a run cut short still covers the
      // orgs where the two resolvers are most likely to disagree.
      onlyOrg
        ? "SELECT id FROM organization WHERE id=$1"
        : `SELECT o.id FROM organization o
            ORDER BY (SELECT count(*) FROM shares s WHERE s.org_id = o.id) DESC,
                     (SELECT count(*) FROM member m WHERE m."organizationId" = o.id) DESC, o.id`,
      onlyOrg ? [onlyOrg] : [],
    )
  ).rows.map((r) => r.id);

  const totals = { orgs: 0, members: 0, resources: 0, all: bucket(), byKind: { note: bucket(), file: bucket(), folder: bucket() } as Record<Kind, Bucket>, folderEditGate: bucket(), indexVsExactMismatches: { old: 0, new: 0, checked: 0 }, readableSet: { checked: 0, oldDisagree: 0, newDisagree: 0, setLost: 0, setGained: 0 }, deletePolicy: { checked: 0, allowed: 0, refusedNotCreator: 0, refusedFolderHasOthers: 0, itemsRefusedForSomeCurrentEditor: 0, itemsRefusedByCreatedByNull: 0, itemsRefusedByOtherCreator: 0, itemsRefusedByFolderContents: 0 }, deleteAffectedPlainMembers: 0, deleteByKindReason: {} as Record<string, number> };
  const perOrg: unknown[] = [];

  for (const orgId of orgs) {
    const members = (
      await pool.query<Member>(`SELECT "userId" AS "userId", role FROM member WHERE "organizationId"=$1 ORDER BY "userId"`, [orgId])
    ).rows;
    const take = <T>(xs: T[]) => (Number.isFinite(limit) ? xs.slice(0, limit) : xs);
    const notes = take(
      (
        await pool.query<{ id: string; folder_id: string | null; created_by: string | null }>(
          `SELECT n.id, n.folder_id, n.created_by FROM notes n JOIN vaults v ON v.id=n.vault_id
            WHERE v.organization_id=$1 AND n.deleted_at IS NULL ORDER BY n.id`,
          [orgId],
        )
      ).rows,
    );
    const files = take(
      (
        await pool.query<{ id: string; folder_id: string | null; created_by: string | null }>(
          `SELECT fi.id, fi.folder_id, fi.created_by FROM files fi JOIN vaults v ON v.id=fi.vault_id
            WHERE v.organization_id=$1 ORDER BY fi.id`,
          [orgId],
        )
      ).rows,
    );
    const folders = take(
      (
        await pool.query<{ id: string; created_by: string | null }>(
          `SELECT f.id, f.created_by FROM folders f JOIN vaults v ON v.id=f.vault_id
            WHERE v.organization_id=$1 ORDER BY f.id`,
          [orgId],
        )
      ).rows,
    );
    const resources: Resource[] = [
      ...notes.map((n) => ({ kind: "note" as const, id: n.id, folderId: n.folder_id, createdBy: n.created_by })),
      ...files.map((f) => ({ kind: "file" as const, id: f.id, folderId: f.folder_id, createdBy: f.created_by })),
      ...folders.map((f) => ({ kind: "folder" as const, id: f.id, folderId: f.id, createdBy: f.created_by })),
    ];

    const facts = await orgFacts(orgId);
    const oldIdx = await OLD_R.loadAccessIndex(pool, orgId);
    const newIdx = await NEW_R.loadAccessIndex(pool, orgId);
    const oldCache = OLD_R.createResolverCache();
    const newCache = NEW_R.createResolverCache();
    const personal = new Map<string, string | null>();
    const snapshot = new Map<string, string | null>();
    for (const m of members) {
      personal.set(m.userId, await NEW_R.personalVaultLevel(pool, orgId, m.userId));
      snapshot.set(m.userId, (await NEW_R.memberAccessSnapshot(pool, orgId, m.userId))?.mode ?? null);
    }

    const org = { all: bucket(), byKind: { note: bucket(), file: bucket(), folder: bucket() } as Record<Kind, Bucket>, folderEditGate: bucket() };
    const examples: unknown[] = [];
    const pairs: unknown[] = [];
    const indexVsExact = { old: 0, new: 0, checked: 0, examples: [] as unknown[] };
    // (resource id) → per-member old/new perms, for the delete pass
    const editors = new Map<string, { m: Member; oldEdit: boolean; newEdit: boolean }[]>();
    let exactBudget = exactSample;
    const docPerms = new Map<string, { o: Perm; n: Perm }>(); // `${userId}\u0000${docId}`

    for (const r of resources) {
      const ctxType = r.kind === "folder" ? "folder" : "file";
      // Notes and files share the "file" resource type in both resolvers; a
      // note id that is also a files id resolves as the note (locateDoc order).
      const oldCtx = await OLD_R.buildAccessContextFromIndex(oldIdx, ctxType, r.id, pool, oldCache);
      const newCtx = await NEW_R.buildAccessContextFromIndex(newIdx, ctxType, r.id, pool, newCache);
      if (!oldCtx || !newCtx) continue;
      const list: { m: Member; oldEdit: boolean; newEdit: boolean }[] = [];
      // Folder gates (DB-bound) for all members at once; the rest stays sequential.
      const gates =
        r.kind === "folder" && folderGates
          ? await Promise.all(
              members.map(async (m) => [
                await OLD_G.canEditFolder(m.userId, r.id, pool, oldCache),
                await NEW_G.canEditFolder(m.userId, r.id, pool, newCache),
              ]),
            )
          : null;
      for (const [mi, m] of members.entries()) {
        const o = (await OLD_R.resolveAccessForUser(oldCtx, m.userId, m.role, pool, oldCache, oldIdx)).permission as Perm;
        const n = (await NEW_R.resolveAccessForUser(newCtx, m.userId, m.role, pool, newCache, newIdx)).permission as Perm;
        if (r.kind !== "folder") docPerms.set(`${m.userId}\u0000${r.id}`, { o, n });
        tally(org.all, o, n);
        tally(org.byKind[r.kind], o, n);
        let oEdit = o === "edit";
        let nEdit = n === "edit";
        if (r.kind === "folder" && folderGates) {
          // Folder EDIT is what creating/renaming inside it asks; it adds the
          // folder-creator rule, so it is compared separately.
          oEdit = gates![mi]![0]!;
          nEdit = gates![mi]![1]!;
          tally(org.folderEditGate, oEdit ? "edit" : "none", nEdit ? "edit" : "none");
        }
        if (r.kind !== "folder" && exactBudget > 0) {
          // Cross-check the indexed path against the per-doc enforcer.
          exactBudget--;
          const oe = await OLD_R.effectivePermission(m.userId, r.id, pool);
          const ne = await NEW_R.effectivePermission(m.userId, r.id, pool);
          indexVsExact.checked++;
          if (oe !== o) indexVsExact.old++;
          if (ne !== n) indexVsExact.new++;
          if ((oe !== o || ne !== n) && indexVsExact.examples.length < 10)
            indexVsExact.examples.push({ userId: m.userId, resourceId: r.id, oldIndexed: o, oldExact: oe, newIndexed: n, newExact: ne });
        }
        if (o !== n && examples.length < MAX_EXAMPLES) {
          examples.push({
            userId: m.userId,
            resourceType: r.kind,
            resourceId: r.id,
            old: o,
            new: n,
            why: why(newIdx, r, m, newCtx.folderIds, personal.get(m.userId) ?? null, facts.posture, snapshot.get(m.userId) ?? null),
          });
        }
        if (dumpPairs) pairs.push({ userId: m.userId, kind: r.kind, id: r.id, old: o, new: n, ...(r.kind === "folder" && folderGates ? { oldFolderEdit: oEdit, newFolderEdit: nEdit } : {}) });
        list.push({ m, oldEdit: oEdit, newEdit: nEdit });
      }
      editors.set(`${r.kind}:${r.id}`, list);
    }

    // ── readable-set listing vs the per-pair resolver (each side vs itself) ──
    // `listReadableDocsInVault` is what sync, the registry pull and
    // `ready.revoked` use; it must agree with `resolveAccessForUser` != none.
    const readable = { checked: 0, oldDisagree: 0, newDisagree: 0, setLost: 0, setGained: 0, examples: [] as unknown[] };
    if (readableSets) {
      const vaultIds = (await pool.query<{ id: string }>("SELECT id FROM vaults WHERE organization_id=$1", [orgId])).rows.map((v) => v.id);
      for (const m of members) {
        const oldSet = new Set<string>();
        const newSet = new Set<string>();
        for (const v of vaultIds) {
          for (const id of await OLD_V.listReadableDocsInVault(m.userId, v, pool)) oldSet.add(id);
          for (const id of await NEW_V.listReadableDocsInVault(m.userId, v, pool)) newSet.add(id);
        }
        for (const r of resources) {
          if (r.kind === "folder") continue;
          const p = docPerms.get(`${m.userId}\u0000${r.id}`);
          if (!p) continue;
          readable.checked++;
          const oIn = oldSet.has(r.id);
          const nIn = newSet.has(r.id);
          if (oIn !== (p.o !== "none")) readable.oldDisagree++;
          if (nIn !== (p.n !== "none")) readable.newDisagree++;
          if (oIn && !nIn) readable.setLost++;
          if (!oIn && nIn) readable.setGained++;
          if ((oIn !== (p.o !== "none") || nIn !== (p.n !== "none")) && readable.examples.length < 10)
            readable.examples.push({ userId: m.userId, resourceId: r.id, kind: r.kind, oldInSet: oIn, oldResolver: p.o, newInSet: nIn, newResolver: p.n });
        }
      }
    }

    // ── delete policy (NEW canDeleteItem) ───────────────────────────────────
    const del = { checked: 0, allowed: 0, refusedNotCreator: 0, refusedFolderHasOthers: 0, itemsRefusedForSomeCurrentEditor: 0, itemsRefusedByCreatedByNull: 0, itemsRefusedByOtherCreator: 0, itemsRefusedByFolderContents: 0, examples: [] as unknown[], byKindReason: {} as Record<string, number>, affectedMembers: [] as string[] };
    const affected = new Set<string>();
    if (doDelete) {
      await pooled(resources, 8, async (r) => {
        const list = editors.get(`${r.kind}:${r.id}`) ?? [];
        // Plain members who can edit it today (OLD) or after the change (NEW).
        const cands = list.filter((e) => !isManager(e.m.role) && (e.oldEdit || e.newEdit));
        let refusedCurrent = false;
        let folderContents = false;
        for (const e of cands) {
          const g = await NEW_G.canDeleteItem(pool, { orgId, userId: e.m.userId, orgRole: e.m.role, kind: r.kind, id: r.id });
          del.checked++;
          if (g.ok) del.allowed++;
          else if (g.code === "delete_not_creator") del.refusedNotCreator++;
          else {
            del.refusedFolderHasOthers++;
            folderContents = true;
          }
          if (!g.ok && e.oldEdit) {
            refusedCurrent = true;
            affected.add(e.m.userId);
          }
          if (dumpPairs) pairs.push({ userId: e.m.userId, kind: r.kind, id: r.id, deleteGate: g.ok ? "ok" : g.code });
        }
        if (refusedCurrent) {
          del.itemsRefusedForSomeCurrentEditor++;
          if (folderContents) del.itemsRefusedByFolderContents++;
          else if (r.createdBy === null) del.itemsRefusedByCreatedByNull++;
          else del.itemsRefusedByOtherCreator++;
          const reason = folderContents ? "folder_has_others_items" : r.createdBy === null ? "created_by_null" : "other_creator";
          del.byKindReason[`${r.kind}:${reason}`] = (del.byKindReason[`${r.kind}:${reason}`] ?? 0) + 1;
          if (del.examples.length < MAX_EXAMPLES)
            del.examples.push({
              resourceType: r.kind,
              resourceId: r.id,
              createdBy: r.createdBy === null ? null : "set",
              plainEditorsToday: cands.filter((c) => c.oldEdit).length,
              reason: folderContents ? "folder_has_others_items" : r.createdBy === null ? "created_by_null" : "other_creator",
            });
        }
      });
    }

    del.affectedMembers = [...affected].sort();
    const summary = {
      orgId,
      members: members.length,
      roles: members.reduce<Record<string, number>>((a, m) => ((a[m.role] = (a[m.role] ?? 0) + 1), a), {}),
      resources: { notes: notes.length, files: files.length, folders: folders.length },
      ...facts,
      comparison: org,
      indexVsExact,
      readableSetVsResolver: readable,
      deletePolicy: del,
      examples,
      ...(dumpPairs ? { pairs } : {}),
    };
    perOrg.push(summary);

    totals.orgs++;
    totals.members += members.length;
    totals.resources += resources.length;
    const merge = (into: Bucket, from: Bucket) => {
      into.pairs += from.pairs; into.same += from.same; into.lost += from.lost; into.gained += from.gained;
      for (const [k, v] of Object.entries(from.transitions)) into.transitions[k] = (into.transitions[k] ?? 0) + v;
    };
    merge(totals.all, org.all);
    for (const k of ["note", "file", "folder"] as Kind[]) merge(totals.byKind[k], org.byKind[k]);
    merge(totals.folderEditGate, org.folderEditGate);
    totals.indexVsExactMismatches.old += indexVsExact.old;
    totals.indexVsExactMismatches.new += indexVsExact.new;
    totals.indexVsExactMismatches.checked += indexVsExact.checked;
    for (const k of Object.keys(totals.readableSet) as (keyof typeof totals.readableSet)[]) totals.readableSet[k] += readable[k];
    for (const k of Object.keys(totals.deletePolicy) as (keyof typeof totals.deletePolicy)[]) totals.deletePolicy[k] += del[k];
    totals.deleteAffectedPlainMembers += del.affectedMembers.length;
    for (const [k, v] of Object.entries(del.byKindReason)) totals.deleteByKindReason[k] = (totals.deleteByKindReason[k] ?? 0) + v;
    writeReport(false);
    console.error(`[dryrun] ${totals.orgs}/${orgs.length} org=${orgId} pairs=${org.all.pairs} lost=${org.all.lost} gained=${org.all.gained} t=${Math.round((Date.now() - started) / 1000)}s`);
  }
  const report = writeReport(true);

  function writeReport(complete: boolean) {
    const r = {
      database: dbName,
      complete,
      orgsTotal: orgs.length,
      generatedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      options: { org: onlyOrg ?? null, limit: Number.isFinite(limit) ? limit : null, exactSample, folderGates, doDelete, readableSets },
      totals,
      orgs: perOrg,
    };
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(r, null, 2));
    return r;
  }

  // ── human summary ───────────────────────────────────────────────────────
  const pad = (s: unknown, n: number) => String(s).padEnd(n);
  console.log(`\nAccess dry run: ${dbName}   (${report.elapsedMs} ms)\n`);
  console.log(
    pad("org", 40) + pad("mem", 5) + pad("res", 6) + pad("pairs", 8) + pad("lost", 6) + pad("gain", 6) +
      pad("note l/g", 10) + pad("file l/g", 10) + pad("fold l/g", 10) + pad("fEdit l/g", 11) + pad("everyone", 10) +
      pad("orgItem", 8) + pad("usrVault", 9) + pad("delRef", 7) + "nullCB",
  );
  for (const o of perOrg as any[]) {
    const c = o.comparison;
    const lg = (b: Bucket) => `${b.lost}/${b.gained}`;
    console.log(
      pad(o.orgId, 40) + pad(o.members, 5) + pad(o.resources.notes + o.resources.files + o.resources.folders, 6) +
        pad(c.all.pairs, 8) + pad(c.all.lost, 6) + pad(c.all.gained, 6) + pad(lg(c.byKind.note), 10) +
        pad(lg(c.byKind.file), 10) + pad(lg(c.byKind.folder), 10) + pad(lg(c.folderEditGate), 11) +
        pad(o.everyoneRowNewUi, 10) + pad(o.orgPrincipalItemRows.total, 8) + pad(o.perUserVaultRows.total, 9) +
        pad(o.deletePolicy.itemsRefusedForSomeCurrentEditor, 7) + o.deletePolicy.itemsRefusedByCreatedByNull,
    );
  }
  const t = totals;
  console.log(
    `\nTOTAL orgs=${t.orgs} members=${t.members} resources=${t.resources} pairs=${t.all.pairs} ` +
      `same=${t.all.same} lost=${t.all.lost} gained=${t.all.gained}`,
  );
  console.log(`  transitions: ${JSON.stringify(t.all.transitions)}`);
  for (const k of ["note", "file", "folder"] as Kind[])
    console.log(`  ${k}: pairs=${t.byKind[k].pairs} lost=${t.byKind[k].lost} gained=${t.byKind[k].gained} ${JSON.stringify(t.byKind[k].transitions)}`);
  console.log(`  folder edit gate (canEditFolder): lost=${t.folderEditGate.lost} gained=${t.folderEditGate.gained}`);
  console.log(`  indexed vs exact (effectivePermission) mismatches: old=${t.indexVsExactMismatches.old} new=${t.indexVsExactMismatches.new} of ${t.indexVsExactMismatches.checked} checked`);
  console.log(`  readable set (listReadableDocsInVault) vs resolver disagreements: old=${t.readableSet.oldDisagree} new=${t.readableSet.newDisagree} of ${t.readableSet.checked}; set lost=${t.readableSet.setLost} gained=${t.readableSet.setGained}`);
  console.log(`  delete policy: ${JSON.stringify(t.deletePolicy)}`);
  console.log(`  delete refusals by kind:reason: ${JSON.stringify(t.deleteByKindReason)}; plain members affected (org,user pairs): ${t.deleteAffectedPlainMembers}`);
  console.log(`\nJSON: ${outPath}`);
}

main()
  .catch((e) => {
    console.error("dry run failed:", e instanceof Error ? e.message : e);
  })
  .finally(async () => {
    await pool.end().catch(() => {});
    process.exitCode = 0;
  });

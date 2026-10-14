/**
 * Synthetic dataset for validating the dry-run harness. DESTRUCTIVE for the
 * target database: it refuses to run unless the database name ends in
 * `_dryrun_dev`. Every id is prefixed `dr-` so the expected-results table in
 * README.md can refer to them.
 *
 *   DATABASE_URL=.../context_dryrun_dev pnpm exec tsx scripts/access-dryrun/seed-synthetic.ts
 */
import pg from "pg";

const url = process.env.DATABASE_URL ?? "";
const dbName = url.split("/").pop()?.split("?")[0] ?? "";
if (!dbName.endsWith("_dryrun_dev")) {
  console.error(`refusing to seed database "${dbName}": name must end in _dryrun_dev`);
  process.exit(1);
}
const db = new pg.Client({ connectionString: url });

async function q(sql: string, params: unknown[] = []) {
  await db.query(sql, params);
}
let shareN = 0;
async function share(org: string, rtype: string, rid: string, ptype: string, pid: string, perm: string) {
  shareN += 1;
  await q(
    `INSERT INTO shares (id, org_id, resource_type, resource_id, principal_type, principal_id, permission)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [`dr-share-${shareN}`, org, rtype, rid, ptype, pid, perm],
  );
}
async function user(id: string) {
  await q(`INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1,$1,$1||'@example.test',true)`, [id]);
}
async function org(id: string) {
  await q(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1,$1,$1,now())`, [id]);
  await q(`INSERT INTO vaults (id, organization_id, name) VALUES ($1||'-v',$1,'v')`, [id]);
}
async function member(orgId: string, userId: string, role: string) {
  await q(`INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1,$2,$3,$4,now())`, [
    `dr-mem-${orgId}-${userId}`,
    orgId,
    userId,
    role,
  ]);
}
async function folder(orgId: string, id: string, path: string, parent: string | null, createdBy: string | null) {
  await q(
    `INSERT INTO folders (id, vault_id, path, name, parent_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, `${orgId}-v`, path, path.split("/").pop(), parent, createdBy],
  );
}
async function note(orgId: string, id: string, relPath: string, folderId: string | null, createdBy: string | null, deleted = false) {
  await q(
    `INSERT INTO notes (id, doc_id, vault_id, rel_path, folder_id, created_by, created_at, deleted_at)
     VALUES ($1,$1,$2,$3,$4,$5, now() - interval '2 days', CASE WHEN $6 THEN now() ELSE NULL END)`,
    [id, `${orgId}-v`, relPath, folderId, createdBy, deleted],
  );
}
async function file(orgId: string, id: string, path: string, folderId: string | null, createdBy: string | null) {
  await q(
    `INSERT INTO files (id, vault_id, path, folder_id, created_by, created_at) VALUES ($1,$2,$3,$4,$5, now() - interval '2 days')`,
    [id, `${orgId}-v`, path, folderId, createdBy],
  );
}

async function main() {
  await db.connect();
  await q("BEGIN");
  for (const t of [
    "shares", "member_access_snapshots", "organization_access_settings", "files", "notes", "folders",
    "vaults", "member", "organization", '"user"',
  ]) {
    await q(`DELETE FROM ${t} WHERE ${t === '"user"' || t === "organization" ? "id" : t === "member" ? '"organizationId"' : t === "member_access_snapshots" || t === "organization_access_settings" ? "organization_id" : t === "vaults" ? "organization_id" : t === "shares" ? "org_id" : "vault_id"} LIKE 'dr-%'`);
  }
  for (const u of ["dr-own", "dr-adm", "dr-m1", "dr-m2", "dr-m3", "dr-m4", "dr-m5"]) await user(u);

  // ── Org A: Shared (org vault edit) ─────────────────────────────────────────
  const A = "dr-orgA";
  await org(A);
  await member(A, "dr-own", "owner");
  await member(A, "dr-adm", "admin");
  for (const m of ["dr-m1", "dr-m2", "dr-m3", "dr-m4", "dr-m5"]) await member(A, m, "member");
  await share(A, "vault", A, "org", A, "edit");
  await share(A, "vault", A, "user", "dr-m1", "view"); // personal level view (absolute in NEW)
  await share(A, "vault", A, "user", "dr-m2", "denied"); // personal level denied
  await share(A, "vault", A, "user", "dr-m4", "view"); // personal view + org folder override below
  await folder(A, "dr-A-f1", "f1", null, "dr-own");
  await folder(A, "dr-A-f2", "f2", null, "dr-m3"); // m3 created, but contains others' items
  await folder(A, "dr-A-f3", "f3", null, "dr-own");
  await folder(A, "dr-A-f4", "f4", null, "dr-m3"); // m3 created, only m3 items
  await share(A, "folder", "dr-A-f1", "org", A, "edit"); // org folder override (invisible in new UI)
  await share(A, "folder", "dr-A-f2", "user", "dr-m3", "readonly"); // per-user folder readonly
  await share(A, "folder", "dr-A-f3", "org", A, "locked"); // a locked row
  await note(A, "dr-A-n-root", "root.md", null, "dr-own");
  await note(A, "dr-A-n-f1", "f1/a.md", "dr-A-f1", "dr-own");
  await note(A, "dr-A-n-f2a", "f2/a.md", "dr-A-f2", "dr-own");
  await note(A, "dr-A-n-f2b", "f2/b.md", "dr-A-f2", "dr-own");
  await share(A, "file", "dr-A-n-f2b", "user", "dr-m3", "edit"); // per-user file edit inside readonly folder
  await note(A, "dr-A-n-f3", "f3/a.md", "dr-A-f3", "dr-own");
  await note(A, "dr-A-n-m3", "m3.md", null, "dr-m3"); // created by a member
  await note(A, "dr-A-n-m2", "m2.md", null, "dr-m2"); // created by personally-denied member
  await note(A, "dr-A-n-f4", "f4/x.md", "dr-A-f4", "dr-m3");
  await folder(A, "dr-A-f5", "f5", null, "dr-m3"); // m3 created, holds the owner's note
  await note(A, "dr-A-n-f5", "f5/own.md", "dr-A-f5", "dr-own");
  await share(A, "vault", A, "user", "dr-adm", "view"); // admin with a personal view level
  await note(A, "dr-A-n-del", "deleted.md", null, "dr-m3", true); // soft-deleted: excluded
  await file(A, "dr-A-file-m3", "m3.png", null, "dr-m3");
  await file(A, "dr-A-file-null", "legacy.png", null, null); // no created_by (pre-049)
  // m5 joined Private AFTER everything above existed.
  // The member INSERT trigger (m032) snapshots everyone; members that predate
  // m032 in production have none, so keep only m5's to exercise both paths.
  await q(
    `INSERT INTO member_access_snapshots (organization_id, user_id, mode, access_revision, snapshot_at)
     VALUES ($1,'dr-m5','private',0, now() - interval '1 day')
     ON CONFLICT (organization_id, user_id) DO UPDATE SET mode = 'private', snapshot_at = EXCLUDED.snapshot_at`,
    [A],
  );
  await q(`INSERT INTO organization_access_settings (organization_id, join_default) VALUES ($1,'open') ON CONFLICT (organization_id) DO UPDATE SET join_default = 'open'`, [A]);

  // ── Org B: sealed (org denied on vault) ────────────────────────────────────
  const B = "dr-orgB";
  await org(B);
  await member(B, "dr-own", "owner");
  await member(B, "dr-m1", "member");
  await member(B, "dr-m2", "member");
  await share(B, "vault", B, "org", B, "denied");
  await share(B, "vault", B, "user", "dr-m2", "edit"); // personal edit lifts sealed
  await folder(B, "dr-B-f1", "f1", null, "dr-own");
  await share(B, "folder", "dr-B-f1", "org", B, "view"); // org grant lifts out of sealed
  await note(B, "dr-B-n-own", "own.md", null, "dr-own");
  await note(B, "dr-B-n-m1", "m1.md", null, "dr-m1");
  await note(B, "dr-B-n-f1", "f1/a.md", "dr-B-f1", "dr-own");

  // ── Org C: never shared (no vault row) ─────────────────────────────────────
  const C = "dr-orgC";
  await org(C);
  await member(C, "dr-own", "owner");
  await member(C, "dr-m1", "member");
  await note(C, "dr-C-n-own", "own.md", null, "dr-own");
  await note(C, "dr-C-n-m1", "m1.md", null, "dr-m1");

  // ── Org D: Read-only (org vault view) ──────────────────────────────────────
  const D = "dr-orgD";
  await org(D);
  await member(D, "dr-own", "owner");
  await member(D, "dr-adm", "admin");
  await member(D, "dr-m1", "member");
  await member(D, "dr-m3", "member");
  await share(D, "vault", D, "org", D, "view");
  await share(D, "vault", D, "user", "dr-m1", "edit"); // personal edit lifts Read-only
  await folder(D, "dr-D-f1", "f1", null, "dr-own");
  await share(D, "folder", "dr-D-f1", "user", "dr-m3", "edit");
  await note(D, "dr-D-n-root", "root.md", null, "dr-own");
  await note(D, "dr-D-n-f1", "f1/a.md", "dr-D-f1", "dr-own");
  await note(D, "dr-D-n-m3", "m3.md", null, "dr-m3");

  await q(`DELETE FROM member_access_snapshots WHERE organization_id LIKE 'dr-%' AND NOT (organization_id = 'dr-orgA' AND user_id = 'dr-m5')`);
  await q("COMMIT");
  console.log(`seeded 4 orgs, ${shareN} share rows into ${dbName}`);
  await db.end();
}
main().catch(async (e) => {
  console.error(e);
  await db.query("ROLLBACK").catch(() => {});
  process.exit(1);
});

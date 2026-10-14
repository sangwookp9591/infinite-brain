import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { pool } from "../src/db/pool.js";
import { canCreateIn } from "../src/permissions/http-gates.js";
import { resetDb } from "./helpers/db.js";
import { authHeaders, createOrg, signUp, type TestUser } from "./helpers/auth.js";
import {
  freezeVaultRoot,
  sealVault,
  seedDeny,
  seedFolder,
  seedLock,
  seedMember,
  seedShare,
  seedUserVaultGrant,
  seedVault,
  seedVaultGrant,
} from "./helpers/seed.js";
import { recordingAppDeps } from "./helpers/app.js";
import type { FolderBatchResult } from "../src/http/routes/bulk-types.js";

/**
 * Equivalence oracle for `POST /vaults/:id/folders/batch`: whatever the route's
 * (preloaded / cached) permission path answers must equal the ORIGINAL uncached
 * `canCreateIn(userId, vaultId, parentId, pool)`. Plus a query-count budget.
 */

const rec = recordingAppDeps();
const app = createApp(rec.deps);

async function post(user: TestUser, vault: string, items: unknown[]) {
  const res = await app.fetch(
    new Request(`http://local/api/vaults/${vault}/folders/batch`, {
      method: "POST",
      headers: authHeaders(user),
      body: JSON.stringify({ items }),
    }),
  );
  return { status: res.status, body: (await res.json()) as { results: FolderBatchResult[] } };
}

const leaf = (p: string) => p.split("/").pop()!;
const item = (path: string) => ({ path, name: leaf(path) });

describe("folders/batch permission equivalence + query budget", () => {
  let owner: TestUser;
  let member: TestUser;
  let org: string;
  let vault: string;

  beforeEach(async () => {
    await resetDb();
    rec.reset();
    owner = await signUp("owner@fbp.test");
    org = (await createOrg(owner, "FBP Co", "fbp-co")).id;
    vault = await seedVault(org);
    await seedVaultGrant(org, "edit");
    member = await signUp("member@fbp.test");
    await seedMember(org, member.userId, "member");
  });
  afterAll(async () => {
    await pool.end();
  });

  /**
   * For each existing parent: post `<p>/n1`, `<p>/n1/d2`, `<p>/n1/d2/d3`.
   * n1 is judged by the uncached gate on the existing parent BEFORE the post;
   * d2 / d3 by the uncached gate on the freshly created parent AFTER it.
   */
  async function checkEquivalence(user: TestUser, parents: { id: string; path: string }[]) {
    const items: ReturnType<typeof item>[] = [];
    const expectedTop = new Map<string, boolean>();
    for (const p of parents) {
      expectedTop.set(p.path, await canCreateIn(user.userId, vault, p.id, pool));
      items.push(item(`${p.path}/n1`), item(`${p.path}/n1/d2`), item(`${p.path}/n1/d2/d3`));
    }
    const { status, body } = await post(user, vault, items);
    expect(status).toBe(200);
    const byPath = new Map(body.results.map((r, i) => [items[i].path, r]));

    const observed: Record<string, string> = {};
    for (const p of parents) {
      const top = byPath.get(`${p.path}/n1`)!;
      observed[`${p.path}/n1`] = top.status === "error" ? String(top.code) : top.status;
      if (expectedTop.get(p.path)) expect(top.status, `${p.path}/n1`).toBe("created");
      else {
        expect(top.status, `${p.path}/n1`).toBe("error");
        expect(top.code).toBe("no_write_access");
      }
      // Nested: oracle is the gate on the created parent row.
      let parentRes = top;
      for (const rel of ["n1/d2", "n1/d2/d3"]) {
        const child = byPath.get(`${p.path}/${rel}`)!;
        observed[`${p.path}/${rel}`] = child.status === "error" ? String(child.code) : child.status;
        if (parentRes.status !== "created") {
          expect(child.status).toBe("error"); // no parent row to hang on
          continue;
        }
        const allowed = await canCreateIn(user.userId, vault, parentRes.id, pool);
        if (allowed) expect(child.status, `${p.path}/${rel}`).toBe("created");
        else {
          expect(child.status).toBe("error");
          expect(child.code).toBe("no_write_access");
        }
        parentRes = child;
      }
    }
    return { observed, expectedTop };
  }

  it("(a) owner in a shared vault: nested creates + adopted case-variant", async () => {
    const proj = await seedFolder(vault, null, "Projects", "Projects", owner.userId);
    const alpha = await seedFolder(vault, proj, "alpha", "Projects/alpha", owner.userId);
    const { expectedTop } = await checkEquivalence(owner, [
      { id: proj, path: "Projects" },
      { id: alpha, path: "Projects/alpha" },
    ]);
    expect([...expectedTop.values()]).toEqual([true, true]);

    // Case-variant path adopts the existing row (canonical spelling echoed).
    const { body } = await post(owner, vault, [item("projects/Alpha")]);
    expect(body.results[0].status).toBe("adopted");
    expect(body.results[0].id).toBe(alpha);
    expect(body.results[0].path).toBe("Projects/alpha");
  });

  it("(a2) member in a shared vault", async () => {
    const proj = await seedFolder(vault, null, "Projects", "Projects", owner.userId);
    const sub = await seedFolder(vault, proj, "Sub", "Projects/Sub", owner.userId);
    await checkEquivalence(member, [
      { id: proj, path: "Projects" },
      { id: sub, path: "Projects/Sub" },
    ]);
  });

  it("(b) per-user denied share on one parent", async () => {
    const open = await seedFolder(vault, null, "Open", "Open", owner.userId);
    const closed = await seedFolder(vault, null, "Closed", "Closed", owner.userId);
    const inner = await seedFolder(vault, closed, "Inner", "Closed/Inner", owner.userId);
    await seedDeny(org, "folder", closed, member.userId);
    const { expectedTop } = await checkEquivalence(member, [
      { id: open, path: "Open" },
      { id: closed, path: "Closed" },
      { id: inner, path: "Closed/Inner" },
    ]);
    expect(expectedTop.get("Closed")).toBe(false);
    expect(expectedTop.get("Open")).toBe(true);
  });

  it("(c) org locked share on a parent folder", async () => {
    const free = await seedFolder(vault, null, "Free", "Free", owner.userId);
    const locked = await seedFolder(vault, null, "Locked", "Locked", owner.userId);
    const below = await seedFolder(vault, locked, "Below", "Locked/Below", owner.userId);
    await seedLock(org, "folder", locked, { type: "org" });
    const { expectedTop } = await checkEquivalence(member, [
      { id: free, path: "Free" },
      { id: locked, path: "Locked" },
      { id: below, path: "Locked/Below" },
    ]);
    expect(expectedTop.get("Locked")).toBe(false);
    await checkEquivalence(owner, [{ id: locked, path: "Locked" }]);
  });

  it("(d) per-user vault view row", async () => {
    const f = await seedFolder(vault, null, "F", "F", owner.userId);
    const g = await seedFolder(vault, f, "G", "F/G", owner.userId);
    await seedUserVaultGrant(org, member.userId, "view");
    const { expectedTop } = await checkEquivalence(member, [
      { id: f, path: "F" },
      { id: g, path: "F/G" },
    ]);
    expect([...expectedTop.values()]).toEqual([false, false]);
  });

  it("(e) sealed vault with an org edit grant lifting one folder", async () => {
    const lifted = await seedFolder(vault, null, "Lifted", "Lifted", owner.userId);
    const other = await seedFolder(vault, null, "Other", "Other", owner.userId);
    await sealVault(org);
    await seedShare(org, "folder", lifted, org, "edit").catch(async () => {
      await pool.query(
        `INSERT INTO shares (id, org_id, resource_type, resource_id, principal_type, principal_id, permission)
         VALUES (gen_random_uuid()::text, $1, 'folder', $2, 'org', $1, 'edit')`,
        [org, lifted],
      );
    });
    // seedShare writes a per-USER row for principal `org`, which grants nothing
    // to the member; make the org-wide row explicit.
    await pool.query(
      `INSERT INTO shares (id, org_id, resource_type, resource_id, principal_type, principal_id, permission)
       VALUES (gen_random_uuid()::text, $1, 'folder', $2, 'org', $1, 'edit')
       ON CONFLICT (resource_type, resource_id, principal_type, principal_id) DO NOTHING`,
      [org, lifted],
    );
    const { expectedTop } = await checkEquivalence(member, [
      { id: lifted, path: "Lifted" },
      { id: other, path: "Other" },
    ]);
    expect(expectedTop.get("Lifted")).toBe(true);
    expect(expectedTop.get("Other")).toBe(false);
  });

  it("(g) root frozen: new root folders refused, nested under existing allowed", async () => {
    const existing = await seedFolder(vault, null, "Existing", "Existing", owner.userId);
    await freezeVaultRoot(vault);
    const rootOk = await canCreateIn(owner.userId, vault, null, pool); // gate says nothing of the latch
    const { body } = await post(owner, vault, [item("Fresh"), item("Existing/Kid"), item("Existing/Kid/Deep")]);
    expect(rootOk).toBe(true);
    expect(body.results[0]).toMatchObject({ status: "error", code: "root_frozen" });
    expect(body.results[1].status).toBe("created");
    expect(body.results[2].status).toBe("created");
    await checkEquivalence(owner, [{ id: existing, path: "Existing" }]);
  });

  it("(h) member joined after content under a Private join default", async () => {
    const late = await signUp("late@fbp.test");
    const before = await seedFolder(vault, null, "Before", "Before", owner.userId);
    await pool.query(`UPDATE folders SET created_at = now() - interval '1 day' WHERE id = $1`, [before]);
    await seedMember(org, late.userId, "member");
    await pool.query(
      `INSERT INTO member_access_snapshots (organization_id, user_id, mode, access_revision, snapshot_at)
       VALUES ($1, $2, 'private', 0, now())
       ON CONFLICT (organization_id, user_id) DO UPDATE SET mode = 'private', snapshot_at = now()`,
      [org, late.userId],
    );
    const after = await seedFolder(vault, null, "After", "After", owner.userId);
    await checkEquivalence(late, [
      { id: before, path: "Before" },
      { id: after, path: "After" },
    ]);
    // Reference value for the report: the old gate's own answer for the pre-join folder.
    const answer = await canCreateIn(late.userId, vault, before, pool);
    console.log(`[folder-batch-preload] (h) late member may create under pre-join folder: ${answer}`);
  });

  it("query budget: 200 nested folders in one batch (owner, fresh vault)", async () => {
    const items: ReturnType<typeof item>[] = [];
    for (let t = 0; t < 20; t++) {
      let path = `top${t}`;
      items.push(item(path));
      for (let d = 1; d < 10; d++) {
        path += `/lvl${d}`;
        items.push(item(path));
      }
    }
    expect(items).toHaveLength(200);
    // Deepest-first to also exercise the server-side ordering.
    items.reverse();

    let poolQueries = 0;
    let clientQueries = 0;
    let folderInserts = 0;
    const isInsert = (a: unknown[]) => typeof a[0] === "string" && /^\s*INSERT INTO folders/i.test(a[0]);
    const origQuery = pool.query.bind(pool) as (...a: unknown[]) => unknown;
    const origConnect = pool.connect.bind(pool) as (...a: unknown[]) => Promise<any>;
    const wrapped: Array<{ client: any; query: unknown }> = [];
    (pool as any).query = (...a: unknown[]) => {
      poolQueries++;
      if (isInsert(a)) folderInserts++;
      return origQuery(...a);
    };
    (pool as any).connect = async (...a: unknown[]) => {
      const client = await origConnect(...a);
      if (client && typeof client.query === "function" && !wrapped.some((w) => w.client === client)) {
        const original = client.query;
        const q = original.bind(client);
        client.query = (...qa: unknown[]) => {
          clientQueries++;
          if (isInsert(qa)) folderInserts++;
          return q(...qa);
        };
        wrapped.push({ client, query: original });
      }
      return client;
    };
    let res;
    try {
      res = await post(owner, vault, items);
    } finally {
      delete (pool as any).query;
      delete (pool as any).connect;
      // Pooled clients outlive the test: put their own query back.
      for (const w of wrapped) w.client.query = w.query;
    }
    const total = poolQueries + clientQueries;
    console.log(
      `[folder-batch-preload] queries: pool=${poolQueries} client=${clientQueries} total=${total} folderInserts=${folderInserts}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.results.filter((r) => r.status === "created")).toHaveLength(200);
    // One INSERT per new folder is the write itself; everything else — the
    // permission reads that used to cost ~5 per folder — must stay constant.
    // Before the preload: ~1,100 total (5-6 per folder).
    expect(total - folderInserts).toBeLessThan(40);
  });
});

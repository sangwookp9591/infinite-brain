import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { recordingAppDeps } from "./helpers/app.js";
import { buildAccessContext, createResolverCache, effectivePermission, resolveAccessForUser } from "../src/permissions/resolver.js";
import { pool } from "../src/db/pool.js";
import { resetDb } from "./helpers/db.js";
import { authHeaders, createOrg, signUp, type TestUser } from "./helpers/auth.js";
import { seedMember, seedVault, seedFolder, seedVaultGrant, seedNote } from "./helpers/seed.js";
import {
  setAppearanceChangedPublisher,
  type AppearanceChangedFields,
} from "../src/sync/member-events.js";
import { decodePubsub, encodePubsubAppearanceChanged } from "../src/sync/vault-protocol.js";

/** GET/PUT /api/orgs/:orgId/appearance — vault-level appearance. */
const rec = recordingAppDeps();
const app = createApp(rec.deps);

let published: Array<{ vaultId: string; change: AppearanceChangedFields }> = [];

function get(caller: TestUser, orgId: string) {
  return app.request(`/api/orgs/${orgId}/appearance`, { headers: authHeaders(caller) });
}
function put(caller: TestUser, orgId: string, settings: unknown) {
  return app.request(`/api/orgs/${orgId}/appearance`, {
    method: "PUT",
    headers: { ...authHeaders(caller), "content-type": "application/json" },
    body: JSON.stringify({ settings }),
  });
}

async function setup() {
  const owner = await signUp("owner@appearance.test");
  const org = await createOrg(owner, "Look", `look-${Date.now()}`);
  const vaultId = await seedVault(org.id);
  const member = await signUp("member@appearance.test");
  await seedMember(org.id, member.userId, "member");
  const admin = await signUp("admin@appearance.test");
  await seedMember(org.id, admin.userId, "admin");
  return { owner, member, admin, orgId: org.id, vaultId };
}

describe("vault appearance", () => {
  beforeEach(async () => {
    await resetDb();
    rec.reset();
    published = [];
    setAppearanceChangedPublisher((vaultId, change) => published.push({ vaultId, change }));
  });
  afterEach(() => setAppearanceChangedPublisher(null));
  afterAll(async () => {
    await pool.end();
  });

  it("member GET with no row returns empty settings and nulls", async () => {
    const { member, orgId } = await setup();
    const res = await get(member, orgId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ settings: {}, updatedAt: null, updatedBy: null });
  });

  it("owner PUT round-trips and members read it back", async () => {
    const { owner, member, orgId } = await setup();
    const settings = { theme: "dark", contentWidth: 72, textSize: 16, lineNumbers: true };
    const res = await put(owner, orgId, settings);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: unknown; updatedAt: string; updatedBy: string };
    expect(body.settings).toEqual(settings);
    expect(body.updatedBy).toBe(owner.userId);
    expect(typeof body.updatedAt).toBe("string");
    expect(await (await get(member, orgId)).json()).toEqual(body);
  });

  it("admin may PUT; member gets 403 access_manager_required", async () => {
    const { admin, member, orgId } = await setup();
    expect((await put(admin, orgId, { autoColors: false })).status).toBe(200);
    const res = await put(member, orgId, { theme: "light" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "access_manager_required" });
    expect((await (await get(member, orgId)).json()) as { settings: unknown }).toMatchObject({
      settings: { autoColors: false },
    });
  });

  it("non-member gets 404 not_member on GET and PUT", async () => {
    const { orgId } = await setup();
    const outsider = await signUp("x@appearance.test");
    for (const res of [await get(outsider, orgId), await put(outsider, orgId, {})]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "not_member" });
    }
  });

  it("invalid key or value is 400 invalid_appearance and stores nothing", async () => {
    const { owner, orgId } = await setup();
    for (const bad of [{ font: "serif" }, { textSize: 30 }, { theme: "blue" }, { contentWidth: 900 }, { contentWidth: 59 }, { contentWidth: 80.5 }, "x", null]) {
      const res = await put(owner, orgId, bad);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_appearance" });
    }
    expect(await (await get(owner, orgId)).json()).toMatchObject({ settings: {}, updatedAt: null });
    expect(published).toEqual([]);
  });

  it("PUT replaces the whole object rather than merging", async () => {
    const { owner, orgId } = await setup();
    await put(owner, orgId, { theme: "dark", textSize: 18, contentWidth: "full" });
    await put(owner, orgId, { properties: "source" });
    expect(await (await get(owner, orgId)).json()).toMatchObject({ settings: { properties: "source" } });
    const res = await put(owner, orgId, {});
    expect(((await res.json()) as { settings: unknown }).settings).toEqual({});
  });

  it("PUT broadcasts appearance-changed to the vault's collections with settings inline", async () => {
    const { owner, orgId, vaultId } = await setup();
    const res = await put(owner, orgId, { theme: "light", lineNumbers: false });
    const body = (await res.json()) as { updatedAt: string };
    expect(published).toEqual([
      {
        vaultId,
        change: { orgId, settings: { theme: "light", lineNumbers: false }, updatedAt: body.updatedAt },
      },
    ]);
  });

  it("PATCH preserves unrelated appearance and concurrent pin toggles", async () => {
    const { owner, member, orgId, vaultId } = await setup();
    await seedNote(vaultId, null, "Home.html", owner.userId, "home");
    await put(owner, orgId, { theme: "dark" });
    const patch = (caller: TestUser, body: unknown) => app.request(`/api/orgs/${orgId}/appearance`, { method: "PATCH", headers: { ...authHeaders(caller), "content-type": "application/json" }, body: JSON.stringify(body) });
    const responses = await Promise.all([
      patch(owner, { togglePin: { kind: "note", docId: "first" } }),
      patch(owner, { togglePin: { kind: "note", docId: "second" } }),
      patch(owner, { settings: { homeDocId: "home" } }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    const saved = await (await get(owner, orgId)).json() as { settings: { pinnedItems: unknown[]; theme: string; homeDocId: string } };
    expect(saved.settings.theme).toBe("dark");
    expect(saved.settings.homeDocId).toBe("home");
    expect(saved.settings.pinnedItems).toHaveLength(2);
    expect(saved.settings.pinnedItems).toEqual(expect.arrayContaining([{ kind: "note", docId: "first" }, { kind: "note", docId: "second" }]));
    expect((await patch(member, { togglePin: { kind: "note", docId: "third" } })).status).toBe(403);
    expect((await patch(owner, { togglePin: { kind: "note", docId: "first" } })).status).toBe(200);
    expect((await (await get(owner, orgId)).json() as typeof saved).settings.pinnedItems).toEqual([{ kind: "note", docId: "second" }]);
  });

  it("folder moves atomically follow shared pins, including descendants and concurrent unpin", async () => {
    const { owner, orgId, vaultId } = await setup();
    await seedVaultGrant(orgId, "edit");
    const folderId = await seedFolder(vaultId, null, "Projects", "Projects");
    await seedFolder(vaultId, folderId, "Active", "Projects/Active");
    await put(owner, orgId, { theme: "dark", pinnedItems: [{ kind: "folder", path: "Projects" }, { kind: "folder", path: "Projects/Active" }, { kind: "note", docId: "stable-note" }] });
    const [pin, move] = await Promise.all([
      app.request(`/api/orgs/${orgId}/appearance`, { method: "PATCH", headers: { ...authHeaders(owner), "content-type": "application/json" }, body: JSON.stringify({ togglePin: { kind: "folder", path: "Projects" } }) }),
      app.request(`/api/folders/${folderId}`, { method: "PATCH", headers: { ...authHeaders(owner), "content-type": "application/json" }, body: JSON.stringify({ path: "Work" }) }),
    ]);
    expect(move.status).toBe(200);
    expect([200, 404]).toContain(pin.status);
    const saved = await (await get(owner, orgId)).json() as { settings: { pinnedItems: { kind: string; path?: string; docId?: string }[]; theme: string } };
    expect(saved.settings.theme).toBe("dark");
    expect(saved.settings.pinnedItems).toContainEqual({ kind: "folder", path: "Work/Active" });
    expect(saved.settings.pinnedItems).toContainEqual({ kind: "note", docId: "stable-note" });
    expect(saved.settings.pinnedItems.some((item) => item.path?.startsWith("Projects"))).toBe(false);
    expect(saved.settings.pinnedItems.some((item) => item.path === "Work")).toBe(pin.status === 404);
  });

  it("publishes shared Home with a view grant that preserves existing edit access and later sharing choices", async () => {
    const { owner, admin, member, orgId, vaultId } = await setup();
    await seedVaultGrant(orgId, "edit");
    const folder = await seedFolder(vaultId, null, "Dashboards", "Dashboards");
    const home = await seedNote(vaultId, folder, "Dashboards/Home.html", owner.userId);
    const patch = () => app.request(`/api/orgs/${orgId}/appearance`, {
      method: "PATCH", headers: { ...authHeaders(admin), "content-type": "application/json" },
      body: JSON.stringify({ settings: { homeDocId: home } }),
    });
    expect((await patch()).status).toBe(200);
    expect(await (await get(member, orgId)).json()).toMatchObject({ settings: { homeDocId: home } });
    expect((await pool.query("SELECT permission FROM shares WHERE resource_id = $1", [home])).rows)
      .toEqual([{ permission: "view" }]);
    expect(await effectivePermission(owner.userId, home)).toBe("edit");
    expect(await effectivePermission(admin.userId, home)).toBe("edit");
    expect(await effectivePermission(member.userId, home)).toBe("edit");
    const cache = createResolverCache();
    await cache.prefetch(pool, [home]);
    const context = await buildAccessContext("file", home);
    for (const [person, role] of [[owner, "owner"], [admin, "admin"], [member, "member"]] as const) {
      expect(await effectivePermission(person.userId, home, pool, cache)).toBe("edit");
      expect((await resolveAccessForUser(context!, person.userId, role)).permission).toBe("edit");
    }
    expect(rec.aclBroadcasts).toContain(vaultId);
    expect(rec.disconnected).toContainEqual({ vaultId, docId: home });
    expect(published.at(-1)?.change.settings).toEqual({ homeDocId: home });
    // Change access using the same control as a Markdown note. Setting Home
    // again must not undo the owner's explicit choice.
    const access = await app.request(`/api/orgs/${orgId}/access/bulk`, {
      method: "POST", headers: { ...authHeaders(owner), "content-type": "application/json" },
      body: JSON.stringify({ resources: [{ resourceType: "file", resourceId: home }], audience: { type: "org" }, mode: "open" }),
    });
    expect(access.status).toBe(200);
    expect((await patch()).status).toBe(200);
    expect((await pool.query("SELECT permission FROM shares WHERE resource_id = $1", [home])).rows)
      .toEqual([{ permission: "edit" }]);
  });

  it.each([
    ["file", "user"], ["folder", "user"], ["vault", "user"],
    ["file", "org"], ["folder", "org"],
  ] as const)("automatically shares only Home through a %s/%s restriction", async (resourceType, principalType) => {
    const { owner, admin, member, orgId, vaultId } = await setup();
    await seedVaultGrant(orgId, "edit");
    const folder = await seedFolder(vaultId, null, "Dashboards", "Dashboards");
    const home = await seedNote(vaultId, folder, "Dashboards/Home.html", owner.userId);
    const sibling = await seedNote(vaultId, folder, "Dashboards/Private.html", owner.userId);
    const resourceId = resourceType === "file" ? home : resourceType === "folder" ? folder : orgId;
    await pool.query(
      `INSERT INTO shares (id, org_id, resource_type, resource_id, principal_type, principal_id, permission)
       VALUES ('restriction', $1, $2, $3, $4, $5, 'denied')`,
      [orgId, resourceType, resourceId, principalType, principalType === "org" ? orgId : member.userId],
    );
    expect(await effectivePermission(member.userId, home)).toBe("none");
    const siblingBefore = await effectivePermission(member.userId, sibling);
    const outsider = await signUp("outsider@appearance.test");
    const response = await put(admin, orgId, { homeDocId: home });
    expect(response.status).toBe(200);
    expect(await effectivePermission(member.userId, home)).toBe("view");
    const cache = createResolverCache();
    await cache.prefetch(pool, [home, sibling]);
    expect(await effectivePermission(member.userId, home, pool, cache)).toBe("view");
    expect(await effectivePermission(member.userId, sibling, pool, cache)).toBe(siblingBefore);
    expect(await effectivePermission(outsider.userId, home)).toBe("none");
    expect((await pool.query(
      "SELECT permission FROM shares WHERE resource_type = 'file' AND resource_id = $1 AND principal_type = 'user' AND principal_id = $2",
      [home, member.userId],
    )).rows).toEqual([{ permission: "readonly" }]);
    // Only an explicit deny on this very file is replaced; inherited rules stay.
    if (resourceType !== "file" || principalType !== "user") {
      expect((await pool.query("SELECT permission FROM shares WHERE id = 'restriction'")).rows).toEqual([{ permission: "denied" }]);
    }
    expect(rec.aclBroadcasts).toContain(vaultId);
    expect(published.at(-1)?.change.settings.homeDocId).toBe(home);
    // Repeating the action is idempotent, and ordinary access management can
    // still restrict the file afterwards; publishing it again restores sharing.
    expect((await put(owner, orgId, { homeDocId: home })).status).toBe(200);
    expect((await pool.query(
      "SELECT count(*)::int AS count FROM shares WHERE resource_id = $1 AND principal_type = 'user' AND principal_id = $2", [home, member.userId],
    )).rows[0].count).toBe(1);
    await pool.query("UPDATE shares SET permission = 'denied' WHERE resource_type = 'file' AND resource_id = $1 AND principal_type = 'user' AND principal_id = $2", [home, member.userId]);
    expect(await effectivePermission(member.userId, home)).toBe("none");
    expect((await put(owner, orgId, { homeDocId: home })).status).toBe(200);
    expect(await effectivePermission(member.userId, home)).toBe("view");
  });

  it("allows a member to be granted edit access through the ordinary Access controls after Home is published", async () => {
    const { owner, admin, member, orgId, vaultId } = await setup();
    await seedVaultGrant(orgId, "view");
    const home = await seedNote(vaultId, null, "Home.html", owner.userId);
    expect((await put(owner, orgId, { homeDocId: home })).status).toBe(200);
    expect(await effectivePermission(member.userId, home)).toBe("view");
    const access = await app.request(`/api/orgs/${orgId}/access/bulk`, {
      method: "POST", headers: { ...authHeaders(owner), "content-type": "application/json" },
      body: JSON.stringify({ resources: [{ resourceType: "file", resourceId: home }],
        audience: { type: "users", userIds: [member.userId] }, mode: "open" }),
    });
    expect(access.status).toBe(200);
    expect(await effectivePermission(member.userId, home)).toBe("edit");
    expect(await effectivePermission(admin.userId, home)).toBe("view");
    expect((await put(owner, orgId, { homeDocId: home })).status).toBe(200);
    expect(await effectivePermission(member.userId, home)).toBe("edit");
  });

  it.each(["readonly", "locked"])("preserves an explicitly chosen %s file restriction when publishing Home", async (permission) => {
    const { owner, admin, member, orgId, vaultId } = await setup();
    await seedVaultGrant(orgId, "edit");
    const home = await seedNote(vaultId, null, "Home.html", owner.userId);
    await pool.query(
      `INSERT INTO shares (id, org_id, resource_type, resource_id, principal_type, principal_id, permission)
       VALUES ('explicit-lock', $1, 'file', $2, 'org', $1, $3)`, [orgId, home, permission],
    );
    expect((await put(owner, orgId, { homeDocId: home })).status).toBe(200);
    for (const person of [owner, admin, member]) expect(await effectivePermission(person.userId, home)).toBe("view");
    expect((await pool.query("SELECT permission FROM shares WHERE id = 'explicit-lock'")).rows).toEqual([{ permission }]);
  });

  it("keeps existing editors while giving an excluded member view-only Home access", async () => {
    const { owner, admin, member, orgId, vaultId } = await setup();
    await seedVaultGrant(orgId, "edit");
    const home = await seedNote(vaultId, null, "Home.html", owner.userId);
    await pool.query(
      `INSERT INTO shares (id, org_id, resource_type, resource_id, principal_type, principal_id, permission)
       VALUES ('excluded', $1, 'file', $2, 'user', $3, 'denied')`, [orgId, home, member.userId],
    );
    expect((await put(owner, orgId, { homeDocId: home })).status).toBe(200);
    expect(await effectivePermission(owner.userId, home)).toBe("edit");
    expect(await effectivePermission(admin.userId, home)).toBe("edit");
    expect(await effectivePermission(member.userId, home)).toBe("view");
    const rows = await pool.query("SELECT principal_id FROM shares WHERE resource_id = $1", [home]);
    expect(rows.rows).toEqual([{ principal_id: member.userId }]);
    const edit = await app.request(`/api/orgs/${orgId}/access/bulk`, {
      method: "POST", headers: { ...authHeaders(owner), "content-type": "application/json" },
      body: JSON.stringify({ resources: [{ resourceType: "file", resourceId: home }],
        audience: { type: "users", userIds: [member.userId] }, mode: "open" }),
    });
    expect(edit.status).toBe(200);
    expect(await effectivePermission(member.userId, home)).toBe("edit");
    expect((await put(owner, orgId, { homeDocId: home })).status).toBe(200);
    expect(await effectivePermission(member.userId, home)).toBe("edit");
  });

  it("rejects a Home reference outside the vault without publishing or changing access", async () => {
    const { owner, orgId } = await setup();
    expect((await put(owner, orgId, { homeDocId: "missing" })).status).toBe(404);
    expect(published).toEqual([]);
    expect((await pool.query("SELECT * FROM shares WHERE resource_id = 'missing'")).rows).toEqual([]);
  });

  it("the pubsub frame round-trips", () => {
    const change = { orgId: "o1", settings: { theme: "dark" }, updatedAt: "2026-10-07T00:00:00.000Z" };
    expect(decodePubsub(encodePubsubAppearanceChanged(change))).toEqual({
      type: "appearance-changed",
      change,
    });
  });
});

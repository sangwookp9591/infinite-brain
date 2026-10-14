// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
const mocks = vi.hoisted(() => ({ session: vi.fn(), role: vi.fn(), query: vi.fn(), connect: vi.fn(), txQuery: vi.fn(), release: vi.fn(), announce: vi.fn() }));
vi.mock("../http/session.js", () => ({ getSession: mocks.session }));
vi.mock("../permissions/lookup.js", () => ({ orgRole: mocks.role }));
vi.mock("../db/pool.js", () => ({ pool: { query: mocks.query, connect: mocks.connect } }));
vi.mock("../sync/member-events.js", () => ({ announceAppearanceChanged: mocks.announce }));
import { createAppearanceRoutes } from "../http/routes/appearance.js";
const app = new Hono().route("/api", createAppearanceRoutes());
const patch = (settings: unknown) => app.request("/api/orgs/vault/appearance", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId: "owner" });
  mocks.role.mockResolvedValue("owner");
  mocks.connect.mockResolvedValue({ query: mocks.txQuery, release: mocks.release });
  mocks.txQuery.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("SELECT path") ? [{ path: "Projects" }] : sql.includes("INSERT INTO") ? [{ settings: { theme: "dark", pinnedItems: [{ kind: "folder", path: "Projects" }] }, updated_by: "owner", updated_at: new Date("2026-01-01") }] : [] }));
  mocks.query.mockResolvedValue({ rows: [{ settings: { theme: "dark", homeDocId: "home-id" }, updated_by: "owner", updated_at: new Date("2026-01-01") }] });
});
describe("shared navigation appearance writes (no database)", () => {
  it("checks ordinary owner/admin authorization before writing", async () => {
    mocks.role.mockResolvedValue("member");
    expect((await patch({ homeDocId: "home-id" })).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.announce).not.toHaveBeenCalled();
  });
  it("refuses unauthenticated callers", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await patch({ homeDocId: "home-id" })).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("merges a patch into existing settings and announces authoritative settings", async () => {
    mocks.txQuery.mockImplementation(async (sql: string) => ({ rows:
      sql.includes("RETURNING access_revision") ? [{ access_revision: 1 }] :
      sql.includes("SELECT n.vault_id") ? [{ vault_id: "collection" }] :
      sql.includes("INSERT INTO vault_appearance") ? [{ settings: { theme: "dark", homeDocId: "home-id" }, updated_by: "owner", updated_at: new Date("2026-01-01") }] : [] }));
    expect((await patch({ homeDocId: "home-id" })).status).toBe(200);
    const write = mocks.txQuery.mock.calls.find(([sql]) => sql.includes("INSERT INTO vault_appearance"))!;
    expect(write[0]).toContain("vault_appearance.settings || EXCLUDED.settings");
    expect(write[1]).toEqual(["vault", JSON.stringify({ homeDocId: "home-id" }), "owner", true]);
    expect(mocks.announce).toHaveBeenCalledWith({ orgId: "vault", settings: { theme: "dark", homeDocId: "home-id" }, updatedAt: "2026-01-01T00:00:00.000Z" });
  });
  it("rejects invalid paths before touching persistence", async () => {
    expect((await patch({ pinnedItems: [{ kind: "folder", path: "../secret" }] })).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("atomically toggles pins without reading and replacing a stale whole list", async () => {
    const res = await app.request("/api/orgs/vault/appearance", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ togglePin: { kind: "folder", path: "projects" } }) });
    expect(res.status).toBe(200);
    const sql = mocks.txQuery.mock.calls.map(([query]) => query);
    expect(sql[0]).toBe("BEGIN");
    expect(sql[1]).toContain("FOR SHARE");
    expect(mocks.txQuery.mock.calls[2][1][1]).toBe(JSON.stringify({ kind: "folder", path: "Projects" }));
    expect(sql[2]).toContain("ON CONFLICT");
    expect(sql[3]).toBe("COMMIT");
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.announce).toHaveBeenCalledOnce();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("refuses a folder that moved before the pin request instead of saving the old path", async () => {
    mocks.txQuery.mockResolvedValue({ rows: [] });
    const res = await app.request("/api/orgs/vault/appearance", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ togglePin: { kind: "folder", path: "old" } }) });
    expect(res.status).toBe(404);
    expect(mocks.txQuery.mock.calls.map(([query]) => query)).toEqual(["BEGIN", expect.stringContaining("FOR SHARE"), "ROLLBACK"]);
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.announce).not.toHaveBeenCalled();
  });

});

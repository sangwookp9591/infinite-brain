// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
vi.mock("../trash/retention.js", () => ({ softDeleteSet: vi.fn() }));
import { moveFolder } from "./tree-ops.js";
function database(failFiles = false) {
  const query = vi.fn(async (sql: string) => {
    if (failFiles && sql.includes("UPDATE files")) throw new Error("write failed");
    return { rows: sql.includes("FROM folders WHERE id") ? [{ id: "folder", vault_id: "vault", parent_id: null, name: "Projects", path: "Projects" }] : [], rowCount: 0 };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { query, release, pool: { connect, query } };
}
describe("folder move transaction (no database)", () => {
  it("commits paths and shared pins together, with folders locked before appearance", async () => {
    const db = database();
    await moveFolder(db.pool as never, "folder", { name: "Work" });
    const queries = db.query.mock.calls.map(([sql]) => sql);
    expect(queries[0]).toBe("BEGIN");
    expect(queries[1]).toContain("FOR UPDATE");
    expect(queries.findIndex((sql) => sql.includes("UPDATE vault_appearance"))).toBeGreaterThan(queries.findIndex((sql) => sql.includes("UPDATE files")));
    expect(queries[queries.length - 1]).toBe("COMMIT");
    expect(db.release).toHaveBeenCalledOnce();
  });
  it("rolls back the whole move when any descendant write fails", async () => {
    const db = database(true);
    await expect(moveFolder(db.pool as never, "folder", { name: "Work" })).rejects.toThrow("write failed");
    const queries = db.query.mock.calls.map(([sql]) => sql);
    expect(queries[queries.length - 1]).toBe("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
    expect(queries.some((sql) => sql.includes("UPDATE vault_appearance"))).toBe(false);
    expect(db.release).toHaveBeenCalledOnce();
  });
});

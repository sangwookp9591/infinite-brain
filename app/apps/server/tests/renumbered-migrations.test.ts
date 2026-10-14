// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ensureMigrated, pool } from "./helpers/db.js";
import { runMigrations } from "../src/db/migrate.js";

it("reapplies renamed migrations over feature-branch schemas without losing data", async () => {
  await ensureMigrated();
  const oldNames = ["056_ai_change_ledger.sql", "056_mcp_scopes.sql"];
  const newNames = ["057_ai_change_ledger.sql", "058_mcp_scopes.sql"];
  await pool.query("DELETE FROM _migrations WHERE name = ANY($1::text[])", [newNames]);
  await pool.query("INSERT INTO _migrations(name) SELECT unnest($1::text[])", [oldNames]);
  try {
    expect(await runMigrations()).toEqual(newNames);
    expect(await runMigrations()).toEqual([]);
    for (const name of newNames) {
      await pool.query(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
    }
    const { rows } = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'mcp_tokens' AND column_name = 'scopes'");
    expect(rows).toHaveLength(1);
    expect((await pool.query("SELECT to_regclass('ai_change_ledger') AS ledger")).rows[0].ledger).toBe("ai_change_ledger");
  } finally {
    await pool.query("DELETE FROM _migrations WHERE name = ANY($1::text[])", [oldNames]);
  }
});

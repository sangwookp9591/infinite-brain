// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { expect, it } from "vitest";
import { config } from "../src/config.js";
import { runMigrations } from "../src/db/migrate.js";

it("upgrades 066 without backfilling people or modifying existing email/member/vault identity", async () => {
  // Create our own database, with a generated identifier, on the disposable test cluster.
  // No application pool/resetDb touches the test runner's configured database here.
  const name = `office_upgrade_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: config.databaseUrl });
  await admin.connect();
  let created = false;
  let db: pg.Client | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    const url = new URL(config.databaseUrl); url.pathname = `/${name}`;
    db = new pg.Client({ connectionString: url.href }); await db.connect();
    await db.query("CREATE TABLE _migrations(name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    const directory = new URL("../migrations/", import.meta.url);
    const files = (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort();
    expect(files.filter((f) => f.startsWith("067_"))).toEqual(["067_office_identity_pairing.sql"]);
    expect(new Set(files.map((f) => f.slice(0, 3))).size).toBe(files.length);
    for (const file of files.filter((f) => f < "067_")) {
      await db.query(await readFile(new URL(file, directory), "utf8"));
      await db.query("INSERT INTO _migrations(name) VALUES ($1)", [file]);
    }
    await db.query(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('existing-user','기존 동료','existing@example.com',true,now(),now());
      INSERT INTO organization(id,name,slug,"createdAt") VALUES ('existing-org','회사','existing-office',now());
      INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES ('existing-member','existing-org','existing-user','owner',now());
      INSERT INTO vaults(id,organization_id,name) VALUES ('different-vault-id','existing-org','자료')`);
    expect(await runMigrations(url.href)).toEqual(["067_office_identity_pairing.sql", "068_office_sas.sql", "069_office_sas_mismatch.sql", "070_office_device_sessions.sql"]);
    expect(await runMigrations(url.href)).toEqual([]);
    expect((await db.query("SELECT id,organization_id FROM vaults")).rows).toEqual([{ id: "different-vault-id", organization_id: "existing-org" }]);
    expect((await db.query('SELECT email FROM "user"')).rows).toEqual([{ email: "existing@example.com" }]);
    expect((await db.query("SELECT * FROM person_identity")).rowCount).toBe(0);
    expect((await db.query("SELECT * FROM person_device")).rowCount).toBe(0);
    expect((await db.query("SELECT is_nullable FROM information_schema.columns WHERE table_name='user' AND column_name='email'")).rows[0].is_nullable).toBe("NO");
  } finally {
    await db?.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});

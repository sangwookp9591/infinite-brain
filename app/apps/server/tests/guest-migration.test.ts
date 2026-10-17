// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { afterAll,expect,it } from "vitest";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
afterAll(()=>pool.end());
it("inserting a guest member writes no join snapshot and preserves existing team snapshots",async()=>{
 const f=await guestFixture();expect((await pool.query("SELECT 1 FROM member_access_snapshots WHERE organization_id=$1 AND user_id=$2",[f.org,f.guest.userId])).rowCount).toBe(0);expect((await pool.query("SELECT 1 FROM member_access_snapshots WHERE organization_id=$1 AND user_id=$2",[f.org,f.member.userId])).rowCount).toBe(1);
});
it("existing join codes receive 30 days and new codes 7 days; existing sharing defaults on",async()=>{
 await guestFixture();const client=await pool.connect();
 try{
  await client.query("BEGIN");await client.query("CREATE SCHEMA migration_defaults_test");await client.query("SET LOCAL search_path=migration_defaults_test,pg_catalog");
  await client.query('CREATE TABLE "user" (id TEXT PRIMARY KEY)');await client.query("CREATE TABLE org_join_codes (organization_id TEXT PRIMARY KEY,code TEXT)");
  await client.query("INSERT INTO org_join_codes VALUES ('old','OLDCODE1')");
  await client.query(await readFile(new URL("../migrations/063_join_code_lifecycle.sql",import.meta.url),"utf8"));
  await client.query("INSERT INTO org_join_codes (organization_id,code) VALUES ('new','NEWCODE1')");
  expect((await client.query("SELECT organization_id,extract(day FROM expires_at-now())::int AS days FROM org_join_codes ORDER BY organization_id")).rows).toEqual([{organization_id:"new",days:7},{organization_id:"old",days:30}]);
  await client.query("CREATE TABLE organization_access_settings (organization_id TEXT PRIMARY KEY)");await client.query("INSERT INTO organization_access_settings VALUES ('existing')");
  await client.query(await readFile(new URL("../migrations/065_external_sharing_policy.sql",import.meta.url),"utf8"));
  expect((await client.query("SELECT external_sharing,external_domains FROM organization_access_settings")).rows[0]).toEqual({external_sharing:"on",external_domains:[]});
 }finally{await client.query("ROLLBACK");client.release();}
});

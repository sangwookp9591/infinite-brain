// SPDX-License-Identifier: Apache-2.0
import { afterAll,beforeEach,expect,it } from "vitest";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { seedNote } from "./helpers/seed.js";
import { createApp } from "../src/http/app.js";
import { authHeaders } from "./helpers/auth.js";
import { recordingAppDeps } from "./helpers/app.js";
let f:Awaited<ReturnType<typeof guestFixture>>;const app=createApp(recordingAppDeps().deps);
beforeEach(async()=>{f=await guestFixture();});afterAll(()=>pool.end());
it("guest cannot mint a public link",async()=>{
 const own=await seedNote(f.vault,f.shared,"Clients/Acme/Shared/guest-public.md",f.guest.userId);
 for(const method of ["GET","POST","DELETE"])expect((await app.request(`/api/notes/${own}/public-link`,{method,headers:authHeaders(f.guest)})).status).toBe(403);
});
it("domains policy refuses anonymous links",async()=>{
 await pool.query("UPDATE organization_access_settings SET external_sharing='domains',external_domains=ARRAY['guest.test'] WHERE organization_id=$1",[f.org]);
 expect((await app.request(`/api/notes/${f.visible}/public-link`,{method:"POST",headers:authHeaders(f.owner)})).status).toBe(403);
});

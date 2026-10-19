// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { createApp } from "../src/http/app.js";
import { recordingAppDeps } from "./helpers/app.js";
import { authHeaders } from "./helpers/auth.js";
import { seedFile } from "./helpers/seed.js";
import { afterAll,beforeEach,expect,it } from "vitest";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { canReadAttachment,canWriteBlob,filterReadableBlobs } from "../src/permissions/http-gates.js";
let f:Awaited<ReturnType<typeof guestFixture>>;
beforeEach(async()=>{f=await guestFixture();await pool.query("INSERT INTO note_index (doc_id,vault_id,title,content) VALUES ($1,$2,'Visible','![image](attachments/shared.png)'),($3,$2,'Private','![image](attachments/private.png)')",[f.visible,f.vault,f.hidden]);});afterAll(()=>pool.end());
it("guest reads only attachments of shared notes",async()=>{
 expect(await canReadAttachment(f.guest.userId,f.vault,"attachments/shared.png")).toBe(true);
 expect(await canReadAttachment(f.guest.userId,f.vault,"attachments/private.png")).toBe(false);
 const rows=[{id:"visible",vault_id:f.vault,doc_id:null,rel_path:"attachments/shared.png"},{id:"private",vault_id:f.vault,doc_id:null,rel_path:"attachments/private.png"}];
 expect((await filterReadableBlobs(f.guest.userId,f.vault,rows)).map(r=>r.id)).toEqual(["visible"]);
});
it("orphan attachments are invisible to guest",async()=>{
 expect(await canReadAttachment(f.guest.userId,f.vault,"attachments/orphan.png")).toBe(false);
 expect(await canReadAttachment(f.guest.userId,f.vault,null)).toBe(false);
});
it("revoked guest is refused new download URLs",async()=>{
 await pool.query("DELETE FROM shares WHERE principal_id=$1",[f.guest.userId]);
 expect(await canReadAttachment(f.guest.userId,f.vault,"attachments/shared.png")).toBe(false);
});
it("guest writes attachments only through editable shared notes",async()=>{
 const row={vault_id:f.vault,doc_id:f.visible,rel_path:"attachments/new.png"};
 expect(await canWriteBlob(f.guest.userId,row)).toBe(true);
 expect(await canWriteBlob(f.guest.userId,{...row,doc_id:f.hidden})).toBe(false);
 expect(await canWriteBlob(f.guest.userId,{...row,doc_id:null})).toBe(false);
 await pool.query("UPDATE shares SET permission='view' WHERE principal_id=$1",[f.guest.userId]);
 expect(await canWriteBlob(f.guest.userId,row)).toBe(false);
});

it("delete conflict lists only readable referrers for guest",async()=>{
 const id=randomUUID();await pool.query(`INSERT INTO blobs (id,vault_id,org_id,sha256,size,mime,rel_path,filename,storage_provider,status,data,created_by) VALUES ($1,$2,$3,$4,3,'image/png','attachments/shared.png','shared.png','postgres','ready',decode('000102','hex'),$5)`,[id,f.vault,f.org,"a".repeat(64),f.guest.userId]);
 for(const doc of [f.visible,f.hidden])await pool.query("INSERT INTO blob_refs (vault_id,rel_path,doc_id) VALUES ($1,'attachments/shared.png',$2)",[f.vault,doc]);
 const response=await createApp(recordingAppDeps().deps).request(`/api/blobs/${id}`,{method:"DELETE",headers:authHeaders(f.guest)});
 expect(response.status).toBe(409);expect((await response.json() as any).referencedBy).toEqual([f.visible]);
});
it("attachment references cannot bypass a tree file lock",async()=>{
 const file=await seedFile(f.vault,f.shared,"Clients/Acme/Shared/locked.png",f.member.userId);
 await pool.query("INSERT INTO shares (id,org_id,resource_type,resource_id,principal_type,principal_id,permission) VALUES ($1,$2,'file',$3,'org',$2,'locked')",[randomUUID(),f.org,file]);
 expect(await canWriteBlob(f.guest.userId,{vault_id:f.vault,doc_id:file,rel_path:"attachments/shared.png"})).toBe(false);
});
it("revoked guest cannot issue a new attachment download URL",async()=>{
 const id=randomUUID();await pool.query(`INSERT INTO blobs (id,vault_id,org_id,sha256,size,mime,rel_path,filename,storage_provider,status,data,created_by) VALUES ($1,$2,$3,$4,3,'image/png','attachments/shared.png','shared.png','postgres','ready',decode('000102','hex'),$5)`,[id,f.vault,f.org,"b".repeat(64),f.guest.userId]);
 await pool.query("DELETE FROM shares WHERE principal_id=$1",[f.guest.userId]);expect((await createApp(recordingAppDeps().deps).request(`/api/blobs/${id}/url`,{headers:authHeaders(f.guest)})).status).toBe(403);
});

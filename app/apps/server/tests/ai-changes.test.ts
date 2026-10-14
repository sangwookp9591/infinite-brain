// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "@hocuspocus/server";
import { createSyncServer } from "../src/sync/hocuspocus.js";
import { purgeExpiredTrash } from "../src/trash/service.js";
import { formatDocName } from "../src/sync/doc-name.js";
import { createApp } from "../src/http/app.js";
import { pool } from "../src/db/pool.js";
import { createDocWriter } from "../src/mcp/doc-writer.js";
import type { SyncContext } from "../src/sync/hocuspocus.js";
import { createMcpToken } from "../src/mcp/tokens.js";
import { recordAiChange } from "../src/ai-changes/store.js";
import { resetDb } from "./helpers/db.js";
import { testAppDeps } from "./helpers/app.js";
import { authHeaders, signUp, type TestUser } from "./helpers/auth.js";
import { seedMember, seedNote, seedOrg, seedShare, seedVault, seedVaultGrant, seedFolder } from "./helpers/seed.js";

const writer = createDocWriter({ hocuspocus: { documents: new Map() } } as unknown as Server<SyncContext>);
const app = createApp(testAppDeps({ docWriter: writer }));
let owner: TestUser, outsider: TestUser, vault: string, org: string, doc: string, token: string, connectionId: string;
async function req(path: string, body?: unknown, user = owner) {
  return app.request(`/api${path}`, { method: body === undefined ? "GET" : "POST",
    headers: authHeaders(user), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function call(name: string, args: Record<string, unknown>) {
  const response = await app.request("/api/mcp", { method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const body = await response.json() as any;
  expect(body.result?.isError, JSON.stringify(body)).not.toBe(true);
  return body.result.structuredContent;
}
async function rows() { return (await (await req(`/vaults/${vault}/ai-changes`)).json() as any).items; }
async function latest() { return (await rows())[0]; }
async function undo(id: string) { return req(`/ai-changes/${id}/revert`, {}); }

beforeEach(async () => {
  await resetDb();
  owner = await signUp("owner-ledger@example.test");
  outsider = await signUp("other-ledger@example.test");
  org = await seedOrg("Ledger", "ledger");
  await seedMember(org, owner.userId, "owner");
  await seedMember(org, outsider.userId, "member");
  vault = await seedVault(org);
  await seedVaultGrant(org, "edit");
  doc = await seedNote(vault, null, "note.md", owner.userId);
  await writer.setContent(vault, doc, "before 😀");
  const minted = await createMcpToken({ userId: owner.userId, organizationId: org }, "Claude synthetic");
  token = minted.token; connectionId = minted.row.id;
});
afterAll(async () => { await pool.end(); });

describe("AI change ledger", () => {
  it("records MCP update attribution and snapshots, reverts through CRDT, and is idempotent", async () => {
    await call("update_note", { docId: doc, content: "after 😀" });
    const row = await latest();
    expect(row).toMatchObject({ op: "update", connection_id: connectionId, connection_label: "Claude synthetic", actor_user_id: owner.userId });
    expect(row.before_text).toBeUndefined();
    const detail = await (await req(`/ai-changes/${row.id}`)).json() as any;
    expect(detail).toMatchObject({ before_text: "before 😀", after_text: "after 😀" });
    expect((await undo(row.id)).status).toBe(200);
    expect(await writer.readContent(vault, doc)).toBe("before 😀");
    expect(await (await undo(row.id)).json()).toMatchObject({ status: "already_reverted" });
    expect((await rows())).toHaveLength(1);
  });
  it("returns 409 with a diff and preserves an intervening human edit", async () => {
    await call("update_note", { docId: doc, content: "AI" });
    const row = await latest();
    await writer.setContent(vault, doc, "human");
    const result = await undo(row.id);
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "conflict", diff: { expected: "AI", current: "human", before: "before 😀" } });
    expect(await writer.readContent(vault, doc)).toBe("human");
    expect((await latest()).reverted_at).toBeNull();
  });
  it("serializes duplicate reverts and rejects a stale earlier entry", async () => {
    await call("update_note", { docId: doc, content: "one" });
    const first = await latest();
    await call("update_note", { docId: doc, content: "two" });
    const second = await latest();
    expect((await undo(first.id)).status).toBe(409);
    expect((await Promise.all([undo(second.id), undo(second.id)])).map(r => r.status)).toEqual([200, 200]);
    expect(await writer.readContent(vault, doc)).toBe("one");
  });
  it("soft-deletes a created note and restores a deleted note with its stable id", async () => {
    const made = await call("create_note", { vaultId: vault, relPath: "made.md", content: "new" });
    const creation = await latest();
    expect(creation.op).toBe("create");
    expect((await undo(creation.id)).status).toBe(200);
    expect((await pool.query("SELECT deleted_at FROM notes WHERE id=$1", [made.docId])).rows[0].deleted_at).not.toBeNull();
    await call("delete_note", { docId: doc });
    const deletion = await latest();
    expect(deletion.op).toBe("delete");
    expect((await undo(deletion.id)).status).toBe(200);
    expect((await pool.query("SELECT deleted_at FROM notes WHERE id=$1", [doc])).rows[0].deleted_at).toBeNull();
    expect(await writer.readContent(vault, doc)).toBe("before 😀");
  });
  it("records empty creates, append, edit and move; reverses path and title", async () => {
    await call("create_note", { vaultId: vault, relPath: "empty.md" });
    expect((await latest()).op).toBe("create");
    await call("append_note", { docId: doc, text: " tail", idempotencyKey: "once" });
    await call("append_note", { docId: doc, text: " tail", idempotencyKey: "once" });
    expect((await rows()).filter((r: any) => r.op === "append")).toHaveLength(1);
    await call("edit_note", { docId: doc, edits: [{ type: "replace", find: "tail", replace: "end" }] });
    expect((await latest()).op).toBe("edit");
    await call("move_note", { docId: doc, relPath: "renamed.md", title: "Renamed" });
    const move = await latest();
    expect(move).toMatchObject({ op: "move", before_path: "note.md", after_path: "renamed.md" });
    expect((await undo(move.id)).status).toBe(200);
    expect((await pool.query("SELECT rel_path, title FROM notes WHERE id=$1", [doc])).rows[0]).toEqual({ rel_path: "note.md", title: "note.md" });
  });
  it("does not expose restricted history or allow a viewer to revert", async () => {
    await call("update_note", { docId: doc, content: "private" });
    const row = await latest();
    await seedShare(org, "file", doc, outsider.userId, "view");
    await pool.query("UPDATE shares SET permission = 'denied' WHERE principal_id=$1", [outsider.userId]);
    const listing = await req(`/vaults/${vault}/ai-changes`, undefined, outsider);
    expect((await listing.json() as any).items).toEqual([]);
    expect((await req(`/ai-changes/${row.id}`, undefined, outsider)).status).toBe(404);
    expect((await req(`/ai-changes/${row.id}/revert`, {}, outsider)).status).toBe(404);
    await pool.query("DELETE FROM shares WHERE principal_id=$1", [outsider.userId]);
    await seedShare(org, "file", doc, outsider.userId, "view");
    await pool.query("UPDATE shares SET permission = 'view' WHERE principal_type = 'org'");
    expect((await req(`/ai-changes/${row.id}/revert`, {}, outsider)).status).toBe(403);
  });
  it("batch undoes a connection newest first and reports conflicts individually", async () => {
    await call("append_note", { docId: doc, text: "1" });
    await call("append_note", { docId: doc, text: "2" });
    const result = await req(`/vaults/${vault}/ai-changes/revert-batch`, { connectionId, since: new Date(Date.now()-3600000).toISOString() });
    const body = await result.json() as any;
    expect(result.status).toBe(200);
    expect(body.results.map((r: any) => r.status)).toEqual(["reverted", "reverted"]);
    expect(await writer.readContent(vault, doc)).toBe("before 😀");
    await call("append_note", { docId: doc, text: "AI" });
    await writer.setContent(vault, doc, "human");
    const conflict = await req(`/vaults/${vault}/ai-changes/revert-batch`, { connectionId, since: new Date(Date.now()-3600000).toISOString() });
    expect((await conflict.json() as any).results[0]).toMatchObject({ status: "failed", httpStatus: 409, diff: { current: "human" } });
  });
  it("bounds UTF-8 snapshots and refuses undo when a body was omitted", async () => {
    await recordAiChange(vault, doc, { auth: { userId: owner.userId, organizationId: org,
      connection: { kind: "oauth", id: "oauth-client", label: "ChatGPT" } }, op: "update", beforePath: "note.md", afterPath: "note.md" }, "가".repeat(350000), "after");
    const row = await latest();
    const detail = await (await req(`/ai-changes/${row.id}`)).json() as any;
    expect(detail.before_text).toBeNull();
    expect(detail.connection_kind).toBe("oauth");
    expect((await undo(row.id)).status).toBe(413);
  });
  it("adopted creates record their real tool and undo content without deleting the existing note", async () => {
    await writer.setContent(vault, doc, "");
    await call("create_note", { vaultId: vault, relPath: "note.md", content: "seeded" });
    const row = await latest();
    expect(row).toMatchObject({ op: "update", tool: "create_note" });
    expect((await undo(row.id)).status).toBe(200);
    expect(await writer.readContent(vault, doc)).toBe("");
    expect((await pool.query("SELECT deleted_at FROM notes WHERE id=$1", [doc])).rows[0].deleted_at).toBeNull();
    await call("create_note", { vaultId: vault, relPath: "note.md", content: "new" });
    await call("create_note", { vaultId: vault, relPath: "note.md", content: "ignored" });
    expect(await rows()).toHaveLength(2);
    expect(await writer.readContent(vault, doc)).toBe("new");
  });
  it("refuses to undo moves or deletes after another structural or trash-content edit", async () => {
    await call("move_note", { docId: doc, relPath: "ai-move.md" });
    const moved = await latest();
    await pool.query("UPDATE notes SET rel_path='human-move.md' WHERE id=$1", [doc]);
    expect((await undo(moved.id)).status).toBe(409);
    expect((await pool.query("SELECT rel_path FROM notes WHERE id=$1", [doc])).rows[0].rel_path).toBe("human-move.md");
    await call("delete_note", { docId: doc });
    const deleted = await latest();
    await writer.setContent(vault, doc, "offline human contribution");
    expect((await undo(deleted.id)).status).toBe(409);
    expect((await pool.query("SELECT deleted_at FROM notes WHERE id=$1", [doc])).rows[0].deleted_at).not.toBeNull();
  });
  it("respects the frozen root when undo would move back out of a folder", async () => {
    await seedFolder(vault, null, "Folder", "Folder", owner.userId);
    await call("move_note", { docId: doc, relPath: "Folder/note.md" });
    const moved = await latest();
    await pool.query("UPDATE vaults SET root_frozen=true WHERE id=$1", [vault]);
    expect((await undo(moved.id)).status).toBe(403);
    expect((await pool.query("SELECT rel_path FROM notes WHERE id=$1", [doc])).rows[0].rel_path).toBe("Folder/note.md");
  });
  it("permanently removes ledger plaintext with a purged trash note", async () => {
    await call("delete_note", { docId: doc });
    expect(await rows()).toHaveLength(1);
    await purgeExpiredTrash(new Date(Date.now()+40*86400000));
    expect((await pool.query("SELECT id FROM ai_change_ledger WHERE doc_id=$1", [doc])).rows).toEqual([]);
  });
  it("filters before the visible limit across multiple scan pages", async () => {
    await call("update_note", { docId: doc, content: "visible" });
    const hidden = await seedNote(vault, null, "secret.md", owner.userId);
    await seedShare(org, "file", hidden, outsider.userId, "view");
    await pool.query("UPDATE shares SET permission='denied' WHERE resource_id=$1 AND principal_id=$2", [hidden, outsider.userId]);
    const template = await latest();
    await pool.query(`INSERT INTO ai_change_ledger
      (id,org_id,vault_id,doc_id,actor_user_id,connection_kind,connection_id,connection_label,tool,op,
       before_text_hash,after_text_hash,before_path,after_path,diff_summary,created_at)
      SELECT 'hidden-' || n,org_id,vault_id,$2,actor_user_id,connection_kind,connection_id,connection_label,tool,op,
       before_text_hash,after_text_hash,'secret.md','secret.md',diff_summary,clock_timestamp()
      FROM ai_change_ledger CROSS JOIN generate_series(1,205) n WHERE id=$1`, [template.id, hidden]);
    const listing = await req(`/vaults/${vault}/ai-changes?limit=1`, undefined, outsider);
    expect((await listing.json() as any).items.map((i: any) => i.doc_id)).toEqual([doc]);
    const filtered = await req(`/vaults/${vault}/ai-changes?doc=${doc}&connection=${connectionId}`);
    expect((await filtered.json() as any).items).toHaveLength(1);
  });
  it("commits a live MCP update once with the real Hocuspocus onChange hook", async () => {
    const server = createSyncServer(0);
    const direct = await server.hocuspocus.openDirectConnection(formatDocName(vault, doc));
    try {
      const liveWriter = createDocWriter(server);
      const countBefore = Number((await pool.query("SELECT count(*) FROM doc_updates WHERE doc_id=$1", [doc])).rows[0].count);
      await liveWriter.editContent(vault, doc, current => [{ index: current.length, deleteLength: 0, insert: " live" }], {
        userId: owner.userId,
        aiChange: { auth: { userId: owner.userId, organizationId: org,
          connection: { kind: "token", id: connectionId, label: "Claude synthetic" } },
          op: "append", beforePath: "note.md", afterPath: "note.md" },
      });
      expect(Number((await pool.query("SELECT count(*) FROM doc_updates WHERE doc_id=$1", [doc])).rows[0].count)).toBe(countBefore + 1);
      expect((await latest()).op).toBe("append");
      const detail = await (await req(`/ai-changes/${(await latest()).id}`)).json() as any;
      expect(detail.after_text).toBe("before 😀 live");
    } finally {
      await direct.disconnect();
      await server.destroy();
      createDocWriter({ hocuspocus: { documents: new Map() } } as unknown as Server<SyncContext>);
    }
  });
  it("rolls back detached CRDT persistence when the ledger insert fails", async () => {
    await expect(writer.editContent(vault, doc, current => [{ index: current.length, deleteLength: 0, insert: " failed" }], {
      userId: owner.userId,
      aiChange: { auth: { userId: owner.userId, organizationId: "missing-org",
        connection: { kind: "token", id: connectionId, label: "Claude synthetic" } },
        op: "append", beforePath: "note.md", afterPath: "note.md" },
    })).rejects.toThrow();
    expect(await writer.readContent(vault, doc)).toBe("before 😀");
    expect(await rows()).toEqual([]);
  });
  it("records nothing for stale writes and rejects malformed query or batch input", async () => {
    const result = await app.request("/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "update_note", arguments: { docId: doc, content: "bad", expectedRevision: "stale" } } }) });
    expect((await result.json() as any).result.isError).toBe(true);
    expect(await rows()).toEqual([]);
    expect((await req(`/vaults/${vault}/ai-changes?limit=-1`)).status).toBe(400);
    expect((await req(`/vaults/${vault}/ai-changes/revert-batch`, { connectionId, since: "bad" })).status).toBe(400);
  });
});

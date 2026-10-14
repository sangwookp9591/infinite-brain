// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { authPool } from "../src/auth/auth.js";
import { config } from "../src/config.js";
import { pool } from "../src/db/pool.js";
import { createMcpToken } from "../src/mcp/tokens.js";
import { MCP_SCOPES, effectiveScopes } from "../src/mcp/scopes.js";
import { testAppDeps } from "./helpers/app.js";
import { resetDb } from "./helpers/db.js";
import { createOrg, signUp, type TestUser } from "./helpers/auth.js";
import { seedMember, seedOrg } from "./helpers/seed.js";

const app = createApp(testAppDeps());
let user: TestUser;
let org: string;
const request = (path: string, init?: RequestInit) => app.fetch(new Request(`${config.betterAuthUrl}${path}`, init));
const sessionHeaders = () => ({ authorization: `Bearer ${user.token}`, "content-type": "application/json" });
const rpc = (token: string, method = "tools/list", params?: unknown, query = false) => request(`/api/mcp${query ? `?key=${encodeURIComponent(token)}` : ""}`, {
  method: "POST", headers: { "content-type": "application/json", ...(query ? {} : { authorization: `Bearer ${token}` }) },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
});
const names = async (token: string) => {
  const res = await rpc(token);
  expect(res.status).toBe(200);
  const body = await res.json() as { result: { tools: { name: string }[] } };
  return body.result.tools.map((tool) => tool.name);
};
const consent = (code: string, clientId: string, preset = "write", extra: Record<string, string> = {}) => request("/oauth/consent", {
  method: "POST", headers: { authorization: `Bearer ${user.token}`, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ consent_code: code, client_id: clientId, organization_id: org, decision: "allow", scope_preset: preset, ...extra }),
});

async function begin(scope = MCP_SCOPES.join(" ")) {
  const registered = await request("/api/auth/mcp/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Test Claude", redirect_uris: ["http://127.0.0.1:54321/callback"], token_endpoint_auth_method: "none" }),
  });
  expect(registered.status).toBeLessThan(300);
  const { client_id: clientId } = await registered.json() as { client_id: string };
  const verifier = "m1-test-pkce-verifier-that-is-at-least-forty-three-characters";
  const params = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: "http://127.0.0.1:54321/callback",
    scope: `openid offline_access ${scope}`, prompt: "consent", state: "state-preserved", code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), resource: `${config.betterAuthUrl}/api/mcp` });
  const authorization = await request(`/api/auth/mcp/authorize?${params}`, { headers: { authorization: `Bearer ${user.token}` } });
  expect(authorization.status).toBe(302);
  const location = new URL(authorization.headers.get("location")!);
  expect(location.pathname).toBe("/oauth/consent");
  return { clientId, verifier, code: location.searchParams.get("consent_code")! };
}

async function exchange(clientId: string, verifier: string, code: string) {
  return request("/api/auth/mcp/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, grant_type: "authorization_code", redirect_uri: "http://127.0.0.1:54321/callback", code, code_verifier: verifier }),
  });
}

async function connect(preset = "write", manage = false) {
  const started = await begin();
  const approved = await consent(started.code, started.clientId, preset, manage ? { [`manage_${org}`]: "yes" } : {});
  expect(approved.status).toBe(302);
  const callback = new URL(approved.headers.get("location")!);
  expect(callback.searchParams.get("iss")).toBe(config.betterAuthUrl);
  expect(callback.searchParams.get("state")).toBe("state-preserved");
  const exchanged = await exchange(started.clientId, started.verifier, callback.searchParams.get("code")!);
  expect(exchanged.status).toBe(200);
  const body = await exchanged.json() as { access_token: string; refresh_token: string; scope: string };
  return { ...body, clientId: started.clientId };
}

describe("MCP connection scopes", () => {
  beforeEach(async () => {
    await resetDb();
    user = await signUp(`scope-${randomUUID()}@test.example`);
    org = (await createOrg(user, "M1 vault", `m1-${randomUUID()}`)).id;
  });
  afterAll(async () => { await pool.end(); await authPool.end(); });

  it("restricts read-only minted tokens in both discovery and calls", async () => {
    const { token } = await createMcpToken({ userId: user.userId, organizationId: org, scopes: ["notes:read"] }, "read-only");
    expect(await names(token)).toContain("read_note");
    expect(await names(token)).not.toContain("update_note");
    const response = await rpc(token, "tools/call", { name: "update_note", arguments: { docId: "missing", content: "forbidden" } });
    expect(await response.json()).toMatchObject({ result: { isError: true, structuredContent: { code: "insufficient_scope" } } });
  });

  it("read+write permits content writes, excludes moves/deletes and access management", async () => {
    const { token } = await createMcpToken({ userId: user.userId, organizationId: org, scopes: ["notes:read", "notes:write"] }, "write");
    const available = await names(token);
    expect(available).toEqual(expect.arrayContaining(["update_note", "append_note", "edit_note", "create_note"]));
    for (const name of ["delete_note", "delete_file", "move_note", "move_folder", "move_file", "manage_access", "set_access_default"]) expect(available).not.toContain(name);
    expect(await (await rpc(token, "tools/call", { name: "move_note" })).json()).toMatchObject({ result: { isError: true, structuredContent: { code: "insufficient_scope" } } });
  });

  it("legacy default tokens retain full access and query-token compatibility", async () => {
    const { token } = await createMcpToken({ userId: user.userId, organizationId: org }, "legacy");
    expect(await names(token)).toEqual(expect.arrayContaining(["update_note", "delete_note", "move_note", "manage_access"]));
    expect((await rpc(token, "tools/list", undefined, true)).status).toBe(200);
    expect(effectiveScopes("openid profile offline_access")).toEqual([...MCP_SCOPES]);
    expect(effectiveScopes(["notes:unknown"])).toEqual([]);
  });

  it("saves approved OAuth scopes in consent and token, filters calls and stamps activity", async () => {
    const linked = await connect("read");
    expect(linked.scope.split(" ")).toContain("notes:read");
    expect(linked.scope).not.toContain("notes:write");
    const { rows } = await pool.query('SELECT scopes FROM "oauthConsent" WHERE "clientId" = $1 AND "userId" = $2', [linked.clientId, user.userId]);
    expect(rows[0].scopes).toBe(linked.scope);
    expect(await names(linked.access_token)).not.toContain("update_note");
    expect(await (await rpc(linked.access_token, "tools/call", { name: "update_note" })).json()).toMatchObject({ result: { isError: true, structuredContent: { code: "insufficient_scope" } } });
    const list = await request("/api/mcp/connections", { headers: sessionHeaders() });
    expect(await list.json()).toMatchObject({ connections: [{ kind: "oauth", name: "Test Claude", scopes: ["notes:read"], lastUsedAt: expect.any(String), useCount: 1 }] });
  });

  it("defaults branded consent to read+write with access:manage off", async () => {
    const linked = await connect();
    expect(await names(linked.access_token)).toContain("update_note");
    expect(await names(linked.access_token)).not.toContain("delete_note");
    expect(linked.scope).not.toContain("access:manage");
  });

  it("allows explicit access:manage only for owners/admins", async () => {
    const linked = await connect("write", true);
    expect(await names(linked.access_token)).toContain("manage_access");
    await pool.query('UPDATE member SET role = $1 WHERE "userId" = $2', ["member", user.userId]);
    const started = await begin();
    const page = await request(`/oauth/consent?client_id=${started.clientId}&consent_code=${started.code}`, { headers: sessionHeaders() });
    expect(await page.text()).not.toContain('type="checkbox"');
    expect((await consent(started.code, started.clientId, "write", { [`manage_${org}`]: "yes" })).status).toBe(400);
    const token = await request("/api/mcp/tokens", { method: "POST", headers: sessionHeaders(), body: JSON.stringify({ scopes: ["notes:read", "access:manage"] }) });
    expect(token.status).toBe(403);
  });

  it("unifies OAuth and token rows; disconnect removes consent/access/refresh and next calls return 401", async () => {
    const linked = await connect("read");
    const minted = await createMcpToken({ userId: user.userId, organizationId: org }, "CLI");
    const listed = await request("/api/mcp/connections", { headers: sessionHeaders() });
    expect((await listed.json() as { connections: unknown[] }).connections).toHaveLength(2);
    for (const [kind, id, token] of [["oauth", linked.clientId, linked.access_token], ["token", minted.row.id, minted.token]]) {
      const disconnected = await request(`/api/mcp/connections/${kind}/${id}`, { method: "DELETE", headers: sessionHeaders() });
      expect(disconnected.status).toBe(200);
      expect((await rpc(token)).status).toBe(401);
    }
    expect((await pool.query('SELECT * FROM "oauthConsent" WHERE "clientId" = $1', [linked.clientId])).rows).toEqual([]);
    const refreshed = await request("/api/auth/mcp/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: linked.clientId, grant_type: "refresh_token", refresh_token: linked.refresh_token }) });
    expect(refreshed.status).toBe(401);
  });

  it("disconnect invalidates approved codes that have not yet been exchanged", async () => {
    const started = await begin();
    const approved = await consent(started.code, started.clientId, "read");
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const revoked = await request(`/api/mcp/connections/oauth/${started.clientId}`, { method: "DELETE", headers: sessionHeaders() });
    expect(revoked.status).toBe(200);
    expect((await exchange(started.clientId, started.verifier, code)).status).not.toBe(200);
  });

  it("does not revive a scoped token through the legacy sole-vault fallback", async () => {
    const linked = await connect("read");
    await pool.query("DELETE FROM mcp_oauth_vault WHERE client_id = $1 AND user_id = $2", [linked.clientId, user.userId]);
    expect((await rpc(linked.access_token)).status).toBe(401);
  });

  it("lists and revokes legacy OAuth grants even before their first MCP request", async () => {
    const started = await begin();
    const token = `legacy-${randomUUID()}`;
    await pool.query(`INSERT INTO "oauthAccessToken" (id, "clientId", "userId", "accessToken", "refreshToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", scopes)
      VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour', now() + interval '1 day', 'openid offline_access')`,
      [randomUUID(), started.clientId, user.userId, token, randomUUID()]);
    const listed = await request("/api/mcp/connections", { headers: sessionHeaders() });
    expect(await listed.json()).toMatchObject({ connections: [{ kind: "oauth", scopes: [...MCP_SCOPES] }] });
    expect(await names(token)).toEqual(expect.arrayContaining(["update_note", "delete_note", "manage_access"]));
    expect((await request(`/api/mcp/connections/oauth/${started.clientId}`, { method: "DELETE", headers: sessionHeaders() })).status).toBe(200);
    expect((await rpc(token)).status).toBe(401);
  });

  it("shows owner/admin management opt-in unchecked and rejects invalid token scopes", async () => {
    const started = await begin();
    const page = await request(`/oauth/consent?client_id=${started.clientId}&consent_code=${started.code}`, { headers: sessionHeaders() });
    const html = await page.text();
    expect(html).toContain(`name="manage_${org}" value="yes" />`);
    expect(html).toContain('name="scope_preset" value="write" checked');
    for (const scopes of [[], ["unknown"], "notes:read"]) {
      expect((await request("/api/mcp/tokens", { method: "POST", headers: sessionHeaders(), body: JSON.stringify({ scopes }) })).status).toBe(400);
    }
  });

  it("rejects invalid/foreign consent before changing the vault binding and preserves PKCE", async () => {
    const started = await begin();
    expect((await consent(started.code, "wrong-client", "delete")).status).toBe(400);
    const approved = await consent(started.code, started.clientId, "read");
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    expect((await exchange(started.clientId, "wrong-verifier", code)).status).not.toBe(200);
  });

  it("cannot expand a client's explicit requested scope", async () => {
    const started = await begin("notes:read");
    const page = await request(`/oauth/consent?client_id=${started.clientId}&consent_code=${started.code}`, { headers: sessionHeaders() });
    expect(await page.text()).toContain('value="write"  disabled');
    expect((await consent(started.code, started.clientId, "delete")).status).toBe(400);
  });

  it("rejects a wrong resource at authorize and token, while legacy omitted resource still works", async () => {
    expect((await request("/api/auth/mcp/authorize?resource=https://other.example/api/mcp&prompt=consent")).status).toBe(400);
    const token = await request("/api/auth/mcp/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resource: "https://other.example/api/mcp" }) });
    expect(token.status).toBe(400);
    const repeated = await request("/api/auth/mcp/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `resource=https://other.example/api/mcp&resource=${encodeURIComponent(`${config.betterAuthUrl}/api/mcp`)}` });
    expect(repeated.status).toBe(400);
    expect((await connect("read")).access_token).toBeTruthy();
    const challenge = await rpc("bad-token");
    expect(challenge.headers.get("www-authenticate")).toContain('scope="notes:read notes:write"');
  });

  it("does not let another vault revoke a connection", async () => {
    const linked = await connect();
    const other = await seedOrg("Other", `other-${randomUUID()}`);
    await seedMember(other, user.userId, "owner");
    await pool.query('UPDATE session SET "activeOrganizationId" = $1 WHERE "userId" = $2', [other, user.userId]);
    expect((await request(`/api/mcp/connections/oauth/${linked.clientId}`, { method: "DELETE", headers: sessionHeaders() })).status).toBe(404);
    expect((await rpc(linked.access_token)).status).toBe(200);
  });
});

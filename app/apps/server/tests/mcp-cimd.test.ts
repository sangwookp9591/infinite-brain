// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { createApp } from "../src/http/app.js";
import { config } from "../src/config.js";
import { pool } from "../src/db/pool.js";
import { authPool } from "../src/auth/auth.js";
import { resetDb } from "./helpers/db.js";
import { testAppDeps } from "./helpers/app.js";
import { signUp, createOrg } from "./helpers/auth.js";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCimdDocument, publicAddress, validateCimd } from "../src/mcp/cimd.js";
import { allowedResource, MCP_RESOURCE, normalizeResource } from "../src/mcp/resource.js";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
let sequence = 0;
const client = () => `https://client.example/metadata-${sequence++}.json`;
const document = (id: string) => ({ client_id: id, client_name: "Example", redirect_uris: ["http://127.0.0.1:1234/callback"], token_endpoint_auth_method: "none" });

function transport(body: string, statusCode = 200, cacheControl = "max-age=120") {
  return vi.spyOn(https, "get").mockImplementation(((_url: unknown, options: any, callback: any) => {
    const req = new EventEmitter() as any;
    req.destroy = (error?: Error) => { if (error) req.emit("error", error); req.emit("close"); };
    queueMicrotask(() => {
      // Verify the socket is connected to the validated IP, preserving URL TLS identity.
      options.lookup("client.example", { all: false }, (error: unknown, address: string) => {
        expect(error).toBeNull(); expect(address).toBe("93.184.216.34");
      });
      const res = Readable.from([Buffer.from(body)]) as any;
      res.statusCode = statusCode;
      res.headers = { "content-type": "application/json", "cache-control": cacheControl };
      res.on("end", () => req.emit("close"));
      res.on("close", () => req.emit("close"));
      callback(res);
    });
    return req;
  }) as typeof https.get);
}

beforeEach(() => { vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("CIMD security and cache", () => {
  it("fetches valid metadata over pinned HTTPS and caches within HTTP max-age", async () => {
    const id = client();
    const get = transport(JSON.stringify(document(id)));
    expect((await fetchCimdDocument(id)).client_id).toBe(id);
    await fetchCimdDocument(id);
    expect(get).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("client.example", { all: true });
  });

  it("does not cache no-store documents", async () => {
    const id = client();
    const get = transport(JSON.stringify(document(id)), 200, "no-store");
    await fetchCimdDocument(id); await fetchCimdDocument(id);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("rejects HTTP, URL credentials, fragments, missing path, and private literal hosts before fetch", async () => {
    const get = vi.spyOn(https, "get");
    for (const id of ["http://example.com/client.json", "https://u:p@example.com/client.json", "https://example.com/client.json#fragment", "https://example.com", "https://127.0.0.1/client.json", "https://[::1]/client.json", "https://169.254.169.254/latest/meta-data", "https://[::ffff:127.0.0.1]/client.json"]) {
      await expect(fetchCimdDocument(id)).rejects.toThrow();
    }
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects mixed public/private DNS results and private-IP override in production", async () => {
    const get = vi.spyOn(https, "get");
    vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }] as never);
    await expect(fetchCimdDocument(client())).rejects.toThrow("Private");
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("MCP_CIMD_ALLOW_PRIVATE_IPS", "true");
    await expect(fetchCimdDocument(client())).rejects.toThrow("Private");
    expect(get).not.toHaveBeenCalled();
  });

  it("blocks non-public IPv4 and IPv6 ranges", () => {
    for (const ip of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.1.2.3", "169.254.0.1", "172.16.0.1", "192.168.0.1", "198.18.0.1", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:10.0.0.1", "2002:7f00:1::", "2001:db8::1"]) expect(publicAddress(ip)).toBe(false);
    expect(publicAddress("93.184.216.34")).toBe(true);
    expect(publicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("rejects redirects, oversized documents, malformed JSON and client_id mismatch", async () => {
    for (const [body, status] of [["{}", 302], ["x".repeat(65537), 200], ["not-json", 200], [JSON.stringify(document("https://other.example/client.json")), 200]] as const) {
      const get = transport(body, status);
      await expect(fetchCimdDocument(client())).rejects.toThrow();
      get.mockRestore();
    }
  });

  it("bounds DNS resolution time and never opens a late socket", async () => {
    vi.useFakeTimers();
    let resolveDns!: (value: unknown) => void;
    vi.mocked(lookup).mockImplementation(() => new Promise((resolve) => { resolveDns = resolve; }) as never);
    const get = vi.spyOn(https, "get");
    const fetch = fetchCimdDocument(client());
    const rejected = expect(fetch).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(5001);
    await rejected;
    resolveDns([{ address: "93.184.216.34", family: 4 }]);
    await Promise.resolve(); await Promise.resolve();
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects unsafe redirect URIs and unsupported client authentication", () => {
    const id = client();
    for (const uri of ["javascript:alert(1)", "https://good.example/cb#fragment", "http://external.example/cb", "https://user:password@example.com/cb", "https://good.example/a,b"]) {
      expect(() => validateCimd({ ...document(id), redirect_uris: [uri] }, id)).toThrow();
    }
    expect(() => validateCimd({ ...document(id), token_endpoint_auth_method: "private_key_jwt" }, id)).toThrow();
    expect(() => validateCimd({ ...document(id), grant_types: ["client_credentials"] }, id)).toThrow();
  });
});

describe("resource normalization and allowlist", () => {
  it("normalizes URL host and default port, preserving path identity", () => {
    expect(normalizeResource("https://EXAMPLE.COM:443/api/mcp")).toBe("https://example.com/api/mcp");
    expect(allowedResource(MCP_RESOURCE)).toBe(true);
    for (const value of [MCP_RESOURCE + "/", MCP_RESOURCE + "?q=x", MCP_RESOURCE + "#x", [MCP_RESOURCE], "https://other.example/api/mcp"]) expect(allowedResource(value)).toBe(false);
    expect(() => normalizeResource("http://public.example/api/mcp")).toThrow();
  });
});


describe("CIMD OAuth integration", () => {
  const app = createApp(testAppDeps());
  const request = (path: string, init?: RequestInit) => app.fetch(new Request(`${config.betterAuthUrl}${path}`, init));
  afterAll(async () => { await pool.end(); await authPool.end(); });

  it("authorizes a URL client through consent, PKCE exchange and audience-checked MCP; rejects unlisted redirect", async () => {
    await resetDb();
    const user = await signUp(`cimd-${randomUUID()}@test.example`);
    const org = await createOrg(user, "CIMD vault", `cimd-${randomUUID()}`);
    const id = client();
    const get = transport(JSON.stringify(document(id)));
    const verifier = "cimd-pkce-verifier-at-least-forty-three-characters-long";
    const params = new URLSearchParams({ client_id: id, response_type: "code", redirect_uri: "http://127.0.0.1:1234/callback",
      prompt: "consent", scope: "openid notes:read offline_access", resource: MCP_RESOURCE,
      code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") });
    const authorized = await request(`/api/auth/mcp/authorize?${params}`, { headers: { authorization: `Bearer ${user.token}` } });
    expect(authorized.status).toBe(302);
    const consentCode = new URL(authorized.headers.get("location")!).searchParams.get("consent_code")!;
    const approved = await request("/oauth/consent", { method: "POST", headers: { authorization: `Bearer ${user.token}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ consent_code: consentCode, client_id: id, organization_id: org.id, decision: "allow", scope_preset: "read" }) });
    expect(approved.status).toBe(302);
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const exchanged = await request("/api/auth/mcp/token", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: id, code, grant_type: "authorization_code", redirect_uri: "http://127.0.0.1:1234/callback", code_verifier: verifier, resource: MCP_RESOURCE }) });
    expect(exchanged.status).toBe(200);
    const token = await exchanged.json() as { access_token: string; refresh_token: string };
    const mcp = await request("/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(mcp.status).toBe(200);
    const refreshed = await request("/api/auth/mcp/token", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: id, grant_type: "refresh_token", refresh_token: token.refresh_token, resource: MCP_RESOURCE }) });
    expect(refreshed.status).toBe(200);
    const newToken = await refreshed.json() as { access_token: string };
    expect((await pool.query('SELECT resource, generation FROM "oauthAccessToken" WHERE "accessToken" = $1', [newToken.access_token])).rows[0]).toMatchObject({ resource: MCP_RESOURCE, generation: expect.any(String) });
    params.set("redirect_uri", "https://attacker.example/callback");
    expect((await request(`/api/auth/mcp/authorize?${params}`, { headers: { authorization: `Bearer ${user.token}` } })).status).toBe(400);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

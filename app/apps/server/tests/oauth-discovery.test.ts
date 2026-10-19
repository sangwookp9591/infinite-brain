import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { testAppDeps } from "./helpers/app.js";
import { config } from "../src/config.js";
import { MCP_SCOPES } from "../src/mcp/scopes.js";
import { pool } from "../src/db/pool.js";

/**
 * MCP OAuth discovery: the bare RFC 9728 / RFC 8414 documents plus the
 * path-suffixed forms MCP clients ask for first for the `/api/mcp` resource.
 */
const app = createApp(testAppDeps());
const get = (path: string) => app.fetch(new Request(`http://local${path}`));

describe("MCP OAuth discovery", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("serves protected-resource metadata at the bare and /api/mcp-suffixed paths", async () => {
    const bare = await get("/.well-known/oauth-protected-resource");
    expect(bare.status).toBe(200);
    const bareBody = (await bare.json()) as { resource: string; authorization_servers: string[] };

    const suffixed = await get("/.well-known/oauth-protected-resource/api/mcp");
    expect(suffixed.status).toBe(200);
    expect(suffixed.headers.get("content-type")).toContain("application/json");
    const body = (await suffixed.json()) as { resource: string; authorization_servers: string[] };
    // RFC 9728 §3.3: `resource` names the URL the suffix was taken from.
    expect(body.resource).toBe(`${config.betterAuthUrl}/api/mcp`);
    expect(bareBody.resource).toBe(body.resource);
    expect(body.authorization_servers).toEqual(bareBody.authorization_servers);
  });

  it("ignores untrusted proxy headers when advertising resource and issuer", async () => {
    const res = await app.fetch(new Request("http://attacker.example/.well-known/oauth-protected-resource", {
      headers: { forwarded: "proto=https;host=attacker.example", "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" },
    }));
    expect((await res.json() as { resource: string }).resource).toBe(`${config.betterAuthUrl}/api/mcp`);
  });

  it("serves the same authorization-server metadata at the /api/mcp-suffixed path", async () => {
    const bare = await get("/.well-known/oauth-authorization-server");
    expect(bare.status).toBe(200);
    const suffixed = await get("/.well-known/oauth-authorization-server/api/mcp");
    expect(suffixed.status).toBe(200);
    const metadata = await bare.json() as Record<string, unknown>;
    expect(metadata.scopes_supported).toEqual(expect.arrayContaining([...MCP_SCOPES]));
    expect(metadata.authorization_response_iss_parameter_supported).toBe(true);
    expect(metadata.client_id_metadata_document_supported).toBe(true);
    expect(await suffixed.json()).toEqual(metadata);
  });
});

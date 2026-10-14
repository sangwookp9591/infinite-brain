import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { testAppDeps } from "./helpers/app.js";
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
    expect(body.resource).toBe(`${bareBody.resource.replace(/\/+$/, "")}/api/mcp`);
    expect(body.authorization_servers).toEqual(bareBody.authorization_servers);
  });

  it("serves the same authorization-server metadata at the /api/mcp-suffixed path", async () => {
    const bare = await get("/.well-known/oauth-authorization-server");
    expect(bare.status).toBe(200);
    const suffixed = await get("/.well-known/oauth-authorization-server/api/mcp");
    expect(suffixed.status).toBe(200);
    expect(await suffixed.json()).toEqual(await bare.json());
  });
});

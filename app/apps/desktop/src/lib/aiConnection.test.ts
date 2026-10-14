// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { AI_TARGETS, CONNECTION_STEPS, connectionSnippet, connectionScopes, connectionTools, codexSnippet, isConnected, relTime } from "./aiConnection";
import type { McpToolInfo } from "./api";

const url = "https://vault.example/api/mcp";
const tools: McpToolInfo[] = [
  { name: "read_note", description: "", access: "read" },
  { name: "update_note", description: "", access: "destructive" },
  { name: "move_note", description: "", access: "write" },
  { name: "delete_note", description: "", access: "destructive" },
  { name: "manage_access", description: "", access: "destructive" },
];

describe("AI connection wizard", () => {
  it("provides three steps for every target and marks ChatGPT/CLI as advanced", () => {
    for (const target of AI_TARGETS) expect(CONNECTION_STEPS[target.id]).toHaveLength(3);
    expect(AI_TARGETS.find((t) => t.id === "chatgpt")!.label).toContain("Developer mode");
    expect(CONNECTION_STEPS.claude.join(" ")).toContain("Sign in");
    expect(connectionSnippet("claude", url)).toBe("");
  });

  it("generates the different Cursor/VS Code JSON schemas with header-only authentication", () => {
    const cursor = JSON.parse(connectionSnippet("cursor", url, "mcp_DEMO"));
    expect(cursor.mcpServers.infiniteBrain).toEqual({ url, headers: { Authorization: "Bearer mcp_DEMO" } });
    const vscode = JSON.parse(connectionSnippet("vscode", url, "mcp_DEMO"));
    expect(vscode.servers.infiniteBrain).toMatchObject({ type: "http", url, headers: { Authorization: "Bearer mcp_DEMO" } });
    expect(vscode.inputs).toBeUndefined();
    expect(connectionSnippet("vscode", url)).toContain("YOUR_MCP_TOKEN");
    for (const target of AI_TARGETS) expect(connectionSnippet(target.id, url, "mcp_DEMO")).not.toContain("?key=");
  });

  it("supports Claude Code OAuth and token headers, and Codex environment-token configuration", () => {
    expect(connectionSnippet("cli", url)).toBe(`claude mcp add --transport http context '${url}'`);
    expect(connectionSnippet("cli", url, "mcp_DEMO")).toContain("--header 'Authorization: Bearer mcp_DEMO'");
    expect(connectionSnippet("cli", "https://vault.example/$(touch injected)'" )).toContain("'\\''");
    expect(codexSnippet(url)).toContain('bearer_token_env_var = "BAALDA_MCP_TOKEN"');
  });

  it("defaults token access to read+write and only adds destructive/admin grants explicitly", () => {
    expect(connectionScopes("write", false)).toEqual(["notes:read", "notes:write"]);
    expect(connectionScopes("read", false)).toEqual(["notes:read"]);
    expect(connectionScopes("delete", true)).toEqual(["notes:read", "notes:write", "notes:delete", "access:manage"]);
  });

  it("confirms recent requests and shows seconds since the last use", () => {
    const now = Date.parse("2026-10-14T12:00:00Z");
    expect(isConnected(null, now)).toBe(false);
    expect(isConnected("invalid", now)).toBe(false);
    expect(isConnected(new Date(now - 179_999).toISOString(), now)).toBe(true);
    expect(isConnected(new Date(now - 180_000).toISOString(), now)).toBe(false);
    expect(relTime(new Date(now - 12_000).toISOString(), now)).toBe("12s ago");
    expect(relTime(new Date(now - 60_000).toISOString(), now)).toBe("1m ago");
  });

  it("shows exactly the scoped tool subset, including legacy annotations", () => {
    expect(connectionTools(["notes:read"], tools).map((t) => t.name)).toEqual(["read_note"]);
    expect(connectionTools(connectionScopes("write", false), tools).map((t) => t.name)).toEqual(["read_note", "update_note"]);
    expect(connectionTools([], tools)).toEqual([]);
    expect(connectionTools(undefined, tools)).toEqual(tools);
    expect(connectionTools(["notes:read"], [{ ...tools[0], scope: "access:manage" }])).toEqual([]);
  });
});

// SPDX-License-Identifier: Apache-2.0
import type { McpToolInfo } from "./api";

export const AI_TARGETS = [
  { id: "claude", label: "Claude" },
  { id: "chatgpt", label: "ChatGPT (Advanced · Developer mode)" },
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code" },
  { id: "cli", label: "Claude Code / Codex (Advanced)" },
] as const;
export type AiTarget = (typeof AI_TARGETS)[number]["id"];

export const CONNECTION_STEPS: Record<AiTarget, readonly string[]> = {
  claude: [
    "In claude.ai, open Settings → Connectors → Add custom connector. Team/Enterprise owners first add it in Organization settings → Connectors.",
    "Name it Infinite Brain and paste the connector URL below. Choose Connect to open the sign-in page.",
    "Sign in, select this vault and approve the access you want. Ask Claude to list your notes, then check the connection below.",
  ],
  chatgpt: [
    "Advanced: use ChatGPT on the web. Enable Developer mode in Settings → Apps → Advanced Settings; your plan and workspace role must allow it.",
    "Create a custom app in Apps (workspace admins: Workspace settings → Apps → Create). Paste this connector URL and select OAuth authentication.",
    "Sign in, choose this vault and approve access. Enable the app in a chat, list your notes, then check the connection below.",
  ],
  cursor: [
    "Open your personal ~/.cursor/mcp.json (or Cursor Settings → MCP).",
    "Copy the settings JSON below. Create a token in Advanced and replace YOUR_MCP_TOKEN, or remove headers to use OAuth sign-in. Keep credentials out of shared project files.",
    "Save and restart Cursor. Enable Infinite Brain in Agent, list your notes, then check the connection below.",
  ],
  vscode: [
    "In VS Code, run MCP: Open User Configuration. Paste the settings JSON below into your user MCP configuration.",
    "Create a token in Advanced and replace YOUR_MCP_TOKEN in the Authorization header. Keep the configuration personal and out of source control.",
    "Open Copilot Chat in Agent mode, enable the server's tools and list your notes. Check the connection below.",
  ],
  cli: [
    "Advanced: install Claude Code or Codex yourself. Copy the Claude Code command below; without a token, run /mcp in Claude Code to sign in with OAuth.",
    "For Codex, use the TOML below in ~/.codex/config.toml and set BAALDA_MCP_TOKEN in your shell to a token created in Advanced.",
    "List your notes in the CLI, then check the connection below. Keep tokens out of URLs and source control.",
  ],
};

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

export function connectionSnippet(target: AiTarget, url: string, token?: string): string {
  if (target === "cursor") {
    return JSON.stringify({ mcpServers: { infiniteBrain: { url, headers: { Authorization: `Bearer ${token ?? "YOUR_MCP_TOKEN"}` } } } }, null, 2);
  }
  if (target === "vscode") {
    return JSON.stringify({
      servers: { infiniteBrain: { type: "http", url, headers: { Authorization: `Bearer ${token ?? "YOUR_MCP_TOKEN"}` } } },
    }, null, 2);
  }
  if (target === "cli") {
    return `claude mcp add --transport http context ${shellQuote(url)}${token ? ` \\\n  --header ${shellQuote(`Authorization: Bearer ${token}`)}` : ""}`;
  }
  return "";
}

export function codexSnippet(url: string): string {
  return `[mcp_servers.infiniteBrain]\nurl = ${JSON.stringify(url)}\nbearer_token_env_var = "BAALDA_MCP_TOKEN"`;
}

export function connectionScopes(preset: string, manage: boolean): string[] {
  const scopes = ["notes:read"];
  if (preset === "write" || preset === "delete") scopes.push("notes:write");
  if (preset === "delete") scopes.push("notes:delete");
  if (manage) scopes.push("access:manage");
  return scopes;
}

export function connectionTools(scopes: readonly string[] | undefined, tools: McpToolInfo[]): McpToolInfo[] {
  if (!scopes) return tools;
  return tools.filter((tool) => scopes.includes(tool.scope ?? (
    tool.name === "manage_access" || tool.name === "set_access_default" ? "access:manage"
      : tool.name === "update_note" ? "notes:write" : tool.name.startsWith("move_") ? "notes:delete"
      : tool.access === "read" ? "notes:read" : tool.access === "destructive" ? "notes:delete" : "notes:write"
  )));
}

/** A connection is "active" when it made a request in the last few minutes
 *  (MCP here is stateless HTTP — there's no socket to watch, so recency is it). */
const CONNECTED_WINDOW_MS = 3 * 60 * 1000;
export function isConnected(lastUsedAt: string | null, now = Date.now()): boolean {
  if (!lastUsedAt) return false;
  return now - new Date(lastUsedAt).getTime() < CONNECTED_WINDOW_MS;
}

/** The first minute shows seconds so a new connection can be confirmed. */
export function relTime(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.max(0, Math.floor(diff / 1000))}s ago`;
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}


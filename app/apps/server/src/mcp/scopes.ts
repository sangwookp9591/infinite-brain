// SPDX-License-Identifier: Apache-2.0
export const MCP_SCOPES = ["notes:read", "notes:write", "notes:delete", "access:manage"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export const DEFAULT_MCP_SCOPES: McpScope[] = ["notes:read", "notes:write"];

/** Older OAuth grants contain only OIDC scopes; keep their existing tool access. */
export function effectiveScopes(value?: string | readonly string[] | null): McpScope[] {
  if (Array.isArray(value)) return MCP_SCOPES.filter((s) => value.includes(s));
  const scopes = typeof value === "string" ? value.split(/\s+/) : value ?? [];
  if (!scopes.some((s) => s.startsWith("notes:") || s.startsWith("access:"))) return [...MCP_SCOPES];
  return MCP_SCOPES.filter((s) => scopes.includes(s));
}

export function validScopes(value: unknown): value is McpScope[] {
  return Array.isArray(value) && value.length > 0 && value.every((s) => MCP_SCOPES.includes(s));
}

export function scopePreset(preset: unknown, manage: boolean): McpScope[] | null {
  const scopes: McpScope[] = preset === "read" ? ["notes:read"]
    : preset === "write" ? [...DEFAULT_MCP_SCOPES]
    : preset === "delete" ? [...DEFAULT_MCP_SCOPES, "notes:delete"] : [];
  if (!scopes.length) return null;
  if (manage) scopes.push("access:manage");
  return scopes;
}

export function toolAccess(tool: { annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean } }) {
  return tool.annotations?.destructiveHint ? "destructive" as const
    : tool.annotations?.readOnlyHint ? "read" as const : "write" as const;
}

export function toolScope(tool: { name: string; annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean } }): McpScope {
  // Content replacement is a write; moves need the separate destructive grant.
  if (tool.name === "update_note") return "notes:write";
  if (tool.name.startsWith("move_")) return "notes:delete";
  if (tool.name === "manage_access" || tool.name === "set_access_default") return "access:manage";
  const access = toolAccess(tool);
  return access === "destructive" ? "notes:delete" : access === "read" ? "notes:read" : "notes:write";
}

export function allowsTool(scopes: readonly string[] | undefined, tool: Parameters<typeof toolScope>[0]): boolean {
  return effectiveScopes(scopes).includes(toolScope(tool));
}

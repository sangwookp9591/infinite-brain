// SPDX-License-Identifier: Apache-2.0
import { config } from "../config.js";

/** RFC 8707: URL serialization normalizes host/default port; path stays exact. */
export function normalizeResource(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || value.includes("#") || url.search
    || (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Invalid MCP resource URL");
  }
  return url.toString();
}

// A single configured public URL is the entire allowlist. Never infer from proxy headers.
export const MCP_RESOURCE = normalizeResource(`${config.betterAuthUrl.replace(/\/+$/, "")}/api/mcp`);
export function allowedResource(value: unknown): boolean {
  try { return typeof value === "string" && normalizeResource(value) === MCP_RESOURCE; }
  catch { return false; }
}

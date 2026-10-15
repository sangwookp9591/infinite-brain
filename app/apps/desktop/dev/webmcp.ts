// SPDX-License-Identifier: Apache-2.0
type DevTool = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute: (input: unknown) => unknown | Promise<unknown>;
};

export function registerDevTools(tools: DevTool[]) {
  const target = (document as Document & { modelContext?: { registerTool: (tool: DevTool) => void } }).modelContext
    ?? (navigator as Navigator & { modelContext?: { registerTool: (tool: DevTool) => void } }).modelContext;
  if (!target) {
    console.info("[dev] WebMCP is unavailable in this browser");
    return;
  }
  for (const tool of tools) {
    try {
      target.registerTool(tool);
    } catch (error) {
      console.warn(`[dev] WebMCP tool registration failed: ${tool.name}`, error);
    }
  }
}

// SPDX-License-Identifier: Apache-2.0
import { Channel, invoke } from "@tauri-apps/api/core";

export type InstalledAgent = {
  agent: "claude" | "codex";
  version: string;
  signedIn: boolean;
  runnable: boolean;
  detail: string;
};
export type AgentEvent =
  | { type: "started"; runId: string }
  | { type: "text" | "status"; text: string }
  | { type: "finished"; cancelled: boolean; success: boolean; exitCode: number | null };

let detection: Promise<InstalledAgent[]> | undefined;
/** One detection per app launch; no auth files or CLI output enter the webview. */
export function detectInstalledAgents(): Promise<InstalledAgent[]> {
  return detection ??= invoke<InstalledAgent[]>("detect_agents");
}
export function runDashboardAgent(
  request: { agent: InstalledAgent["agent"]; prompt: string; dashboardPath: string; expectedEpoch: number; runId: string },
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const onEventChannel = new Channel<AgentEvent>();
  onEventChannel.onmessage = onEvent;
  return invoke("run_agent", { request, onEvent: onEventChannel });
}
export function cancelDashboardAgent(runId: string): Promise<void> {
  return invoke("cancel_agent", { runId });
}
/** Keep recent output only. Logs live in memory and disappear when closed. */
export function appendAgentLog(log: string, next: string): string {
  const limit = 24_000;
  const joined = `${log}${log ? "\n" : ""}${next}`;
  if (joined.length <= limit) return joined;
  const suffix = joined.slice(-limit);
  const newline = suffix.indexOf("\n");
  return `[Earlier output omitted]\n${newline >= 0 ? suffix.slice(newline + 1) : suffix}`;
}

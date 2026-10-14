// SPDX-License-Identifier: Apache-2.0
import type { InstalledAgent } from "./agent";

export type DashboardAgentLaunch = {
  agent: InstalledAgent["agent"];
  path: string;
  expectedEpoch: number;
};
export const DASHBOARD_AGENT_LAUNCH = "baalda:launch-dashboard-agent";
/** Trusted app UI only. This event is not exposed to dashboard content. */
export function requestDashboardAgent(request: DashboardAgentLaunch): void {
  window.dispatchEvent(new CustomEvent<DashboardAgentLaunch>(DASHBOARD_AGENT_LAUNCH, { detail: request }));
}

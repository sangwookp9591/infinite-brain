// SPDX-License-Identifier: Apache-2.0

/** A creation request is explicit; no Home hint writes into a vault. */
export type DashboardCreationIntent = { setAsHome?: boolean; manage?: boolean; templateId?: string };
export function requestNewDashboard(kind?: "link", intent: DashboardCreationIntent = {}) {
  window.dispatchEvent(new CustomEvent("baalda:new-dashboard", { detail: { kind, ...intent } }));
}

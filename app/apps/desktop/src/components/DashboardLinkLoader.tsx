// SPDX-License-Identifier: Apache-2.0
export function DashboardLinkLoader({ url }: { url: string }) {
  const host = new URL(url).hostname;
  const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  const label = matches("chatgpt.site") ? "Loading your ChatGPT Site…" : matches("claude.ai") || matches("claude.site") ? "Loading your Claude Artifact…" : "Loading your dashboard…";
  return <div className="dashboard-link-loader" role="status" aria-live="polite"><span className="dashboard-link-spinner" aria-hidden="true" /><span>{label}</span></div>;
}

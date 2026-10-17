/* SPDX-License-Identifier: Apache-2.0 */
import { HealthView } from "../../src/components/HealthTab";
import { HousekeeperView } from "../../src/components/HousekeeperPanel";
import type { HealthActions, VaultHealthSnapshot } from "../../src/lib/health/types";

type PreviewSurface = "health" | "housekeeper";

const previewActions = new Proxy({}, { get: () => async () => undefined }) as HealthActions;

const healthSnapshot = {
  report: {
    verdict: "healthy",
    headline: "All 12 notes are up to date",
    detail: "Last checked just now · preview.invalid",
    stages: [
      { id: "disk", label: "Files on this computer", state: "ok", headline: "12", detail: "All notes are available." },
      { id: "index", label: "Search index", state: "ok", headline: "12", detail: "Search is up to date." },
      { id: "history", label: "Note history", state: "ok", headline: "12", detail: "History is ready." },
      { id: "connection", label: "Connection", state: "ok", headline: "Connected", detail: "The vault is connected." },
      { id: "server", label: "Remote Vault", state: "ok", headline: "12", detail: "All notes are up to date." },
    ],
    counts: { total: 12, synced: 11, pending: 1, failed: 0, unsynced: 0, unreported: 0 },
    issues: [],
    lastSyncedAt: Date.now(),
    serverHost: "preview.invalid",
  },
  inventory: {
    local: { notes: 12, folders: 3, files: 4, total: 19 },
    localReady: true,
    server: { notes: 12, folders: 3, files: 4, total: 19 },
    serverState: "current",
    deviceOnlyNotes: [], serverOnlyNotes: [], deviceOnlyFolders: [],
    serverOnlyFolders: [], deviceOnlyFiles: [], serverOnlyFiles: [],
  },
  stats: {
    computedAt: Date.now(),
    notes: { count: 12, bytes: 4096, empty: 1 }, folders: 3,
    attachments: { count: 2, bytes: 1024 }, otherFiles: { count: 4, bytes: 2048 },
    tags: 5, links: 9, brokenLinks: 0,
    index: { bytes: 65536, files: 0, extractedTextBytes: 0 },
    history: { docs: 12, updates: 40, bytes: 2048, orphanDocs: 0, orphanBytes: 0 },
    largestNotes: [{ path: "Specs/Launch plan.md", bytes: 12288, mtime: Date.now() }],
    largestFiles: [], heaviestHistory: [],
    activity: { modifiedLast7d: 4, modifiedLast30d: 9, weeks: [0, 1, 2, 0, 0, 3, 1, 0, 2, 5, 1, 4], days: [] },
  },
  statsError: null,
  checks: null,
  log: [],
  loading: false,
  refresh() {},
  actions: previewActions,
} as unknown as VaultHealthSnapshot;

const notes = [
  { id: "launch", path: "Launch.md", title: "Launch" },
  { id: "pricing", path: "Specs/Pricing.md", title: "Pricing" },
  { id: "research", path: "Research/Interviews.md", title: "Interviews" },
];

const diagnostics = {
  checks: [{ id: "broken-links", count: 1 }, { id: "empty-notes", count: 1 }],
  sync: { pending: 1, failed: 0, unsynced: 0 },
};

export function SurfacePreview({ surface }: { surface: PreviewSurface }) {
  return <div style={{ minHeight: "100dvh", background: "var(--bg-app)", color: "var(--text-primary)", fontFamily: "var(--font-body)" }}>
    <main style={{ boxSizing: "border-box", width: "min(100%, 1080px)", margin: "0 auto", padding: "clamp(16px, 4vw, 40px)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
        <div><p style={{ margin: 0, color: "var(--text-tertiary)", fontSize: 12 }}>PREVIEW ONLY · SYNTHETIC DATA</p><h1 style={{ margin: "6px 0 0", fontSize: 26, fontFamily: "var(--font-display)" }}>{surface === "health" ? "Vault health" : "Housekeeper"}</h1></div>
        <span style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", padding: "5px 10px", color: "var(--text-secondary)", fontSize: 12 }}>{document.documentElement.dataset.theme ?? "light"}</span>
      </div>
      {surface === "health" ? <HealthView title="Vault health" demo snapshot={healthSnapshot} notes={notes} vaultPath="/preview/Product team" /> :
        <section style={{ padding: "clamp(16px, 3vw, 28px)", border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-surface)", boxShadow: "var(--shadow-sm)" }}>
          <HousekeeperView vaultId="preview-vault" notes={notes} diagnostics={diagnostics} brokenLinkNotes={[{ path: "Launch.md", docId: "launch", detail: "Pricing page renamed" }]} />
        </section>}
    </main>
  </div>;
}

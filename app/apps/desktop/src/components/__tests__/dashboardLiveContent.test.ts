// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../store", () => ({ useStore: Object.assign((selector: (s: unknown) => unknown) => selector({
  vault: { epoch: 1 }, titles: [], locks: [], lifts: [], tree: null, syncEnabled: false,
  session: null, docSyncState: {}, openNote: { path: "Dashboards/Home.html" }, activeVirtualTab: null,
  personalHomeDocId: null, vaultAppearance: {},
}), { getState: () => ({ vault: { epoch: 1 }, openNote: { path: "Dashboards/Home.html" } }) }) }));
vi.mock("../../lib/ipc", () => ({ readNote: vi.fn(), onFileChanged: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => "lease") }));
vi.mock("../../lib/dashboard/host", () => ({ dashboardHost: vi.fn(), pushDashboardTheme: vi.fn() }));
vi.mock("../../lib/dashboard/bridge", () => ({ dashboardUrl: () => "https://preview.invalid/Home.html", createDashboardBridge: vi.fn(), DASHBOARD_PROTOCOL: "test" }));
import * as ipc from "../../lib/ipc";
import { HtmlView } from "../HtmlView";
import { VaultDashboardPreview } from "../VaultDashboardPreview";

let host: HTMLDivElement, root: Root, changed: (event: ipc.FileChanged) => void;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.mocked(ipc.readNote).mockResolvedValue("");
  vi.mocked(ipc.onFileChanged).mockImplementation(async (cb) => { changed = cb; return () => {}; });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([{ name: "HTML view", View: HtmlView }, { name: "Home preview", View: VaultDashboardPreview }])("refreshes $name when synced HTML replaces an empty indexed placeholder", async ({ View }) => {
  await act(async () => root.render(createElement(View, { path: "Dashboards/Home.html" })));
  const before = host.querySelector("iframe")!;
  expect(before).not.toBeNull();
  vi.mocked(ipc.readNote).mockResolvedValue("<!doctype html><h1>Shared dashboard</h1>");
  // A sync write has already advanced the index hash before its watcher echo.
  await act(async () => { changed({ path: "Dashboards/Home.html", kind: "modified", unchanged: true }); await vi.advanceTimersByTimeAsync(300); });
  const after = host.querySelector("iframe")!;
  expect(after).not.toBe(before);
  expect(after.src).not.toBe(before.src);
  await act(async () => { changed({ path: "Dashboards/Home.html", kind: "modified", unchanged: true }); await vi.advanceTimersByTimeAsync(300); });
  // Identical bytes should not reload the iframe or reset interactive widgets.
  expect(host.querySelector("iframe")).toBe(after);
});

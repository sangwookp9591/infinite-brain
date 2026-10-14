// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { NativeDashboardLink } from "../NativeDashboardLink";
import * as ipc from "../../lib/ipc";
vi.mock("../../lib/ipc", () => ({ mountDashboardLink:vi.fn(), updateDashboardLink:vi.fn(), unmountDashboardLink:vi.fn() }));
let root: Root, host: HTMLDivElement, next: FrameRequestCallback;
const advance = async () => { await act(async () => next(0)); };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { next = fn; return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x:100, y:80, width:600, height:400, right:700, bottom:480 } as DOMRect);
  vi.mocked(ipc.mountDashboardLink).mockResolvedValue("dashboard-link-1");
  vi.mocked(ipc.updateDashboardLink).mockResolvedValue();
  vi.mocked(ipc.unmountDashboardLink).mockResolvedValue();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("loads inline automatically, hides beneath overlays and releases on tab change", async () => {
  await act(async () => root.render(createElement(NativeDashboardLink, {url:"https://claude.ai/artifact/example"})));
  await advance();
  expect(ipc.mountDashboardLink).toHaveBeenCalledWith("https://claude.ai/artifact/example", {x:100,y:80,width:600,height:400}, expect.any(Function));
  expect(host.textContent).toContain("Loading your Claude Artifact…");
  await act(async () => vi.mocked(ipc.mountDashboardLink).mock.calls[0][2]());
  expect(host.textContent).not.toContain("Loading your Claude Artifact…");
  const dialog = document.createElement("div"); dialog.role = "dialog"; host.append(dialog);
  await advance();
  expect(ipc.updateDashboardLink).toHaveBeenLastCalledWith("dashboard-link-1", expect.any(Object), false);
  dialog.remove(); await advance();
  expect(ipc.updateDashboardLink).toHaveBeenLastCalledWith("dashboard-link-1", expect.any(Object), true);
  await act(async () => root.render(null));
  expect(ipc.unmountDashboardLink).toHaveBeenCalledWith("dashboard-link-1");
});
it("closes a viewer whose creation completes after leaving the tab", async () => {
  let finish!: (label:string) => void;
  vi.mocked(ipc.mountDashboardLink).mockReturnValue(new Promise(resolve => {finish=resolve;}));
  await act(async () => root.render(createElement(NativeDashboardLink, {url:"https://claude.ai/artifact/example"})));
  await advance(); await act(async () => root.render(null));
  await act(async () => finish("dashboard-link-late"));
  expect(ipc.unmountDashboardLink).toHaveBeenCalledWith("dashboard-link-late");
});

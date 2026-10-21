// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "./ipc";
import { advertiseOffice, openDiscoveredOffice, openOfficeDiscovery } from "./officeDiscovery";
vi.mock("./ipc", () => ({
  officeDiscoveryStart: vi.fn(), officeDiscoverySnapshot: vi.fn(),
  officeDiscoveryStop: vi.fn(), officeDiscoveryOpen: vi.fn(), officeDiscoveryAdvertise: vi.fn(),
}));
const snapshot: ipc.OfficeDiscoverySnapshot = { scanId: "scan", searching: true, candidates: [
  { candidateId: "opaque", serverId: "hub", displayName: "공유 작업 공간", trust: "untrusted" },
] };
describe("screen-scoped office discovery", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks();
    vi.mocked(ipc.officeDiscoveryStart).mockResolvedValue("scan");
    vi.mocked(ipc.officeDiscoverySnapshot).mockResolvedValue(snapshot);
    vi.mocked(ipc.officeDiscoveryStop).mockResolvedValue();
  });
  afterEach(() => { vi.useRealTimers(); });
  it("starts only when opened, publishes candidates, and cancels on close", async () => {
    expect(ipc.officeDiscoveryStart).not.toHaveBeenCalled();
    const update = vi.fn(); const screen = openOfficeDiscovery(update);
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenCalledWith(snapshot);
    expect(ipc.officeDiscoveryStart).toHaveBeenCalledTimes(1);
    await screen.close(); await screen.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ipc.officeDiscoverySnapshot).toHaveBeenCalledTimes(1);
    expect(ipc.officeDiscoveryStop).toHaveBeenCalledExactlyOnceWith("scan");
  });
  it("stops a late start after the screen closes and emits no stale results", async () => {
    let resolve!: (id: string) => void;
    vi.mocked(ipc.officeDiscoveryStart).mockReturnValue(new Promise((done) => { resolve = done; }));
    const update = vi.fn(); const screen = openOfficeDiscovery(update);
    await screen.close(); resolve("late"); await vi.advanceTimersByTimeAsync(0);
    expect(ipc.officeDiscoveryStop).toHaveBeenCalledWith("late");
    expect(ipc.officeDiscoverySnapshot).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
  it("reads removals and expiration without restarting a completed browse", async () => {
    vi.mocked(ipc.officeDiscoverySnapshot).mockResolvedValueOnce(snapshot)
      .mockResolvedValue({ scanId: "scan", searching: false, candidates: [] });
    const update = vi.fn(); const screen = openOfficeDiscovery(update);
    await vi.advanceTimersByTimeAsync(1500);
    expect(update).toHaveBeenLastCalledWith({ scanId: "scan", searching: false, candidates: [] });
    expect(ipc.officeDiscoveryStart).toHaveBeenCalledTimes(1);
    await screen.close();
  });
  it("reports failure without automatically retrying a network browse", async () => {
    vi.mocked(ipc.officeDiscoveryStart).mockRejectedValue(new Error("denied"));
    const failed = vi.fn(); const screen = openOfficeDiscovery(vi.fn(), failed);
    await vi.advanceTimersByTimeAsync(10000);
    expect(failed).toHaveBeenCalledTimes(1); expect(ipc.officeDiscoveryStart).toHaveBeenCalledTimes(1);
    await screen.close();
  });
  it("passes only an opaque selected ID to native reconnect and opts in explicitly", async () => {
    vi.mocked(ipc.officeDiscoveryOpen).mockRejectedValue(new Error("office_hub_approval_required"));
    await expect(openDiscoveredOffice(snapshot.candidates[0])).rejects.toThrow("office_hub_approval_required");
    expect(ipc.officeDiscoveryOpen).toHaveBeenCalledExactlyOnceWith("opaque");
    expect(ipc.officeDiscoveryAdvertise).not.toHaveBeenCalled();
    await advertiseOffice("공유 작업 공간"); await advertiseOffice(null);
    expect(ipc.officeDiscoveryAdvertise).toHaveBeenNthCalledWith(1, "공유 작업 공간");
    expect(ipc.officeDiscoveryAdvertise).toHaveBeenNthCalledWith(2, null);
  });
});

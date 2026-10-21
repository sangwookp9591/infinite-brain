// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../ipc";
import { candidateShortMarker, createFakeOfficeAdapter, createOfficeAdapter } from "../officeAdapters";

describe("office preview adapter", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it("publishes nearby workspaces only after discovery starts", async () => {
    const adapter = createFakeOfficeAdapter();
    let found = 0;
    adapter.onCandidates((items) => { found = items.length; });
    expect(found).toBe(0);
    await adapter.start();
    expect(found).toBe(3);
    await adapter.stop();
    expect(found).toBe(0);
  });
  it("provides three untrusted candidates after opt-in and distinct approval confirmation numbers", async () => {
    const adapter = createFakeOfficeAdapter();
    let found = 0;
    adapter.onCandidates((candidates) => { found = candidates.length; expect(candidates.every((c) => c.trust === "untrusted-candidate")).toBe(true); });
    await adapter.start();
    expect(found).toBe(3);
    expect(adapter.getRequests().map((r) => r.nickname)).toEqual(["민수", "민수"]);
    expect(adapter.getRequests().map((r) => r.confirmationNumber)).toEqual(["482193", "731604"]);
    const invitation = await adapter.createInvitation();
    expect(invitation.invitationCode).toMatch(/^IB1\./);
    expect(Date.parse(invitation.expiresAt)).toBeGreaterThan(Date.now());
  });
  it("reproduces duplicate candidate names in development preview", async () => {
    const duplicates = createFakeOfficeAdapter("duplicates");
    let names: string[] = [];
    duplicates.onCandidates((list) => { names = list.map((c) => c.displayName); });
    await duplicates.start();
    expect(new Set(names).size).toBe(3);
    expect(names[0]).toMatch(/^민수 · [A-Z0-9]{4}$/);
    expect(names[0]).not.toBe(names[1]);
    expect(candidateShortMarker("candidate-plan-minsu")).toBe(candidateShortMarker("candidate-plan-minsu"));
    expect(candidateShortMarker("candidate-plan-minsu")).not.toBe(candidateShortMarker("candidate-design-minsu"));
  });
  it("cannot be instantiated outside development builds", () => {
    vi.stubEnv("DEV", false);
    expect(() => createFakeOfficeAdapter()).toThrow("only in development");
  });
  it("stops a host that cannot reach ready LAN sharing before reporting failure", async () => {
    const stop = vi.spyOn(ipc, "officeHostStop").mockResolvedValue(undefined);
    vi.spyOn(ipc, "officeHostStart").mockResolvedValue({ available: true, phase: "starting", endpoint: null, scope: "lan", port: null, lanExposed: false, certificateFingerprint: null, error: null, runId: null });
    vi.spyOn(ipc, "officeDiscoveryAdvertise").mockResolvedValue(undefined);
    const adapter = createOfficeAdapter({ officeRequest: vi.fn() } as never, "org");
    await expect(adapter.setHostRunning(true)).rejects.toThrow("office:host_stopped");
    expect(stop).toHaveBeenCalledExactlyOnceWith();
    expect(adapter.getHostRunning()).toBe(false);
  });
});

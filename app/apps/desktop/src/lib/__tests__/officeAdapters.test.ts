// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateShortMarker, createFakeOfficeAdapter } from "../officeAdapters";

describe("office preview adapter", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("provides three untrusted candidates and distinct approval confirmation numbers", async () => {
    const adapter = createFakeOfficeAdapter();
    let found = 0;
    adapter.onCandidates((candidates) => { found = candidates.length; expect(candidates.every((c) => c.trust === "untrusted-candidate")).toBe(true); });
    expect(found).toBe(3);
    expect(adapter.getRequests().map((r) => r.nickname)).toEqual(["민수", "민수"]);
    expect(adapter.getRequests().map((r) => r.confirmationNumber)).toEqual(["482193", "731604"]);
  });
  it("reproduces duplicate candidate names and an easy network error", async () => {
    const duplicates = createFakeOfficeAdapter("duplicates");
    let names: string[] = [];
    duplicates.onCandidates((list) => { names = list.map((c) => c.displayName); });
    expect(new Set(names).size).toBe(3);
    expect(names[0]).toMatch(/^민수 · [A-Z0-9]{4}$/);
    expect(names[0]).not.toBe(names[1]);
    expect(candidateShortMarker("candidate-plan-minsu")).toBe(candidateShortMarker("candidate-plan-minsu"));
    expect(candidateShortMarker("candidate-plan-minsu")).not.toBe(candidateShortMarker("candidate-design-minsu"));
    await expect(createFakeOfficeAdapter("error").verifyCandidate("x")).rejects.toThrow("network_blocked");
  });
  it("cannot be instantiated outside development builds", () => {
    vi.stubEnv("DEV", false);
    expect(() => createFakeOfficeAdapter()).toThrow("only in development");
  });
});

// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { ASKED_KEY, markSmartSearchAsked, megabytes, shouldAskSmartSearch } from "../smartSearch";

const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const off = { state: "off" as const, downloaded: false, modelBytes: 0 };

describe("smart search first-run question", () => {
  it("asks once, only while nothing is downloaded", () => {
    const s = store();
    expect(shouldAskSmartSearch(s, off)).toBe(true);
    markSmartSearchAsked(s);
    expect(s.getItem(ASKED_KEY)).not.toBeNull();
    expect(shouldAskSmartSearch(s, off)).toBe(false);
  });

  it("never asks when it cannot help or storage is unreadable", () => {
    expect(shouldAskSmartSearch(store(), null)).toBe(false);
    expect(shouldAskSmartSearch(store(), { state: "unsupported" })).toBe(false);
    expect(shouldAskSmartSearch(store(), { ...off, downloaded: true, modelBytes: 1 })).toBe(false);
    expect(shouldAskSmartSearch(store(), { state: "on", modelBytes: 1, indexed: 0, total: 1 })).toBe(false);
    const broken = { getItem: () => { throw new Error("denied"); } };
    expect(shouldAskSmartSearch(broken, off)).toBe(false);
  });

  it("shows decimal megabytes like Finder", () => {
    expect(megabytes(309_855_520)).toBe(310);
  });
});

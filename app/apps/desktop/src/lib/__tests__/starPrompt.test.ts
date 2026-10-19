// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { answered, dayKey, loadStarState, recordOpen, saveStarState, shouldAskForStar, STAR_MIN_DAYS } from "../starPrompt";

function memory(): Pick<Storage, "getItem" | "setItem"> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}
const day = (n: number) => new Date(2026, 9, 1 + n, 10, 0, 0);

describe("star prompt", () => {
  it("counts days, not launches", () => {
    let s = loadStarState(memory());
    for (let i = 0; i < 10; i++) s = recordOpen(s, new Date(2026, 9, 1, 9 + (i % 5)));
    expect(s.days).toEqual(["2026-10-01"]);
    expect(shouldAskForStar(s, { busy: false })).toBe(false);
  });

  it("asks only after enough distinct days", () => {
    let s = loadStarState(memory());
    for (let i = 0; i < STAR_MIN_DAYS - 1; i++) s = recordOpen(s, day(i));
    expect(shouldAskForStar(s, { busy: false })).toBe(false);
    s = recordOpen(s, day(STAR_MIN_DAYS));
    expect(shouldAskForStar(s, { busy: false })).toBe(true);
  });

  it("waits while something else needs the user", () => {
    let s = loadStarState(memory());
    for (let i = 0; i < STAR_MIN_DAYS; i++) s = recordOpen(s, day(i));
    expect(shouldAskForStar(s, { busy: true })).toBe(false);
  });

  it("asks once: any answer ends it, and it survives a restart", () => {
    const store = memory();
    let s = loadStarState(store);
    for (let i = 0; i < STAR_MIN_DAYS; i++) s = recordOpen(s, day(i));
    s = answered(s);
    saveStarState(store, s);
    expect(shouldAskForStar(loadStarState(store), { busy: false })).toBe(false);
  });

  it("never nags when storage is unreadable or blocked", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(shouldAskForStar(loadStarState(broken), { busy: false })).toBe(false);
    expect(() => saveStarState(broken, { days: [], done: false })).not.toThrow();
    expect(shouldAskForStar(loadStarState({ getItem: () => "{not json" }), { busy: false })).toBe(false);
  });

  it("keeps local calendar days", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

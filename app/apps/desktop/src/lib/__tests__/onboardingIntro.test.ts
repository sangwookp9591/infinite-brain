// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { markOnboardingSeen, shouldShowOnboarding } from "../onboardingIntro";
import { galaxyStars } from "../../components/Onboarding";

function memory(): Pick<Storage, "getItem" | "setItem"> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe("first-launch intro", () => {
  it("shows once, then never again on this device", () => {
    const s = memory();
    expect(shouldShowOnboarding(s)).toBe(true);
    markOnboardingSeen(s);
    expect(shouldShowOnboarding(s)).toBe(false);
  });

  it("stays out of the way when storage is blocked", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(shouldShowOnboarding(blocked)).toBe(false);
    expect(() => markOnboardingSeen(blocked)).not.toThrow();
  });

  it("draws the same galaxy every launch, inside the frame", () => {
    const a = galaxyStars(140);
    expect(a).toEqual(galaxyStars(140));
    for (const s of a) {
      expect(s.x).toBeGreaterThan(-5);
      expect(s.x).toBeLessThan(105);
      expect(s.y).toBeGreaterThan(-5);
      expect(s.y).toBeLessThan(105);
    }
  });
});

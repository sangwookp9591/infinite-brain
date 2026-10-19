// SPDX-License-Identifier: Apache-2.0 AND LicenseRef-ReactBits-MIT-CommonsClause
import { describe, expect, it } from "vitest";
import { backEase, swellOf } from "../PulseStar";

describe("PulseStar curve", () => {
  it("starts and ends at rest", () => {
    expect(swellOf(0, 1.7)).toBe(0);
    expect(swellOf(1, 1.7)).toBeCloseTo(0, 6);
  });

  it("is fully shrunk exactly at the flip (40%)", () => {
    expect(swellOf(0.4, 1.7)).toBeCloseTo(1, 6);
  });

  it("rises monotonically into the flip", () => {
    let prev = -1;
    for (let t = 0; t <= 0.4; t += 0.02) { const s = swellOf(t, 1.7); expect(s).toBeGreaterThanOrEqual(prev); prev = s; }
  });

  it("rebounds past rest (negative swell = bigger than rest) only when overshoot > 0", () => {
    const min = (c: number) => Math.min(...Array.from({ length: 100 }, (_, i) => swellOf(0.4 + (i / 99) * 0.6, c)));
    expect(min(1.7)).toBeLessThan(-0.05);
    expect(min(0)).toBeGreaterThanOrEqual(-1e-9);
  });

  it("easeOutBack lands on 1", () => {
    expect(backEase(0, 1.7)).toBeCloseTo(0, 6);
    expect(backEase(1, 1.7)).toBeCloseTo(1, 6);
  });
});

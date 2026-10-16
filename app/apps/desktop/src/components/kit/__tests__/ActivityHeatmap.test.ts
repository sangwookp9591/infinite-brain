// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { buildModel } from "../ActivityHeatmap";

describe("ActivityHeatmap buildModel", () => {
  it("assigns activity levels and calendar lead/week columns", () => {
    const model = buildModel([
      { date: "2026-01-01", count: 0 },
      { date: "2026-01-02", count: 1 },
      { date: "2026-01-03", count: 2 },
      { date: "2026-01-04", count: 3 },
      { date: "2026-01-05", count: 4 },
    ], 1, [1, 2, 3], "ko-KR");
    expect(model.levels).toEqual([0, 1, 2, 3, 4]);
    expect(model.lead).toBe(3);
    expect(model.weeks).toBe(2);
  });
  it("returns a safe empty calendar for no valid input", () => {
    const model = buildModel([], 1, undefined, "ko-KR");
    expect(model.length).toBe(0);
    expect(model.weeks).toBe(0);
    expect(model.total).toBe(0);
    expect(model.levels).toEqual([]);
  });
});

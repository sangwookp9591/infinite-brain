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
  it("sums duplicate dates and ignores unsorted order", () => {
    const model = buildModel([
      { date: "2026-01-03", count: 1 },
      { date: "2026-01-01", count: 2 },
      { date: "2026-01-01", count: 3 },
    ], 1, [1, 2, 3], "ko-KR");
    expect(model.length).toBe(3);
    expect(model.counts).toEqual([5, 0, 1]);
    expect(model.total).toBe(6);
  });
  it("treats negative, NaN and invalid-date input as no activity", () => {
    const model = buildModel([
      { date: "2026-01-01", count: -5 },
      { date: "2026-01-02", count: Number.NaN },
      { date: "2026-01-03", count: 2 },
      { date: "not-a-date", count: 9 },
    ], 1, undefined, "ko-KR");
    expect(model.counts).toEqual([0, 0, 2]);
    expect(model.total).toBe(2);
    expect(model.levels).toEqual([0, 0, 2]);
  });
  it("derives default thresholds from the max count", () => {
    expect(buildModel([{ date: "2026-01-01", count: 0 }], 1, undefined, "ko-KR").thresholds).toEqual([1, 2, 3]);
    expect(buildModel([{ date: "2026-01-01", count: 40 }], 1, undefined, "ko-KR").thresholds).toEqual([10, 20, 30]);
  });
  it("aligns the first column to weekStartsOn 0 and 1", () => {
    const sunday = [{ date: "2026-01-04", count: 1 }, { date: "2026-01-10", count: 1 }];
    expect(buildModel(sunday, 0, undefined, "ko-KR")).toMatchObject({ lead: 0, weeks: 1 });
    expect(buildModel(sunday, 1, undefined, "ko-KR")).toMatchObject({ lead: 6, weeks: 2 });
    const monday = [{ date: "2026-01-05", count: 1 }];
    expect(buildModel(monday, 1, undefined, "ko-KR").lead).toBe(0);
    expect(buildModel(monday, 0, undefined, "ko-KR").lead).toBe(1);
  });
  it("counts days per level and labels months in the locale", () => {
    const days = Array.from({ length: 70 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), count: i % 2 }));
    const model = buildModel(days, 1, [1, 2, 3], "ko-KR");
    expect(model.perLevel.reduce((a, b) => a + b, 0)).toBe(70);
    expect(model.perLevel[0]).toBe(35);
    expect(model.months.map(m => m.label)).toEqual(["1월", "2월", "3월"]);
  });
});

// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { dialAngleToValue, dialValueToAngle } from "../ProgressDial";
it("maps the full sweep and clamps the gap to its nearest endpoint", () => {
  expect(dialValueToAngle(0)).toBe(110); expect(dialValueToAngle(100)).toBe(430);
  for (const value of [0, 1, 25, 62, 100]) expect(dialAngleToValue(dialValueToAngle(value))).toBe(value);
  expect(dialAngleToValue(90)).toBe(100); expect(dialAngleToValue(100)).toBe(0);
});
it("snaps fractional steps relative to the minimum", () => {
  expect(dialAngleToValue(dialValueToAngle(.37, .1, 1), .1, 1, .1)).toBe(.4);
});

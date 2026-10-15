// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { formatActivityTime } from "../ActivityLattice";
it("formats elapsed time without rounding up or wrapping minutes", () => {
  expect(formatActivityTime(-1)).toBe("0:00"); expect(formatActivityTime(59999)).toBe("0:59");
  expect(formatActivityTime(60000)).toBe("1:00"); expect(formatActivityTime(3600000)).toBe("60:00");
});

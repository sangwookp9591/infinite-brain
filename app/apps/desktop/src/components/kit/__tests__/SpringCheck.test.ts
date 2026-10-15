// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { checkProgress } from "../SpringCheck";
it("keeps spring overshoot within drawable bounds", () => {
 expect(checkProgress(-.2)).toBe(0); expect(checkProgress(1.2)).toBe(1); expect(checkProgress(.5)).toBe(.5);
});

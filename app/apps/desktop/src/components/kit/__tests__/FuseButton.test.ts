// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { fuseDuration, fuseRemaining } from "../FuseButton";
it("expires at the deadline and normalizes invalid durations", () => {
 expect(fuseRemaining(5000,1000)).toBe(4000); expect(fuseRemaining(5000,5000)).toBe(0); expect(fuseRemaining(5000,6000)).toBe(0);
 expect(fuseDuration(4)).toBe(4000); expect(fuseDuration(-1)).toBe(0); expect(fuseDuration(Infinity)).toBe(4000);
});

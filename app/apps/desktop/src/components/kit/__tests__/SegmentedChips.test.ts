// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { nextChip } from "../SegmentedChips";
it("wraps and skips disabled radios", () => {
 const items = [{value:"a",label:"A"},{value:"b",label:"B",disabled:true},{value:"c",label:"C"}];
 expect(nextChip(items,0,1)).toBe(2); expect(nextChip(items,0,-1)).toBe(2); expect(nextChip(items,2,1)).toBe(0);
 expect(nextChip(items.map(i => ({...i, disabled:true})),1,1)).toBe(1);
 expect(nextChip([],0,1)).toBe(0);
});

// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { snapSlider, sliderPosition, sliderValue } from "../BarSlider";
it("maps positions and snaps decimal steps and uneven endpoints", () => {
 expect(sliderValue(.5,60,120,1)).toBe(90); expect(sliderPosition(90,60,120)).toBe(.5);
 expect(sliderValue(-1,60,120,1)).toBe(60); expect(sliderValue(2,60,120,1)).toBe(120);
 expect(snapSlider(.31,0,1,.1)).toBe(.3); expect(snapSlider(9.9,0,10,3)).toBe(10);
 expect(snapSlider(NaN,12,24,1)).toBe(12); expect(sliderPosition(3,2,2)).toBe(0);
 expect(snapSlider(4,3,2,1)).toBe(3);
});

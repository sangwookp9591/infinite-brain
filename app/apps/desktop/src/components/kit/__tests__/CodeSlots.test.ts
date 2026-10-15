// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { parseJoinCode } from "../CodeSlots";
it("matches uppercase eight-character vault join codes", () => {
 expect(parseJoinCode(" k7m-px2ra\n")).toBe("K7MPX2RA"); expect(parseJoinCode("abc123456789")).toBe("ABC12345");
 expect(parseJoinCode("é한!😀")).toBe(""); expect(parseJoinCode("a1b2",2)).toBe("A1"); expect(parseJoinCode("a",0)).toBe("");
});

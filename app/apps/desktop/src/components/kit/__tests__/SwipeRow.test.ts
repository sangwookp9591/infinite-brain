// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { swipeOutcome } from "../SwipeRow";
it("requires deliberate left travel before opening or committing", () => {
  expect(swipeOutcome(30, 400)).toBe("close"); expect(swipeOutcome(-50, 400)).toBe("close");
  expect(swipeOutcome(-51, 400)).toBe("open"); expect(swipeOutcome(-259, 400)).toBe("open");
  expect(swipeOutcome(-260, 400)).toBe("commit"); expect(swipeOutcome(-120, 120)).toBe("open");
});

// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { glowPosition } from "../GlowCard";
it("increases glow toward edges and follows pointer direction", () => {
  expect(glowPosition(100, 50, 200, 100).edge).toBe(0);
  expect(glowPosition(200, 50, 200, 100)).toEqual({ angle: 90, edge: 1 });
  expect(glowPosition(100, 0, 200, 100).angle).toBe(0);
  expect(glowPosition(400, 50, 200, 100).edge).toBe(1);
});

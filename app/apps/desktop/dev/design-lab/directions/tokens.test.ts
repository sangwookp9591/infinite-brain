// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { contrast } from "../avatars/generators";
import { TOKENS, type DirectionId, type Mode } from "./tokens";

describe("direction colour systems meet 4.5:1 for text", () => {
  for (const dir of Object.keys(TOKENS) as DirectionId[]) {
    for (const mode of ["light", "dark"] as Mode[]) {
      const p = TOKENS[dir][mode];
      it(`${dir}/${mode}`, () => {
        for (const bg of [p.bg, p.panel, p.surface]) {
          expect(contrast(p.ink, bg)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p.muted, bg)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p.accent, bg)).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.accent, p.accentSoft)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.ink, p.accentSoft)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.danger, p.surface)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

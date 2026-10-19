// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { accentPalette, contrast } from "../accent";

const seeds = ["#3b74d1", "#3f8850", "#dc6e52", "#7f73ff", "#ffffff", "#000000", "#ffff00", "#777777"];

function seededSeeds(): string[] {
  let state = 0x5eed1234;
  return Array.from({ length: 200 }, () => {
    let hex = "#";
    for (let i = 0; i < 3; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      hex += (state >>> 24).toString(16).padStart(2, "0");
    }
    return hex;
  });
}

describe("accentPalette", () => {
  it("keeps both theme pairs in gamut and readable for preset, extreme, and seeded colors", () => {
    for (const seed of [...seeds, ...seededSeeds()]) {
      const palette = accentPalette(seed);
      for (const [theme, surface] of [[palette.light, "#ffffff"], [palette.dark, "#141830"]] as const) {
        expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/);
        expect(theme.hover).toMatch(/^#[0-9a-f]{6}$/);
        expect(theme.onAccent).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrast(theme.onAccent, theme.accent)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.accent, surface)).toBeGreaterThanOrEqual(3);
        expect(theme.hover).not.toBe(theme.accent);
      }
      expect(accentPalette(seed)).toEqual(palette);
    }
  });
});

it("keeps hover visibly distinct at the ends of the lightness range", () => {
  for (const seed of ["#000000", "#ffffff"]) {
    for (const pair of Object.values(accentPalette(seed))) {
      expect(contrast(pair.hover, pair.accent)).toBeGreaterThan(1.15);
    }
  }
});

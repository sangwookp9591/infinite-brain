// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { AVATAR_STYLES, PALETTE, TILE_BG, avatarSvg, contrast, hashSeed, MIN_NODE_RADIUS, MIN_STROKE } from "./generators";

const seeds = Array.from({ length: 500 }, (_, i) => `user-${i}@example.com`);

describe("avatar generators", () => {
  for (const style of AVATAR_STYLES) {
    describe(style, () => {
      it("is deterministic across calls and trims/lower-cases the seed", () => {
        for (const theme of ["light", "dark"] as const) {
          expect(avatarSvg("Ada@Example.com", { style, theme })).toBe(avatarSvg(" ada@example.com ", { style, theme }));
        }
      });
      it("gives different seeds different avatars (>= 99% unique out of 500)", () => {
        const set = new Set(seeds.map((s) => avatarSvg(s, { style, theme: "light" })));
        expect(set.size).toBeGreaterThanOrEqual(495);
      });
      it("keeps the 24 grid seeds all distinct", () => {
        const grid = Array.from({ length: 24 }, (_, i) => `grid-seed-${i}`);
        expect(new Set(grid.map((s) => avatarSvg(s, { style, theme: "dark" }))).size).toBe(24);
      });
      it("is a self-contained SVG: no ids, urls, scripts or external refs", () => {
        const svg = avatarSvg("x", { style, theme: "light" });
        expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 32 32"/);
        expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)|<script|<image|href=|\bid=|url\(/);
      });
      it("keeps every coordinate inside the tile", () => {
        for (const s of seeds.slice(0, 100)) {
          const svg = avatarSvg(s, { style, theme: "light" });
          for (const m of svg.matchAll(/(?:cx|cy)="([\d.]+)"/g)) {
            expect(Number(m[1])).toBeGreaterThanOrEqual(0);
            expect(Number(m[1])).toBeLessThanOrEqual(32);
          }
        }
      });
    });
  }
  it("the three styles look different for one seed", () => {
    const out = AVATAR_STYLES.map((style) => avatarSvg("same", { style, theme: "light" }));
    expect(new Set(out).size).toBe(3);
  });
  it("uses a spread of hues (every palette entry appears)", () => {
    const used = new Set(seeds.map((s) => /<(?:circle|ellipse|path)[^>]*(?:fill|stroke)="(#[0-9a-f]{6})"/.exec(avatarSvg(s, { style: "orbit", theme: "light" }).replace(/<circle cx="16" cy="16" r="16"[^>]*>/, ""))?.[1]));
    expect(used.size).toBe(PALETTE.length);
  });
  it("palette marks have >= 4.5:1 against the tile in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      for (const hue of PALETTE) expect(contrast(hue[theme], TILE_BG[theme])).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("palette hues differ in lightness-or-hue enough that no two entries are equal", () => {
    expect(new Set(PALETTE.map((p) => p.light)).size).toBe(PALETTE.length);
    expect(new Set(PALETTE.map((p) => p.dark)).size).toBe(PALETTE.length);
  });
  it("smallest feature stays >= 1px at 16px render size", () => {
    expect(MIN_STROKE * (16 / 32)).toBeGreaterThanOrEqual(1);
    expect(MIN_NODE_RADIUS * 2 * (16 / 32)).toBeGreaterThanOrEqual(2);
  });
  it("hashSeed is stable", () => {
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    expect(hashSeed("abc")).not.toBe(hashSeed("abd"));
  });
});

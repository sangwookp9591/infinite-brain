// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { NEURON_PALETTE, TILE_BG, contrast, hashSeed, neuronSvg } from "./neuron";

const seeds = (n: number) => Array.from({ length: n }, (_, i) => `user-${i}-vkZI6mlNCOsJ`);

describe("neuron avatar", () => {
  it("is deterministic and theme-specific", () => {
    for (const theme of ["light", "dark"] as const) {
      expect(neuronSvg("ada", theme)).toBe(neuronSvg("ada", theme));
    }
    expect(neuronSvg("ada", "light")).not.toBe(neuronSvg("ada", "dark"));
    expect(neuronSvg("ada")).toBe(neuronSvg("ada", "light"));
  });
  it("is case-sensitive (ids are)", () => {
    expect(neuronSvg("Ab")).not.toBe(neuronSvg("aB"));
  });
  it("gives 100 different seeds 100 different SVGs", () => {
    for (const theme of ["light", "dark"] as const) {
      expect(new Set(seeds(100).map((s) => neuronSvg(s, theme))).size).toBe(100);
    }
  });
  it("differs by SHAPE, not just colour (colour-blind safe)", () => {
    const shape = (s: string) => neuronSvg(s).replace(/#[0-9a-f]{6}/g, "#");
    expect(new Set(seeds(100).map(shape)).size).toBe(100);
  });
  it("is self-contained: no ids, urls, scripts or external refs", () => {
    for (const s of seeds(50)) {
      const svg = neuronSvg(s);
      expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 32 32"/);
      expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)|<script|<image|href=|\bid=|url\(|style=/);
    }
  });
  it("keeps every mark inside the circular tile", () => {
    for (const s of seeds(300)) {
      const svg = neuronSvg(s);
      for (const m of svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"\/>/g)) {
        const [x, y, r] = [Number(m[1]), Number(m[2]), Number(m[3])];
        if (r === 16) continue;
        expect(Math.hypot(x - 16, y - 16) + r).toBeLessThanOrEqual(15.5);
      }
    }
  });
  it("uses every palette hue", () => {
    const used = new Set(seeds(300).map((s) => /<g fill="(#[0-9a-f]{6})"/.exec(neuronSvg(s))?.[1]));
    expect(used.size).toBe(NEURON_PALETTE.length);
  });
  it("marks have >= 4.5:1 against the lavender tile in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      for (const hue of NEURON_PALETTE) {
        expect(contrast(hue[theme], TILE_BG[theme])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("hashSeed is stable", () => {
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    expect(hashSeed("abc")).not.toBe(hashSeed("abd"));
  });
});

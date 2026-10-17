// SPDX-License-Identifier: Apache-2.0
// Neuron avatars: a deterministic, dependency-free SVG per seed. A round soma,
// 3-5 even dendrites that each end in a small bulb, and one thicker axon with a
// larger bulb. People differ by SHAPE (arm count, axon direction, which arm
// forks, how the arms curve) as well as by hue, so the avatars stay apart for
// colour-blind viewers. Pure: no DOM, no network, no ids (nothing to scope).

export type AvatarTheme = "light" | "dark";

/** Lavender tiles that sit under the Orbit palette. */
export const TILE_BG: Record<AvatarTheme, string> = { light: "#ebe8fa", dark: "#2b2850" };

/**
 * Eight hues adapted from the Okabe-Ito colour-blind-safe set, tuned per theme
 * so every mark keeps >= 4.5:1 against {@link TILE_BG} (asserted in tests).
 */
export const NEURON_PALETTE: ReadonlyArray<Record<AvatarTheme, string>> = [
  { light: "#0b5aa0", dark: "#7cc0f5" }, // blue
  { light: "#a14000", dark: "#f5ae66" }, // orange
  { light: "#006a55", dark: "#58d8ac" }, // bluish green
  { light: "#86398c", dark: "#e298e6" }, // reddish purple
  { light: "#a82c19", dark: "#ff9580" }, // vermillion
  { light: "#005f82", dark: "#66d6f5" }, // sky
  { light: "#6a5200", dark: "#f2da55" }, // gold
  { light: "#3a4150", dark: "#cdd2de" }, // graphite
];

/** FNV-1a over UTF-16 code units with a murmur-style finaliser. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32, seeded from the exact seed string (case-sensitive: ids are). */
function rng(seed: string): () => number {
  let a = hashSeed(`neuron\u0000${seed}`);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Thinnest line and smallest dot, in the 32-unit viewBox (0.9px lines / 4px dots at 16px). */
export const DENDRITE_WIDTH = 1.8;
export const AXON_WIDTH = 2.2;
export const BULB_RADIUS = 2.1;
export const AXON_BULB_RADIUS = 3;
export const SOMA_RADIUS = 4.4;

/** Deterministic SVG (32x32 viewBox, scales to any size) for a seed. */
export function neuronSvg(seed: string, theme: AvatarTheme = "light"): string {
  const rand = rng(seed);
  const fg = NEURON_PALETTE[Math.floor(rand() * NEURON_PALETTE.length)][theme];
  const arms = 3 + Math.floor(rand() * 3); // 3..5
  const base = rand() * Math.PI * 2;
  const axon = Math.floor(rand() * arms);
  const forked = (axon + 1 + Math.floor(rand() * (arms - 1))) % arms; // never the axon
  const hand = rand() < 0.5 ? 1 : -1; // all arms bend the same way: tidy, not scribbled
  const cx = r1(16 + (rand() - 0.5) * 1.2);
  const cy = r1(16 + (rand() - 0.5) * 1.2);

  let strokes = "";
  let bulbs = "";
  for (let i = 0; i < arms; i++) {
    const isAxon = i === axon;
    const a = base + (i / arms) * Math.PI * 2 + (rand() - 0.5) * 0.24;
    const len = (isAxon ? 10 : 8.6) + rand() * 1.2;
    const bend = hand * (0.1 + rand() * 0.12);
    const mx = cx + Math.cos(a + bend) * len * 0.55;
    const my = cy + Math.sin(a + bend) * len * 0.55;
    const ex = cx + Math.cos(a) * len;
    const ey = cy + Math.sin(a) * len;
    const w = isAxon ? AXON_WIDTH : DENDRITE_WIDTH;
    strokes += `<path d="M${cx} ${cy}Q${r1(mx)} ${r1(my)} ${r1(ex)} ${r1(ey)}" stroke-width="${w}"/>`;
    bulbs += `<circle cx="${r1(ex)}" cy="${r1(ey)}" r="${isAxon ? AXON_BULB_RADIUS : BULB_RADIUS}"/>`;
    if (i === forked) {
      const f = a + hand * 0.7;
      const fx = mx + Math.cos(f) * 4;
      const fy = my + Math.sin(f) * 4;
      strokes += `<path d="M${r1(mx)} ${r1(my)}L${r1(fx)} ${r1(fy)}" stroke-width="${DENDRITE_WIDTH}"/>`;
      bulbs += `<circle cx="${r1(fx)}" cy="${r1(fy)}" r="${BULB_RADIUS}"/>`;
    }
  }
  const soma = `<circle cx="${cx}" cy="${cy}" r="${SOMA_RADIUS}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-hidden="true">` +
    `<circle cx="16" cy="16" r="16" fill="${TILE_BG[theme]}"/>` +
    `<g fill="${fg}" stroke="${fg}" stroke-linecap="round">` +
    `<g fill="none">${strokes}</g>` +
    `<g stroke="none">${bulbs}${soma}</g></g></svg>`
  );
}

/** WCAG 2.x contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// SPDX-License-Identifier: Apache-2.0
// Vault marks: the Orbit-style replacement for the old third-party preset glyphs. Same
// visual grammar as the Neuron avatars (a round hub, a few arms that curve one
// way, a bulb on each end, one heavier arm) on a rounded-square tile, so a vault
// reads as a place and a person as a circle. Deterministic per preset name,
// dependency-free, and id-free (nothing to scope when several are on a page).

import { hashSeed } from "./neuron";

export interface VaultMarkColors {
  /** Tile fill (the pastel). */
  fill: string;
  /** Mark colour (the deeper hue of the same family). */
  ink: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function rng(seed: string): () => number {
  let a = hashSeed(`vault\u0000${seed}`);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function channel(hex: string, i: number): number {
  return parseInt(hex.slice(i, i + 2), 16);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = channel(hex, i) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function markContrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Darken `ink` toward black until it holds `min`:1 on `fill` (graphics need 3:1). */
export function inkOn(fill: string, ink: string, min = 3): string {
  let out = ink;
  for (let step = 0; step < 20 && markContrast(out, fill) < min; step++) {
    out = "#" + [1, 3, 5].map((i) => Math.round(channel(out, i) * 0.9).toString(16).padStart(2, "0")).join("");
  }
  return out;
}

/** Deterministic 32x32 SVG for a preset name. `colors === null` is the "None" tile. */
export function vaultMarkSvg(icon: string, colors: VaultMarkColors | null): string {
  const rand = rng(icon);
  const arms = 3 + Math.floor(rand() * 3);
  const base = rand() * Math.PI * 2;
  const heavy = Math.floor(rand() * arms);
  const hand = rand() < 0.5 ? 1 : -1;
  const cx = r1(16 + (rand() - 0.5) * 1.2);
  const cy = r1(16 + (rand() - 0.5) * 1.2);
  const ink = colors ? inkOn(colors.fill, colors.ink) : "currentColor";

  let strokes = "";
  let bulbs = "";
  for (let i = 0; i < arms; i++) {
    const a = base + (i / arms) * Math.PI * 2 + (rand() - 0.5) * 0.24;
    const len = (i === heavy ? 10.5 : 9) + rand() * 1.2;
    const bend = hand * (0.1 + rand() * 0.12);
    const mx = cx + Math.cos(a + bend) * len * 0.55;
    const my = cy + Math.sin(a + bend) * len * 0.55;
    const ex = cx + Math.cos(a) * len;
    const ey = cy + Math.sin(a) * len;
    strokes += `<path d="M${cx} ${cy}Q${r1(mx)} ${r1(my)} ${r1(ex)} ${r1(ey)}" stroke-width="${i === heavy ? 2.2 : 1.8}"/>`;
    bulbs += `<circle cx="${r1(ex)}" cy="${r1(ey)}" r="${i === heavy ? 3 : 2.1}"/>`;
  }
  const tile = colors ? `<rect width="32" height="32" rx="9" fill="${colors.fill}"/>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-hidden="true">` +
    tile +
    `<g fill="${ink}" stroke="${ink}" stroke-linecap="round">` +
    `<g fill="none">${strokes}</g>` +
    `<g stroke="none">${bulbs}<circle cx="${cx}" cy="${cy}" r="4.4"/></g></g></svg>`
  );
}

// SPDX-License-Identifier: Apache-2.0
// Design-lab only: dependency-free, deterministic SVG avatar generators.
// Pure functions: the same (seed, style, theme) always yields the same string.
// No network, no external avatar service, no DOM.

export type AvatarStyle = "constellation" | "orbit" | "neuron";
export type AvatarTheme = "light" | "dark";
export const AVATAR_STYLES: readonly AvatarStyle[] = ["constellation", "orbit", "neuron"];

/** Tile backgrounds per theme. Marks are drawn in a hue from {@link PALETTE}. */
export const TILE_BG: Record<AvatarTheme, string> = { light: "#eef0f4", dark: "#232733" };

/**
 * Eight hues adapted from the Okabe–Ito colour-blind-safe set. Each is tuned
 * per theme so it keeps >= 4.5:1 against {@link TILE_BG} (checked in tests).
 */
export const PALETTE: ReadonlyArray<Record<AvatarTheme, string>> = [
  { light: "#0b5fa5", dark: "#6cb4f0" }, // blue
  { light: "#a84300", dark: "#f2a65a" }, // orange
  { light: "#00705a", dark: "#4fd1a5" }, // bluish green
  { light: "#8a3f8f", dark: "#d58ad9" }, // reddish purple
  { light: "#b0301d", dark: "#ff8a75" }, // vermillion
  { light: "#00668a", dark: "#5bd0f0" }, // sky
  { light: "#6e5800", dark: "#f0d54a" }, // gold
  { light: "#3d4452", dark: "#c3c9d6" }, // graphite
];

/** FNV-1a over UTF-16 code units, then a murmur-style finaliser. */
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

/** mulberry32 PRNG. */
export function rng(seed: string, salt = ""): () => number {
  let a = hashSeed(`${salt}\u0000${seed.trim().toLowerCase()}`);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const int = (rand: () => number, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

/** Smallest feature (in the 32-unit viewBox) any mark uses; keeps 16px legible. */
export const MIN_STROKE = 2;
export const MIN_NODE_RADIUS = 2.2;

function constellation(rand: () => number, fg: string): string {
  // 5x5 lattice; choose 5-7 distinct cells so shapes differ in topology.
  const cells = Array.from({ length: 25 }, (_, i) => i);
  const count = int(rand, 5, 7);
  const picked: number[] = [];
  while (picked.length < count) picked.push(cells.splice(int(rand, 0, cells.length - 1), 1)[0]);
  const pts = picked.map((c) => ({ x: 5 + (c % 5) * 5.5, y: 5 + Math.floor(c / 5) * 5.5 }));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${r1(p.x)} ${r1(p.y)}`).join("");
  const close = rand() < 0.5 ? "Z" : "";
  const star = int(rand, 0, count - 1);
  const nodes = pts.map((p, i) => i === star
    ? `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="4" fill="${fg}"/>`
    : `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${MIN_NODE_RADIUS}" fill="${fg}"/>`).join("");
  return `<path d="${d}${close}" fill="none" stroke="${fg}" stroke-width="${MIN_STROKE}" stroke-linejoin="round" stroke-linecap="round" opacity=".7"/>${nodes}`;
}

function orbit(rand: () => number, fg: string): string {
  const tilt = int(rand, 0, 17) * 10;
  const nucleus = r1(3 + rand() * 2.5);
  const ringCount = int(rand, 1, 2);
  let out = `<circle cx="16" cy="16" r="${nucleus}" fill="${fg}"/>`;
  const radii = ringCount === 1 ? [11.5] : [8, 13];
  radii.forEach((rx, i) => {
    const ry = r1(rx * (0.45 + rand() * 0.3));
    const dash = rand() < 0.4 ? ` stroke-dasharray="4 3"` : "";
    out += `<ellipse cx="16" cy="16" rx="${rx}" ry="${ry}" transform="rotate(${tilt + i * 55} 16 16)" fill="none" stroke="${fg}" stroke-width="${MIN_STROKE}"${dash} opacity=".75"/>`;
    const planets = int(rand, 1, 2);
    for (let k = 0; k < planets; k++) {
      const a = rand() * Math.PI * 2;
      const px = rx * Math.cos(a), py = ry * Math.sin(a);
      const rot = ((tilt + i * 55) * Math.PI) / 180;
      const x = 16 + px * Math.cos(rot) - py * Math.sin(rot);
      const y = 16 + px * Math.sin(rot) + py * Math.cos(rot);
      out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(MIN_NODE_RADIUS + rand() * 1.2)}" fill="${fg}"/>`;
    }
  });
  return out;
}

function neuron(rand: () => number, fg: string): string {
  const sx = r1(13 + rand() * 6), sy = r1(13 + rand() * 6);
  const arms = int(rand, 3, 5);
  const base = rand() * Math.PI * 2;
  let out = "";
  for (let i = 0; i < arms; i++) {
    const a = base + (i / arms) * Math.PI * 2 + (rand() - 0.5) * 0.6;
    const len = 9 + rand() * 4;
    const bend = (rand() - 0.5) * 0.9;
    const mx = sx + Math.cos(a + bend) * len * 0.55, my = sy + Math.sin(a + bend) * len * 0.55;
    const clamp = (v: number) => Math.min(27, Math.max(5, v));
    const ex = clamp(sx + Math.cos(a) * len), ey = clamp(sy + Math.sin(a) * len);
    out += `<path d="M${sx} ${sy}Q${r1(mx)} ${r1(my)} ${r1(ex)} ${r1(ey)}" fill="none" stroke="${fg}" stroke-width="${MIN_STROKE}" stroke-linecap="round"/>`;
    if (rand() < 0.6) {
      const f = a + (rand() < 0.5 ? 0.7 : -0.7);
      out += `<path d="M${r1(mx)} ${r1(my)}L${r1(clamp(mx + Math.cos(f) * 5))} ${r1(clamp(my + Math.sin(f) * 5))}" fill="none" stroke="${fg}" stroke-width="${MIN_STROKE}" stroke-linecap="round"/>`;
    }
    if (i === 0) out += `<circle cx="${r1(ex)}" cy="${r1(ey)}" r="${MIN_NODE_RADIUS + 0.6}" fill="${fg}"/>`;
  }
  return `${out}<circle cx="${sx}" cy="${sy}" r="${r1(4 + rand() * 1.5)}" fill="${fg}"/>`;
}

const DRAW: Record<AvatarStyle, (rand: () => number, fg: string) => string> = { constellation, orbit, neuron };

export interface AvatarOptions { style: AvatarStyle; theme: AvatarTheme; circle?: boolean }

/** Deterministic SVG (32x32 viewBox, scalable) for any id/email/name. */
export function avatarSvg(seed: string, { style, theme, circle = true }: AvatarOptions): string {
  const rand = rng(seed, style);
  const fg = PALETTE[int(rand, 0, PALETTE.length - 1)][theme];
  const bg = TILE_BG[theme];
  const tile = circle ? `<circle cx="16" cy="16" r="16" fill="${bg}"/>` : `<rect width="32" height="32" rx="8" fill="${bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-hidden="true">${tile}${DRAW[style](rand, fg)}</svg>`;
}

/** WCAG 2.x contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

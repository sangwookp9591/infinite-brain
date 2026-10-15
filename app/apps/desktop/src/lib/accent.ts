// SPDX-License-Identifier: Apache-2.0

type Lab = { l: number; a: number; b: number };
export type Pair = { accent: string; hover: string; onAccent: string };

const LIGHT_SURFACE = "#ffffff";
const DARK_SURFACE = "#18181b";
const WHITE = "#ffffff";
const INK = "#18181b";

function linear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

function toOklab(hex: string): Lab {
  const [r, g, b] = hexRgb(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function fromOklch(l: number, c: number, h: number): string | null {
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const ll = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const ss = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss,
    -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss,
    -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss,
  ];
  if (rgb.some((channel) => channel < -1e-7 || channel > 1 + 1e-7)) return null;
  return `#${rgb.map((channel) => Math.round(255 * (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055)).toString(16).padStart(2, "0")).join("")}`;
}

function gamutMapped(l: number, c: number, h: number): string {
  let low = 0;
  let high = c;
  let result = fromOklch(l, low, h)!;
  for (let i = 0; i < 16; i += 1) {
    const mid = (low + high) / 2;
    const candidate = fromOklch(l, mid, h);
    if (candidate) {
      low = mid;
      result = candidate;
    } else high = mid;
  }
  return result;
}

function atLightness(l: number, c: number, h: number): string {
  return fromOklch(l, c, h) ?? gamutMapped(l, c, h);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexRgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function derive(seed: string, dark: boolean): Pair {
  const { l, a, b } = toOklab(seed);
  const c = Math.hypot(a, b);
  const h = Math.atan2(b, a);
  const surface = dark ? DARK_SURFACE : LIGHT_SURFACE;
  const start = dark ? Math.max(l, 0.76) : Math.min(l, 0.9);
  const step = dark ? 0.01 : -0.01;
  let accent = atLightness(start, c, h);
  for (let i = 0; i < 100; i += 1) {
    if (contrast(accent, surface) >= 3 && Math.max(contrast(WHITE, accent), contrast(INK, accent)) >= 4.5) break;
    accent = atLightness(Math.max(0, Math.min(1, start + step * (i + 1))), c, h);
  }
  const lightness = toOklab(accent).l;
  // Hover steps away from the surface (the other way at the end of the range)
  // until it is visibly distinct; OKLab L is compressed near black, so a fixed
  // 0.06 step is not enough there.
  const dir = (dark ? 1 : -1) * (lightness + (dark ? 0.06 : -0.06) >= 0 && lightness + (dark ? 0.06 : -0.06) <= 1 ? 1 : -1);
  let hover = accent;
  for (let i = 2; i <= 20 && contrast(hover, accent) < 1.15; i += 1) {
    hover = atLightness(Math.max(0, Math.min(1, lightness + dir * 0.03 * i)), c, h);
  }
  return { accent, hover, onAccent: contrast(WHITE, accent) >= 4.5 ? WHITE : INK };
}

export function accentPalette(seed: string): { light: Pair; dark: Pair } {
  return { light: derive(seed, false), dark: derive(seed, true) };
}

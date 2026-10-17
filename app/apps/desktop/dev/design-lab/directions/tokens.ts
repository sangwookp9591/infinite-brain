// SPDX-License-Identifier: Apache-2.0
// Colour systems for the three identity directions (spec 2026-10-17).
// Kept as data so tests can assert the 4.5:1 text contrast rule.
export type DirectionId = "orbit" | "synapse" | "folio";
export type Mode = "light" | "dark";
export interface Palette {
  bg: string; panel: string; surface: string; ink: string; muted: string;
  line: string; accent: string; onAccent: string; accentSoft: string; danger: string;
}
export const TOKENS: Record<DirectionId, Record<Mode, Palette>> = {
  orbit: {
    light: { bg: "#f1f2f9", panel: "#f8f9fd", surface: "#ffffff", ink: "#14162b", muted: "#555a74", line: "#dcdeed", accent: "#4a3fd4", onAccent: "#ffffff", accentSoft: "#e9e7ff", danger: "#b3261e" },
    dark: { bg: "#080a16", panel: "#0e1122", surface: "#141830", ink: "#e9ebf9", muted: "#a2a8c8", line: "#262b4a", accent: "#a29bff", onAccent: "#0b0c1e", accentSoft: "#232150", danger: "#ff8f87" },
  },
  synapse: {
    light: { bg: "#f4f4f5", panel: "#fafafa", surface: "#ffffff", ink: "#09090b", muted: "#52525b", line: "#dedee2", accent: "#3f6212", onAccent: "#ffffff", accentSoft: "#ecf5d8", danger: "#b42318" },
    dark: { bg: "#08080a", panel: "#0d0d10", surface: "#121215", ink: "#f2f2f4", muted: "#a1a1aa", line: "#25252b", accent: "#c6f135", onAccent: "#0b1100", accentSoft: "#1f2a0a", danger: "#ff8a80" },
  },
  folio: {
    light: { bg: "#f2e9d8", panel: "#f7f0e1", surface: "#fffaf0", ink: "#2b2118", muted: "#6a5847", line: "#e0d3ba", accent: "#a8421f", onAccent: "#fffaf0", accentSoft: "#f7dfd2", danger: "#a82020" },
    dark: { bg: "#17130e", panel: "#1e1912", surface: "#27211a", ink: "#f2e9d8", muted: "#c0b29b", line: "#3a3126", accent: "#f0916f", onAccent: "#2a1208", accentSoft: "#43251a", danger: "#ff9a8a" },
  },
};
export const DIRECTIONS: Record<DirectionId, { name: string; concept: string; avatar: "orbit" | "neuron" | "constellation" }> = {
  orbit: { name: "Orbit", concept: "Calm, floating islands in a night sky.", avatar: "orbit" },
  synapse: { name: "Synapse", concept: "Fast, dense, keyboard-first signal.", avatar: "neuron" },
  folio: { name: "Folio", concept: "A warm paper notebook for everyone.", avatar: "constellation" },
};
export function cssVars(p: Palette): Record<string, string> {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v]));
}

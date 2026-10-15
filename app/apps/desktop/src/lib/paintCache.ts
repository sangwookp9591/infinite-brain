// SPDX-License-Identifier: Apache-2.0
import type { ThemeMode } from "./theme";

export const PAINT_CACHE_KEY = "context.appearancePaint.v1";
export const ACCENT_CUSTOM_PROPERTIES = [
  "--accent-custom-light", "--accent-custom-light-hover", "--on-accent-custom-light",
  "--accent-custom-dark", "--accent-custom-dark-hover", "--on-accent-custom-dark",
] as const;

export function readPaintCache(raw: string | null): {
  theme: ThemeMode;
  accentVars: Record<string, string> | null;
} | null {
  try {
    const cached = JSON.parse(raw ?? "null");
    if (!cached || !["light", "dark", "system"].includes(cached.theme)) return null;
    const vars = cached.accentVars;
    const valid = vars && typeof vars === "object" && !Array.isArray(vars)
      && Object.keys(vars).length === 6
      && ACCENT_CUSTOM_PROPERTIES.every((key) => Object.prototype.hasOwnProperty.call(vars, key))
      && Object.entries(vars).every(([key, value]) =>
        /^--(on-)?accent-custom-(light|dark)(-hover)?$/.test(key)
        && typeof value === "string" && /^#[0-9a-f]{6}$/.test(value));
    return { theme: cached.theme, accentVars: valid ? vars : null };
  } catch {
    return null;
  }
}

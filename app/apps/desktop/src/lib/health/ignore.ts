// "I know — leave it." The Health page's ignore list.
//
// A warning a person has looked at and decided to live with must be able to
// step aside, or the page trains them to stop reading it. Two kinds of thing
// can be ignored: a whole CHECK (by id: "I don't care about duplicate titles in
// this vault") and one ISSUE row (by its stable key). Both are remembered per
// vault, on this device — like the properties mode or the theme, it is a
// preference about how one person reads the page, not a fact about the vault,
// so it does not travel in `.context/` and never reaches a teammate.
//
// Pure helpers here; the React hook that owns the state is `useHealthIgnores`.

import type { VaultCheckId } from "./types";

export interface HealthIgnores {
  checks: VaultCheckId[];
  issues: string[];
}

const EMPTY: HealthIgnores = { checks: [], issues: [] };

/** One key per vault folder, so two vaults never share a list. */
export function ignoreStorageKey(vaultPath: string): string {
  return `context.healthIgnored:${vaultPath}`;
}

/** Whatever this device remembers for the vault; empty when nothing, when
 *  storage is unavailable, or when the stored value is not the shape we write
 *  (a corrupted entry must not throw the page). */
export function readIgnores(vaultPath: string | null): HealthIgnores {
  if (!vaultPath) return EMPTY;
  try {
    const raw = localStorage.getItem(ignoreStorageKey(vaultPath));
    if (!raw) return EMPTY;
    return sanitize(JSON.parse(raw));
  } catch {
    return EMPTY;
  }
}

export function writeIgnores(vaultPath: string | null, ignores: HealthIgnores): void {
  if (!vaultPath) return;
  try {
    const key = ignoreStorageKey(vaultPath);
    if (ignores.checks.length === 0 && ignores.issues.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(ignores));
    }
  } catch {
    /* localStorage unavailable — the choice stays in-memory only */
  }
}

/** Accept only arrays of strings; anything else reads as "nothing ignored". */
export function sanitize(value: unknown): HealthIgnores {
  if (!value || typeof value !== "object") return EMPTY;
  const v = value as { checks?: unknown; issues?: unknown };
  const strings = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
  return { checks: strings(v.checks) as VaultCheckId[], issues: strings(v.issues) };
}

/** Add or remove `key`, without duplicates, preserving order. */
export function withKey<T extends string>(list: readonly T[], key: T, present: boolean): T[] {
  const has = list.includes(key);
  if (present === has) return [...list];
  return present ? [...list, key] : list.filter((k) => k !== key);
}

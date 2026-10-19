// SPDX-License-Identifier: Apache-2.0
// UI language: English and Korean.
//
// The English text IS the key: `t("Appearance")`. A string with no Korean entry
// shows its English text, so a screen is never blank or half-keyed, and screens
// can be translated one at a time without touching the ones that are not.
// Placeholders are `{name}`: `t("Version {v} found", { v })`.
//
// The choice is "system" (follow the OS), "en" or "ko". It lives in localStorage
// like the theme, because it must be known before the first paint and must not
// wait for a server round-trip. `html[lang]` follows it, which also lets the
// browser pick the right Hangul/Latin font fallbacks.
import { useSyncExternalStore } from "react";
import { ko } from "./ko";

export type Locale = "en" | "ko";
export type LocaleChoice = "system" | Locale;

export const LOCALE_CHOICES: ReadonlyArray<{ id: LocaleChoice; label: string }> = [
  { id: "system", label: "System" },
  { id: "en", label: "English" },
  // Each language is named in itself, so someone who cannot read the current
  // one can still find theirs.
  { id: "ko", label: "한국어" },
];

const KEY = "infinitebrain.locale";
const DICTS: Record<Locale, Record<string, string>> = { en: {}, ko };

/** `navigator.language` → a supported locale; anything else is English. */
export function resolveSystemLocale(languages: readonly string[] | undefined): Locale {
  for (const l of languages ?? []) {
    const base = l.toLowerCase().split("-")[0];
    if (base === "ko") return "ko";
    if (base === "en") return "en";
  }
  return "en";
}

export function readLocaleChoice(storage: Pick<Storage, "getItem"> | null): LocaleChoice {
  try {
    const v = storage?.getItem(KEY);
    return v === "en" || v === "ko" ? v : "system";
  } catch {
    return "system";
  }
}

export function resolveLocale(choice: LocaleChoice, languages: readonly string[] | undefined): Locale {
  return choice === "system" ? resolveSystemLocale(languages) : choice;
}

/** Look `text` up in `locale`, fill `{placeholders}`. Pure, so it is unit-tested. */
export function translate(
  locale: Locale,
  text: string,
  vars?: Record<string, string | number>,
): string {
  const raw = DICTS[locale][text] ?? text;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const hasWindow = typeof window !== "undefined";
let choice: LocaleChoice = hasWindow ? readLocaleChoice(window.localStorage) : "system";
let locale: Locale = resolveLocale(choice, hasWindow ? navigator.languages : undefined);
const listeners = new Set<() => void>();

function paint(): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

export function getLocale(): Locale { return locale; }
export function getLocaleChoice(): LocaleChoice { return choice; }

export function setLocaleChoice(next: LocaleChoice): void {
  choice = next;
  try {
    if (next === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, next);
  } catch {
    /* in-memory only: the choice lasts until the app closes */
  }
  locale = resolveLocale(next, hasWindow ? navigator.languages : undefined);
  paint();
  for (const l of listeners) l();
}

/** Call once at startup, before the first render. */
export function initLocale(): void { paint(); }

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Non-React code (toasts, IPC error paths) translates with the current locale. */
export function t(text: string, vars?: Record<string, string | number>): string {
  return translate(locale, text, vars);
}

/** In a component: re-renders when the language changes. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLocale, getLocale);
  return t;
}

export function useLocaleChoice(): LocaleChoice {
  return useSyncExternalStore(subscribe, getLocaleChoice, getLocaleChoice);
}

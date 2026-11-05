// SPDX-License-Identifier: Apache-2.0
// How this device uses Infinite Brain: on your own ("personal") or with a team.
// Asked once at the end of the first-launch intro, changeable in Account
// settings → Appearance. Personal hides the team-only surfaces (Members and
// access, Billing/Plan, Security history, Office collaboration); it is a
// display preference only — the server still authorizes everything, so no
// permission depends on it.
import { useSyncExternalStore } from "react";

export type UsageMode = "personal" | "team";

const KEY = "infinitebrain.usage.v1";

/** The recorded choice, or null when this device has not chosen yet. */
export function readUsageMode(storage: Pick<Storage, "getItem"> | null): UsageMode | null {
  try {
    const v = storage?.getItem(KEY);
    return v === "personal" || v === "team" ? v : null;
  } catch {
    return null;
  }
}

/** Unchosen behaves like the app always has: every team surface stays. */
export function effectiveUsageMode(mode: UsageMode | null): UsageMode {
  return mode ?? "team";
}

const hasWindow = typeof window !== "undefined";
let current: UsageMode | null = hasWindow ? readUsageMode(window.localStorage) : null;
const listeners = new Set<() => void>();

export function getUsageMode(): UsageMode | null {
  return current;
}

export function setUsageMode(next: UsageMode): void {
  current = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    /* in-memory only: the choice lasts until the app closes */
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The recorded choice (null = not asked yet). Re-renders when it changes. */
export function useUsageMode(): UsageMode | null {
  return useSyncExternalStore(subscribe, getUsageMode, getUsageMode);
}

/** True when team-only surfaces should be hidden on this device. */
export function useIsPersonal(): boolean {
  return effectiveUsageMode(useUsageMode()) === "personal";
}

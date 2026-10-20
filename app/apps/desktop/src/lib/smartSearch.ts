// SPDX-License-Identifier: Apache-2.0
// Smart search state shared by the settings tab, the first-run card and the
// search box: one status, fed by the `smart-search` event, so every surface
// shows the same thing. The engine itself is Rust (`src-tauri/src/semantic.rs`).
import { useSyncExternalStore } from "react";
import * as ipc from "./ipc";
import type { SmartSearchStatus } from "./ipc";

let current: SmartSearchStatus | null = null;
const listeners = new Set<() => void>();
let started = false;

function set(next: SmartSearchStatus) {
  current = next;
  listeners.forEach((l) => l());
}

function start() {
  if (started) return;
  started = true;
  void ipc.onSmartSearch(set).catch(() => {});
  // A vault switch changes the counts without any smart-search event.
  void ipc.onIndexReady(() => void refreshSmartSearch()).catch(() => {});
  void refreshSmartSearch();
}

export async function refreshSmartSearch(): Promise<void> {
  try {
    set(await ipc.smartSearchStatus());
  } catch {
    // No Tauri host (tests, the browser preview): nothing to show.
  }
}

/** The current status; `null` until the first answer. */
export function useSmartSearch(): SmartSearchStatus | null {
  start();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** Turn it on. Progress arrives as events; the result is the final state. */
export async function enableSmartSearch(includeImages?: boolean): Promise<SmartSearchStatus> {
  const s = await ipc.smartSearchEnable(includeImages);
  set(s);
  return s;
}

export async function disableSmartSearch(): Promise<void> {
  set(await ipc.smartSearchDisable());
}

export async function setSmartSearchWhen(when: "idle" | "manual"): Promise<void> {
  set(await ipc.smartSearchSetWhen(when));
}

export async function clearSmartSearch(): Promise<void> {
  set(await ipc.smartSearchClear());
}

/** Whole megabytes, decimal like Finder (310 MB, not 296 MiB). */
export const megabytes = (bytes: number) => Math.round(bytes / 1_000_000);

/** The download size shown before anything is downloaded (Q8_0, `semantic.rs`). */
export const MODEL_MB = 310;

// ---- the corner card ------------------------------------------------------------

// The first-run card and the star ask share a corner; the star waits while
// this card is open, whatever it is showing.
let cardOpen = false;
const cardListeners = new Set<() => void>();

export function setSmartSearchCardOpen(open: boolean): void {
  if (cardOpen === open) return;
  cardOpen = open;
  cardListeners.forEach((l) => l());
}

export function useSmartSearchCardOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      cardListeners.add(l);
      return () => cardListeners.delete(l);
    },
    () => cardOpen,
  );
}

// ---- the first-run question --------------------------------------------------

export const ASKED_KEY = "infinitebrain.smartSearch.asked.v1";

/** Ask once, only while it has never been downloaded. Unreadable storage means
 *  never ask: a question that comes back every launch is worse than none. */
export function shouldAskSmartSearch(storage: Pick<Storage, "getItem"> | null, status: SmartSearchStatus | null): boolean {
  if (status?.state !== "off" || status.downloaded) return false;
  try {
    return storage?.getItem(ASKED_KEY) == null;
  } catch {
    return false;
  }
}

export function markSmartSearchAsked(storage: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(ASKED_KEY, new Date().toISOString());
  } catch {
    // Unwritable storage: the card closes for this session either way.
  }
}

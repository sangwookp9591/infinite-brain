// SPDX-License-Identifier: Apache-2.0
// "Enjoying Infinite Brain?" — a one-time, polite ask to star the repo.
//
// Policy (all pure, so it is tested without a DOM):
//  - count distinct days the app was opened, not launches: someone who restarts
//    ten times in an afternoon has not "used it for a while";
//  - ask only after STAR_MIN_DAYS days, and never in the first launch's tour;
//  - ask once. A star click, "Not now" and "Don't ask again" all end it for good
//    (a nag is the fastest way to lose the star and the user);
//  - it is a footnote to a good moment, so the caller supplies `busy` (another
//    dialog, a sync problem, an update restart) and the answer is "not now".
export const REPO_URL = "https://github.com/sangwookp9591/infinite-brain";
export const STAR_MIN_DAYS = 5;

const KEY = "infinitebrain.starPrompt.v1";

export interface StarState {
  /** Local calendar days (YYYY-MM-DD) the app was opened, oldest first, capped. */
  days: string[];
  /** The user answered; never ask again. */
  done: boolean;
}

const EMPTY: StarState = { days: [], done: false };
const MAX_DAYS = 60;

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function loadStarState(storage: Pick<Storage, "getItem"> | null): StarState {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const v = JSON.parse(raw) as Partial<StarState>;
    return {
      days: Array.isArray(v.days) ? v.days.filter((x) => typeof x === "string").slice(-MAX_DAYS) : [],
      done: v.done === true,
    };
  } catch {
    // Unreadable or blocked storage: behave as already answered. Asking on
    // every launch because we cannot remember is the nag we promised not to be.
    return { days: [], done: true };
  }
}

export function saveStarState(storage: Pick<Storage, "setItem"> | null, s: StarState): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* worst case we ask again next launch */
  }
}

/** Record that the app was opened on `now`'s day. */
export function recordOpen(s: StarState, now: Date): StarState {
  const k = dayKey(now);
  if (s.days.includes(k)) return s;
  return { ...s, days: [...s.days, k].slice(-MAX_DAYS) };
}

export function shouldAskForStar(s: StarState, opts: { busy: boolean }): boolean {
  return !s.done && !opts.busy && s.days.length >= STAR_MIN_DAYS;
}

export function answered(s: StarState): StarState {
  return { ...s, done: true };
}

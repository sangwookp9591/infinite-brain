/* Scheduling for the Activity feed's server listings (Trash, shrink events,
   sync pauses, expired invitations). Those four routes were about a quarter of
   every request production saw: one client asked each of them 36 times in 15
   minutes, in bursts of 2–4 within 10 s, because every event-shaped trigger
   (a structural `registry` frame, an `activity` frame, a reconcile-report
   change, a vault reconnect, a focus or visibility flip) refetched on its own,
   5 s apart at best, and a refetch started while one was still in flight sent
   a second request.

   Two rules here, both pure so they test without React:
   - `createRefreshScheduler`: event triggers `request()` a refresh and are
     coalesced to at most one per `minGapMs` — leading (an idle feed answers at
     once) and trailing (the last change in a burst is always fetched). An
     explicit user action (`now()`: the panel opening) runs at once and counts
     as the latest run.
   - `sharedInFlight`: at most one request per key (route + vault) on the wire;
     a second caller while it is pending gets the same promise. */

/** Minimum gap between two event-triggered refreshes of the feed's listings. */
export const EVENT_REFRESH_MIN_GAP_MS = 20_000;

export interface RefreshScheduler {
  /** An event says the listings may have moved: run now if the last run is at
   *  least `minGapMs` old, else once when it is (one trailing run per burst). */
  request(): void;
  /** An explicit user action: run at once, absorbing any pending trailing run. */
  now(): void;
  /** Drop a pending trailing run. The scheduler stays usable (StrictMode
   *  re-runs effects on the same instance). */
  cancel(): void;
}

export interface RefreshSchedulerOptions {
  minGapMs: number;
  run: () => void;
  clock?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function createRefreshScheduler(opts: RefreshSchedulerOptions): RefreshScheduler {
  const clock = opts.clock ?? Date.now;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let lastRun = Number.NEGATIVE_INFINITY;
  let trailing: unknown = null;

  const cancel = () => {
    if (trailing != null) clearTimer(trailing);
    trailing = null;
  };
  const fire = () => {
    trailing = null;
    lastRun = clock();
    opts.run();
  };
  return {
    request() {
      if (trailing != null) return;
      const wait = lastRun + opts.minGapMs - clock();
      if (wait <= 0) fire();
      else trailing = setTimer(fire, wait);
    },
    now() {
      cancel();
      fire();
    },
    cancel,
  };
}

const inFlight = new Map<string, Promise<unknown>>();

/** One request per `key` at a time: a caller while one is pending shares it. */
export function sharedInFlight<T>(key: string, start: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const p = start().finally(() => {
    if (inFlight.get(key) === p) inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p;
}

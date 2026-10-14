// "Wait until the user isn't in the middle of something."
//
// The auto-updater installs new bytes silently, but the RELAUNCH is violent:
// the window disappears and comes back. Doing that under someone's fingers is
// the whole reason update prompts exist, so instead of asking we wait for a
// pause — no keystroke, no pointer input for a few seconds — and slip the
// restart into it.
//
// Everything here is pure and injectable (clock, timers, the event source,
// the "is the window even in front of them" probe) so the whole policy is
// unit-testable in a plain Node environment with no DOM.

/** No input for this long, with the window in front of the user, counts as quiet. */
export const QUIET_IDLE_MS = 5_000;
/** After this long waiting, stop holding out for a real lull. */
export const QUIET_CEILING_MS = 10 * 60 * 1000;
/** Past the ceiling, any pause at least this long will do. */
export const QUIET_FLOOR_MS = 1_000;

export interface QuietMomentOptions {
  /** Idle stretch that counts as quiet before the ceiling. */
  idleMs?: number;
  /** How long to hold out for a real lull before lowering the bar. */
  ceilingMs?: number;
  /** The pause accepted once the ceiling has lapsed. */
  floorMs?: number;
  /** Clock, in ms. */
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /**
   * Register an "the user did something / something changed" callback; returns
   * an unsubscribe. Every call re-evaluates the wait, so a source may fire for
   * focus changes as well as for real input.
   */
  subscribe?: (onActivity: () => void) => () => void;
  /**
   * True when the window is not in front of the user (blurred, hidden, another
   * desktop). Away is quiet by definition — restart now rather than waiting out
   * an idle timer nobody is watching.
   */
  isAway?: () => boolean;
}

/** Input events that mean a person is actively working in the window. */
const ACTIVITY_EVENTS = [
  "keydown",
  "pointerdown",
  "pointermove",
  "wheel",
  "blur",
  "focus",
] as const;

/** Production event source: real input in the real window. A no-op off-DOM. */
function domActivitySource(onActivity: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }
  const opts = { capture: true, passive: true } as const;
  for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, opts);
  document.addEventListener("visibilitychange", onActivity);
  return () => {
    for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity, opts);
    document.removeEventListener("visibilitychange", onActivity);
  };
}

/** Production away probe. Off-DOM we assume the window is in front of them. */
function domIsAway(): boolean {
  if (typeof document === "undefined") return false;
  if (document.visibilityState === "hidden") return true;
  return !document.hasFocus?.();
}

/**
 * Resolve at the next quiet moment.
 *
 * Quiet means one of:
 * - the window is away (blurred/hidden) — resolves on the spot, and
 * - no input for `idleMs`, which any keystroke or pointer move restarts.
 *
 * The hold-out is not unbounded: once `ceilingMs` has passed the bar drops to
 * `floorMs`, so even a relentless typist gets restarted at the next real pause
 * instead of running a stale build forever.
 *
 * Never rejects — the worst case is a longer wait.
 */
export function waitForQuietMoment(options: QuietMomentOptions = {}): Promise<void> {
  const idleMs = options.idleMs ?? QUIET_IDLE_MS;
  const ceilingMs = options.ceilingMs ?? QUIET_CEILING_MS;
  const floorMs = options.floorMs ?? QUIET_FLOOR_MS;
  const now = options.now ?? (() => Date.now());
  const schedule =
    options.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel =
    options.clearTimeout ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const subscribe = options.subscribe ?? domActivitySource;
  const isAway = options.isAway ?? domIsAway;

  return new Promise<void>((resolve) => {
    const startedAt = now();
    let lastActivity = startedAt;
    let timer: unknown = null;
    let unsubscribe: (() => void) | null = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer != null) cancel(timer);
      timer = null;
      unsubscribe?.();
      resolve();
    };

    // Re-decide from scratch: are we quiet yet, and if not, when could we be?
    const evaluate = () => {
      if (settled) return;
      if (timer != null) {
        cancel(timer);
        timer = null;
      }
      // Nobody is looking at the window — that is as quiet as it gets.
      if (isAway()) {
        finish();
        return;
      }
      const elapsed = now() - startedAt;
      const pastCeiling = elapsed >= ceilingMs;
      const required = pastCeiling ? floorMs : idleMs;
      const idle = now() - lastActivity;
      if (idle >= required) {
        finish();
        return;
      }
      // Wake at whichever comes first: the moment this pause would qualify, or
      // the moment the ceiling lapses and the bar drops to `floorMs`.
      let delay = required - idle;
      if (!pastCeiling) delay = Math.min(delay, ceilingMs - elapsed);
      timer = schedule(evaluate, Math.max(0, delay));
    };

    const onActivity = () => {
      if (settled) return;
      lastActivity = now();
      evaluate();
    };

    unsubscribe = subscribe(onActivity);
    evaluate();
  });
}

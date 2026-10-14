import { describe, expect, it } from "vitest";

import { waitForQuietMoment } from "../quietMoment";

// The auto-updater restarts the app on its own, so the only thing standing
// between a user mid-sentence and a window that vanishes is this wait. Clock,
// timers, the activity source and the "are they even looking" probe are all
// injected, so the whole policy runs deterministically with no DOM.

/** A fake clock + timer queue + activity source, driven by `advance`. */
function harness(away = false) {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let listener: (() => void) | null = null;
  let isAway = away;

  return {
    options: {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { at: now + ms, fn });
        return id;
      },
      clearTimeout: (handle: unknown) => {
        timers.delete(handle as number);
      },
      subscribe: (onActivity: () => void) => {
        listener = onActivity;
        return () => {
          listener = null;
        };
      },
      isAway: () => isAway,
    },
    /** Run the clock forward, firing due timers in order. */
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | null = null;
        for (const entry of timers) {
          if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) due = entry;
        }
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
    /** A keystroke, a pointer move, a focus change. */
    activity() {
      listener?.();
    },
    setAway(value: boolean) {
      isAway = value;
    },
    get subscribed() {
      return listener !== null;
    },
  };
}

/** Track settlement without racing the microtask queue in every assertion. */
function watch(promise: Promise<void>) {
  const box = { done: false };
  void promise.then(() => {
    box.done = true;
  });
  return box;
}

const flush = () => new Promise((r) => setImmediate(r));

const opts = { idleMs: 5_000, ceilingMs: 20_000, floorMs: 1_000 };

describe("waitForQuietMoment", () => {
  it("resolves after an uninterrupted idle stretch", async () => {
    const h = harness();
    const done = watch(waitForQuietMoment({ ...opts, ...h.options }));

    h.advance(4_999);
    await flush();
    expect(done.done).toBe(false);

    h.advance(1);
    await flush();
    expect(done.done).toBe(true);
    expect(h.subscribed).toBe(false);
  });

  it("restarts the idle window on every keystroke", async () => {
    const h = harness();
    const done = watch(waitForQuietMoment({ ...opts, ...h.options }));

    h.advance(4_000);
    h.activity();
    h.advance(4_000);
    await flush();
    // 8s in, but only 4s since the last keystroke — still typing.
    expect(done.done).toBe(false);

    h.advance(1_000);
    await flush();
    expect(done.done).toBe(true);
  });

  it("treats a blurred or hidden window as quiet straight away", async () => {
    const h = harness(true);
    const done = watch(waitForQuietMoment({ ...opts, ...h.options }));

    // No clock movement at all: nobody is looking, so nothing is interrupted.
    await flush();
    expect(done.done).toBe(true);
  });

  it("gives up holding out once the ceiling lapses, at the next short pause", async () => {
    const h = harness();
    const done = watch(waitForQuietMoment({ ...opts, ...h.options }));

    // Someone typing steadily: never a five-second lull, for well past the
    // ceiling. Without the ceiling this would wait forever.
    for (let elapsed = 0; elapsed < 22_000; elapsed += 500) {
      h.advance(500);
      h.activity();
    }
    await flush();
    expect(done.done).toBe(false);

    // The bar has dropped to a one-second pause, and they take a breath.
    h.advance(1_000);
    await flush();
    expect(done.done).toBe(true);
  });

  it("does not lower the bar before the ceiling", async () => {
    const h = harness();
    const done = watch(waitForQuietMoment({ ...opts, ...h.options }));

    // A one-second pause well inside the ceiling is not enough.
    h.advance(1_500);
    h.activity();
    h.advance(1_500);
    await flush();
    expect(done.done).toBe(false);
  });
});

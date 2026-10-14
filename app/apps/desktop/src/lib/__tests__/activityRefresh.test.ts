import { describe, expect, it, vi } from "vitest";
import { createRefreshScheduler, sharedInFlight } from "../activityRefresh";

function harness(minGapMs = 20_000) {
  let t = 1_000_000;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const run = vi.fn();
  const s = createRefreshScheduler({
    minGapMs,
    run,
    clock: () => t,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((x) => x.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      t = next.at;
      next.fn();
    }
    t = end;
  };
  return { s, run, advance, pending: () => timers.length };
}

describe("createRefreshScheduler", () => {
  it("runs the first event at once (leading edge)", () => {
    const h = harness();
    h.s.request();
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst into one trailing run after the gap", () => {
    const h = harness();
    h.s.request();
    // The production pattern: 2–4 triggers within 10 s, repeatedly.
    for (const dt of [0, 2_000, 4_000, 4_000, 1_000]) {
      h.advance(dt);
      h.s.request();
    }
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.pending()).toBe(1);
    h.advance(20_000);
    expect(h.run).toHaveBeenCalledTimes(2);
    expect(h.pending()).toBe(0);
  });

  it("caps sustained events at one run per gap", () => {
    const h = harness();
    // An event every 2 s for 15 minutes.
    for (let i = 0; i < 450; i++) {
      h.s.request();
      h.advance(2_000);
    }
    // 900 s / 20 s = 45 runs (+1 leading), never the 36-per-route-per-15-min bursts × 4.
    expect(h.run.mock.calls.length).toBeLessThanOrEqual(46);
    expect(h.run.mock.calls.length).toBeGreaterThanOrEqual(44);
  });

  it("an explicit refresh runs immediately and absorbs a pending trailing run", () => {
    const h = harness();
    h.s.request();
    h.advance(1_000);
    h.s.request(); // trailing armed
    h.s.now();
    expect(h.run).toHaveBeenCalledTimes(2);
    expect(h.pending()).toBe(0);
    // …and counts as the latest run for the gap.
    h.advance(5_000);
    h.s.request();
    expect(h.run).toHaveBeenCalledTimes(2);
    h.advance(15_000);
    expect(h.run).toHaveBeenCalledTimes(3);
  });

  it("cancel drops a pending trailing run but leaves the scheduler usable", () => {
    const h = harness();
    h.s.request();
    h.s.request();
    h.s.cancel();
    h.advance(60_000);
    expect(h.run).toHaveBeenCalledTimes(1);
    h.s.request();
    expect(h.run).toHaveBeenCalledTimes(2);
  });
});

describe("sharedInFlight", () => {
  it("keeps one request per key on the wire", async () => {
    let resolve!: (v: number) => void;
    const start = vi.fn(() => new Promise<number>((r) => (resolve = r)));
    const a = sharedInFlight("trash:v1", start);
    const b = sharedInFlight("trash:v1", start);
    expect(start).toHaveBeenCalledTimes(1);
    resolve(7);
    await expect(a).resolves.toBe(7);
    await expect(b).resolves.toBe(7);
    // Settled: the next call goes out.
    const c = sharedInFlight("trash:v1", async () => 8);
    await expect(c).resolves.toBe(8);
  });

  it("keys are independent and a rejection clears the slot", async () => {
    const other = vi.fn(async () => 1);
    const failing = sharedInFlight("shrinks:v1", async () => {
      throw new Error("boom");
    });
    await sharedInFlight("shrinks:v2", other);
    expect(other).toHaveBeenCalledTimes(1);
    await expect(failing).rejects.toThrow("boom");
    await expect(sharedInFlight("shrinks:v1", async () => 2)).resolves.toBe(2);
  });
});

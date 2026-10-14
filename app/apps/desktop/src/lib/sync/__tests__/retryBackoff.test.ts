import { describe, expect, it } from "vitest";
import { RETRY_BACKOFF_STEPS_MS, RetryBackoff } from "../retryBackoff";

const MIN = 60_000;

describe("RetryBackoff", () => {
  it("is not waiting for a doc it never saw fail", () => {
    expect(new RetryBackoff().isWaiting("d", 0)).toBe(false);
  });

  it("backs off 1 → 2 → 5 → 15 → 60 min, capped at 60", () => {
    expect(RETRY_BACKOFF_STEPS_MS).toEqual([1 * MIN, 2 * MIN, 5 * MIN, 15 * MIN, 60 * MIN]);
    const b = new RetryBackoff();
    let now = 1_000;
    for (const step of [1, 2, 5, 15, 60, 60, 60]) {
      b.record("d", now);
      expect(b.isWaiting("d", now + step * MIN - 1)).toBe(true);
      expect(b.isWaiting("d", now + step * MIN)).toBe(false);
      now += step * MIN;
    }
    expect(b.attempts("d")).toBe(7);
  });

  it("is per doc, and clear / clearAll reset it", () => {
    const b = new RetryBackoff();
    b.record("a", 0);
    b.record("b", 0);
    expect(b.isWaiting("a", 10)).toBe(true);
    expect(b.isWaiting("c", 10)).toBe(false);
    b.clear("a");
    expect(b.isWaiting("a", 10)).toBe(false);
    expect(b.attempts("a")).toBe(0);
    // Starts again from the first step after a clear.
    b.record("a", 0);
    expect(b.isWaiting("a", MIN)).toBe(false);
    b.clearAll();
    expect(b.isWaiting("b", 10)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { noteSizeRefusal, noteSizeRefusalFor } from "../src/sync/hocuspocus.js";

/**
 * `noteSizeRefusalFor` skips measuring the doc in bytes when the unit count
 * proves it is under the cap. It must give exactly the answer `noteSizeRefusal`
 * gives — the cap is a wall, and a shortcut that lets one byte past it for a
 * Korean or emoji note would defeat the point — so this checks parity over the
 * cases where the two could differ: every script, and docs just under, at and
 * just over the cap and over a third of it (where the shortcut stops applying).
 */

/** A fake `Y.Text`: counts how often the expensive copy is made. */
function fakeText(s: string) {
  const t = { copies: 0, length: s.length, toString() { t.copies++; return s; } };
  return t;
}

const CAP = 1200;
const SAMPLES: Record<string, string> = {
  ascii: "x",
  korean: "한",       // 1 unit, 3 bytes
  cjk: "漢",          // 1 unit, 3 bytes
  emoji: "😀",        // 2 units, 4 bytes
  accented: "é",      // 1 unit, 2 bytes
  mixed: "a한😀é",
};

describe("noteSizeRefusalFor", () => {
  it("gives the same answer as noteSizeRefusal for every script and size around the cap", () => {
    for (const [name, ch] of Object.entries(SAMPLES)) {
      const unitBytes = Buffer.byteLength(ch, "utf8");
      // Repeat counts that put the doc at 1/3 of the cap, just under, at, and just over it.
      const base = Math.floor(CAP / unitBytes);
      for (const reps of [0, 1, Math.floor(CAP / 3 / ch.length), base - 1, base, base + 1, base * 2]) {
        const text = ch.repeat(Math.max(0, reps));
        for (const update of [0, 10, CAP, CAP + 1]) {
          const expected = noteSizeRefusal(update, text, CAP);
          const actual = noteSizeRefusalFor(update, fakeText(text), CAP);
          expect({ name, reps, update, actual }).toEqual({ name, reps, update, actual: expected });
        }
      }
    }
  });

  it("does not copy a doc whose unit count proves it is under the cap", () => {
    const t = fakeText("x".repeat(100));
    expect(noteSizeRefusalFor(50, t, CAP)).toBeNull();
    expect(t.copies).toBe(0);
  });

  it("measures exactly when the doc could be near the cap", () => {
    const t = fakeText("漢".repeat(500)); // 500 units × 3 = 1500 > CAP: not provable, so it is measured
    expect(noteSizeRefusalFor(10, t, CAP)).toMatch(/oversized doc/);
    expect(t.copies).toBe(1);
  });

  it("still refuses a message over the cap without needing the doc at all to be big", () => {
    expect(noteSizeRefusalFor(CAP + 1, fakeText(""), CAP)).toMatch(/oversized sync message/);
  });

  it("is never looser than the byte wall: a doc over the cap in bytes is always refused", () => {
    // 401 CJK characters: 401 units (< CAP) but 1203 bytes (> CAP).
    expect(noteSizeRefusalFor(10, fakeText("漢".repeat(401)), CAP)).toMatch(/oversized doc/);
  });
});

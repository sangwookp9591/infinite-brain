// The Health page's timeline buffer. Three things have to hold or the page
// misleads: oldest-first order, a hard cap, and coalescing that folds a
// reconnect storm without hiding a real sequence.

import { describe, expect, it, vi } from "vitest";
import { SYNC_LOG_COALESCE_MS, SyncLog } from "../syncLog";

describe("SyncLog", () => {
  it("keeps entries oldest first", () => {
    const log = new SyncLog();
    log.push({ level: "info", event: "connect", message: "Connected", at: 1 });
    log.push({ level: "info", event: "run-start", message: "Sync started", at: 2 });
    expect(log.entries().map((e) => e.event)).toEqual(["connect", "run-start"]);
  });

  it("drops the oldest past its capacity", () => {
    const log = new SyncLog(3);
    for (let i = 0; i < 5; i++) {
      log.push({ level: "info", event: "retry", message: `n${i}`, at: i * 10_000 });
    }
    expect(log.entries().map((e) => e.message)).toEqual(["n2", "n3", "n4"]);
  });

  it("folds an identical repeat inside the window and bumps its timestamp", () => {
    const log = new SyncLog();
    log.push({ level: "warn", event: "offline", message: "Connection lost", at: 1_000 });
    log.push({ level: "warn", event: "offline", message: "Connection lost", at: 1_500 });
    log.push({ level: "warn", event: "offline", message: "Connection lost", at: 2_900 });
    const entries = log.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0].at).toBe(2_900);
    expect(entries[0].count).toBe(3);
  });

  it("does not fold once the window has passed", () => {
    const log = new SyncLog();
    log.push({ level: "warn", event: "offline", message: "Connection lost", at: 0 });
    log.push({
      level: "warn",
      event: "offline",
      message: "Connection lost",
      at: SYNC_LOG_COALESCE_MS + 1,
    });
    expect(log.entries()).toHaveLength(2);
  });

  it("treats a different doc, message or event as a different fact", () => {
    const log = new SyncLog();
    log.push({ level: "error", event: "push-failed", message: "x", docId: "a", at: 0 });
    log.push({ level: "error", event: "push-failed", message: "x", docId: "b", at: 1 });
    log.push({ level: "error", event: "push-failed", message: "y", docId: "b", at: 2 });
    log.push({ level: "error", event: "register-failed", message: "y", docId: "b", at: 3 });
    expect(log.entries()).toHaveLength(4);
  });

  it("folds an alternating repeat inside the window and moves it to the end, counted", () => {
    const log = new SyncLog();
    log.push({ level: "warn", event: "offline", message: "Connection lost", at: 0 });
    log.push({ level: "info", event: "connect", message: "Connected", at: 100 });
    log.push({ level: "warn", event: "offline", message: "Connection lost", at: 200 });
    log.push({ level: "info", event: "connect", message: "Connected", at: 300 });
    const entries = log.entries();
    expect(entries.map((e) => e.event)).toEqual(["offline", "connect"]);
    expect(entries.map((e) => e.count)).toEqual([2, 2]);
    expect(entries[1].at).toBe(300);
  });

  it("does not fold a repeat that is outside the window even when it is recent in the tape", () => {
    const log = new SyncLog();
    log.push({ level: "warn", event: "offline", message: "Connection lost", at: 0 });
    log.push({
      level: "warn",
      event: "offline",
      message: "Connection lost",
      at: SYNC_LOG_COALESCE_MS + 1,
    });
    expect(log.entries().map((e) => e.count ?? 1)).toEqual([1, 1]);
  });

  it("notifies subscribers on push and clear, and stops after unsubscribe", () => {
    const log = new SyncLog();
    const cb = vi.fn();
    const off = log.subscribe(cb);
    log.push({ level: "info", event: "connect", message: "Connected", at: 0 });
    expect(cb).toHaveBeenCalledTimes(1);
    log.clear();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(log.entries()).toEqual([]);
    // Clearing an empty buffer is not a change.
    log.clear();
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    log.push({ level: "info", event: "connect", message: "Connected", at: 1 });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("hands out copies, so a held snapshot is not mutated by a later fold", () => {
    const log = new SyncLog();
    log.push({ level: "warn", event: "offline", message: "Connection lost", at: 0 });
    const snapshot = log.entries();
    log.push({ level: "warn", event: "offline", message: "Connection lost", at: 500 });
    expect(snapshot[0].at).toBe(0);
    expect(log.entries()[0].at).toBe(500);
  });

  it("defaults `at` to now", () => {
    const log = new SyncLog();
    const before = Date.now();
    log.push({ level: "info", event: "connect", message: "Connected" });
    expect(log.entries()[0].at).toBeGreaterThanOrEqual(before);
  });
});

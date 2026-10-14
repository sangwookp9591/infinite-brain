// Per-doc backoff for the BACKGROUND content re-queue.
//
// A transient upload failure (the server did not answer the initial sync, did
// not ack, a 5xx) is never remembered as permanent, so every vault-channel
// `ready` (`ready.empty` / `ready.behind`), every batch leftover and every
// content pass used to queue the same doc again at once. A doc that keeps
// failing that way held four upload slots open forever: four `/sync` sockets
// every ~10 s and a token mint apiece (prod 2026-10-12).
//
// This only spaces out the automatic retries: 1 → 2 → 5 → 15 → 60 min (cap).
// It never blocks the open note (that is its own `DocSync`, not the uploader),
// a user's "Sync now" / per-note retry, or an access change — those clear it.
// Any confirmed push of the doc clears it too.

export const RETRY_BACKOFF_STEPS_MS: readonly number[] = [
  60_000,
  2 * 60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
];

export class RetryBackoff {
  private entries = new Map<string, { attempts: number; nextAt: number }>();

  /** A transient failure of `docId` was just reported. */
  record(docId: string, now: number): void {
    const attempts = (this.entries.get(docId)?.attempts ?? 0) + 1;
    const step = RETRY_BACKOFF_STEPS_MS[Math.min(attempts, RETRY_BACKOFF_STEPS_MS.length) - 1];
    this.entries.set(docId, { attempts, nextAt: now + step });
  }

  /** Should the background re-queue leave this doc alone for now? */
  isWaiting(docId: string, now: number): boolean {
    const e = this.entries.get(docId);
    return e != null && now < e.nextAt;
  }

  /** When this doc's current wait ends (undefined when none is recorded). */
  nextAt(docId: string): number | undefined {
    return this.entries.get(docId)?.nextAt;
  }

  /** Consecutive transient failures recorded for this doc (0 when none). */
  attempts(docId: string): number {
    return this.entries.get(docId)?.attempts ?? 0;
  }

  clear(docId: string): void {
    this.entries.delete(docId);
  }

  clearAll(): void {
    this.entries.clear();
  }
}

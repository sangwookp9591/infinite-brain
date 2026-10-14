// "The server refused our SESSION" — the one fact the sync layer could not say.
//
// A token mint (`POST /api/sync-token`, `POST /api/vaults/:id/sync-token`) that
// comes back 401 is the server saying the bearer session is no longer valid:
// expired (a 30-day session lapsing under a long-running app), revoked from
// another device, or deleted server-side. `mintFailureStatus` maps that to
// `"offline"` on purpose — it is not THIS doc's fault and a re-login fixes it —
// but nothing then re-read the session, so `store.authStatus` stayed
// `"signed-in"` for the rest of the run. The app looked healthy, the corner pill
// said "Offline", the #145 banner never fired, and every edit stayed on the
// device until the next launch, where `authManager.init()` finally answered
// "signed out" (#145).
//
// This closes that gap without turning a single 401 into a sign-out. Two things
// must be true before the app drops a session: the server refused a mint, AND a
// fresh session check agrees the session is gone. A 401 racing a server restart,
// a proxy hiccup, a token minted a millisecond before a deploy — all of those
// leave auth exactly as it was, and today's `"offline"` behaviour stands.

/** What a session check answered. `unreachable` is "ask again later", not "no". */
export type SessionVerdict =
  | "valid" // the server knows this session — the 401 was about something else
  | "gone" // the server says there is no session: sign the app out
  | "unreachable"; // no answer (offline / server down): decide nothing

export interface SessionRejectionGuardOptions {
  /**
   * Ask the server whether the stored session is still real. The production
   * implementation is `authManager.revalidateSession()` — the same
   * `GET /api/auth/get-session` call `initAuth` restores a launch with.
   */
  probe: () => Promise<SessionVerdict>;
  /**
   * The session is confirmed gone. Fires AT MOST ONCE per episode, however many
   * 401s arrive: a bulk content run connects one provider per note, so a lapsed
   * session produces a mint refusal for every doc in the vault within seconds.
   */
  onSessionGone: () => void;
  /**
   * After an inconclusive answer (`valid`/`unreachable`), ignore further 401s
   * for this long. Without it a genuinely mismatched 401 — one the session check
   * keeps clearing — would put a `get-session` round trip behind every retry of
   * every doc, forever. Default 30s: longer than a server restart, far shorter
   * than the session TTL this exists to notice.
   */
  cooldownMs?: number;
  /** Injectable clock (ms since epoch), for tests. */
  now?: () => number;
}

/**
 * The once-per-episode latch between "a mint returned 401" and "sign the app
 * out", kept as a plain object so the decision is testable without a socket, a
 * server, or the store.
 *
 * Lifecycle: every mint path calls {@link reject}; at most one probe is ever in
 * flight; a `gone` verdict fires `onSessionGone` once and then CONCLUDES — the
 * guard answers nothing further until {@link reset}, which `SyncManager.enable`
 * calls when a session is established again. That latch is the loop guard: the
 * store's handler tears the sync layer down on `onSessionGone`, and if anything
 * still in flight lands one more 401 on the way out, it is swallowed here rather
 * than re-running a sign-out that already happened.
 */
export class SessionRejectionGuard {
  private readonly probe: () => Promise<SessionVerdict>;
  private readonly onSessionGone: () => void;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  /** The probe currently in flight — every concurrent 401 rides this one. */
  private inFlight: Promise<void> | null = null;
  /** The session is confirmed gone: nothing to decide any more. */
  private concluded = false;
  private lastProbeAt = Number.NEGATIVE_INFINITY;

  constructor(opts: SessionRejectionGuardOptions) {
    this.probe = opts.probe;
    this.onSessionGone = opts.onSessionGone;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.now = opts.now ?? (() => Date.now());
  }

  /** True once the session has been confirmed gone (until {@link reset}). */
  get sessionGone(): boolean {
    return this.concluded;
  }

  /**
   * A token mint came back 401. Returns the in-flight probe so tests (and only
   * tests) can await the verdict; production callers fire and forget.
   */
  reject(): Promise<void> {
    if (this.concluded) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const startedAt = this.now();
    if (startedAt - this.lastProbeAt < this.cooldownMs) return Promise.resolve();
    this.lastProbeAt = startedAt;
    const run = (async () => {
      let verdict: SessionVerdict;
      try {
        verdict = await this.probe();
      } catch {
        // A throwing probe is an unanswered question, never a "no".
        verdict = "unreachable";
      }
      // Re-stamp from the END of the round trip, so a slow check can't be
      // followed immediately by another.
      this.lastProbeAt = this.now();
      if (verdict !== "gone") return;
      this.concluded = true;
      this.onSessionGone();
    })().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  /** A session is established again (sign-in / vault enable): re-arm. */
  reset(): void {
    this.concluded = false;
    this.inFlight = null;
    this.lastProbeAt = Number.NEGATIVE_INFINITY;
  }
}

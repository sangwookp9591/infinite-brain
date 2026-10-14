// A session that dies MID-RUN (#145).
//
// The reporter's app looked healthy for days: the vault was open, the editor
// accepted every keystroke, the corner pill said "Offline" — and nothing had
// left the device since the 30-day session lapsed. `mintFailureStatus` maps a
// 401 at token mint straight to "offline" (correctly: it is not the DOC's
// fault), but nothing re-read the session, so `store.authStatus` stayed
// "signed-in" and the banner that exists for exactly this never fired. Only the
// next launch, where `authManager.init()` asks the server, noticed.
//
// These tests pin the two halves of the fix: every mint path REPORTS a 401, and
// the guard decides what it means — once per episode, and never on the 401 alone.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

/** The provider config DocSync hands to Hocuspocus, captured per instance. */
type Handlers = {
  token: () => Promise<string>;
  onAuthenticationFailed?: (p: { reason?: string }) => void;
  onStatus?: (p: { status: string }) => void;
};

const captured = vi.hoisted(() => ({ handlers: null as Handlers | null }));

vi.mock("@hocuspocus/provider", () => {
  class FakeHocuspocusProvider {
    readonly awareness = { setLocalStateField() {}, destroy() {}, on() {}, off() {} };
    isSynced = false;
    readonly configuration: { websocketProvider: unknown };
    constructor(config: Handlers) {
      captured.handlers = config;
      this.configuration = {
        websocketProvider: {
          status: "disconnected",
          connect: () => {},
          disconnect: () => {},
          on() {},
          off() {},
          webSocket: undefined,
        },
      };
    }
    on() {}
    off() {}
    disconnect() {}
    destroy() {}
  }
  return {
    HocuspocusProvider: FakeHocuspocusProvider,
    WebSocketStatus: {
      Disconnected: "disconnected",
      Connecting: "connecting",
      Connected: "connected",
    },
  };
});

import { ApiClient } from "../../api";
import { SessionRejectionGuard, type SessionVerdict } from "../sessionGuard";
import { DocSync } from "../syncManager";
import { VaultSyncEngine, type WebSocketLike } from "../vaultSyncEngine";

/** An ApiClient whose every call answers with `status`. */
function api(status: number, body: unknown = { token: "tok", readOnly: false }): ApiClient {
  const impl = (async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
  return new ApiClient({ baseUrl: "http://localhost:3010", token: "sess", fetchImpl: impl });
}

/**
 * A store stand-in wired exactly like the real one: the guard is the only thing
 * between a 401 and `authStatus`, so the assertions are about IT, not about
 * Zustand.
 */
function harness(verdicts: SessionVerdict[] | SessionVerdict, opts: { cooldownMs?: number } = {}) {
  const queue = Array.isArray(verdicts) ? [...verdicts] : null;
  const state = { authStatus: "signed-in" as "signed-in" | "signed-out", signOuts: 0, probes: 0 };
  let now = 1_000_000;
  const guard = new SessionRejectionGuard({
    probe: async () => {
      state.probes++;
      return queue ? (queue.shift() ?? "valid") : (verdicts as SessionVerdict);
    },
    onSessionGone: () => {
      state.signOuts++;
      state.authStatus = "signed-out";
    },
    now: () => now,
    ...(opts.cooldownMs != null ? { cooldownMs: opts.cooldownMs } : {}),
  });
  return { guard, state, advance: (ms: number) => (now += ms) };
}

beforeEach(() => {
  captured.handlers = null;
});

describe("SessionRejectionGuard — what a 401 at token mint means", () => {
  it("signs out ONCE for a burst of 401s when the session is really gone", async () => {
    // The shape of a real episode: a bulk content run connects one provider per
    // note, so a lapsed session refuses a mint for every doc in the vault within
    // seconds. One session check, one sign-out — not 500 of each.
    const { guard, state } = harness("gone");
    await Promise.all(Array.from({ length: 50 }, () => guard.reject()));
    // …and the stragglers that land after the verdict (a doc still tearing down).
    await guard.reject();
    await guard.reject();

    expect(state.probes).toBe(1);
    expect(state.signOuts).toBe(1);
    expect(state.authStatus).toBe("signed-out");
    expect(guard.sessionGone).toBe(true);
  });

  it("leaves auth alone when the session checks out — today's offline behaviour", async () => {
    // A 401 racing a server restart, or a token minted a millisecond before a
    // deploy. The doc's status is still "offline" (DocSync decides that on its
    // own); what must NOT happen is an app that signs itself out over it.
    const { guard, state } = harness("valid");
    await guard.reject();

    expect(state.probes).toBe(1);
    expect(state.signOuts).toBe(0);
    expect(state.authStatus).toBe("signed-in");
    expect(guard.sessionGone).toBe(false);
  });

  it("treats an unanswered check as 'ask again later', never as 'no'", async () => {
    // Server down / offline: `revalidateSession` says `unreachable` and a
    // throwing probe is folded into the same verdict. Signing out here would log
    // people out of a local-first app every time their wifi dropped.
    const { guard, state } = harness("unreachable");
    await guard.reject();
    expect(state.signOuts).toBe(0);

    const thrower = new SessionRejectionGuard({
      probe: async () => {
        throw new Error("network");
      },
      onSessionGone: () => state.signOuts++,
    });
    await thrower.reject();
    expect(state.signOuts).toBe(0);
  });

  it("does not put a session check behind every retry of every doc", async () => {
    // An inconclusive answer re-arms, but only after the cooldown — otherwise a
    // persistently mismatched 401 costs a `get-session` round trip per doc per
    // retry, forever.
    const { guard, state, advance } = harness(["valid", "valid", "gone"], { cooldownMs: 30_000 });
    await guard.reject();
    expect(state.probes).toBe(1);

    await guard.reject(); // inside the cooldown — ignored outright
    expect(state.probes).toBe(1);

    advance(30_000);
    await guard.reject();
    expect(state.probes).toBe(2);
    expect(state.signOuts).toBe(0);

    // …and a session that HAS gone is still caught on the next window.
    advance(30_000);
    await guard.reject();
    expect(state.probes).toBe(3);
    expect(state.signOuts).toBe(1);
  });

  it("stays latched until a new session is established", async () => {
    // The latch is the loop guard: the store's handler tears sync down on the
    // sign-out, and whatever was still in flight must not re-run it.
    const { guard, state, advance } = harness("gone");
    await guard.reject();
    advance(10 * 60_000);
    await guard.reject();
    expect(state.signOuts).toBe(1);
    expect(state.probes).toBe(1);

    // `SyncManager.enable` re-arms it — a sign-in always goes through there.
    guard.reset();
    expect(guard.sessionGone).toBe(false);
    await guard.reject();
    expect(state.signOuts).toBe(2);
  });
});

describe("the mint paths report a 401", () => {
  it("DocSync: the note's provider reports it, and still reads as offline", async () => {
    let rejected = 0;
    const sync = new DocSync({
      api: api(401, { error: "Unauthorized" }),
      doc: new Y.Doc(),
      docId: "d1",
      vaultId: "v1",
      onSessionRejected: () => rejected++,
    });
    // The provider asks for a token on every (re)connect — including the
    // proactive re-mint `tokenRefresh.ts` schedules 60s before expiry, which is
    // the mint most likely to be the FIRST to meet a lapsed session.
    await captured.handlers!.token();

    expect(rejected).toBe(1);
    // Unchanged: the session is the problem, not this doc, so nothing here goes
    // terminal and a re-login fixes it without reopening the note.
    expect(sync.status).toBe("offline");
    sync.destroy();
  });

  it("DocSync: a refusal that is NOT about the session says nothing", async () => {
    for (const [status, expected] of [
      [403, "no-access"],
      [404, "deleted"],
      [500, "error"],
    ] as const) {
      let rejected = 0;
      const sync = new DocSync({
        api: api(status, { error: "no" }),
        doc: new Y.Doc(),
        docId: "d1",
        vaultId: "v1",
        onSessionRejected: () => rejected++,
      });
      await captured.handlers!.token();
      expect(rejected).toBe(0);
      expect(sync.status).toBe(expected);
      sync.destroy();
    }
  });

  it("the vault channel reports it too — the only mint left when no note is open", async () => {
    let rejected = 0;
    const statuses: string[] = [];
    const sockets: FakeSocket[] = [];
    const engine = new VaultSyncEngine({
      api: api(401, { error: "Unauthorized" }),
      vaultId: "v1",
      sink: {
        knownDocs: () => [],
        stateVector: async () => null,
        recentDocs: () => [],
        applyUpdate: async () => {},
        drop: () => {},
      },
      wsFactory: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      onSessionRejected: () => rejected++,
      onStatus: (s) => statuses.push(s),
      // Keep the retry ladder from opening a second socket during the test.
      reconnect: { baseMs: 60_000, maxMs: 60_000 },
      random: () => 1,
    });
    engine.start();
    sockets[0].open();
    await vi.waitFor(() => expect(rejected).toBe(1));
    // Not `no-access`: that is the 403 (not a member), which stops the ladder
    // outright. A 401 stays transient — the channel keeps retrying and the
    // session check is what decides whether there is anything to retry WITH.
    expect(statuses).not.toContain("no-access");
    expect(statuses).toContain("error");
    engine.stop();
  });
});

/** The slice of a WebSocket the engine drives, with a hand-fired `open`. */
class FakeSocket implements WebSocketLike {
  binaryType = "";
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {}
  send(): void {}
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.({});
  }
}

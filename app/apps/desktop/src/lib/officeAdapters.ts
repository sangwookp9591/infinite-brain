// SPDX-License-Identifier: Apache-2.0
import type { OfficeCandidate } from "./officeFlow";
import * as ipc from "./ipc";
import { openOfficeDiscovery } from "./officeDiscovery";
import type { ApiClient } from "./api";
import { createOfficeJoin } from "./officeJoin";
import { OfficeClient, type OfficeInvitation, type OfficeRequest } from "./officeClient";

export type { OfficeRequest } from "./officeClient";

export interface OfficeDemoPort {
  start(): Promise<void>;
  stop(): Promise<void>;
  onCandidates(callback: (items: readonly OfficeCandidate[]) => void): () => void;
  createInvitation(): Promise<OfficeInvitation>;
  getRequests(): OfficeRequest[];
  decideRequest(id: string, approve: boolean): Promise<void>;
  confirmRequest(id: string, matches: boolean): Promise<void>;
  setHostRunning(running: boolean): Promise<void>;
  getHostRunning(): boolean;
  refreshRequests?(): Promise<OfficeRequest[]>;
  refreshHost?(): Promise<boolean>;
}

/** Real IPC/API ports. Invitation secrets are returned only to the caller for display. */
export function createOfficeAdapter(api: ApiClient, organizationId: string): OfficeDemoPort {
  const client = new OfficeClient(api, organizationId);
  let scan: ReturnType<typeof openOfficeDiscovery> | undefined;
  let listeners = new Set<(items: readonly OfficeCandidate[]) => void>();
  let running = false;
  let requests: OfficeRequest[] = [];
  const publish = (snapshot: ipc.OfficeDiscoverySnapshot) => {
    const view = snapshot.candidates.map((candidate) => ({ candidateId: candidate.candidateId, displayName: candidate.displayName, trust: "untrusted-candidate" as const }));
    listeners.forEach((listener) => listener(view));
  };
  return {
    async start() { scan?.close(); scan = openOfficeDiscovery(publish, () => listeners.forEach((fn) => fn([]))); },
    async stop() { await scan?.close(); scan = undefined; listeners.forEach((fn) => fn([])); },
    onCandidates(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    async createInvitation() { return client.createInvitation(); },
    getRequests() { return requests; },
    async decideRequest(id, approve) { await client.decide(id, approve ? "approved" : "rejected"); requests = await client.requests(); },
    async confirmRequest(id, matches) { await client.confirmSas(id, matches); requests = await client.requests(); },
    async setHostRunning(next) {
      if (!next) {
        await ipc.officeDiscoveryAdvertise(null).catch(() => undefined);
        await ipc.officeHostStop(); running = false; return;
      }
      try {
        const status = await ipc.officeHostStart("lan");
        running = status.available && status.phase === "ready" && status.scope === "lan" && status.lanExposed;
        if (!running) throw new Error("office:host_stopped");
        await ipc.officeDiscoveryAdvertise("공유 작업 공간");
      } catch {
        running = false;
        await ipc.officeDiscoveryAdvertise(null).catch(() => undefined);
        await ipc.officeHostStop().catch(() => undefined);
        throw new Error("office:host_stopped");
      }
    },
    getHostRunning() { return running; },
    async refreshRequests() { requests = await client.requests(); return requests; },
    async refreshHost() {
      const status = await ipc.officeHostStatus().catch(() => null);
      running = !!status?.available && status.phase === "ready" && status.scope === "lan" && status.lanExposed;
      return running;
    },
  };
}

const candidates: OfficeCandidate[] = [
  { candidateId: "candidate-plan-minsu", displayName: "민수", trust: "untrusted-candidate" },
  { candidateId: "candidate-design-minsu", displayName: "민수", trust: "untrusted-candidate" },
  { candidateId: "candidate-shared", displayName: "공용 작업 공간", trust: "untrusted-candidate" },
];

/** Stable, display-only discriminator derived from an opaque candidate key. */
export function candidateShortMarker(candidateId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < candidateId.length; i += 1) {
    hash ^= candidateId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, "0").slice(-4);
}

/** Add a short marker only to names that are ambiguous in this result set. */
export function disambiguateCandidateNames<T extends OfficeCandidate>(items: readonly T[]): (T & { displayName: string })[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.displayName, (counts.get(item.displayName) ?? 0) + 1);
  return items.map((item) => ({
    ...item,
    displayName: (counts.get(item.displayName) ?? 0) > 1
      ? `${item.displayName} · ${candidateShortMarker(item.candidateId)}`
      : item.displayName,
  }));
}

/** Synthetic ports for the simulator and local development only. */
export function createFakeOfficeAdapter(scenario = "default"): OfficeDemoPort {
  if (!import.meta.env.DEV) throw new Error("Office preview adapters are available only in development.");
  let running = false;
  let scanActive = false;
  const candidateListeners = new Set<(items: readonly OfficeCandidate[]) => void>();
  const sampleCandidates = () => disambiguateCandidateNames(scenario === "duplicates" ? candidates.map((candidate) => ({ ...candidate, displayName: "민수" })) : candidates);
  let requests: OfficeRequest[] = [
    { id: "request-1", nickname: "민수", device: "회사 노트북", platform: "Windows", status: "pending", confirmationNumber: "482193" },
    { id: "request-2", nickname: "민수", device: "개인 Mac", platform: "macOS", status: "pending", confirmationNumber: "731604" },
  ];
  return {
    async start() { scanActive = true; const items = sampleCandidates(); candidateListeners.forEach((callback) => callback(items)); },
    async stop() { scanActive = false; candidateListeners.forEach((callback) => callback([])); },
    onCandidates(callback) { candidateListeners.add(callback); if (scanActive) callback(sampleCandidates()); return () => candidateListeners.delete(callback); },
    async createInvitation() { return { invitationCode: "IB1.preview.invite", expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() }; },
    getRequests() { return requests.map((request) => ({ ...request })); },
    async decideRequest(id, approve) { requests = requests.map((r) => r.id === id && r.status === "pending" ? { ...r, status: approve ? "approved" : "rejected" } : r); },
    async confirmRequest(id, matches) { requests = requests.map((r) => r.id === id && r.status === "pending" ? { ...r, sasMatches: matches } : r); },
    async setHostRunning(next) { running = next; },
    getHostRunning() { return running; },
  };
}

export interface OfficeSyncPorts {
  /** Synchronously retire providers, then await local Markdown + CRDT writes. */
  stop(): Promise<void>;
  connect(api: ApiClient, session: import("./api").SessionInfo, vault: import("./api").Vault, onRejected: () => void, onStorage: (shared: boolean) => void): Promise<void>;
  /** Restore the shared API only after relay close succeeds. */
  restore(): void;
}
export interface OfficeConnectionState {
  phase: "idle" | "vault-selecting" | "connecting" | "connected" | "error";
  vaults: readonly import("./api").Vault[];
  error?: import("./officeFlow").OfficeErrorCode;
  storage?: "local-only" | "company-shared";
}

/** Owns a single hub's process-only connection beyond the settings panel's life.
 * Approval/listing is never a storage ACK. No document payload or credential is
 * persisted here; the existing sync manager owns pull, seed and durable ACKs.
 */
export function createOfficeConnection(
  api: ApiClient,
  ports: OfficeSyncPorts,
  joinPorts?: import("./officeJoin").OfficeJoinPorts,
) {
  let state: OfficeConnectionState = { phase: "idle", vaults: [] };
  const listeners = new Set<() => void>();
  const events = new Set<(event: import("./officeJoin").OfficeJoinEvent) => void>();
  let join: import("./officeJoin").OfficeJoin | undefined;
  let selected: import("./api").Vault | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renewalLink: import("./officeLink").OfficeLink | undefined;
  let renewalAt = 0, sessionExpiresAt = NaN;
  let revision = 0;
  let transition: Promise<void> = Promise.resolve();
  const publish = (next: OfficeConnectionState) => { state = next; listeners.forEach((fn) => fn()); };
  const queue = (fn: () => Promise<void>) => {
    const next = transition.then(fn, fn);
    transition = next.catch(() => undefined);
    return next;
  };
  function code(error: unknown): import("./officeFlow").OfficeErrorCode {
    const match = String(error).match(/office:([a-z_]+)/)?.[1];
    return match === "permission_missing" || match === "session_revoked" ? match : navigator.onLine === false ? "connection_lost" : "unknown";
  }
  function storage(shared: boolean) {
    if (state.phase === "connected") publish({ ...state, storage: shared ? "company-shared" : "local-only" });
  }
  async function stop() { clearTimeout(timer); timer = undefined; await ports.stop(); }
  async function closeNow() {
    await stop();
    // Keep the reference on failure so the same close can be retried.
    await join?.close();
    join = undefined;
    ports.restore();
  }
  async function readAllowed() {
    if (!join?.getConnection()) throw new Error("office:connection_lost");
    const session = await api.getSession();
    if (!session) throw new Error("office:session_revoked");
    const vaults = await api.listVaults();
    return { session, vaults: vaults.filter((v) => (v.organization_id ?? v.organizationId) === session.activeOrganizationId) };
  }
  async function approved(current: number) {
    try {
      const { vaults } = await readAllowed();
      if (current !== revision) return;
      publish({ phase: "vault-selecting", vaults, ...(vaults.length ? {} : { error: "permission_missing" as const }) });
      schedule();
    } catch (error) {
      await stop();
      const failure = code(error);
      if (failure === "session_revoked") await closeNow();
      publish({ phase: "error", vaults: [], error: failure });
    }
  }
  function schedule() {
    clearTimeout(timer);
    const link = join?.getConnection();
    if (link && link !== renewalLink) {
      renewalLink = link;
      sessionExpiresAt = Date.parse(link.expiresAt ?? "");
      const remaining = sessionExpiresAt - Date.now();
      renewalAt = Number.isFinite(sessionExpiresAt) ? Date.now() + Math.max(0, remaining - Math.max(remaining * .2, Math.min(60_000, remaining * .5))) : Date.now() + 30_000;
    }
    // Probe revocation/offline too. Renew before the actual native session TTL,
    // including hubs configured below the default ten minutes.
    const renewIn = Math.max(0, renewalAt - Date.now());
    timer = setTimeout(() => { void maintainQueued(renewIn <= 15_000); }, Math.min(15_000, renewIn));
  }
  async function maintain(renew: boolean, rejected = false) {
    if (!join) return;
    const previousExpiry = sessionExpiresAt;
    try {
      if (navigator.onLine === false) throw new Error("offline");
      if (!renew) { rejected = !(await api.getSession()); if (!rejected) { schedule(); return; } }
      await stop();
      publish({ ...state, phase: "connecting", error: undefined });
      await join.reconnect(); // new native signature/challenge, no generic keychain
      const { session, vaults } = await readAllowed();
      if (selected) {
        const allowed = vaults.find((v) => v.id === selected!.id);
        if (!allowed) throw new Error("office:permission_missing");
        await ports.connect(api, session, allowed, () => { void rejectedSession(); }, storage);
      }
      publish({ phase: selected ? "connected" : "vault-selecting", vaults });
      schedule();
    } catch (error) {
      await stop();
      const expired = previousExpiry <= Date.now();
      const failure = String(error).includes("office:permission_missing") ? "permission_missing" : navigator.onLine === false ? "connection_lost" : rejected ? "session_revoked" : expired ? "session_expired" : "connection_lost";
      // Final authorization loss closes the join. Network loss can retry its
      // same pinned hub; it never begins another hub or seeds local content.
      if (failure === "session_revoked" || failure === "permission_missing") await closeNow();
      publish({ phase: "error", vaults: state.vaults, error: failure });
      if (join) timer = setTimeout(() => { void maintainQueued(true); }, 5_000);
    }
  }
  function maintainQueued(renew: boolean, rejected = false) {
    return queue(() => maintain(renew, rejected)).catch(() => {
      // Local persistence/cleanup failure stops the transition too. Timers
      // must not leave an unhandled rejection or silently switch a hub.
      publish({ ...state, phase: "error", error: "connection_lost" });
    });
  }
  function rejectedSession() { return maintainQueued(true, true); }
  return {
    api,
    getState: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    onEvent(fn: (event: import("./officeJoin").OfficeJoinEvent) => void) { events.add(fn); return () => { events.delete(fn); }; },
    async begin(input: string, profile: ipc.OfficePairingProfile, candidateId: string | null = null) {
      return queue(async () => {
        try { await closeNow(); }
        catch (error) { publish({ ...state, phase: "error", error: "connection_lost" }); throw error; }
        selected = undefined;
        const current = ++revision;
        publish({ phase: "idle", vaults: [] });
        join = createOfficeJoin((event) => {
          events.forEach((fn) => fn(event));
          if (event.type === "APPROVAL_GRANTED") void queue(() => approved(current));
        }, joinPorts, api);
        await join.begin(input, profile, candidateId);
      });
    },
    async discover() {
      if (!join) join = createOfficeJoin((event) => events.forEach((fn) => fn(event)), joinPorts, api);
      await join.openDiscovery();
    },
    confirm: (matches: boolean) => join?.confirm(matches) ?? Promise.resolve(),
    cancel: () => join?.cancel() ?? Promise.resolve(),
    select(vaultId: string) {
      return queue(async () => {
        const chosen = state.vaults.find((v) => v.id === vaultId);
        if (!chosen || state.phase !== "vault-selecting") return;
        await stop();
        publish({ ...state, phase: "connecting", error: undefined });
        try {
          const { session, vaults } = await readAllowed();
          if (!vaults.some((v) => v.id === chosen.id)) throw new Error("office:permission_missing");
          await ports.connect(api, session, chosen, () => { void rejectedSession(); }, storage);
          selected = chosen;
          publish({ phase: "connected", vaults });
          schedule();
        } catch (error) {
          await stop();
          const failure = code(error);
          if (failure === "session_revoked") await closeNow();
          publish({ phase: "error", vaults: [], error: failure });
        }
      });
    },
    reconnect: () => queue(() => maintain(true)),
    close() {
      return queue(async () => {
        ++revision;
        try { await closeNow(); selected = undefined; publish({ phase: "idle", vaults: [] }); }
        catch (error) { publish({ ...state, phase: "error", error: "connection_lost" }); throw error; }
      });
    },
  };
}

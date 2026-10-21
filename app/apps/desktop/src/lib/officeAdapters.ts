// SPDX-License-Identifier: Apache-2.0
import type { OfficeCandidate } from "./officeFlow";
import * as ipc from "./ipc";
import { openOfficeDiscovery } from "./officeDiscovery";
import type { ApiClient } from "./api";
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

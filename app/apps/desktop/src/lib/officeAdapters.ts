// SPDX-License-Identifier: Apache-2.0
import type { OfficeCandidate, OfficeDiscoveryPort, OfficeLinkPort, PairingPort } from "./officeFlow";
import * as ipc from "./ipc";
import { openOfficeDiscovery, openDiscoveredOffice } from "./officeDiscovery";
import { openOfficeLink, type OfficeLink } from "./officeLink";
import type { ApiClient } from "./api";
import { OfficeClient, type OfficeRequest } from "./officeClient";

export type { OfficeRequest } from "./officeClient";

export interface OfficeDemoPort extends OfficeDiscoveryPort, OfficeLinkPort, PairingPort {
  getRequests(): OfficeRequest[];
  decideRequest(id: string, approve: boolean): Promise<void>;
  confirmRequest(id: string, matches: boolean): Promise<void>;
  setHostRunning(running: boolean): Promise<void>;
  getHostRunning(): boolean;
  refreshRequests?(): Promise<OfficeRequest[]>;
  refreshHost?(): Promise<boolean>;
}

/** Real IPC/API ports. Invite-based pairing is intentionally not fabricated:
 * callers must supply an invitation through the native pairing entry point. */
export function createOfficeAdapter(api: ApiClient, organizationId: string, pinnedHub?: { origin: string; serverId: string }): OfficeDemoPort {
  const client = new OfficeClient(api, organizationId);
  let scan: ReturnType<typeof openOfficeDiscovery> | undefined;
  let listeners = new Set<(items: readonly OfficeCandidate[]) => void>();
  let candidates = new Map<string, ipc.OfficeDiscoveryCandidate>();
  let running = false;
  let endpoint: ipc.OfficeLinkEndpoint | undefined;
  let pinnedLink: OfficeLink | undefined;
  let requests: OfficeRequest[] = [];
  const publish = (snapshot: ipc.OfficeDiscoverySnapshot) => {
    candidates = new Map(snapshot.candidates.map((candidate) => [candidate.candidateId, candidate]));
    const view = snapshot.candidates.map((candidate) => ({ candidateId: candidate.candidateId, displayName: candidate.displayName, trust: "untrusted-candidate" as const }));
    listeners.forEach((listener) => listener(view));
  };
  return {
    async start() { scan?.close(); scan = openOfficeDiscovery(publish, () => listeners.forEach((fn) => fn([]))); },
    async stop() { await scan?.close(); scan = undefined; candidates.clear(); listeners.forEach((fn) => fn([])); },
    onCandidates(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    async verifyCandidate(id) {
      const candidate = candidates.get(id);
      if (!candidate) throw new Error("office:host_not_found");
      if (pinnedHub && pinnedHub.serverId === candidate.serverId) {
        pinnedLink = await openOfficeLink(pinnedHub, api);
        throw new Error("office:invite_invalid");
      }
      endpoint = await openDiscoveredOffice(candidate);
      // Discovery reconnect is available only for an already pinned hub.
      throw new Error("office:invite_invalid");
    },
    async close() {
      if (pinnedLink) await pinnedLink.close();
      else if (endpoint) await ipc.officeLinkClose(endpoint.linkId);
      pinnedLink = undefined; endpoint = undefined;
    },
    async requestApproval() { throw new Error("office:invite_invalid"); },
    async cancelRequest() { throw new Error("office:unknown"); },
    async getStatus() { return "pending"; },
    getRequests() { return requests; },
    async decideRequest(id, approve) { await client.decide(id, approve ? "approved" : "rejected"); requests = await client.requests(); },
    async confirmRequest(id, matches) { await client.confirmSas(id, matches); requests = await client.requests(); },
    async setHostRunning(next) {
      if (!next) {
        await ipc.officeDiscoveryAdvertise(null);
        await ipc.officeHostStop(); running = false; return;
      }
      try {
        const status = await ipc.officeHostStart("lan");
        running = status.available && status.phase === "ready" && status.scope === "lan" && status.lanExposed;
        await ipc.officeDiscoveryAdvertise(running ? "공유 작업 공간" : null);
      } catch {
        running = false;
        await ipc.officeDiscoveryAdvertise(null).catch(() => undefined);
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
  let requests: OfficeRequest[] = [
    { id: "request-1", nickname: "민수", device: "회사 노트북", platform: "Windows", status: "pending", confirmationNumber: "482193" },
    { id: "request-2", nickname: "민수", device: "개인 Mac", platform: "macOS", status: "pending", confirmationNumber: "731604" },
  ];
  return {
    async start() {}, async stop() {},
    onCandidates(callback) { callback(disambiguateCandidateNames(scenario === "duplicates" ? candidates.map((c) => ({ ...c, displayName: "민수" })) : candidates)); return () => {}; },
    async verifyCandidate() {
      if (scenario === "error") throw new Error("network_blocked");
      return { sas: "482193" };
    },
    async close() {},
    async requestApproval() { return { expiresAt: Date.now() + 15 * 60_000 }; },
    async cancelRequest() {}, async getStatus() { return "pending"; },
    getRequests() { return requests.map((request) => ({ ...request })); },
    async decideRequest(id, approve) { requests = requests.map((r) => r.id === id && r.status === "pending" ? { ...r, status: approve ? "approved" : "rejected" } : r); },
    async confirmRequest(id, matches) { requests = requests.map((r) => r.id === id && r.status === "pending" ? { ...r, sasMatches: matches } : r); },
    async setHostRunning(next) { running = next; },
    getHostRunning() { return running; },
  };
}

// SPDX-License-Identifier: Apache-2.0
import type { OfficeCandidate, OfficeDiscoveryPort, OfficeLinkPort, PairingPort } from "./officeFlow";

export interface OfficeRequest {
  id: string;
  nickname: string;
  device: string;
  platform: "Windows" | "macOS";
  status: "pending" | "approved" | "rejected";
  confirmationNumber: string;
  sasMatches?: boolean;
}

export interface OfficeDemoPort extends OfficeDiscoveryPort, OfficeLinkPort, PairingPort {
  getRequests(): OfficeRequest[];
  decideRequest(id: string, approve: boolean): Promise<void>;
  confirmRequest(id: string, matches: boolean): Promise<void>;
  setHostRunning(running: boolean): Promise<void>;
  getHostRunning(): boolean;
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

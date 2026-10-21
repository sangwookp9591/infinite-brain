// SPDX-License-Identifier: Apache-2.0
import * as ipc from "./ipc";
import { openOfficeDiscovery } from "./officeDiscovery";
import type { OfficeCandidate, OfficeErrorCode } from "./officeFlow";

/** Display-only events. No native transport object or raw error is forwarded. */
export type OfficeJoinEvent =
  | { type: "DISCOVERY_STARTED" }
  | { type: "CANDIDATES_UPDATED"; candidates: readonly OfficeCandidate[] }
  | { type: "JOIN_STARTED" }
  | { type: "CANDIDATE_SELECTED"; candidateId: string }
  | { type: "SAS_RECEIVED"; sas: string }
  | { type: "SAS_CONFIRMED"; matches: boolean }
  | { type: "JOIN_REQUESTED"; approvalExpiresAt: number }
  | { type: "APPROVAL_GRANTED" | "APPROVAL_REJECTED" | "APPROVAL_EXPIRED" | "APPROVAL_CANCELLED" }
  | { type: "FAILED"; code: OfficeErrorCode };

export interface OfficeJoinPorts {
  begin: typeof ipc.officePairingBegin;
  confirm: typeof ipc.officePairingConfirm;
  status: typeof ipc.officePairingStatus;
  cancel: typeof ipc.officePairingCancel;
  discovery(onSnapshot: (snapshot: ipc.OfficeDiscoverySnapshot) => void, onError: (error: unknown) => void): { close(): Promise<void> };
  now(): number;
}
const nativePorts: OfficeJoinPorts = {
  begin: ipc.officePairingBegin, confirm: ipc.officePairingConfirm,
  status: ipc.officePairingStatus, cancel: ipc.officePairingCancel,
  discovery: openOfficeDiscovery, now: Date.now,
};
const interval = 3_000, maxPolls = 200;
const codes: Record<string, OfficeErrorCode> = {
  hub_pin_mismatch: "hub_pin_mismatch", hub_unavailable: "network_blocked",
  invite_invalid: "invite_invalid", invite_expired: "invite_expired",
  identity_link_required: "identity_link_required", host_not_found: "host_not_found",
  discovery_expired: "host_not_found", discovery_unavailable: "discovery_unavailable",
  approval_expired: "approval_expired", approval_rejected: "approval_rejected",
  request_cancelled: "request_cancelled", sas_mismatch: "sas_mismatch", too_many_attempts: "too_many_attempts",
};
function errorCode(error: unknown): OfficeErrorCode {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return codes[/^office_([a-z_]+):/.exec(message)?.[1] ?? ""] ?? "unknown";
}

/** Call from a user action. The pasted invitation is passed straight to native
 * parsing, never retained here, returned, attached to an error, or published.
 * Clear the input DOM element after begin(); do not use a controlled UI/store
 * field for the pasted secret. close() stops timers and cancels native work.
 */
export function createOfficeJoin(onEvent: (event: OfficeJoinEvent) => void, ports: OfficeJoinPorts = nativePorts) {
  let scan: { close(): Promise<void> } | undefined;
  let session: string | undefined;
  let closed = false, busy = false, polling = false;
  let revision = 0, polls = 0, deadline = 0, nextPollAt = 0;
  let sasDeadline = 0, awaitingSas = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const emit = (event: OfficeJoinEvent) => { if (!closed) onEvent(event); };
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  async function forget() {
    clearTimer(); awaitingSas = false; polling = false;
    const previous = session; session = undefined;
    if (previous) await ports.cancel(previous).catch(() => undefined);
  }
  async function failed(error: unknown) {
    const code = errorCode(error);
    await forget();
    if (code === "approval_rejected") emit({ type: "APPROVAL_REJECTED" });
    else if (code === "approval_expired") emit({ type: "APPROVAL_EXPIRED" });
    else if (code === "request_cancelled") emit({ type: "APPROVAL_CANCELLED" });
    else emit({ type: "FAILED", code });
  }
  function schedule() {
    clearTimer();
    if (!closed && polling) timer = setTimeout(() => { void poll(); }, Math.max(0, Math.min(deadline, nextPollAt) - ports.now()));
  }
  async function poll(): Promise<void> {
    if (closed || !polling || !session || busy) return;
    if (ports.now() >= deadline || polls >= maxPolls) {
      await forget(); emit({ type: "APPROVAL_EXPIRED" }); return;
    }
    if (ports.now() < nextPollAt) { schedule(); return; }
    const id = session, current = revision;
    busy = true; polls++; nextPollAt = ports.now() + interval;
    try {
      const result = await ports.status(id);
      if (closed || current !== revision) return;
      if (result.state === "approved") {
        clearTimer(); polling = false; session = undefined;
        emit({ type: "APPROVAL_GRANTED" });
      } else if (result.state !== "pending_approval" || !Number.isFinite(Date.parse(result.expiresAt))) {
        await failed(undefined);
      } else {
        deadline = Math.min(deadline, Date.parse(result.expiresAt));
      }
    } catch (error) { if (!closed && current === revision) await failed(error); }
    finally { busy = false; if (current === revision) schedule(); }
  }
  return {
    async openDiscovery(): Promise<void> {
      if (closed) return;
      await scan?.close();
      if (closed) return;
      emit({ type: "DISCOVERY_STARTED" });
      scan = ports.discovery((snapshot) => {
        emit({ type: "CANDIDATES_UPDATED", candidates: snapshot.candidates.map((candidate) => ({
          candidateId: candidate.candidateId, displayName: candidate.displayName, trust: "untrusted-candidate",
        })) });
      }, () => emit({ type: "FAILED", code: "discovery_unavailable" }));
    },
    async closeDiscovery(): Promise<void> { const old = scan; scan = undefined; await old?.close(); },
    async begin(invitation: string, profile: ipc.OfficePairingProfile, candidateId: string | null = null): Promise<void> {
      if (closed || busy || session) return;
      const current = ++revision; busy = true;
      emit(candidateId ? { type: "CANDIDATE_SELECTED", candidateId } : { type: "JOIN_STARTED" });
      try {
        const result = await ports.begin(invitation, profile, candidateId);
        if (closed || current !== revision) { await ports.cancel(result.sessionId).catch(() => undefined); return; }
        if (!/^[a-f0-9-]{36}$/i.test(result.sessionId) || !/^\d{6}$/.test(result.sas) || !Number.isFinite(Date.parse(result.expiresAt))) {
          await ports.cancel(result.sessionId).catch(() => undefined); await failed(undefined); return;
        }
        session = result.sessionId; sasDeadline = Date.parse(result.expiresAt); awaitingSas = true;
        if (sasDeadline <= ports.now()) { await failed("office_approval_expired:"); return; }
        emit({ type: "SAS_RECEIVED", sas: result.sas });
      } catch (error) { if (!closed && current === revision) await failed(error); }
      finally { busy = false; }
    },
    async confirm(matches: boolean): Promise<void> {
      if (closed || busy || !session || !awaitingSas) return;
      if (ports.now() >= sasDeadline) { await failed("office_approval_expired:"); return; }
      const id = session, current = revision; busy = true; awaitingSas = false;
      try {
        const result = await ports.confirm(id, matches);
        if (closed || current !== revision) { await ports.cancel(id).catch(() => undefined); return; }
        emit({ type: "SAS_CONFIRMED", matches });
        if (!matches) { await forget(); return; }
        const expires = Date.parse(result.expiresAt);
        if (result.state !== "pending_approval" || !Number.isFinite(expires)) { await failed(undefined); return; }
        deadline = Math.min(expires, ports.now() + maxPolls * interval);
        polling = true; polls = 0; nextPollAt = ports.now() + interval;
        emit({ type: "JOIN_REQUESTED", approvalExpiresAt: deadline });
      } catch (error) { if (!closed && current === revision) await failed(error); }
      finally { busy = false; if (current === revision) schedule(); }
    },
    poll,
    async cancel(): Promise<void> { ++revision; await forget(); emit({ type: "APPROVAL_CANCELLED" }); },
    async close(): Promise<void> {
      if (closed) return;
      closed = true; ++revision;
      const old = scan; scan = undefined;
      await Promise.all([forget(), old?.close().catch(() => undefined)]);
    },
  };
}
export type OfficeJoin = ReturnType<typeof createOfficeJoin>;

// SPDX-License-Identifier: Apache-2.0

/** Screen-independent state machine for the proposed office pairing flow.
 * Native discovery, pinned transport and pairing remain ports; this module
 * deliberately contains no IPC, timers, storage, or UI framework imports.
 */
export type OfficeErrorCode =
  | "host_not_found"
  | "network_blocked"
  | "hub_pin_mismatch"
  | "approval_rejected"
  | "approval_expired"
  | "request_cancelled"
  | "discovery_unavailable"
  | "invite_invalid"
  | "invite_expired"
  | "challenge_expired"
  | "challenge_replayed"
  | "sas_mismatch"
  | "too_many_attempts"
  | "already_joined"
  | "identity_link_required"
  | "permission_missing"
  | "host_stopped"
  | "connection_lost"
  | "unknown";

export interface OfficeCandidate {
  candidateId: string;
  displayName: string;
  /** Discovery is a lead only and must never imply trust. */
  trust: "untrusted-candidate";
}

export interface OfficeFlowState {
  phase:
    | "nickname-required"
    | "browsing"
    | "candidate-selected"
    | "sas-waiting"
    | "approval-waiting"
    | "connected"
    | "error";
  nickname?: string;
  candidates: readonly OfficeCandidate[];
  selectedCandidateId?: string;
  sas?: string;
  approvalExpiresAt?: number;
  error?: OfficeErrorCode;
  /** These labels describe storage location, never authority. */
  storage: "local-only" | "company-share-pending" | "company-shared";
}

export type OfficeFlowEvent =
  | { type: "NICKNAME_SAVED"; nickname: string }
  | { type: "DISCOVERY_STARTED" }
  | { type: "CANDIDATES_UPDATED"; candidates: readonly OfficeCandidate[] }
  | { type: "CANDIDATE_SELECTED"; candidateId: string }
  | { type: "SAS_RECEIVED"; sas: string }
  | { type: "SAS_CONFIRMED"; matches: boolean }
  | { type: "JOIN_REQUESTED"; approvalExpiresAt: number }
  | { type: "APPROVAL_GRANTED" }
  | { type: "APPROVAL_REJECTED" }
  | { type: "APPROVAL_CANCELLED" }
  | { type: "APPROVAL_EXPIRED" }
  | { type: "CONNECTION_LOST" }
  | { type: "LOCAL_SAVE_ONLY" }
  | { type: "SHARE_ACKNOWLEDGED" }
  | { type: "FAILED"; code: OfficeErrorCode }
  | { type: "RETRY" }
  | { type: "RESET" };

export interface OfficeFlowContext {
  /** Caller supplies the clock so expiry transitions are deterministic. */
  now: number;
}

export interface OfficeDiscoveryPort {
  start(): Promise<void>;
  stop(): Promise<void>;
  onCandidates(callback: (candidates: readonly OfficeCandidate[]) => void): () => void;
}
export interface OfficeLinkPort {
  verifyCandidate(candidateId: string): Promise<{ sas: string }>;
  close(): Promise<void>;
}
export interface PairingPort {
  requestApproval(nickname: string): Promise<{ expiresAt: number }>;
  cancelRequest(): Promise<void>;
  getStatus(): Promise<"pending" | "approved" | "rejected" | "expired">;
}

export const initialOfficeFlowState: OfficeFlowState = {
  phase: "nickname-required",
  candidates: [],
  storage: "local-only",
};

const allowedSas = /^\d{4,6}$/;

export function reduceOfficeFlow(
  state: OfficeFlowState,
  event: OfficeFlowEvent,
  context: OfficeFlowContext,
): OfficeFlowState {
  if (event.type === "RESET") return initialOfficeFlowState;
  if (event.type === "FAILED") return { ...state, phase: "error", error: event.code };
  if (event.type === "RETRY") {
    if (state.phase !== "error") return state;
    return state.error === "approval_rejected" || state.error === "approval_expired"
      ? { ...initialOfficeFlowState, nickname: state.nickname, phase: "browsing" }
      : { ...state, phase: state.nickname ? "browsing" : "nickname-required", error: undefined };
  }

  switch (event.type) {
    case "NICKNAME_SAVED": {
      const nickname = event.nickname.trim();
      return state.phase === "nickname-required" && nickname
        ? { ...state, nickname, phase: "browsing" }
        : state;
    }
    case "DISCOVERY_STARTED":
      return state.phase === "browsing" ? { ...state, candidates: [] } : state;
    case "CANDIDATES_UPDATED":
      return state.phase === "browsing"
        ? { ...state, candidates: event.candidates.map((candidate) => ({ ...candidate, trust: "untrusted-candidate" })) }
        : state;
    case "CANDIDATE_SELECTED":
      return state.phase === "browsing" && state.candidates.some((candidate) => candidate.candidateId === event.candidateId)
        ? { ...state, phase: "candidate-selected", selectedCandidateId: event.candidateId }
        : state;
    case "SAS_RECEIVED":
      return state.phase === "candidate-selected" && allowedSas.test(event.sas)
        ? { ...state, phase: "sas-waiting", sas: event.sas }
        : state;
    case "SAS_CONFIRMED":
      if (state.phase !== "sas-waiting") return state;
      return event.matches
        ? { ...state, phase: "candidate-selected" }
        : { ...state, phase: "error", error: "sas_mismatch", sas: undefined };
    case "JOIN_REQUESTED":
      if (state.phase !== "candidate-selected" || event.approvalExpiresAt <= context.now) return state;
      return { ...state, phase: "approval-waiting", approvalExpiresAt: event.approvalExpiresAt, storage: "company-share-pending" };
    case "APPROVAL_GRANTED":
      return state.phase === "approval-waiting" && (state.approvalExpiresAt ?? 0) > context.now
        // Approval grants membership; only the later durable-ACK event may
        // claim that company storage contains the user's changes.
        ? { ...state, phase: "connected", storage: "company-share-pending", error: undefined }
        : state.phase === "approval-waiting"
          ? { ...state, phase: "error", error: "approval_expired", storage: "local-only" }
          : state;
    case "APPROVAL_REJECTED":
      return state.phase === "approval-waiting" ? { ...state, phase: "error", error: "approval_rejected", storage: "local-only" } : state;
    case "APPROVAL_CANCELLED":
      return state.phase === "approval-waiting" ? { ...state, phase: "error", error: "request_cancelled", storage: "local-only" } : state;
    case "APPROVAL_EXPIRED":
      return state.phase === "approval-waiting" && (state.approvalExpiresAt ?? Infinity) <= context.now
        ? { ...state, phase: "error", error: "approval_expired", storage: "local-only" }
        : state;
    case "CONNECTION_LOST":
      return state.phase === "connected" ? { ...state, phase: "error", error: "connection_lost", storage: "company-share-pending" } : state;
    case "LOCAL_SAVE_ONLY":
      return { ...state, storage: state.phase === "connected" ? "company-share-pending" : "local-only" };
    case "SHARE_ACKNOWLEDGED":
      return state.phase === "connected" ? { ...state, storage: "company-shared" } : state;
  }
}

export const officeErrorCopy: Readonly<Record<OfficeErrorCode, { cause: string; next: string }>> = {
  host_not_found: { cause: "회사 작업 공간을 찾지 못했어요.", next: "관리자에게 공유가 켜져 있는지 확인해 달라고 하거나 초대 링크를 열어 주세요." },
  network_blocked: { cause: "회사 네트워크나 보안 정책이 연결을 막고 있어요.", next: "회사 네트워크에 연결한 뒤에도 안 되면 관리자에게 이 안내를 보여 주세요." },
  hub_pin_mismatch: { cause: "확인한 회사 작업 공간과 연결 대상이 달라요.", next: "연결을 멈추고 관리자에게 새 초대를 요청해 주세요." },
  approval_rejected: { cause: "이 기기의 참여가 승인되지 않았어요.", next: "관리자에게 확인한 뒤 다시 요청해 주세요." },
  approval_expired: { cause: "참여 요청 시간이 지났어요.", next: "초대를 다시 열고 새 요청을 보내 주세요." },
  request_cancelled: { cause: "참여 요청을 취소했어요.", next: "원하면 근처 작업 공간을 다시 찾아 요청할 수 있어요." },
  discovery_unavailable: { cause: "근처 작업 공간을 찾는 기능을 사용할 수 없어요.", next: "초대 링크나 파일을 열어 참여해 주세요." },
  invite_invalid: { cause: "초대가 올바르지 않거나 이미 사용됐어요.", next: "관리자에게 새 초대를 요청해 주세요." },
  invite_expired: { cause: "초대가 만료됐어요.", next: "관리자에게 새 초대를 요청해 주세요." },
  challenge_expired: { cause: "확인 시간이 지나 요청을 이어갈 수 없어요.", next: "초대를 다시 열어 새 확인을 시작해 주세요." },
  challenge_replayed: { cause: "이미 처리된 확인 요청이에요.", next: "초대를 새로 열어 다시 시작해 주세요." },
  sas_mismatch: { cause: "두 화면의 확인 숫자가 달라요.", next: "승인하지 말고 연결을 닫은 뒤 관리자에게 새 초대를 요청해 주세요." },
  too_many_attempts: { cause: "확인 요청이 여러 번 실패해 잠시 멈췄어요.", next: "잠시 기다린 뒤 관리자에게 새 초대를 요청해 주세요." },
  already_joined: { cause: "이 기기는 이미 회사 작업 공간에 연결돼 있어요.", next: "설정에서 현재 연결을 확인해 주세요." },
  identity_link_required: { cause: "이 기기를 기존 구성원 계정과 연결해야 해요.", next: "기존 계정으로 로그인하거나 관리자에게 계정 연결을 요청해 주세요." },
  permission_missing: { cause: "승인됐지만 열 수 있는 공유 자료가 아직 없어요.", next: "관리자에게 필요한 vault 권한을 확인해 달라고 해 주세요." },
  host_stopped: { cause: "공유를 시작한 컴퓨터가 현재 꺼져 있어요.", next: "관리자에게 호스트를 다시 켜 달라고 하거나 나중에 다시 연결해 주세요." },
  connection_lost: { cause: "회사 작업 공간 연결이 끊겼어요.", next: "변경 내용은 이 컴퓨터에 저장돼 있어요. 네트워크가 복구되면 다시 연결해 주세요." },
  unknown: { cause: "회사 작업 공간에 연결하지 못했어요.", next: "잠시 후 다시 시도하거나 관리자에게 이 안내를 보여 주세요." },
};

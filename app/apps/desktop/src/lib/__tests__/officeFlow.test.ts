// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  initialOfficeFlowState,
  officeErrorCopy,
  reduceOfficeFlow,
  type OfficeCandidate,
  type OfficeFlowEvent,
  type OfficeFlowState,
} from "../officeFlow";

const now = 1000;
const candidate: OfficeCandidate = { candidateId: "hub-a", displayName: "기획팀 · 민수 · 7K2P", trust: "untrusted-candidate" };
function step(state: OfficeFlowState, event: OfficeFlowEvent, time = now): OfficeFlowState {
  return reduceOfficeFlow(state, event, { now: time });
}
function joining(): OfficeFlowState {
  let state = step(initialOfficeFlowState, { type: "NICKNAME_SAVED", nickname: " 민수 " });
  state = step(state, { type: "CANDIDATES_UPDATED", candidates: [candidate] });
  state = step(state, { type: "CANDIDATE_SELECTED", candidateId: "hub-a" });
  state = step(state, { type: "SAS_RECEIVED", sas: "4821" });
  state = step(state, { type: "SAS_CONFIRMED", matches: true });
  return state;
}

describe("officeFlow reducer", () => {
  it("starts with nickname required and saves a trimmed nickname once", () => {
    expect(initialOfficeFlowState.phase).toBe("nickname-required");
    expect(step(initialOfficeFlowState, { type: "NICKNAME_SAVED", nickname: "  " })).toBe(initialOfficeFlowState);
    const browsing = step(initialOfficeFlowState, { type: "NICKNAME_SAVED", nickname: " 민수 " });
    expect(browsing).toMatchObject({ phase: "browsing", nickname: "민수" });
    expect(step(browsing, { type: "NICKNAME_SAVED", nickname: "다른 이름" })).toBe(browsing);
  });
  it("discovers only untrusted candidates, selects a listed candidate, and waits for SAS", () => {
    let state = step(initialOfficeFlowState, { type: "NICKNAME_SAVED", nickname: "민수" });
    state = step(state, { type: "CANDIDATES_UPDATED", candidates: [candidate] });
    expect(state.candidates[0].trust).toBe("untrusted-candidate");
    expect(step(state, { type: "CANDIDATE_SELECTED", candidateId: "missing" })).toBe(state);
    state = step(state, { type: "CANDIDATE_SELECTED", candidateId: "hub-a" });
    expect(state.phase).toBe("candidate-selected");
    expect(step(state, { type: "SAS_RECEIVED", sas: "12x4" })).toBe(state);
    state = step(state, { type: "SAS_RECEIVED", sas: "4821" });
    expect(state).toMatchObject({ phase: "sas-waiting", sas: "4821" });
  });
  it("starts a pasted invitation without exposing a candidate endpoint", () => {
    const browsing = step(initialOfficeFlowState, { type: "NICKNAME_SAVED", nickname: "민수" });
    const started = step(browsing, { type: "JOIN_STARTED" });
    expect(started).toMatchObject({ phase: "candidate-selected", selectedCandidateId: undefined, sas: undefined });
    expect(step(started, { type: "SAS_RECEIVED", sas: "482193" }).phase).toBe("sas-waiting");
  });
  it("requires a matching SAS before requesting approval", () => {
    const waiting = step(joining(), { type: "SAS_RECEIVED", sas: "1234" });
    expect(step(waiting, { type: "SAS_CONFIRMED", matches: false })).toMatchObject({ phase: "error", error: "sas_mismatch" });
    const selected = step(waiting, { type: "SAS_CONFIRMED", matches: true });
    expect(selected.phase).toBe("candidate-selected");
    expect(step(selected, { type: "JOIN_REQUESTED", approvalExpiresAt: now })).toBe(selected);
  });
  it("tracks pending, approved, rejected, cancelled, and expired outcomes with injected time", () => {
    const pending = step(joining(), { type: "JOIN_REQUESTED", approvalExpiresAt: now + 50 });
    expect(pending).toMatchObject({ phase: "approval-waiting", storage: "company-share-pending" });
    expect(step(pending, { type: "APPROVAL_GRANTED" }, now + 49)).toMatchObject({ phase: "connected", storage: "company-share-pending" });
    expect(step(pending, { type: "APPROVAL_GRANTED" }, now + 50)).toMatchObject({ phase: "error", error: "approval_expired" });
    expect(step(pending, { type: "APPROVAL_REJECTED" })).toMatchObject({ phase: "error", error: "approval_rejected", storage: "local-only" });
    expect(step(pending, { type: "APPROVAL_CANCELLED" })).toMatchObject({ phase: "error", error: "request_cancelled" });
    expect(step(pending, { type: "APPROVAL_EXPIRED" }, now + 49)).toBe(pending);
    expect(step(pending, { type: "APPROVAL_EXPIRED" }, now + 50)).toMatchObject({ phase: "error", error: "approval_expired" });
  });
  it("keeps local saves distinct from company sharing and handles lost connection", () => {
    const connected = step(step(joining(), { type: "JOIN_REQUESTED", approvalExpiresAt: now + 50 }), { type: "APPROVAL_GRANTED" });
    expect(step(connected, { type: "LOCAL_SAVE_ONLY" }).storage).toBe("company-share-pending");
    expect(step(connected, { type: "SHARE_ACKNOWLEDGED" }).storage).toBe("company-shared");
    expect(step(connected, { type: "CONNECTION_LOST" })).toMatchObject({ phase: "error", error: "connection_lost", storage: "company-share-pending" });
    expect(step(initialOfficeFlowState, { type: "LOCAL_SAVE_ONLY" }).storage).toBe("local-only");
  });
  it("handles generic failures, retry, and reset", () => {
    const failed = step(joining(), { type: "FAILED", code: "network_blocked" });
    expect(failed).toMatchObject({ phase: "error", error: "network_blocked" });
    expect(step(failed, { type: "RETRY" }).phase).toBe("browsing");
    expect(step(failed, { type: "RESET" })).toBe(initialOfficeFlowState);
  });
  it("has a cause and next action for every public error code", () => {
    const codes = Object.keys(officeErrorCopy);
    expect(codes.length).toBeGreaterThanOrEqual(15);
    for (const [code, copy] of Object.entries(officeErrorCopy)) {
      expect(copy.cause, code).toBeTruthy();
      expect(copy.next, code).toBeTruthy();
    }
  });
});

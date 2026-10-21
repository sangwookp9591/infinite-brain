// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../lib/i18n";
import { initialOfficeFlowState, reduceOfficeFlow } from "../../lib/officeFlow";
import type { OfficeCandidate, OfficeErrorCode } from "../../lib/officeFlow";
import type { OfficeDemoPort } from "../../lib/officeAdapters";
import { OfficeScreens } from "./OfficeScreens";
import "./office.css";

const errorMessages: Record<OfficeErrorCode, { cause: string; next: string }> = {
  host_not_found: { cause: "The company workspace was not found.", next: "Ask your administrator to check sharing or open an invitation." },
  network_blocked: { cause: "Your company network or security policy blocked the connection.", next: "Reconnect to your company network. Ask your administrator if it still fails." },
  hub_pin_mismatch: { cause: "This is not the company workspace you confirmed.", next: "Stop here and ask your administrator for a new invitation." },
  approval_rejected: { cause: "This device was not approved to join.", next: "Check with your administrator before requesting again." },
  approval_expired: { cause: "The join request expired.", next: "Open a new invitation and send another request." },
  request_cancelled: { cause: "The join request was cancelled.", next: "You can find a workspace and request again." },
  discovery_unavailable: { cause: "Nearby workspace search is unavailable.", next: "Open an invitation from your administrator." },
  invite_invalid: { cause: "This invitation is invalid or already used.", next: "Ask your administrator for a new invitation." },
  invite_expired: { cause: "This invitation has expired.", next: "Ask your administrator for a new invitation." },
  challenge_expired: { cause: "The confirmation timed out.", next: "Open the invitation again to start a new confirmation." },
  challenge_replayed: { cause: "This confirmation was already used.", next: "Open a new invitation and try again." },
  sas_mismatch: { cause: "The confirmation numbers do not match.", next: "Stop and ask your administrator for a new invitation." },
  too_many_attempts: { cause: "Too many confirmation attempts failed.", next: "Wait, then ask your administrator for a new invitation." },
  already_joined: { cause: "This device is already connected to the workspace.", next: "Check the current connection in settings." },
  identity_link_required: { cause: "Link this device to your existing account first.", next: "Sign in to your account or ask an administrator to link it." },
  permission_missing: { cause: "You are approved, but no shared items are available yet.", next: "Ask your administrator to check your workspace access." },
  host_stopped: { cause: "The computer sharing this workspace is off.", next: "Ask your administrator to turn it on or try again later." },
  connection_lost: { cause: "The workspace connection was lost.", next: "Your changes are saved on this computer. Reconnect when the network is back." },
  unknown: { cause: "Could not connect to the workspace.", next: "Try again later or show this message to your administrator." },
};

export function OfficePanel({ adapter, scenario = "default" }: { adapter: OfficeDemoPort; scenario?: string }) {
  const tr = useT();
  const [state, setState] = useState(() => scenario === "error"
    ? { ...initialOfficeFlowState, phase: "error" as const, error: "network_blocked" as const }
    : initialOfficeFlowState);
  const [nickname, setNickname] = useState("");
  const [candidates, setCandidates] = useState<readonly OfficeCandidate[]>([]);
  const [requests, setRequests] = useState(() => adapter.getRequests());
  const [hostRunning, setHostRunning] = useState(adapter.getHostRunning());
  useEffect(() => {
    if (scenario !== "duplicates") return;
    setNickname("민수");
    setState({ ...initialOfficeFlowState, phase: "browsing", nickname: "민수" });
    adapter.onCandidates((list) => setCandidates(list));
  }, [adapter, scenario]);
  const tick = (event: Parameters<typeof reduceOfficeFlow>[1]) => setState((s) => reduceOfficeFlow(s, event, { now: Date.now() }));
  const copy = useMemo(() => state.error ? errorMessages[state.error] : undefined, [state.error]);
  const confirm = (matches: boolean) => { tick({ type: "SAS_CONFIRMED", matches }); if (!matches) void adapter.close(); };
  return <div className="office-frame">
    <nav className="office-locale" aria-label={tr("Language")}>{tr("English · Korean")}</nav>
    <OfficeScreens t={tr} state={state} nickname={nickname} candidates={candidates} requests={requests} hostRunning={hostRunning} errorCopy={copy && { cause: tr(copy.cause), next: tr(copy.next) }}
      onNicknameChange={setNickname} onSaveNickname={() => tick({ type: "NICKNAME_SAVED", nickname })}
      onDiscover={() => { void adapter.start().then(() => adapter.onCandidates((list) => { setCandidates(list); tick({ type: "CANDIDATES_UPDATED", candidates: list }); })); tick({ type: "DISCOVERY_STARTED" }); }}
      onSelect={(candidateId) => { tick({ type: "CANDIDATE_SELECTED", candidateId }); void adapter.verifyCandidate(candidateId).then(({ sas }) => tick({ type: "SAS_RECEIVED", sas }), () => tick({ type: "FAILED", code: "network_blocked" })); }}
      onConfirm={confirm} onJoin={() => void adapter.requestApproval(nickname).then(({ expiresAt }) => tick({ type: "JOIN_REQUESTED", approvalExpiresAt: expiresAt }))}
      onRetry={() => tick({ type: "RETRY" })}
      onConfirmSas={(id, matches) => void adapter.confirmRequest(id, matches).then(() => setRequests(adapter.getRequests()))}
      onDecide={(id, approve) => void adapter.decideRequest(id, approve).then(() => { setRequests(adapter.getRequests()); if (approve) tick({ type: "APPROVAL_GRANTED" }); else tick({ type: "APPROVAL_REJECTED" }); })}
      onHostToggle={(running) => void adapter.setHostRunning(running).then(() => setHostRunning(adapter.getHostRunning()))} />
  </div>;
}

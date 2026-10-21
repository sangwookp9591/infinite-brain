// SPDX-License-Identifier: Apache-2.0
import type { OfficeCandidate, OfficeFlowState } from "../../lib/officeFlow";
import type { OfficeRequest } from "../../lib/officeAdapters";

export interface OfficeScreensProps {
  t(text: string): string;
  state: OfficeFlowState;
  nickname: string;
  candidates: readonly OfficeCandidate[];
  requests: readonly OfficeRequest[];
  hostRunning: boolean;
  errorCopy?: { cause: string; next: string };
  onNicknameChange(value: string): void;
  onSaveNickname(): void;
  onDiscover(): void;
  onSelect(candidateId: string): void;
  onConfirm(matches: boolean): void;
  onJoin(): void;
  onRetry(): void;
  onDecide(id: string, approve: boolean): void;
  onConfirmSas(id: string, matches: boolean): void;
  onHostToggle(running: boolean): void;
}

function ConfirmationNumber({ value, label }: { value: string; label: string }) {
  const grouped = value.length === 6 ? `${value.slice(0, 3)} ${value.slice(3)}` : value;
  return <output className="office-sas" aria-label={`${label}: ${[...value].join(" ")}`}>{grouped}</output>;
}

export function OfficeScreens(p: OfficeScreensProps) {
  const tr = p.t;
  const { state } = p;
  const stepHeading: Record<OfficeFlowState["phase"], string> = {
    "nickname-required": "How should coworkers see you?",
    browsing: "Nearby workspaces",
    "candidate-selected": "Workspace checked",
    "sas-waiting": "Do the numbers on both screens match?",
    "approval-waiting": "Waiting for approval",
    connected: "Connected",
    error: "Office collaboration",
  };
  return <main className="office" aria-labelledby="office-title">
    {state.phase === "error" && <div className="office-error office-error-top" role="alert"><strong>{p.errorCopy?.cause}</strong><p>{p.errorCopy?.next}</p><button className="office-secondary" onClick={p.onRetry}>{tr("Try again")}</button></div>}
    <header className="office-header"><div><p className="office-eyebrow">Infinite Brain</p><h1 id="office-title">{tr(stepHeading[state.phase])}</h1></div><span className={`office-status office-status-${state.storage}`} role="status">{tr(state.storage === "company-shared" ? "Connected" : state.storage === "company-share-pending" ? "Waiting to share with your company" : state.phase === "approval-waiting" ? "Waiting for approval" : "This computer only")}</span></header>
    {state.phase !== "error" && <section className="office-card office-flow" aria-label={tr("Join a workspace")}>
      {state.phase === "nickname-required" && <>
        <h2>{tr("How should coworkers see you?")}</h2><p>{tr("Your nickname is for display. It does not verify your account or device.")}</p>
        <label htmlFor="office-nickname">{tr("Nickname")}</label><input id="office-nickname" value={p.nickname} maxLength={40} onChange={(e) => p.onNicknameChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && p.onSaveNickname()} />
        <button className="primary" disabled={!p.nickname.trim()} onClick={p.onSaveNickname}>{tr("Save nickname")}</button>
      </>}
      {state.phase === "browsing" && <>
        <p>{tr("These are unverified candidates. Finding one does not make it trusted.")}</p>
        <button className="office-secondary" onClick={p.onDiscover}>{tr("Find nearby workspaces")}</button>
        <ul className="office-candidates" aria-live="polite">{p.candidates.map((candidate) => <li key={candidate.candidateId}><div><strong>{candidate.displayName}</strong><span>{tr("Not verified")}</span></div><button className="office-secondary" onClick={() => p.onSelect(candidate.candidateId)}>{tr("Review")}</button></li>)}</ul>
        <p className="office-hint">{tr("Open an invitation from your administrator if nothing appears.")}</p>
      </>}
      {state.phase === "candidate-selected" && (state.sas
        ? <div className="office-confirm"><p>{tr("Workspace checked. Request approval to join.")}</p><button className="primary" onClick={p.onJoin}>{tr("Request to join")}</button></div>
        : <p className="office-hint" role="status">{tr("Checking the workspace…")}</p>)}
      {state.phase === "sas-waiting" && <div className="office-confirm"><p>{tr("Ask your coworker to compare the confirmation numbers. Stop if they differ.")}</p><ConfirmationNumber value={state.sas ?? ""} label={tr("Six-digit confirmation number")} /><button className="primary" onClick={() => p.onConfirm(true)}>{tr("Yes, they match")}</button><button className="office-secondary" onClick={() => p.onConfirm(false)}>{tr("No, they are different")}</button></div>}
      {state.phase === "approval-waiting" && <p className="office-hint" role="status">{tr("Your request is waiting for an administrator. You can keep working on this computer.")}</p>}
      {state.phase === "connected" && <p className="office-hint" role="status">{tr("The company workspace approved this device.")}</p>}
    </section>}
    <section className="office-card office-local" aria-labelledby="office-local-title">
      <h2 id="office-local-title">{tr("Share from this computer")}</h2>
      <p>{tr("Manage requests and sharing for this computer.")}</p>
      <div className="office-admin" aria-label={tr("Approval inbox")}>
        <h3>{tr("Approval inbox")}</h3><p>{tr("Check that each person and device is familiar before approving.")}</p>
        {p.requests.map((request) => <div className="office-request" key={request.id}><div><strong>{request.nickname}</strong><span>{request.device} · {request.platform}</span><small>{tr(request.status === "pending" ? "Pending" : request.status === "approved" ? "Approved" : "Rejected")}</small>{request.status === "pending" && <><span>{tr("Confirmation number")}</span><ConfirmationNumber value={request.confirmationNumber} label={tr("Six-digit confirmation number")} />{request.sasMatches === false && <small role="alert">{tr("The numbers differ. Do not approve this request.")}</small>}{request.sasMatches == null && <div className="office-actions"><button className="office-secondary" onClick={() => p.onConfirmSas(request.id, false)}>{tr("No, they are different")}</button><button className="office-secondary" onClick={() => p.onConfirmSas(request.id, true)}>{tr("Yes, they match")}</button></div>}</>}</div>{request.status === "pending" && <div className="office-actions"><button className="office-secondary" onClick={() => p.onDecide(request.id, false)}>{tr("Reject")}</button><button className="primary" disabled={request.sasMatches !== true} onClick={() => p.onDecide(request.id, true)}>{tr("Approve")}</button></div>}</div>)}
      </div>
      <div className="office-host"><div><h3>{tr("Share from this computer")}</h3><p>{tr("This workspace is available while this computer is on.")}</p></div><button className="office-secondary" aria-pressed={p.hostRunning} onClick={() => p.onHostToggle(!p.hostRunning)}>{tr(p.hostRunning ? "Stop sharing" : "Start sharing")}</button></div>
    </section>
  </main>;
}

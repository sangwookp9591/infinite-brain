// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { useT } from "../../lib/i18n";
import { initialOfficeFlowState, reduceOfficeFlow, officeErrorCopy, type OfficeCandidate, type OfficeErrorCode } from "../../lib/officeFlow";
import type { OfficeDemoPort } from "../../lib/officeAdapters";
import { createOfficeJoin, type OfficeJoinPorts } from "../../lib/officeJoin";
import * as ipc from "../../lib/ipc";
import { OfficeScreens, type OfficeMode } from "./OfficeScreens";
import "./office.css";

function localProfile(): { personId: string; nickname: string } {
  try {
    let personId = localStorage.getItem("infinitebrain.office.personId");
    if (!personId || !/^[a-f0-9-]{36}$/i.test(personId)) { personId = crypto.randomUUID(); localStorage.setItem("infinitebrain.office.personId", personId); }
    return { personId, nickname: localStorage.getItem("infinitebrain.office.nickname") ?? "" };
  } catch { return { personId: crypto.randomUUID(), nickname: "" }; }
}

export function OfficePanel({ adapter, scenario = "default" }: { adapter: OfficeDemoPort; scenario?: string }) {
  const tr = useT();
  const [state, setState] = useState(() => scenario === "error" ? { ...initialOfficeFlowState, phase: "error" as const, error: "network_blocked" as const } : initialOfficeFlowState);
  const [profile] = useState(localProfile);
  const [nickname, setNickname] = useState(profile.nickname);
  const [candidates, setCandidates] = useState<readonly OfficeCandidate[]>([]);
  const [requests, setRequests] = useState(() => adapter.getHostRunning() ? adapter.getRequests() : []);
  const [hostRunning, setHostRunning] = useState(adapter.getHostRunning());
  const [mode, setMode] = useState<OfficeMode>("choice");
  const [invitation, setInvitation] = useState<{ code: string; expiresAt: string }>();
  const simulator = import.meta.env.DEV && window.location.pathname.startsWith("/dev/window-simulator/");
  const join = useRef<ReturnType<typeof createOfficeJoin> | undefined>(undefined);
  const tick = (event: Parameters<typeof reduceOfficeFlow>[1]) => setState((s) => reduceOfficeFlow(s, event, { now: Date.now() }));
  useEffect(() => {
    let live = true;
    void adapter.refreshHost?.().then(async (running) => {
      if (!live) return;
      setHostRunning(running);
      if (!running) { setRequests([]); return; }
      try { setRequests(await adapter.refreshRequests?.() ?? adapter.getRequests()); } catch { setRequests([]); }
    }).catch(() => undefined);
    const onCandidates = adapter.onCandidates((list) => { if (live) setCandidates(list); });
    return () => { live = false; onCandidates(); void adapter.stop(); void join.current?.close(); };
  }, [adapter]);
  useEffect(() => {
    if (scenario !== "duplicates") return;
    setNickname("민수"); setState({ ...initialOfficeFlowState, phase: "browsing", nickname: "민수" });
  }, [scenario]);
  const fail = (error: unknown) => {
    const raw = error instanceof Error ? /^office:([a-z_]+)/.exec(error.message)?.[1] : undefined;
    tick({ type: "FAILED", code: raw && raw in officeErrorCopy ? raw as OfficeErrorCode : "unknown" });
  };
  const ensureJoin = () => {
    if (join.current) return join.current;
    let joinPorts: OfficeJoinPorts | undefined;
    if (simulator) {
      let pollCount = 0;
      joinPorts = {
        begin: async () => ({ sessionId: crypto.randomUUID(), sas: "482193", expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() }),
        confirm: async () => ({ state: "pending_approval", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }),
        status: async () => ({ state: ++pollCount > 1 ? "approved" : "pending_approval", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }),
        cancel: async () => {}, now: Date.now,
        discovery: (onSnapshot, onError) => {
          void adapter.start().then(() => { adapter.onCandidates((items) => onSnapshot({ scanId: "preview", searching: false, candidates: items.map((item) => ({ candidateId: item.candidateId, serverId: "preview", displayName: item.displayName, trust: "untrusted" as const })) })); }, onError);
          return { close: () => adapter.stop() };
        },
      };
    }
    join.current = createOfficeJoin((event) => {
      if (event.type === "DISCOVERY_STARTED") tick({ type: "DISCOVERY_STARTED" });
      else if (event.type === "JOIN_STARTED") tick({ type: "JOIN_STARTED" });
      else if (event.type === "CANDIDATES_UPDATED") { setCandidates(event.candidates); tick({ type: "CANDIDATES_UPDATED", candidates: event.candidates }); }
      else if (event.type === "CANDIDATE_SELECTED") tick({ type: "CANDIDATE_SELECTED", candidateId: event.candidateId });
      else if (event.type === "SAS_RECEIVED") tick({ type: "SAS_RECEIVED", sas: event.sas });
      else if (event.type === "SAS_CONFIRMED") { tick({ type: "SAS_CONFIRMED", matches: event.matches }); if (!event.matches) setMode("join"); }
      else if (event.type === "JOIN_REQUESTED") tick({ type: "JOIN_REQUESTED", approvalExpiresAt: event.approvalExpiresAt });
      else if (event.type === "APPROVAL_GRANTED") tick({ type: "APPROVAL_GRANTED" });
      else if (event.type === "APPROVAL_REJECTED") tick({ type: "APPROVAL_REJECTED" });
      else if (event.type === "APPROVAL_EXPIRED") tick({ type: "APPROVAL_EXPIRED" });
      else if (event.type === "APPROVAL_CANCELLED") tick({ type: "APPROVAL_CANCELLED" });
      else if (event.type === "FAILED") tick({ type: "FAILED", code: event.code });
    }, joinPorts);
    return join.current;
  };
  const begin = async (input: HTMLInputElement, candidateId: string | null = null) => {
    const code = input.value; input.setCustomValidity(""); input.value = "";
    if (!code.trim()) { tick({ type: "FAILED", code: "invite_invalid" }); return; }
    try {
      if (!simulator) await ipc.officeDeviceIdentity();
      const agent = ensureJoin();
      await agent.begin(code, { personId: profile.personId, displayAlias: nickname, deviceLabel: "내 컴퓨터", platform: /Win/.test(navigator.userAgent) ? "windows" : /Mac/.test(navigator.userAgent) ? "macos" : "other" }, candidateId);
    } catch (error) { fail(error); }
  };
  const copy = async () => { if (invitation) await navigator.clipboard.writeText(invitation.code).catch(() => tick({ type: "FAILED", code: "unknown" })); };
  return <div className="office-frame"><OfficeScreens t={tr} state={state} nickname={nickname} candidates={candidates} requests={requests} hostRunning={hostRunning} mode={mode} invitationCode={invitation?.code} invitationExpiresAt={invitation?.expiresAt} errorCopy={state.error ? officeErrorCopy[state.error] : undefined}
    onNicknameChange={setNickname} onSaveNickname={() => { try { localStorage.setItem("infinitebrain.office.nickname", nickname.trim()); } catch {} tick({ type: "NICKNAME_SAVED", nickname }); setMode("choice"); }}
    onDiscover={() => { setMode("join"); void ensureJoin().openDiscovery().catch(() => tick({ type: "FAILED", code: "discovery_unavailable" })); }}
    onSelect={(candidateId, input) => { if (!input || !input.value.trim()) { input?.setCustomValidity(tr("Paste an invitation code before choosing a workspace.")); input?.reportValidity(); input?.focus(); return; } input.setCustomValidity(""); void begin(input, candidateId); }}
    onConfirm={(matches) => { void ensureJoin().confirm(matches); }}
    onJoin={() => { void ensureJoin().confirm(true); }} onRetry={() => { if (state.phase === "approval-waiting") void ensureJoin().cancel(); else { tick({ type: "RETRY" }); setMode("join"); } }}
    onConfirmSas={(id, matches) => void adapter.confirmRequest(id, matches).then(async () => setRequests(await adapter.refreshRequests?.() ?? adapter.getRequests()), fail)}
    onDecide={(id, approve) => void adapter.decideRequest(id, approve).then(async () => setRequests(await adapter.refreshRequests?.() ?? adapter.getRequests()), fail)}
    onHostToggle={(running) => { if (!running && hostRunning && !window.confirm(tr("Stopping sharing disconnects coworkers. Copies already saved on their computers will remain. Stop sharing?"))) return; void adapter.setHostRunning(running).then(async () => { setHostRunning(await adapter.refreshHost?.() ?? adapter.getHostRunning()); if (!running) { setInvitation(undefined); setRequests([]); } else setRequests(await adapter.refreshRequests?.() ?? adapter.getRequests()); }, fail); }}
    onMode={(next) => setMode(next)} onPasteInvitation={(input) => void begin(input)}
    onCreateInvitation={() => void adapter.createInvitation().then((result) => setInvitation({ code: result.invitationCode, expiresAt: result.expiresAt }), fail)} onCopyInvitation={() => void copy()} /></div>;
}

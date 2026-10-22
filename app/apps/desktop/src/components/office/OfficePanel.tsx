// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { useT } from "../../lib/i18n";
import { initialOfficeFlowState, reduceOfficeFlow, officeErrorCopy, type OfficeCandidate, type OfficeErrorCode } from "../../lib/officeFlow";
import { createOfficeConnection, type OfficeDemoPort } from "../../lib/officeAdapters";
import type { OfficeJoinPorts } from "../../lib/officeJoin";
import { ApiClient } from "../../lib/api";
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

export function OfficePanel({ adapter, scenario = "default", connection: provided }: { adapter: OfficeDemoPort; scenario?: string; connection?: ReturnType<typeof createOfficeConnection> }) {
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
  const [connection] = useState(() => {
    if (provided) return provided;
    if (!import.meta.env.DEV || !window.location.pathname.startsWith("/dev/window-simulator/")) throw new Error("Office preview is development-only");
    const api = new ApiClient();
    api.getSession = async () => ({ user: { id: "preview-person", name: "민수", email: "preview@example.invalid" }, activeOrganizationId: "preview-company" });
    api.listVaults = async () => scenario === "vault-empty" ? [] : [{ id: "preview-vault-plan", organization_id: "preview-company", name: "제품 기획" }, ...(scenario === "vault-single" ? [] : [{ id: "preview-vault-design", organization_id: "preview-company", name: "디자인 자료" }])];
    const previewPorts: OfficeJoinPorts = {
      begin: async () => ({ sessionId: crypto.randomUUID(), sas: "482193", expiresAt: new Date(Date.now() + 300_000).toISOString() }),
      confirm: async () => ({ state: "pending_approval", expiresAt: new Date(Date.now() + 600_000).toISOString() }),
      status: async () => ({ state: "approved", expiresAt: new Date(Date.now() + 600_000).toISOString(), origin: "https://preview.invalid", serverId: "preview-hub" }),
      cancel: async () => {}, now: Date.now,
      openLink: async () => ({ httpBaseUrl: "preview", syncUrl: "preview", vaultSyncUrl: "preview", expiresAt: new Date(Date.now() + 600_000).toISOString(), close: async () => {} }),
      discovery: (onSnapshot) => {
        const remove = adapter.onCandidates((items) => onSnapshot({ scanId: "preview", searching: false, candidates: items.map((item) => ({ candidateId: item.candidateId, serverId: "preview", displayName: item.displayName, trust: "untrusted" as const })) }));
        void adapter.start();
        return { close: async () => { remove(); await adapter.stop(); } };
      },
    };
    return createOfficeConnection(api, { stop: async () => {}, connect: async () => {}, restore: () => {} }, previewPorts);
  });
  const [connectionState, setConnectionState] = useState(connection.getState);
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
    return () => { live = false; onCandidates(); void adapter.stop(); };
  }, [adapter]);
  useEffect(() => {
    if (scenario !== "duplicates") return;
    setNickname("민수"); setState({ ...initialOfficeFlowState, phase: "browsing", nickname: "민수" });
  }, [scenario]);
  const fail = (error: unknown) => {
    const raw = error instanceof Error ? /^office:([a-z_]+)/.exec(error.message)?.[1] : undefined;
    tick({ type: "FAILED", code: raw && raw in officeErrorCopy ? raw as OfficeErrorCode : "unknown" });
  };
  useEffect(() => {
    const update = () => {
      const next = connection.getState();
      setConnectionState(next);
      if (next.phase === "vault-selecting") setState((s) => ({ ...s, phase: "vault-selecting", storage: "local-only", error: undefined }));
      else if (next.phase === "connecting") tick({ type: "SYNC_CONNECTING" });
      else if (next.phase === "connected") {
        tick({ type: "RELAY_CONNECTED" });
        if (next.storage === "company-shared") tick({ type: "SHARE_ACKNOWLEDGED" });
      }
      else if (next.phase === "error") tick({ type: "FAILED", code: next.error ?? "unknown" });
    };
    const remove = connection.subscribe(update);
    const removeEvents = connection.onEvent((event) => {
      if (event.type === "CANDIDATES_UPDATED") setCandidates(event.candidates);
      tick(event);
    });
    update();
    return () => { remove(); removeEvents(); };
  }, [connection]);
  useEffect(() => {
    if (!simulator || !["vault-select", "vault-single", "vault-empty", "connected", "revoked", "expired", "offline"].includes(scenario)) return;
    setNickname("민수");
    setState({ ...initialOfficeFlowState, phase: "browsing", nickname: "민수" });
    void connection.begin("IB1.preview.synthetic", { personId: profile.personId, displayAlias: "민수", deviceLabel: "내 컴퓨터", platform: "other" }).then(() => connection.confirm(true));
    return () => { if (!provided) void connection.close(); };
  }, [connection, scenario]);
  useEffect(() => {
    if (!simulator || connectionState.phase !== "vault-selecting") return;
    if (scenario === "connected") void connection.select(connectionState.vaults[0].id);
    if (["revoked", "expired", "offline"].includes(scenario)) tick({ type: "FAILED", code: scenario === "revoked" ? "session_revoked" : scenario === "expired" ? "session_expired" : "connection_lost" });
  }, [connectionState, scenario]);
  const begin = async (input: HTMLInputElement, candidateId: string | null = null) => {
    const code = input.value; input.setCustomValidity(""); input.value = "";
    if (!code.trim()) { tick({ type: "FAILED", code: "invite_invalid" }); return; }
    try {
      if (!simulator) await ipc.officeDeviceIdentity();
      await connection.begin(code, { personId: profile.personId, displayAlias: nickname, deviceLabel: "내 컴퓨터", platform: /Win/.test(navigator.userAgent) ? "windows" : /Mac/.test(navigator.userAgent) ? "macos" : "other" }, candidateId);
    } catch (error) { fail(error); }
  };
  const copy = async () => { if (invitation) await navigator.clipboard.writeText(invitation.code).catch(() => tick({ type: "FAILED", code: "unknown" })); };
  return <div className="office-frame"><OfficeScreens t={tr} state={state} nickname={nickname} candidates={candidates} requests={requests} hostRunning={hostRunning} mode={mode} invitationCode={invitation?.code} invitationExpiresAt={invitation?.expiresAt} errorCopy={state.error ? officeErrorCopy[state.error] : undefined} vaults={connectionState.vaults} onSelectVault={(id) => void connection.select(id).catch(fail)} onDisconnect={() => void connection.close().then(() => { tick({ type: "RESET" }); }, fail)}
    onNicknameChange={setNickname} onSaveNickname={() => { try { localStorage.setItem("infinitebrain.office.nickname", nickname.trim()); } catch {} tick({ type: "NICKNAME_SAVED", nickname }); setMode("choice"); }}
    onDiscover={() => { setMode("join"); void connection.discover().catch(() => tick({ type: "FAILED", code: "discovery_unavailable" })); }}
    onSelect={(candidateId, input) => { if (!input || !input.value.trim()) { input?.setCustomValidity(tr("Paste an invitation code before choosing a workspace.")); input?.reportValidity(); input?.focus(); return; } input.setCustomValidity(""); void begin(input, candidateId); }}
    onConfirm={(matches) => { void connection.confirm(matches).catch(fail); }}
    onJoin={() => { void connection.confirm(true).catch(fail); }} onRetry={() => { if (state.phase === "approval-waiting") void connection.cancel().catch(fail); else { void connection.close().then(() => { tick({ type: "RETRY" }); setMode("join"); }, fail); } }}
    onConfirmSas={(id, matches) => void adapter.confirmRequest(id, matches).then(async () => setRequests(await adapter.refreshRequests?.() ?? adapter.getRequests()), fail)}
    onDecide={(id, approve) => void adapter.decideRequest(id, approve).then(async () => setRequests(await adapter.refreshRequests?.() ?? adapter.getRequests()), fail)}
    onHostToggle={(running) => { if (!running && hostRunning && !window.confirm(tr("Stopping sharing disconnects coworkers. Copies already saved on their computers will remain. Stop sharing?"))) return; void adapter.setHostRunning(running).then(async () => { setHostRunning(await adapter.refreshHost?.() ?? adapter.getHostRunning()); if (!running) { setInvitation(undefined); setRequests([]); } else setRequests(await adapter.refreshRequests?.() ?? adapter.getRequests()); }, fail); }}
    onMode={(next) => setMode(next)} onPasteInvitation={(input) => void begin(input)}
    onCreateInvitation={() => void adapter.createInvitation().then((result) => setInvitation({ code: result.invitationCode, expiresAt: result.expiresAt }), fail)} onCopyInvitation={() => void copy()} /></div>;
}

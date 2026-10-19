import { shareErrorMessage } from "./shareErrorMessage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// The `.skel-line` shimmer lives with the editor skeleton (as ContentWidthPreview does).
import "./editor.css";
import type {
  AccessDefault,
  InvitationOverview,
  MemberOverview,
  MembersOverview,
  MyBillingAccount,
  TeamAccess,
  TeamAccessMode,
} from "../lib/api";
import { authManager } from "../lib/auth/authManager";
import { freeLimitOf } from "../lib/billing";
import { rosterCache, type RosterSnapshot } from "../lib/membersAccessCaches";
import { buildInviteLink, isInvitationExpired } from "../lib/inviteLink";
import {
  countLine,
  EVERYONE_OPTIONS,
  everyoneLabel,
  filterPeople,
  freshViewerRole,
  invitationAccessLabel,
  needsAccessConfirm,
  LEVEL_TO_MODE,
  levelClass,
  lastActiveLabel,
  NEW_MEMBER_OPTIONS,
  PERSON_LEVEL_LABEL,
  reduceAccessCopy,
  ROLE_LABEL,
  shortDate,
  presentUserIds,
  levelOfMode,
  patchedTeamAccess,
  withMemberLevel,
  withNewInvitations,
  withoutInvitation,
  withViewerRole,
} from "../lib/membersAccess";
import { syncManager } from "../lib/sync/docSession";
import { writeTeamAccessCache } from "../lib/teamAccessCache";
import { toast } from "../lib/toast";
import type { SettingsTab } from "../lib/settingsTabs";
import { useStore } from "../store";
import { Avatar } from "./Avatar";
import { ConfirmDialog } from "./ConfirmDialog";
import { InvitePeopleDialog } from "./InvitePeopleDialog";
import { PeopleLimitNotice, inviteLimitError, peopleLimitKind } from "./PeopleLimitNotice";
import { MemberProfilePage, type ProfileTab } from "./MemberProfilePage";
import { ProfileSkeleton } from "./MemberProfileSkeletons";
import { canActOnMember, canSetMemberAccess } from "./memberRoles";
import { MenuSelect } from "./MenuSelect";
import { RowActionsMenu, type RowAction } from "./RowActionsMenu";
import { markSelfAccessChange } from "../lib/sync/selfAccessChanges";
import { useT } from "../lib/i18n";

/** Render a translated sentence with one bold value; `text` was translated with the placeholder set to \u0001. */
const boldIn = (text: string, value: string) => {
  const [before, after] = text.split("\u0001");
  return <>{before}<strong>{value}</strong>{after}</>;
};


/** How long a burst of per-item ticks settles before the shared side effects run. */
export const ITEM_WRITE_SETTLE_MS = 600;

type PersonChoice = TeamAccessMode | "manage" | "custom";

interface Confirm {
  title: string;
  label: string;
  tone: "danger" | "accent";
  body: React.ReactNode;
  apply: () => Promise<void>;
}

/**
 * Settings → Members and access: one table of people with their role, their
 * vault-wide access and when they were last around, under the two vault-level
 * rows (Everyone, New members). Plain members see the roster read-only.
 *
 * The Everyone row writes ONLY through `PUT team-access` — never through the
 * bulk route with an org audience — because that endpoint is what clears the
 * per-folder team rows in the same transaction.
 */
/**
 * The last roster answer per (server, org, manager view), kept in memory for
 * the session so a revisit paints at once and re-fetches behind it (#307).
 * Never persisted and never used to authorise anything: the fresh answer
 * replaces it as soon as it lands.
 */
const rosterKey = (orgId: string, canManage: boolean) =>
  `${authManager.getServerUrl()}|${orgId}|${canManage ? "m" : "p"}`;

/**
 * Warm the roster cache when Vault Settings opens, so the Members tab paints
 * at once (#307). Fills only an empty slot and swallows failures: the tab's
 * own load still runs and stays authoritative.
 */
const prefetching = new Set<string>();
export function prefetchRoster(orgId: string | null, canManage: boolean): void {
  if (!orgId) return;
  const key = rosterKey(orgId, canManage);
  if (rosterCache.has(key) || prefetching.has(key)) return;
  prefetching.add(key);
  void Promise.all([
    authManager.api.getMembersOverview(orgId).catch(() => null),
    canManage ? authManager.api.getTeamAccess(orgId).catch(() => null) : Promise.resolve(null),
    canManage ? authManager.api.getAccessDefault(orgId).catch(() => null) : Promise.resolve(null),
  ]).then(([overview, teamAccess, accessDefault]) => {
    prefetching.delete(key);
    if (!overview || rosterCache.has(key)) return;
    rosterCache.set(key, { overview, teamAccess, accessDefault });
  });
}

export function MembersAccessTab({ canManage, onOpenTab, onCloseSettings, resetToken = 0 }: {
  canManage: boolean;
  /** Bumped when the active nav item is clicked again: back to the roster (#308). */
  resetToken?: number;
  /** Switch the settings dialog to another page (the MCP hint uses it). */
  onOpenTab?: (tab: SettingsTab) => void;
  /** Close the settings dialog, so a note opened from a profile is visible. */
  onCloseSettings?: () => void;
}) {
  const tr = useT();
  const session = useStore((s) => s.session);
  const organizations = useStore((s) => s.organizations);
  const presence = useStore((s) => s.vaultPresence);
  const vaultStatus = useStore((s) => s.vaultSyncStatus);
  const serverUrl = useStore((s) => s.serverUrl);
  const orgId = session?.activeOrganizationId ?? null;
  const myUserId = session?.user.id;
  const vaultName = organizations.find((o) => o.id === orgId)?.name ?? tr("this vault");

  const [overview, setOverview] = useState<MembersOverview | null>(null);
  const [teamAccess, setTeamAccess] = useState<TeamAccess | null>(null);
  const [accessDefault, setAccessDefault] = useState<AccessDefault | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [limitCause, setLimitCause] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [profile, setProfile] = useState<{ userId: string; tab: ProfileTab } | null>(null);
  const loadGen = useRef(0);

  // `canManage` comes from the store's member list, read when the vault
  // opened; the overview is re-read on every open, so once it has answered
  // its `canManage` is the authority (a promotion made after launch, #admin).
  const manage = overview ? overview.canManage : canManage;
  const seatAccount = useSeatAccount(orgId, manage);

  const reload = useCallback(async () => {
    const mine = ++loadGen.current;
    if (!orgId) return;
    const [ov, team, joining] = await Promise.all([
      authManager.api.getMembersOverview(orgId).catch(() => null),
      canManage ? authManager.api.getTeamAccess(orgId).catch(() => null) : Promise.resolve(null),
      canManage ? authManager.api.getAccessDefault(orgId).catch(() => null) : Promise.resolve(null),
    ]);
    // A slower, older response must never overwrite a newer one.
    if (mine !== loadGen.current) return;
    if (ov) setOverview(ov);
    if (team) {
      setTeamAccess(team);
      writeTeamAccessCache(authManager.getServerUrl(), orgId, team.mode);
    }
    if (joining) setAccessDefault(joining);
    const prev = rosterCache.get(rosterKey(orgId, canManage));
    rosterCache.set(rosterKey(orgId, canManage), {
      overview: ov ?? prev?.overview ?? null,
      teamAccess: team ?? prev?.teamAccess ?? null,
      accessDefault: joining ?? prev?.accessDefault ?? null,
    });
    if (!ov || (canManage && (!team || !joining))) {
      setError(tr("Couldn't load everything on this page. Check your connection and reopen it."));
    }
  }, [orgId, canManage]);

  useEffect(() => {
    loadGen.current++;
    // A roster seen earlier this session paints at once; the reload refreshes it.
    const seen = orgId ? rosterCache.get(rosterKey(orgId, canManage)) : undefined;
    setOverview(seen?.overview ?? null);
    setTeamAccess(seen?.teamAccess ?? null);
    setAccessDefault(seen?.accessDefault ?? null);
    setError(null);
    setConfirm(null);
    setProfile(null);
    void reload();
    return () => { loadGen.current++; };
  }, [orgId, canManage, reload]);

  // Teach the store the viewer's fresh role, so every other Vault Settings tab
  // (and this tab's `canManage` prop, which re-fetches the Everyone and New
  // members rows) follows a promotion or demotion made after the vault opened.
  useEffect(() => {
    if (!overview || !orgId || !myUserId) return;
    const current = useStore.getState().members ?? [];
    const stored = current.find((m) => m.userId === myUserId)?.role;
    const fresh = freshViewerRole(overview, myUserId, stored);
    if (!fresh || fresh === stored) return;
    const memberId = overview.members.find((m) => m.userId === myUserId)?.memberId;
    const next = withViewerRole(current, orgId, myUserId, fresh, memberId);
    if (next !== current) useStore.setState({ members: next });
  }, [overview, orgId, myUserId]);

  // Clicking the already-active "Members and access" item returns to the
  // first page of the tab: the roster, search cleared.
  useEffect(() => {
    if (resetToken === 0) return;
    setProfile(null);
    setQuery("");
  }, [resetToken]);

  /** Everything that must follow an access write. */
  const afterAccessWrite = async () => {
    cancelSideEffects();
    syncManager.retryHeldRegistrations();
    await Promise.all([useStore.getState().refreshLocks(), reload()]);
  };

  /**
   * Patch the roster on screen (and its session cache) right after a write,
   * then refresh once in the background so the server stays authoritative
   * (#307). Paint only: no write ever reads this state to decide anything.
   */
  const patchRoster = (patch: (prev: RosterSnapshot) => RosterSnapshot) => {
    if (!orgId) return;
    const key = rosterKey(orgId, canManage);
    const prev = rosterCache.get(key) ?? { overview, teamAccess, accessDefault };
    const next = patch(prev);
    rosterCache.set(key, next);
    setOverview(next.overview);
    setTeamAccess(next.teamAccess);
    setAccessDefault(next.accessDefault);
  };
  /** The one background refresh after a patched write. */
  const refreshBehind = () => {
    cancelSideEffects();
    syncManager.retryHeldRegistrations();
    void useStore.getState().refreshLocks();
    void reload();
  };

  // Per-item writes from the profile page: retry held registrations and
  // refresh the sidebar padlocks ONCE after a burst of ticks, not per row, and
  // reload nothing (the page updates its own rows; the overview reloads when
  // the page is left).
  const sideEffectsTimer = useRef<number | null>(null);
  const cancelSideEffects = () => {
    if (sideEffectsTimer.current !== null) window.clearTimeout(sideEffectsTimer.current);
    sideEffectsTimer.current = null;
  };
  const runSideEffects = () => {
    sideEffectsTimer.current = null;
    syncManager.retryHeldRegistrations();
    void useStore.getState().refreshLocks();
  };
  const scheduleSideEffects = () => {
    cancelSideEffects();
    sideEffectsTimer.current = window.setTimeout(runSideEffects, ITEM_WRITE_SETTLE_MS);
  };
  // Leaving the tab with a burst still pending: run it now rather than drop it.
  useEffect(() => () => {
    if (sideEffectsTimer.current !== null) {
      window.clearTimeout(sideEffectsTimer.current);
      runSideEffects();
    }
  }, []);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setLimitCause(null);
    try {
      await work();
    } catch (cause) {
      if (peopleLimitKind(cause)) { setLimitCause(cause); return; }
      setError(shareErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  // ── Everyone ────────────────────────────────────────────────────────────
  const writeEveryone = (mode: TeamAccessMode) => run(async () => {
    if (!orgId) return;
    markSelfAccessChange([orgId]); // Everyone includes the signed-in user
    await authManager.api.setTeamAccess(orgId, mode);
    patchRoster((r) => ({ ...r, teamAccess: r.teamAccess ? patchedTeamAccess(r.teamAccess, mode) : r.teamAccess }));
    refreshBehind();
    toast(tr("Everyone in {vault}: {level}", { vault: vaultName, level: tr(EVERYONE_OPTIONS.find((o) => o.value === mode)?.label ?? "") }));
  });

  const chooseEveryone = (mode: TeamAccessMode) => {
    if (!teamAccess) return;
    if (mode === teamAccess.mode && teamAccess.overrides.length === 0 && teamAccess.posture !== "none") return;
    const label = tr(EVERYONE_OPTIONS.find((o) => o.value === mode)?.label ?? mode);
    if (!needsAccessConfirm(teamAccess.posture === "none" ? "private" : teamAccess.mode, mode)) {
      void writeEveryone(mode);
      return;
    }
    if (mode === "open") return;
    const copy = reduceAccessCopy({ kind: "everyone" }, mode);
    setConfirm({
      title: tr(copy.title),
      label: tr(copy.button),
      tone: mode === "private" ? "danger" : "accent",
      apply: () => writeEveryone(mode),
      body: (
        <>
          <p>{boldIn(tr("Every member gets {label} unless they have their own setting. People set by name keep theirs.", { label: "\u0001" }), label)}</p>
          <p>{tr(copy.outcome)}</p>
        </>
      ),
    });
  };

  // ── New members ─────────────────────────────────────────────────────────
  const chooseDefault = (mode: TeamAccessMode) => run(async () => {
    if (!orgId || accessDefault?.mode === mode) return;
    const next = await authManager.api.setAccessDefault(orgId, mode);
    setAccessDefault(next);
    patchRoster((r) => ({ ...r, accessDefault: next }));
    toast(tr("New members: {level}", { level: tr(NEW_MEMBER_OPTIONS.find((o) => o.value === next.mode)?.label ?? "") }));
  });

  // ── One person ──────────────────────────────────────────────────────────
  const writePerson = (m: MemberOverview, mode: TeamAccessMode) => run(async () => {
    if (!orgId) return;
    if (m.userId === myUserId) markSelfAccessChange([orgId]);
    await authManager.api.setBulkAccess(orgId, {
      resources: [{ resourceType: "vault", resourceId: orgId }],
      audience: { type: "users", userIds: [m.userId] },
      mode,
    });
    patchRoster((r) => ({
      ...r,
      overview: r.overview ? withMemberLevel(r.overview, m.userId, levelOfMode(mode)) : r.overview,
    }));
    refreshBehind();
    toast(tr("{name}: {level}", { name: displayName(m), level: tr(PERSON_LEVEL_LABEL[mode === "open" ? "edit" : mode === "readonly" ? "view" : "none"]) }));
  });

  const choosePerson = (m: MemberOverview, choice: PersonChoice) => {
    if (choice === "custom") return;
    if (choice === "manage") {
      setProfile({ userId: m.userId, tab: "access" });
      return;
    }
    const level = m.access?.level ?? null;
    const from = level === null ? null : level === "custom" ? "custom" : LEVEL_TO_MODE[level];
    if (from === choice) return;
    if (!needsAccessConfirm(from, choice)) {
      void writePerson(m, choice);
      return;
    }
    if (choice === "open") return;
    const copy = reduceAccessCopy({ kind: "person", name: displayName(m), self: m.userId === myUserId }, choice);
    setConfirm({
      // Titles that name the person are rebuilt here so each has its own key.
      title: m.userId === myUserId
        ? tr(copy.title)
        : tr(choice === "private" ? "Remove {name}'s access to this vault?" : "Make {name} view only across the vault?", { name: displayName(m) }),
      label: tr(copy.button),
      tone: choice === "private" ? "danger" : "accent",
      apply: () => writePerson(m, choice),
      body: (
        <>
          <p>
            {m.userId === myUserId
              ? tr("This replaces your own settings across the vault. Your setting wins over the default setting, and owners and admins are not exempt.")
              : tr("This replaces {name}'s own settings across the vault. Their setting wins over the default setting.", { name: displayName(m) })}
          </p>
          <p>{tr(copy.outcome)}</p>
        </>
      ),
    });
  };

  const changeRole = (m: MemberOverview, role: "member" | "admin" | "guest"): Promise<void> => {
    const apply = () => run(async () => { await useStore.getState().updateMemberRole(m.userId, role); await reload(); });
    if (role === "guest") {
      setConfirm({ title: tr("Change {name} to a guest?", { name: displayName(m) }), label: tr("Change to guest"), tone: "danger",
        body: tr("They will lose access to the rest of the vault and keep only folders and notes shared directly with them."), apply });
      return Promise.resolve();
    }
    return apply();
  };

  const askRemove = (m: MemberOverview) => setConfirm({
    title: tr("Remove {name} from {vault}?", { name: displayName(m), vault: vaultName }),
    label: tr("Remove"),
    tone: "danger",
    apply: () => run(async () => {
      await useStore.getState().removeMember(m.userId);
      await reload();
    }),
    body: <p>{tr("They lose access on all their devices right away. You can invite them again later.")}</p>,
  });

  // ── Invitations ─────────────────────────────────────────────────────────
  const copyLink = async (inv: InvitationOverview) => {
    const link = buildInviteLink(serverUrl, inv.id);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast(tr("Invite link copied"));
    } catch { /* clipboard unavailable */ }
  };

  const resend = (inv: InvitationOverview) => run(async () => {
    if (!orgId) return;
    const [result] = await authManager.api.inviteMany(orgId, {
      emails: [inv.email],
      role: inv.role === "admin" ? "admin" : "member",
      access: inv.access,
    });
    await reload();
    const limit = result?.error ? inviteLimitError(result.error) : null;
    if (limit) setLimitCause(limit);
    else if (result?.error) setError(result.error);
    else toast(result?.emailed ? tr("Invitation emailed to {email}", { email: inv.email }) : tr("Invitation renewed — copy its link for {email}", { email: inv.email }));
  });

  const askRevoke = (inv: InvitationOverview) => setConfirm({
    title: tr("Revoke the invitation to {email}?", { email: inv.email }),
    label: tr("Revoke"),
    tone: "danger",
    apply: () => run(async () => {
      await authManager.api.cancelInvitation(inv.id);
      patchRoster((r) => ({ ...r, overview: r.overview ? withoutInvitation(r.overview, inv.id) : r.overview }));
      void reload();
      void useStore.getState().refreshVault();
    }),
    body: <p>{tr("Its link stops working. You can invite them again later.")}</p>,
  });

  // ── Render ──────────────────────────────────────────────────────────────
  const members = overview?.members ?? [];
  const invitations = (overview?.invitations ?? []).filter((i) => i.status === "pending");
  const shown = useMemo(() => filterPeople(query, members, invitations), [query, members, invitations]);
  const myRole = members.find((m) => m.userId === myUserId)?.role;
  const presentIds = useMemo(() => presentUserIds(presence, myUserId, vaultStatus), [presence, myUserId, vaultStatus]);
  const now = Date.now();
  const profileMember = profile ? members.find((m) => m.userId === profile.userId) ?? null : null;

  const canAct = (m: MemberOverview) =>
    canActOnMember({ canManage: manage, myUserId, myRole, target: { userId: m.userId, role: m.role } });
  const canSetAccess = (m: MemberOverview) =>
    canSetMemberAccess({ canManage: manage, myUserId, myRole, target: { userId: m.userId, role: m.role } });

  // The Everyone row shows nothing current until the server has answered; a
  // cached mode only paints the trigger as a hint, it never authorises a write.
  const everyone = teamAccess ? everyoneLabel(teamAccess.mode, teamAccess.posture) : null;

  // A profile asked for before the roster has arrived: hold its layout.
  if (profile && orgId && !overview) {
    return <div className="members-access"><ProfileSkeleton /></div>;
  }

  if (profile && profileMember && orgId) {
    return (
      <div className="members-access">
        <MemberProfilePage
          key={`${profile.userId}:${profile.tab}`}
          orgId={orgId}
          vaultName={vaultName}
          member={profileMember}
          initialTab={profile.tab}
          canAct={canAct(profileMember)}
          canSetAccess={canSetAccess(profileMember)}
          showAccessTab={manage}
          present={presentIds.has(profileMember.userId)}
          teamAccess={teamAccess}
          onClose={() => { setProfile(null); void reload(); }}
          onChanged={afterAccessWrite}
          onItemWritten={scheduleSideEffects}
          onRoleChange={(role) => changeRole(profileMember, role)}
          onRemove={() => { setProfile(null); askRemove(profileMember); }}
          onOpenNote={onCloseSettings ? (path) => {
            onCloseSettings();
            void useStore.getState().openNoteByPath(path);
          } : undefined}
        />
        {confirm && (
          <ConfirmDialog
            title={confirm.title}
            confirmLabel={confirm.label}
            tone={confirm.tone}
            onCancel={() => setConfirm(null)}
            onConfirm={async () => {
              await confirm.apply();
              setConfirm(null);
            }}
          >
            {confirm.body}
          </ConfirmDialog>
        )}
      </div>
    );
  }

  return (
    <div className="members-access">
      <div className="members-access-header">
        <h2 className="settings-section-title">{tr("Members and access")}</h2>
        {manage && (
          <button className="primary" onClick={() => setInviteOpen(true)}>{tr("Invite people")}</button>
        )}
      </div>
      <p className="members-access-intro">{tr("Owners and admins can always manage access.")}</p>
      {error && <div className="auth-error">{error}</div>}
      {limitCause != null && <PeopleLimitNotice error={limitCause} canManageBilling={myRole === "owner"} ownerName={ownerName(members)} freeLimit={seatAccount ? freeLimitOf(seatAccount) : null} />}

      {manage && (
        <div className="members-access-rows">
          <div className="members-access-row">
            <span className="members-access-row-icon" aria-hidden="true">
              <PeopleIcon />
            </span>
            <span className="members-access-row-copy">
              <span className="members-access-row-title">{tr("Everyone in {vault}", { vault: vaultName })}</span>
              <span className="muted">{tr(everyone?.sub ?? "Default for every member")}</span>
            </span>
            {teamAccess ? (
              <MenuSelect
                value={teamAccess.posture === "none" ? ("none" as TeamAccessMode) : teamAccess.mode}
                options={EVERYONE_OPTIONS.map((o) => ({ ...o, label: tr(o.label), hint: tr(o.hint) }))}
                onSelect={chooseEveryone}
                disabled={busy}
                ariaLabel={tr("Access for everyone in {vault}", { vault: vaultName })}
                triggerClassName={`members-access-trigger is-level ${levelClass(teamAccess.posture === "none" ? "private" : teamAccess.mode)}`}
                menuClassName="access-menu"
                triggerContent={everyone ? tr(everyone.label) : undefined}
              />
            ) : (
              <PillSkeleton label={tr("Loading access for everyone in {vault}", { vault: vaultName })} />
            )}
          </div>
          <div className="members-access-row">
            <span className="members-access-row-icon" aria-hidden="true">
              <ClockIcon />
            </span>
            <span className="members-access-row-copy">
              <span className="members-access-row-title">{tr("New members")}</span>
              <span className="muted">{tr("For notes made before they joined")}</span>
            </span>
            {accessDefault ? (
              <MenuSelect
                value={accessDefault.mode}
                options={NEW_MEMBER_OPTIONS.map((o) => ({ ...o, label: tr(o.label), hint: o.hint === undefined ? undefined : tr(o.hint) }))}
                onSelect={(m) => void chooseDefault(m)}
                disabled={busy}
                ariaLabel={tr("Access for new members")}
                triggerClassName={`members-access-trigger is-level ${levelClass(accessDefault.mode)}`}
                menuClassName="access-menu"
              />
            ) : (
              <PillSkeleton label={tr("Loading access for new members")} />
            )}
          </div>
        </div>
      )}

      <div className="members-access-list-heading">
        <h3>{tr("People")}</h3>
        <span className="members-access-count muted">
          {overview ? countLine(query, shown.members.length, shown.invitations.length) : <span className="skel-line members-skel-count" aria-hidden="true" />}
        </span>
      </div>
      <label className="members-access-search-field">
        <span className="members-access-search-label">{tr("Search this list")}</span>
        <span className="members-access-search">
          <SearchIcon />
          <input
            type="search"
            placeholder={tr("Name or email")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
      </label>

      {!overview && <TableSkeleton manage={manage} />}

      {overview && (
        <table className="members-table">
          <thead>
            <tr>
              <th>{tr("Name")}</th>
              <th>{tr("Role")}</th>
              {manage && <th>{tr("Access")}</th>}
              <th>{tr("Last active")}</th>
              {manage && <th aria-label={tr("Actions")} />}
            </tr>
          </thead>
          <tbody>
            {shown.members.map((m) => {
              const name = displayName(m);
              const isMe = m.userId === myUserId;
              const actions: RowAction[] = [
                { key: "profile", label: tr("View profile"), onSelect: () => setProfile({ userId: m.userId, tab: "info" }) },
              ];
              if (canSetAccess(m)) {
                actions.push({ key: "access", label: tr("Manage access"), onSelect: () => setProfile({ userId: m.userId, tab: "access" }) });
              }
              if (canAct(m)) {
                actions.push(m.role === "admin"
                  ? { key: "role", label: tr("Make member"), onSelect: () => changeRole(m, "member") }
                  : { key: "role", label: tr("Make admin"), onSelect: () => changeRole(m, "admin") });
                actions.push({ key: "remove", label: tr("Remove from {vault}", { vault: vaultName }), danger: true, separated: true, onSelect: () => askRemove(m) });
              }
              return (
                <tr
                  key={m.userId}
                  className="is-clickable"
                  tabIndex={0}
                  role="button"
                  aria-label={tr("Open profile of {name}", { name })}
                  onClick={(e) => { if (isRowOwnClick(e)) setProfile({ userId: m.userId, tab: "info" }); }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    setProfile({ userId: m.userId, tab: "info" });
                  }}
                >
                  <td>
                    <span className="members-table-person">
                      <Avatar label={name} image={m.image} userId={m.userId} />
                      <span className="members-table-names">
                        <span className="members-table-name">{name}{isMe && <span className="muted"> {tr("(you)")}</span>}</span>
                        {m.email && m.name && <span className="muted">{m.email}</span>}
                      </span>
                    </span>
                  </td>
                  <td>{tr(ROLE_LABEL[m.role] ?? m.role)}</td>
                  {manage && (
                    <td>
                      {m.access && canSetAccess(m) ? (
                        <MenuSelect<PersonChoice>
                          value={m.access.level === "custom" ? "custom" : LEVEL_TO_MODE[m.access.level]}
                          options={[
                            { value: "open", label: tr(PERSON_LEVEL_LABEL.edit) },
                            { value: "readonly", label: tr(PERSON_LEVEL_LABEL.view) },
                            { value: "private", label: tr(PERSON_LEVEL_LABEL.none) },
                            { value: "manage", label: tr("Manage access…") },
                          ]}
                          onSelect={(c) => choosePerson(m, c)}
                          disabled={busy}
                          ariaLabel={tr("Access for {name}", { name })}
                          triggerClassName={`members-access-trigger is-level ${levelClass(m.access.level)}`}
                menuClassName="access-menu"
                          triggerContent={tr(PERSON_LEVEL_LABEL[m.access.level])}
                        />
                      ) : m.access ? (
                        <span>{tr(PERSON_LEVEL_LABEL[m.access.level])}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  )}
                  <td>{tr(lastActiveLabel(presentIds.has(m.userId), m.lastActiveAt, now))}</td>
                  {manage && (
                    <td className="members-table-actions">
                      <RowActionsMenu actions={actions} ariaLabel={tr("Actions for {name}", { name })} disabled={busy} />
                    </td>
                  )}
                </tr>
              );
            })}
            {shown.invitations.map((inv) => {
              const expired = isInvitationExpired(inv.expiresAt ?? undefined);
              return (
                <tr key={inv.id} className="is-invited">
                  <td>
                    <span className="members-table-person">
                      <Avatar label={inv.email} image={null} />
                      <span className="members-table-names">
                        <span className="members-table-name">{inv.email}</span>
                        <span className="muted">
                          {expired ? tr("Invite expired") : tr("Invite sent {date}", { date: shortDate(inv.createdAt) })}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td>{tr("Invited")}</td>
                  {manage && <td>{tr(invitationAccessLabel(inv.access))}</td>}
                  <td>{tr("Not joined yet")}</td>
                  {manage && (
                    <td className="members-table-actions">
                      <RowActionsMenu
                        ariaLabel={tr("Actions for the invitation to {email}", { email: inv.email })}
                        disabled={busy}
                        actions={[
                          { key: "resend", label: tr("Resend"), onSelect: () => resend(inv) },
                          { key: "copy", label: tr("Copy link"), onSelect: () => copyLink(inv) },
                          { key: "revoke", label: tr("Revoke"), danger: true, separated: true, onSelect: () => askRevoke(inv) },
                        ]}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Only people who can manage access, and only on a synced vault — this
          tab is behind the sync gate, so reaching it means synced. */}
      {manage && onOpenTab && (
        <p className="members-access-mcp-hint">
          <TerminalIcon />
          <span>
            {tr("Tip: you can also manage access by chatting with Claude or ChatGPT through MCP.")}{" "}
            <button type="button" className="link-btn" onClick={() => onOpenTab("mcp")}>{tr("Set it up →")}</button>
          </span>
        </p>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          confirmLabel={confirm.label}
          tone={confirm.tone}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await confirm.apply();
            setConfirm(null);
          }}
        >
          {confirm.body}
        </ConfirmDialog>
      )}
      {inviteOpen && orgId && (
        <InvitePeopleDialog
          orgId={orgId}
          canManageBilling={myRole === "owner"}
          seatAccount={seatAccount}
          ownerName={ownerName(members)}
          onClose={() => setInviteOpen(false)}
          onInvited={(results, sent) => {
            const limit = results.map((r) => (r.error ? inviteLimitError(r.error) : null)).find((x) => x != null);
            if (limit) setLimitCause(limit);
            patchRoster((r) => ({
              ...r,
              overview: r.overview ? withNewInvitations(r.overview, results, sent, new Date().toISOString()) : r.overview,
            }));
            void reload();
          }}
        />
      )}
    </div>
  );
}

/** Controls inside a row keep their own clicks. */
const ROW_CONTROLS = 'button, [role="button"], [role="menu"], [role="menuitem"], [role="menuitemradio"], input, select, textarea, a, label, .row-more';

/**
 * Is this click on the row itself rather than on one of its controls? Menus
 * and confirms are portalled to <body>, and React still bubbles their clicks
 * up to this row — so anything outside the row's own DOM is ignored too.
 */
/**
 * The vault's billing account for the quiet seat line above the roster
 * (owner/admin only). Silent on any failure or when billing is off or not
 * on the Team model: the line simply does not show.
 */
function useSeatAccount(orgId: string | null, enabled: boolean): MyBillingAccount | null {
  const [account, setAccount] = useState<MyBillingAccount | null>(null);
  useEffect(() => {
    setAccount(null);
    if (!orgId || !enabled) return;
    let live = true;
    void (async () => {
      try {
        const config = await authManager.api.getBillingConfig();
        if (!config.enabled || config.model !== "team") return;
        const acct = await authManager.api.getBillingAccount({ orgId });
        if (live) setAccount(acct);
      } catch {
        // Fail silently: the seat line is informational.
      }
    })();
    return () => {
      live = false;
    };
  }, [orgId, enabled]);
  return account;
}

/** The vault owner's display name for the seat line, or null. */
function ownerName(members: MemberOverview[]): string | null {
  const owner = members.find((m) => m.role === "owner");
  return owner ? owner.name || owner.email || null : null;
}

export function isRowOwnClick(e: { target: EventTarget | null; currentTarget: EventTarget & Element }): boolean {
  const target = e.target;
  if (!(target instanceof Element) || !e.currentTarget.contains(target)) return false;
  const control = target.closest(ROW_CONTROLS);
  return !control || control === e.currentTarget;
}

export function displayName(m: Pick<MemberOverview, "name" | "email" | "userId">): string {
  return m.name || m.email || m.userId;
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </svg>
  );
}

/**
 * Placeholders that hold the final layout while the server answers: no text
 * and no mode until the state is authoritative, and nothing that jumps when it
 * arrives. They borrow the editor skeleton's `.skel-line` shimmer.
 */
function PillSkeleton({ label }: { label: string }) {
  return <span className="skel-line members-skel-pill" role="status" aria-busy="true" aria-label={label} />;
}

function TableSkeleton({ manage }: { manage: boolean }) {
  const tr = useT();
  return (
    <table className="members-table members-table-skeleton" aria-busy="true" aria-label={tr("Loading people")}>
      <thead>
        <tr>
          <th>{tr("Name")}</th>
          <th>{tr("Role")}</th>
          {manage && <th>{tr("Access")}</th>}
          <th>{tr("Last active")}</th>
          {manage && <th aria-label={tr("Actions")} />}
        </tr>
      </thead>
      <tbody aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <tr key={i}>
            <td>
              <span className="members-table-person">
                <span className="skel-line members-skel-avatar" />
                <span className="members-skel-names">
                  <span className="skel-line members-skel-name" />
                  <span className="skel-line members-skel-email" />
                </span>
              </span>
            </td>
            <td><span className="skel-line members-skel-role" /></td>
            {manage && <td><span className="skel-line members-skel-access" /></td>}
            <td><span className="skel-line members-skel-time" /></td>
            {manage && <td />}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The MCP tab's own glyph (VaultSettingsDialog), so the hint points at it. */
function TerminalIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 17l6-6-6-6" />
      <path d="M12 19h8" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

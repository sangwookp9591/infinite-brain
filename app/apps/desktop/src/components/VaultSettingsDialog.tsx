import { SecurityHistoryTab } from "./SecurityHistoryTab";
import { SmartSearchTab } from "./SmartSearch";
import { ShortcutsTab } from "./ShortcutsTab";
import { FeatureHelp } from "./FeatureHelp";
import { SpringCheck } from "./kit/SpringCheck";
/* The vault-settings dialog and its nine tabs — the whole settings surface of
   the app, split out of `AccountMenu.tsx` so it can load on demand. Nothing
   here is on the first screen: the sidebar footer (identity bar + popovers)
   stays eager, and this chunk lands when someone actually opens settings. */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  type BillingUsage,
  type McpToolInfo,
  type McpConnection,
  type MyBillingAccount,
  type MyBillingVault,
  type UnsyncPreview,
  type VaultCheckpoint,
} from "../lib/api";
import { AI_TARGETS, CONNECTION_STEPS, connectionSnippet, codexSnippet, connectionScopes, connectionTools, isConnected, type AiTarget } from "../lib/aiConnection";
import { toast } from "../lib/toast";
import { agoFromIso } from "./versionFormat";
import { authManager } from "../lib/auth/authManager";
import { t, useT } from "../lib/i18n";
import {
  classifyLimitError,
  formatBytes,
  LEGACY_PRO_BENEFITS,
  legacyFreePlanExplanation,
  type LimitKind,
  limitFromError,
  planPillLabel,
  subscriptionStatusLine,
  transferTargets,
  vaultPlanLine,
  vaultLimitReason,
} from "../lib/billing";
import * as ipc from "../lib/ipc";
import { useStore } from "../store";
import { MembersAccessTab, prefetchRoster } from "./MembersAccessTab";
import { AsyncButton } from "./AsyncButton";
import { ConfirmDialog } from "./ConfirmDialog";
import { useResetLocalCopy } from "./useResetLocalCopy";
import { AiSettingsTab } from "./AiSettingsTab";
// Static, not via ./Face: this module is itself a lazy chunk, so it pays for
// the avatar chunk it is already loading.
import { LimitNudge } from "./LimitNudge";
import { MenuIcon } from "./MenuIcon";
import { SettingsModal } from "./SettingsModal";
import { SettingsCrossLink } from "./SettingsCrossLink";
import { Switch } from "./Switch";
import { ThemeToggle } from "./ThemeToggle";
import { AppearanceRows } from "./AppearanceRows";
import {
  APPEARANCE_DEFAULTS,
  vaultAppearanceValues,
  type AppearanceKey,
  type AppearanceSettings,
  type ResolvedAppearance,
} from "../lib/appearanceSettings";
import { formatPrice, perLabel, UpgradeDialog } from "./UpgradeDialog";
import { useLocalFolderClasses, useLocalVaults } from "./useVaultLists";
import { visibleFolders } from "../lib/vault/vaultList";
import { VaultIconSettings } from "./VaultIconSettings";
import { VaultDashboardsTab } from "./VaultDashboardsTab";
import { AccountVaultsTab } from "./AccountVaultsTab";

// Defined in `lib/settingsTabs.ts` so the store can name a tab without importing
// this component; re-exported here so every existing importer is unchanged.
export type { SettingsTab } from "../lib/settingsTabs";
import type { SettingsTab } from "../lib/settingsTabs";
import { PlanHeader } from "./PlanHeader";

/** Fill `{name}` slots in a translated sentence with elements, so one sentence stays one key. */
function fill(text: string, slots: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in slots ? <Fragment key={i}>{slots[m[1]]}</Fragment> : part;
  });
}

/** "1 note" / "2 notes": English picks the key by count, Korean has one form. */
function count(n: number, one: string, many: string): string {
  return t(n === 1 ? one : many, { count: n });
}

// Sections that only make sense once the vault is synced to an org. On a
// local vault they're shown but locked, with a "Turn on sync" gate.
//
// Billing is deliberately NOT one of them (#109). Someone working in a local
// folder can still own vaults that are billing, and a subscription left behind
// by a DELETED vault has to be reachable from somewhere or the money is
// unrecoverable. Only the per-vault card at the top of that tab needs a synced
// vault, and it says so itself.
const TEAM_TABS = new Set<SettingsTab>([
  "members",
  "mcp",
  "versioning",
]);

/** General tab: name, folder, and sync state (incl. the Turn-on-sync CTA). */
const GENERAL_TAB: { id: SettingsTab; label: string; icon: React.ReactNode } = {
  id: "general",
  label: "General",
  icon: (
    <MenuIcon>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </MenuIcon>
  ),
};

/** The AI (Beta) page is hidden for now; flip to bring it back. Anything that
 *  asks for the "ai" tab while it is hidden lands on General instead. */
const SHOW_AI_TAB = false;

const AI_TAB: { id: SettingsTab; label: string; icon: React.ReactNode } = {
  id: "ai", label: "AI", icon: <MenuIcon><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /></MenuIcon>,
};

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
  {
    id: "vaults",
    label: "Vaults",
    icon: (
      <MenuIcon>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </MenuIcon>
    ),
  },
  {
    id: "members",
    label: "Members and access",
    icon: (
      <MenuIcon>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </MenuIcon>
    ),
  },
  { id: "dashboards", label: "Dashboards", icon: <MenuIcon><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></MenuIcon> },
  {
    id: "mcp",
    label: "AI connections",
    icon: (
      <MenuIcon>
        <path d="M4 17l6-6-6-6" />
        <path d="M12 19h8" />
      </MenuIcon>
    ),
  },
  {
    id: "versioning",
    label: "Versioning",
    icon: (
      <MenuIcon>
        <path d="M3 12a9 9 0 1 0 2.6-6.4" />
        <path d="M3 4v4h4" />
        <path d="M12 8v4l3 2" />
      </MenuIcon>
    ),
  },
  {
    id: "import-export",
    label: "Import / Export",
    icon: (
      <MenuIcon>
        <path d="M12 3v10" />
        <path d="m8 9 4 4 4-4" />
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </MenuIcon>
    ),
  },
  {
    id: "smart-search",
    label: "Smart search",
    icon: (
      <MenuIcon>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
        <path d="M11 8v6M8 11h6" />
      </MenuIcon>
    ),
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    icon: (
      <MenuIcon>
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
      </MenuIcon>
    ),
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: (
      <MenuIcon>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a10 10 0 0 1 0 20 5 5 0 0 1 0-10 5 5 0 0 0 0-10" />
      </MenuIcon>
    ),
  },
];

/** The Billing tab, inserted after Members only when the server has billing on. */
const BILLING_TAB: { id: SettingsTab; label: string; icon: React.ReactNode } = {
  id: "billing",
  label: "Billing",
  icon: (
    <MenuIcon>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </MenuIcon>
  ),
};

/**
 * Vault settings — a centered modal over the app (sharing its shell with
 * Account settings via {@link SettingsModal}): everything about the vault lives
 * here. Members (roster + join code + invites), Permissions (RBAC locks), and
 * Appearance (the vault's appearance defaults).
 */
export function VaultSettingsDialog({
  onClose,
  onRequestSignIn,
  initialTab,
}: {
  onClose: () => void;
  onRequestSignIn?: () => void;
  initialTab?: SettingsTab;
}) {
  const session = useStore((s) => s.session);
  const organizations = useStore((s) => s.organizations);
  const members = useStore((s) => s.members);
  const billingConfig = useStore((s) => s.billingConfig);
  const vault = useStore((s) => s.vault);
  const syncEnabled = useStore((s) => s.syncEnabled);
  const locals = useLocalVaults();
  const t = useT();

  const visibleTab = (id: SettingsTab): SettingsTab =>
    (!SHOW_AI_TAB && id === "ai") || (id === "vaults" && session) ? "general" : id;
  const [tab, setTabRaw] = useState<SettingsTab>(visibleTab(initialTab ?? "general"));
  /** Bumped when the active nav item is clicked again, so a tab can return to its first page. */
  const [tabReset, setTabReset] = useState(0);
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; }, [tab, tabReset]);
  const setTab = (id: SettingsTab) => setTabRaw(visibleTab(id));

  // Esc, click-away, focus and the backdrop all live in `SettingsModal`.
  const activeOrg =
    organizations.find((o) => o.id === session?.activeOrganizationId) ?? null;
  // Is the vault we're looking at actually syncing to an org? A local
  // vault (signed out, or an unsynced local folder) shows a reduced page
  // with the team sections locked behind "Turn on sync".
  const isSynced = syncEnabled && !!activeOrg;
  const billingEnabled = billingConfig?.enabled === true;
  // Team model: the plan lives on the account (Account Settings → Plan &
  // Billing), so this vault's page shows its usage. Same tab id, so a
  // `requestSettings("billing")` deep link still lands here.
  const teamBilling = billingConfig?.model === "team";

  // The vault list lives in Account Settings → Vaults (2026-10-07). Only a
  // signed-out app with local folders keeps it here: it has no account page.
  // Signed out every stamped folder is hidden there (`visibleFolders`), so the
  // tab appears only when an unstamped local folder remains to list.
  const localClasses = useLocalFolderClasses(session ? [] : locals, []);
  const showVaults =
    !session &&
    localClasses.resolved &&
    visibleFolders(locals, localClasses.classes).length > 0;
  const myMember = members.find((m) => m.userId === session?.user.id);
  const canManage = myMember?.role === "owner" || myMember?.role === "admin";
  const tabs = useMemo(() => {
    const out = SHOW_AI_TAB ? [GENERAL_TAB, AI_TAB] : [GENERAL_TAB];
    if (showVaults) out.push(...SETTINGS_TABS);
    else out.push(...SETTINGS_TABS.filter((item) => item.id !== "vaults"));
    if (billingEnabled) {
      const idx = out.findIndex((item) => item.id === "dashboards");
      out.splice(
        idx >= 0 ? idx + 1 : out.length,
        0,
        teamBilling ? { ...BILLING_TAB, label: "Usage" } : BILLING_TAB,
      );
    }
    if (isSynced && canManage) out.push({ id: "security", label: "Security", icon: <MenuIcon><path d="M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7Z" /></MenuIcon> });
    return out;
  }, [showVaults, billingEnabled, teamBilling, isSynced, canManage]);

  // Warm the Members tab's roster as the dialog opens (#307); paint only.
  useEffect(() => {
    const orgId = session?.activeOrganizationId ?? null;
    const me = members.find((m) => m.userId === session?.user.id);
    if (!orgId || !me) return;
    prefetchRoster(orgId, me.role === "owner" || me.role === "admin");
  }, [session, members]);

  if (!session && !vault) return null;
  // Stricter than `canManage`: making a vault local only destroys the server
  // copy for everyone, so an admin may not do it (the server agrees — 403
  // `owner_only`) and the control simply isn't drawn for them.
  const isOwner = myMember?.role === "owner";
  const activeTab = tabs.find((item) => item.id === tab) ?? tabs[0];
  const lockedTab = TEAM_TABS.has(activeTab.id) && !isSynced;
  // Render what the nav shows: a requested tab that is not offered yet (the
  // signed-out Vaults list before the recents load) paints the first tab.
  const shown = activeTab.id;

  return (
    <SettingsModal
      label={isSynced ? t("Vault settings") : t("Local vault settings")}
      onClose={onClose}
    >
      <header className="settings-page-header">
        <div className="settings-title">
          <span className="settings-eyebrow">
            {isSynced ? t("Vault settings") : t("Local vault")}
          </span>
          {/* The session's active org outlives a switch to a local folder, so
              its name only titles the dialog while that vault is the synced one. */}
          <h1>{(isSynced ? activeOrg?.name : null) ?? vault?.name ?? t("Vault")}</h1>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={t("Close settings")} title={t("Close (Esc)")}>
          ✕
        </button>
      </header>

      <div className="settings-body">
        <nav className="settings-nav" aria-label={t("Settings sections")}>
          {tabs.map((item) => {
            const locked = TEAM_TABS.has(item.id) && !isSynced;
            return (
              <button
                key={item.id}
                type="button"
                className={`menu-item${item.id === "ai" ? " settings-ai-item" : ""}${tab === item.id ? " active" : ""}${locked ? " locked" : ""}`}
                onClick={() => {
                  // Re-clicking the active item resets its sub-pages (#308).
                  if (tab === item.id) setTabReset((n) => n + 1);
                  else setTab(item.id);
                }}
                title={locked ? t("Turn on sync to unlock") : undefined}
              >
                {item.icon}
                <span className="menu-item-label">{item.id === "ai" ? t("AI (Beta)") : t(item.label)}</span>
                {locked && (
                  <svg
                    className="nav-lock"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                )}
              </button>
            );
          })}
          {session && (
            <SettingsCrossLink
              label={t("Account settings")}
              onOpen={() => useStore.getState().requestAccountSettings("profile")}
            />
          )}
        </nav>

        <section ref={contentRef} className="settings-content" aria-label={t(activeTab.label)}>
          {/* Members and access swaps its title for a back link while a profile
              is open. */}
          {!(shown === "members" && !lockedTab) && <h2 className="settings-section-title">{t(activeTab.label)}</h2>}
          <FeatureHelp tab={shown} />
          {shown === "general" ? (
            <GeneralTab
              isSynced={isSynced}
              canManage={canManage}
              isOwner={isOwner}
              activeOrgName={activeOrg?.name ?? null}
              onRequestSignIn={onRequestSignIn}
            />
          ) : shown === "dashboards" ? (
            <VaultDashboardsTab onClose={onClose} resetToken={tabReset} />
          ) : shown === "ai" ? (
            <AiSettingsTab onClose={onClose} onGoToGeneral={() => setTab("general")} />
          ) : lockedTab ? (
            <SyncGate label={activeTab.label} onGoToSync={() => setTab("general")} />
          ) : shown === "vaults" ? (
            <AccountVaultsTab />
          ) : shown === "members" ? (
            <MembersAccessTab
              canManage={canManage}
              onOpenTab={setTab}
              onCloseSettings={onClose}
              resetToken={tabReset}
            />
          ) : shown === "security" && canManage && activeOrg ? (
            <SecurityHistoryTab organizationId={activeOrg.id} />
          ) : shown === "billing" ? (
            <BillingTab canManage={canManage} isSynced={isSynced} />
          ) : shown === "mcp" ? (
            <McpTab canManage={canManage} />
          ) : shown === "versioning" ? (
            <VersioningTab canManage={canManage} />
          ) : shown === "import-export" ? (
            <ImportExportTab />
          ) : shown === "smart-search" ? (
            <SmartSearchTab />
          ) : shown === "shortcuts" ? (
            <ShortcutsTab />
          ) : (
            <AppearanceTab canManage={canManage} isSynced={isSynced} />
          )}
        </section>
      </div>
    </SettingsModal>
  );
}

/**
 * General tab: the identity of the current vault. Its heart is the
 * Turn-on-sync card for a local vault — which adopts the folder you're
 * already in (files and all) rather than making you set up a new one.
 */
function GeneralTab({
  isSynced,
  canManage,
  isOwner,
  activeOrgName,
  onRequestSignIn,
}: {
  isSynced: boolean;
  /** Owner/admin — the only roles that may flip a vault-wide latch. */
  canManage: boolean;
  /** Owner alone — the only role that may destroy the server copy. */
  isOwner: boolean;
  activeOrgName: string | null;
  onRequestSignIn?: () => void;
}) {
  const t = useT();
  const vault = useStore((s) => s.vault);
  const authStatus = useStore((s) => s.authStatus);
  // The sidebar paints before the session restore finishes, so this page can be
  // open while we still don't know whether anyone is signed in.
  const authPending = authStatus === "unknown";
  const activeOrgId = useStore((s) => s.session?.activeOrganizationId ?? null);
  // Same identity the sidebar switcher keys its icons on.
  const iconIdentity =
    isSynced && activeOrgId ? `org:${activeOrgId}` : vault ? `local:${vault.path}` : null;

  const [name, setName] = useState(vault?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitNudge, setLimitNudge] = useState<{ kind: LimitKind; limit: number | null } | null>(
    null,
  );
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const turnOn = async () => {
    if (authStatus !== "signed-in") {
      // Not signed in yet — launch sign-in right here instead of dead-ending.
      // After sign-in the button becomes "Turn on sync" (the page stays open).
      onRequestSignIn?.();
      return;
    }
    setBusy(true);
    setError(null);
    setLimitNudge(null);
    try {
      await useStore.getState().turnOnSyncForCurrentVault(name.trim() || undefined);
    } catch (e) {
      const kind = classifyLimitError(e);
      if (kind) {
        const limit = limitFromError(e);
        setLimitNudge({ kind, limit });
        // Team model: the refusal IS the upgrade moment, so the plan comparison
        // opens at once; the nudge stays behind it for after a close.
        const st = useStore.getState();
        if (kind === "vault_limit" && st.billingConfig?.model === "team") {
          st.requestUpgradeDialog({
            reason: vaultLimitReason(limit ?? st.billingConfig.freeLimits?.vaultsPerUser ?? 1),
          });
        }
      } else {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        // The inline line can be scrolled out of view, and the button simply
        // returns to idle — which reads as "nothing happened". A sticky toast is
        // always visible (#85).
        toast(t("Couldn't turn on sync — {message}", { message }), "error");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {iconIdentity && (
        <>
          {/* One icon per vault. A synced vault's belongs to the org: members see
              the owner's picker with every action disabled. */}
          <VaultIconSettings
            identity={iconIdentity}
            name={(isSynced ? activeOrgName : null) ?? vault?.name ?? ""}
            canEdit={!isSynced || canManage}
          />
          {/* A synced vault's next row (Freeze vault root) brings its own divider. */}
          {!isSynced && <div className="menu-sep" />}
        </>
      )}
      {!isSynced && (
        <>
          <div className="muted">
            {activeOrgName
              ? t("You're viewing a local folder. Turn on sync to keep this vault on your account and across devices.")
              : t("This vault lives only on this computer. Turn on sync to reach it from other devices — or invite people to it.")}
          </div>

          <div className="sync-promo">
            <h3 className="sync-promo-title">{t("Turn on sync & sharing")}</h3>
            <p className="sync-promo-desc">
              {t("Keeps the notes and folders already here — nothing to re-import. Enables live collaboration and lets you invite people. Everyone in the vault can edit by default; you choose who sees what.")}
            </p>
            <div className="row invite-bar">
              <input
                placeholder={t("Vault name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void turnOn();
                }}
              />
              {/* Disabled while the session restore runs: its answer decides
                  whether this button turns sync on or raises a sign-in card,
                  and pressing it in between would do the wrong one. */}
              <button
                className="primary"
                disabled={busy || authPending}
                onClick={() => void turnOn()}
              >
                {busy
                  ? "…"
                  : authPending
                    ? t("Checking your account…")
                    : authStatus === "signed-in"
                      ? t("Turn on sync")
                      : t("Sign in to turn on")}
              </button>
            </div>
            {!authPending && authStatus !== "signed-in" && (
              <div className="muted">{t("You'll need to sign in first — this button will prompt you.")}</div>
            )}
            {error && <div className="auth-error">{error}</div>}
            {limitNudge && (
              <LimitNudge
                kind={limitNudge.kind}
                limit={limitNudge.limit}
                onUpgrade={() => setUpgradeOpen(true)}
              />
            )}
          </div>
        </>
      )}

      {isSynced && canManage && <FreezeRootRow canManage={canManage} />}

      <div className="menu-sep" />
      <div className="subhead">{t("Folder on disk")}</div>
      <div className="join-code-row">
        <code className="vault-root-path" title={vault?.path ?? ""}>
          {vault?.path ?? "—"}
        </code>
      </div>

      {isSynced && isOwner && <UnsyncDangerZone />}

      {upgradeOpen && <UpgradeDialog onClose={() => setUpgradeOpen(false)} />}
    </>
  );
}

/**
 * The mirror of "Turn on sync": take the vault back off the server and keep the
 * folder. Owner-only, at the bottom of the page, behind a type-the-name confirm
 * — the three things that stop a mis-click on the one action in this dialog that
 * destroys other people's access.
 *
 * The counts come from the preview call rather than from anything this device
 * knows: what matters is what the SERVER is about to lose (edit history, version
 * checkpoints, public links, MCP tokens), none of which the local index can see.
 */
function UnsyncDangerZone() {
  const t = useT();
  const orgId = useStore((s) => s.session?.activeOrganizationId ?? null);
  const orgName = useStore(
    (s) =>
      s.organizations.find((o) => o.id === s.session?.activeOrganizationId)?.name ?? null,
  );
  const vaultPath = useStore((s) => s.vault?.path ?? null);
  const serverUrl = useStore((s) => s.serverUrl);
  const [preview, setPreview] = useState<UnsyncPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const reset = useResetLocalCopy();

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    authManager.api
      .getUnsyncPreview(orgId)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      // A preview that won't load must not hide the control: the confirm asks
      // again, and the server is the gate either way.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!orgId || !orgName) return null;
  const folder = vaultPath ? (vaultPath.split("/").pop() ?? vaultPath) : null;

  return (
    <>
      <div className="menu-sep" />
      <div className="subhead">{t("Danger zone")}</div>
      {reset.available && (
        <div className="vault-local-only-card">
          <span className="vault-local-only-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
          </span>
          <div className="vault-local-only-copy">
            <strong>{t("Reset local copy")}</strong>
            <span className="field-hint">
              {folder
                ? fill(t("Delete the {folder} folder on this device and download a fresh copy from {host}. Nothing changes for your team."), {
                    folder: <strong>{folder}</strong>,
                    host: serverHost(serverUrl),
                  })
                : t("Delete this vault's folder on this device and download a fresh copy from {host}. Nothing changes for your team.", {
                    host: serverHost(serverUrl),
                  })}
            </span>
          </div>
          <button className="vault-local-only-action" onClick={reset.start}>
            {t("Reset")}
          </button>
        </div>
      )}
      <div className="vault-local-only-card">
        <span className="vault-local-only-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3 2.5 20h19L12 3Z" />
            <path d="M12 9v5M12 17h.01" />
          </svg>
        </span>
        <div className="vault-local-only-copy">
          <strong>{t("Make this vault local only")}</strong>
          <span className="field-hint">
            {folder
              ? fill(t("Keep the {folder} folder on this device and remove its synced copy from {host}."), {
                  folder: <strong>{folder}</strong>,
                  host: serverHost(serverUrl),
                })
              : t("Keep the local folder on this device and remove its synced copy from {host}.", {
                  host: serverHost(serverUrl),
                })}{" "}
            {preview ? (
              <>
                {t("The server copy of {notes} and {files}, version history, and sharing will be deleted.", {
                  notes: count(preview.notes, "{count} note", "{count} notes"),
                  files: count(preview.files, "{count} file", "{count} files"),
                })}{" "}
                {preview.members > 0
                  ? t("{teammates} lose access.", {
                      teammates: count(preview.members, "{count} teammate", "{count} teammates"),
                    })
                  : t("No teammates currently have access.")}
              </>
            ) : (
              t("Checking what will be removed…")
            )}
          </span>
        </div>
        <button className="vault-local-only-action" onClick={() => setConfirming(true)}>
          {t("Make local only")}
        </button>
      </div>
      {reset.dialog}
      {confirming && (
        <UnsyncConfirmDialog
          orgId={orgId}
          orgName={orgName}
          folderName={folder}
          seed={preview}
          onCancel={() => setConfirming(false)}
          onDone={() => setConfirming(false)}
        />
      )}
    </>
  );
}

/** Just the host of the server URL — the whole URL is noise inside a sentence. */
function serverHost(serverUrl: string): string {
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}

/**
 * The confirm for "make local only".
 *
 * Wraps the shared `ConfirmDialog` rather than replacing it, and uses its
 * `confirmDisabled` for a type-the-vault-name gate: this is the one action in
 * the app that destroys data for people who are not at the keyboard, so there is
 * deliberately no path from a single click to done.
 *
 * On failure the dialog STAYS OPEN so the server's reason (403 `owner_only`, a
 * 409 `name_mismatch`, the 502 a refusing billing provider produces) has
 * somewhere to show, with a sticky error toast beside it — a destructive path
 * must never look like a success (#85). Nothing was destroyed in that case: the
 * store only touches this device once the server has answered.
 */
export function UnsyncConfirmDialog({
  orgId,
  orgName,
  folderName,
  seed,
  onCancel,
  onDone,
}: {
  orgId: string;
  orgName: string;
  folderName: string | null;
  /** An already-loaded preview, so the page and the dialog don't both count. */
  seed?: UnsyncPreview | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const serverUrl = useStore((s) => s.serverUrl);
  const [preview, setPreview] = useState<UnsyncPreview | null>(seed ?? null);
  const [loading, setLoading] = useState(!seed);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (seed) return;
    let cancelled = false;
    setLoading(true);
    authManager.api
      .getUnsyncPreview(orgId)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, seed]);

  const run = async () => {
    setError(null);
    try {
      await useStore.getState().unsyncVault(orgId, orgName);
      onDone();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      toast(t("Couldn't make the vault local only — {message}", { message }), "error");
    }
  };

  const teamBilling = useStore((s) => s.billingConfig?.model === "team");
  // On Team-model servers billing belongs to the owner's account, not the
  // vault, so removing a vault never ends a subscription.
  const sub = teamBilling ? null : (preview?.subscription ?? null);

  return (
    <ConfirmDialog
      title={t("Make {name} local only?", { name: orgName })}
      confirmLabel={t("Make local only")}
      cancelLabel={t("Cancel")}
      // The name has to match exactly. The server re-checks it too (409
      // `name_mismatch`), so a slip here can't get past either gate.
      confirmDisabled={loading || typed.trim() !== orgName}
      onCancel={onCancel}
      onConfirm={run}
    >
      <p>
        {t("Your files stay where they are.")}{" "}
        {folderName
          ? fill(t("{folder} on this device keeps every note and attachment as ordinary files."), {
              folder: <strong>{folderName}</strong>,
            })
          : t("This device keeps every note and attachment as ordinary files.")}
      </p>
      <p>
        <strong>{t("Deleted from {host}, permanently:", { host: serverHost(serverUrl) })}</strong>
      </p>
      {loading && !preview ? (
        <p className="muted">{t("Counting what would be deleted…")}</p>
      ) : preview ? (
        <ul className="confirm-list">
          <li>
            {preview.checkpoints > 0
              ? t("{notes} and {files}, with all of their edit history and {checkpoints}", {
                  notes: count(preview.notes, "{count} note", "{count} notes"),
                  files: count(preview.files, "{count} file", "{count} files"),
                  checkpoints: count(preview.checkpoints, "{count} version checkpoint", "{count} version checkpoints"),
                })
              : t("{notes} and {files}, with all of their edit history", {
                  notes: count(preview.notes, "{count} note", "{count} notes"),
                  files: count(preview.files, "{count} file", "{count} files"),
                })}
          </li>
          {preview.members > 0 && (
            <li>
              {t("{teammates} lose access immediately; their own local copies are kept", {
                teammates: count(preview.members, "{count} teammate", "{count} teammates"),
              })}
            </li>
          )}
          {preview.publicLinks > 0 && (
            <li>
              {t("{links} stop working", {
                links: count(preview.publicLinks, "{count} public share link", "{count} public share links"),
              })}
            </li>
          )}
          {preview.mcpTokens > 0 && (
            <li>
              {t("{tokens} stop working — AI clients lose access", {
                tokens: count(preview.mcpTokens, "{count} MCP token", "{count} MCP tokens"),
              })}
            </li>
          )}
        </ul>
      ) : null}
      {sub && (
        <p>
          {sub.currentPeriodEnd
            ? t("Pro ends on {date} — until then you can move the subscription to another vault from Billing.", {
                date: formatDate(sub.currentPeriodEnd),
              })
            : t("Pro ends when the current period does — until then you can move the subscription to another vault from Billing.")}
        </p>
      )}
      <p>{t("This cannot be undone. Teammates cannot get the vault back from us.")}</p>
      <label className="confirm-type">
        <span>
          {fill(t("Type {name} to confirm"), { name: <strong>{orgName}</strong> })}
        </span>
        <input
          autoFocus
          value={typed}
          spellCheck={false}
          placeholder={orgName}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      {error && <div className="auth-error">{error}</div>}
    </ConfirmDialog>
  );
}

/**
 * The "Freeze vault root" latch.
 *
 * A vault's top level is the one place where a stray note or folder is most
 * visible and least recoverable — everyone sees it, and nobody is sure whose it
 * is. Once a team has agreed the top-level shape, this closes it: new notes and
 * folders have to go inside an existing folder.
 *
 * Deliberately applies to EVERYONE, owners and admins included, because the
 * accidental root folder is almost always created by someone who does have
 * permission. Only an owner/admin can lift it; everyone else sees the switch in
 * its real state, disabled, so the rule is visible rather than mysterious.
 */
function FreezeRootRow({ canManage }: { canManage: boolean }) {
  const t = useT();
  const rootFrozen = useStore((s) => s.rootFrozen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flip = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await useStore.getState().setRootFrozen(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="menu-sep" />
      <label className="menu-row toggle-row">
        <span className="menu-row-label">
          {t("Freeze vault root")}
          <span className="field-hint">
            {t("Stops anything new being created at the top level of this vault — new notes and folders have to go inside an existing folder. Applies to everyone, including you; only an owner or admin can turn it off. Nothing already at the root is moved, renamed, or hidden.")}
          </span>
        </span>
        <Switch
          checked={rootFrozen}
          disabled={!canManage || busy}
          ariaLabel={t("Freeze vault root")}
          title={canManage ? undefined : t("Only an owner or admin can change this")}
          onChange={(next) => void flip(next)}
        />
      </label>
      {error && <div className="auth-error">{error}</div>}
    </>
  );
}

/** Locked-section gate shown for a team tab on a local vault. */
function SyncGate({ label, onGoToSync }: { label: string; onGoToSync: () => void }) {
  const t = useT();
  return (
    <div className="sync-gate">
      <svg
        className="sync-gate-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <h3>{t("{label} unlocks with sync", { label: t(label) })}</h3>
      <p className="muted">
        {t("Turn on sync for this vault to invite people, set sharing and permissions, and connect AI clients.")}
      </p>
      <button className="primary" onClick={onGoToSync}>
        {t("Turn on sync & sharing →")}
      </button>
    </div>
  );
}

/** One stat tile on the team-mode Usage tab. */
interface UsageTile {
  key: string;
  caption: string;
  value: string;
  sub: string;
  meter?: { used: number; limit: number } | null;
}

/** "1.2 MB" → { value: "1.2", unit: "MB" }; plain bytes read as "bytes". */
function splitBytes(n: number): { value: string; unit: string } {
  const [value, unit] = formatBytes(n).split(" ");
  return { value, unit: unit === "B" ? t("bytes") : unit };
}

/**
 * Team model: the active vault's billing card. A user owns exactly one billing
 * account (`billing/accounts.ts`), so the only destination a move can have is
 * the caller's own account: an owner whose vault is billed on a co-owner's
 * account gets "Move to my account". There is no picker because the server
 * accepts no other destination (`POST /billing/orgs/:orgId/move` requires the
 * caller to own both the vault and the destination account).
 */
function TeamVaultBillingCard({
  orgId,
  vaultName,
  isOwner,
  plan,
  vaultAccountId,
  onMoved,
}: {
  orgId: string | null;
  vaultName: string | null;
  isOwner: boolean;
  plan: "free" | "pro" | "team";
  vaultAccountId: string | null;
  onMoved: () => Promise<unknown>;
}) {
  const t = useT();
  // Only an owner can move, so only an owner needs (or lazily creates) their account.
  const [myAccount, setMyAccount] = useState<MyBillingAccount | null>(null);
  const myAccountId = myAccount?.id ?? null;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitNudge, setLimitNudge] = useState<{ kind: LimitKind; limit: number | null } | null>(
    null,
  );

  // This vault's usage, read from the account it is billed on (any member may
  // read it with `orgId`). `undefined` = loading, `null` = unavailable.
  const [usage, setUsage] = useState<BillingUsage | null | undefined>(undefined);

  // Fresh on every mount: the owner's billing account (the same source Plan &
  // Billing reads, so the pill agrees with it) and the `/mine` mirror whose
  // per-vault `accountPlan` covers vaults billed on someone else's account.
  useEffect(() => {
    void useStore.getState().refreshMyBilling();
    if (!isOwner) return;
    let live = true;
    authManager.api
      .getBillingAccount()
      .then((a) => { if (live) setMyAccount(a); })
      .catch(() => {});
    return () => { live = false; };
  }, [isOwner, orgId]);

  useEffect(() => {
    if (!orgId) {
      setUsage(null);
      return;
    }
    let live = true;
    setUsage(undefined);
    authManager.api
      .getBillingUsage({ orgId })
      .then((u) => { if (live) setUsage(u); })
      .catch(() => { if (live) setUsage(null); });
    return () => { live = false; };
  }, [orgId, vaultAccountId]);

  const usageRow = usage?.vaults.find((v) => v.orgId === orgId) ?? null;
  const ownerName = useStore((s) => {
    const owner = s.members.find((m) => m.organizationId === orgId && m.role === "owner");
    return owner?.user?.name || owner?.user?.email || null;
  });
  const planLine = vaultPlanLine({
    account: myAccount,
    vaultAccountId,
    fallbackPlan: plan,
    isOwner,
    ownerName,
    fmtDate: formatDate,
  });

  const elsewhere = isOwner && !!myAccountId && !!vaultAccountId && vaultAccountId !== myAccountId;
  const label = vaultName ?? t("this vault");

  const runMove = async () => {
    if (!orgId || !myAccountId) return;
    setError(null);
    setLimitNudge(null);
    try {
      await authManager.api.moveVault(orgId, myAccountId);
      setConfirming(false);
      await onMoved();
      toast(t("{name} is now on your account.", { name: vaultName ?? t("The vault") }));
    } catch (e) {
      const body = e instanceof ApiError && e.body && typeof e.body === "object"
        ? (e.body as Record<string, unknown>)
        : null;
      const code = body ? (body.code ?? body.error) : null;
      if (e instanceof ApiError && e.status === 400 && code === "same_account") {
        // Already there (another device moved it): just catch up.
        setConfirming(false);
        await onMoved();
        return;
      }
      if (e instanceof ApiError && e.status === 409 && code === "vault_limit_reached") {
        setConfirming(false);
        setLimitNudge({
          kind: "vault_limit",
          limit: typeof body?.limit === "number" ? body.limit : null,
        });
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      toast(t("Couldn't move the vault — {message}", { message }), "error");
    }
  };

  // Tiles: the four counts always; on Free, People carries a meter against the
  // account's ceiling and a Synced vaults tile joins only when a vault limit exists.
  const loading = usage === undefined;
  const syncedVaults = usage ? (usage.totals.vaults ?? usage.vaults.length) : 0;
  const bytes = usageRow ? splitBytes(usageRow.storageBytes) : null;
  const tiles: UsageTile[] = [
    {
      key: "people",
      caption: t("People"),
      value: loading ? "…" : String(usageRow?.people ?? 0),
      sub:
        usage?.limits.people != null
          ? t("of {limit} on this account", { limit: usage.limits.people })
          : (usageRow?.people ?? 0) === 1 ? t("person") : t("people"),
      meter:
        usage?.limits.people != null && usageRow
          ? { used: usageRow.people, limit: usage.limits.people }
          : null,
    },
    {
      key: "notes",
      caption: t("Notes"),
      value: loading ? "…" : String(usageRow?.notes ?? 0),
      sub: t("in this vault"),
    },
    {
      key: "attachments",
      caption: t("Attachments"),
      value: loading ? "…" : (bytes?.value ?? "0"),
      sub: bytes?.unit ?? t("bytes"),
    },
    {
      key: "files",
      caption: t("Files"),
      value: loading ? "…" : String(usageRow?.files ?? 0),
      sub: t("in this vault"),
    },
  ];
  const freeBase = useStore.getState().billingConfig?.free?.syncedVaults ?? null;
  if (usage?.limits.vaults != null) {
    tiles.push({
      key: "vaults",
      caption: t("Synced vaults"),
      value: String(syncedVaults),
      sub:
        freeBase != null && usage.limits.vaults > freeBase
          ? t("of {vaults} on this account · includes vaults you had before", { vaults: usage.limits.vaults })
          : t("of {vaults} on this account", { vaults: usage.limits.vaults }),
      meter: { used: syncedVaults, limit: usage.limits.vaults },
    });
  }

  return (
    <>
      <div className="billing-card vault-usage">
        <div className={`plan-header${planLine.plan === "Team" ? " is-team" : ""}`}>
          <PlanHeader
            name={t(planLine.plan)}
            pill={planLine.status && { ...planLine.status, label: t(planLine.status.label) }}
          />
          {planLine.billedOn && <div className="billing-section-note muted">{t(planLine.billedOn)}</div>}
        </div>
        {loading || (usageRow && usage) ? (
          <div className="vault-usage-tiles">
            {tiles.map((tile) => {
              const full = !!tile.meter && tile.meter.limit > 0 && tile.meter.used >= tile.meter.limit;
              const pct = tile.meter && tile.meter.limit > 0
                ? Math.min(100, Math.round((tile.meter.used / tile.meter.limit) * 100))
                : 0;
              return (
                <div key={tile.key} className="vault-usage-tile">
                  <span className="vault-usage-caption">{tile.caption}</span>
                  <span className="vault-usage-value">{tile.value}</span>
                  <span className="vault-usage-sub">{tile.sub}</span>
                  {tile.meter && !loading && (
                    <div
                      className={`vault-usage-meter${full ? " is-full" : ""}`}
                      role="meter"
                      aria-label={tile.caption}
                      aria-valuemin={0}
                      aria-valuemax={tile.meter.limit}
                      aria-valuenow={tile.meter.used}
                    >
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="muted">{t("Usage isn't available for this vault right now.")}</div>
        )}
        <div className="vault-usage-footer is-end">
          <button
            className="secondary billing-action"
            onClick={() => useStore.getState().requestAccountSettings("plan")}
          >
            {t("Open Plan & Billing")}
          </button>
        </div>
        {elsewhere && (
          <div className="vault-usage-footer">
            <span className="vault-usage-footer-label">
              {t("Bill it on your own account instead.")}
            </span>
            <button
              className="secondary billing-action"
              onClick={() => {
                setError(null);
                setLimitNudge(null);
                setConfirming(true);
              }}
            >
              {t("Move to my account")}
            </button>
          </div>
        )}
        {error && <div className="auth-error">{error}</div>}
        {limitNudge && (
          <LimitNudge
            kind={limitNudge.kind}
            limit={limitNudge.limit}
            onUpgrade={() => useStore.getState().requestAccountSettings("plan")}
          />
        )}
        {confirming && (
          <ConfirmDialog
            tone="accent"
            title={t("Move {name} to your account?", { name: label })}
            confirmLabel={t("Move to my account")}
            cancelLabel={t("Cancel")}
            onCancel={() => setConfirming(false)}
            onConfirm={runMove}
          >
            <p>
              {t("Its people and limits will count on your account from now on, and it stops counting on the account it is on today. Notes, members and access stay exactly as they are.")}
            </p>
          </ConfirmDialog>
        )}
      </div>
    </>
  );
}

/**
 * BillingTab: the current vault's plan and seats, then every subscription the
 * signed-in user can act on (spec 04, #109/#110).
 *
 * Three sections, in the order someone reaching for this page needs them:
 * this vault (what am I on?), all my vaults (what am I paying for?), and
 * subscriptions from deleted vaults (what am I paying for that no longer
 * exists?). Facts are visible to every member; each action is gated to the
 * role the server will actually accept — Upgrade and Manage for owners and
 * admins, Transfer for owners only, because it changes who pays for what.
 *
 * Only the first section needs a synced vault; the other two are account-wide,
 * which is why this tab is no longer in TEAM_TABS.
 */
function BillingTab({ canManage, isSynced }: { canManage: boolean; isSynced: boolean }) {
  const t = useT();
  const billingConfig = useStore((s) => s.billingConfig);
  const orgBilling = useStore((s) => s.orgBilling);
  const myBilling = useStore((s) => s.myBilling);
  const orgId = useStore((s) => s.session?.activeOrganizationId ?? null);

  // The vault the upgrade dialog should charge: the active one from the card
  // at the top, or any owned free vault picked out of the list below.
  const [upgradeOrg, setUpgradeOrg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A transfer being set up: the source row's Transfer was clicked and the
  // dialog is open. `targetOrgId` is the pick, null until one is made (or the
  // only eligible vault, pre-picked). It moves money between vaults, so the
  // dialog is where both the choice AND the confirmation happen — never a
  // popover that fires on the first click.
  const [transfer, setTransfer] = useState<{
    sourceOrgId: string;
    sourceLabel: string;
    targetOrgId: string | null;
  } | null>(null);
  // An orphaned subscription waiting on a "cancel now" confirmation.
  const [cancelling, setCancelling] = useState<{ orgId: string; label: string } | null>(
    null,
  );

  // Refresh this vault's seats AND the account-wide list whenever the tab opens.
  useEffect(() => {
    void useStore.getState().refreshOrgBilling();
    void useStore.getState().refreshMyBilling();
  }, []);

  const refreshAll = async () => {
    await Promise.all([
      useStore.getState().refreshMyBilling(),
      useStore.getState().refreshOrgBilling(),
    ]);
  };

  /** Open a vault's provider portal in the OS browser (owner/admin). */
  const openPortal = async (portalOrgId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await authManager.api.getBillingPortalUrl(portalOrgId);
      await ipc.openExternal(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Both confirmed actions leave their dialog OPEN on failure and report into
  // it, rather than closing over an error nobody sees. Neither re-throws — the
  // dialog's own AsyncButton has finished reporting by then.
  const runTransfer = async () => {
    if (!transfer || !transfer.targetOrgId) return;
    const { sourceOrgId, targetOrgId } = transfer;
    const targetName = vaults.find((v) => v.orgId === targetOrgId)?.name ?? t("the vault");
    setError(null);
    try {
      await authManager.api.transferSubscription(sourceOrgId, targetOrgId);
      setTransfer(null);
      await refreshAll();
      toast(t("Pro moved to {name}.", { name: targetName }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      toast(t("Couldn't move the subscription — {message}", { message }), "error");
    }
  };

  const runCancelNow = async () => {
    if (!cancelling) return;
    const { orgId: target, label } = cancelling;
    setError(null);
    try {
      await authManager.api.cancelSubscription(target, "now");
      setCancelling(null);
      await refreshAll();
      toast(t("Subscription for {name} canceled.", { name: label }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      toast(t("Couldn't cancel the subscription — {message}", { message }), "error");
    }
  };

  if (!billingConfig?.enabled) {
    return (
      <div className="muted perm-empty">{t("Billing isn't enabled on this server.")}</div>
    );
  }

  // Team model: billing lives on the owner's account (Account Settings → Plan &
  // Billing); this tab (labelled Usage) shows the vault's own usage. No per-vault subscription list and no transfer here.
  if (billingConfig.model === "team") {
    const row = myBilling?.vaults.find((v) => v.orgId === orgId) ?? null;
    return (
      <TeamVaultBillingCard
        orgId={orgId}
        vaultName={row?.name ?? null}
        isOwner={row?.role === "owner"}
        plan={row?.accountPlan ?? orgBilling?.accountPlan ?? "free"}
        vaultAccountId={row?.accountId ?? orgBilling?.accountId ?? null}
        onMoved={refreshAll}
      />
    );
  }

  const vaults = myBilling?.vaults ?? [];
  const orphaned = myBilling?.orphaned ?? [];
  const freeLimits = myBilling?.freeLimits ?? null;

  /**
   * The Transfer control for one row. It opens the transfer dialog, where the
   * eligible destinations are laid out with their seats and plan and the move
   * is confirmed in the same place. With exactly one eligible vault it is
   * pre-picked, so the common case is still one click plus a confirm.
   *
   * No eligible vault ⇒ a disabled control that says why, rather than a menu
   * with nothing in it.
   */
  const transferControl = (sourceOrgId: string, sourceLabel: string) => {
    const targets = transferTargets(vaults, sourceOrgId);
    if (targets.length === 0) {
      return (
        <button
          className="link-btn"
          disabled
          title={t("Nowhere to move it — you need another vault you own that isn't already on Pro.")}
        >
          {t("Transfer")}
        </button>
      );
    }
    return (
      <button
        type="button"
        className="link-btn"
        disabled={busy}
        aria-label={t("Move {name}'s subscription to another vault", { name: sourceLabel })}
        onClick={() => {
          setError(null);
          setTransfer({
            sourceOrgId,
            sourceLabel,
            targetOrgId: targets.length === 1 ? targets[0].orgId : null,
          });
        }}
      >
        {t("Transfer")}
      </button>
    );
  };

  /**
   * The transfer dialog body: the eligible destinations as selectable cards.
   * Each card carries what the reader weighs when choosing — the vault's
   * seats, and that it is on Free today — instead of a bare name.
   */
  const renderTransferDialog = () => {
    if (!transfer) return null;
    const targets = transferTargets(vaults, transfer.sourceOrgId);
    const target = targets.find((tv) => tv.orgId === transfer.targetOrgId) ?? null;
    // Owned vaults that are NOT offered, so the list's gaps are explained.
    const skipped = vaults.filter(
      (v) => v.orgId !== transfer.sourceOrgId && v.role === "owner" && !targets.includes(v),
    ).length;
    return (
      <ConfirmDialog
        tone="accent"
        title={t("Move Pro from {name}", { name: transfer.sourceLabel })}
        confirmLabel={target ? t("Move Pro to {name}", { name: target.name }) : t("Move subscription")}
        cancelLabel={t("Cancel")}
        confirmDisabled={!target}
        onCancel={() => setTransfer(null)}
        onConfirm={runTransfer}
      >
        <p>
          {fill(
            t("Choose the vault that becomes Pro. It keeps the same billing period and price. {source} drops to Free — its members and notes stay, but its attachments stop syncing. Every local copy remains available on its device."),
            { source: <strong>{transfer.sourceLabel}</strong> },
          )}
        </p>
        <div className="transfer-targets" role="radiogroup" aria-label={t("Destination vault")}>
          {targets.map((tv) => {
            const used = tv.seats.members + tv.seats.pendingInvitations;
            const selected = tv.orgId === transfer.targetOrgId;
            return (
              <button
                key={tv.orgId}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`upgrade-plan-card transfer-target${selected ? " selected" : ""}`}
                onClick={() => setTransfer({ ...transfer, targetOrgId: tv.orgId })}
              >
                <span className="transfer-target-name">{tv.name}</span>
                <span className="transfer-target-meta">
                  {t(used === 1 ? "{used} of {limit} member · Free" : "{used} of {limit} members · Free", {
                    used,
                    limit: tv.seats.limit ?? "∞",
                  })}
                </span>
              </button>
            );
          })}
        </div>
        {skipped > 0 && (
          <p className="transfer-targets-note">
            {t("Only vaults you own that aren't already on Pro are listed.")}
          </p>
        )}
        {error && <div className="auth-error">{error}</div>}
      </ConfirmDialog>
    );
  };

  /** Section 1 — the vault currently open. A plain render helper, NOT a nested
   *  component: a component declared in here would remount its whole subtree
   *  on every state change of this page. */
  const renderVaultCard = () => {
    if (!isSynced || !orgId) {
      // A card, not a bare line: this slot holds the Pro/Free card in every
      // other state, and a naked sentence there left the tab starting on
      // nothing and the Subscriptions list looking like the whole page.
      return (
        <div className="billing-card">
          <div className="muted">
            {t("This vault isn't synced, so it has no plan of its own. The vaults on your account are listed below.")}
          </div>
        </div>
      );
    }
    if (!orgBilling) return <div className="muted">{t("Loading…")}</div>;

    if (orgBilling.plan === "pro") {
      return (
        <div className="billing-card plan-pro">
          <div className="billing-plan-head">
            <span className="billing-plan-name">Pro</span>
            <span className={`billing-status ${orgBilling.status}`}>
              {orgBilling.status === "past_due"
                ? t("Past due")
                : orgBilling.status === "canceled"
                  ? t("Canceled")
                  : t("Active")}
            </span>
          </div>
          <div className="muted">
            {t("Attachment sync is active across devices and with your team.")}
          </div>
          {orgBilling.currentPeriodEnd && (
            <div className="menu-row">
              <span className="menu-row-label">
                {orgBilling.cancelAtPeriodEnd ? t("Access until") : t("Renews")}
              </span>
              <span>{formatDate(orgBilling.currentPeriodEnd)}</span>
            </div>
          )}
          {orgBilling.cancelAtPeriodEnd && (
            <div className="limit-nudge">
              <span>
                {t("Your subscription is set to cancel at the end of the current period.")}
              </span>
            </div>
          )}
          {canManage ? (
            <AsyncButton
              className="secondary billing-action"
              disabled={busy}
              onClick={() => openPortal(orgId)}
            >
              {t("Manage subscription")}
            </AsyncButton>
          ) : (
            <div className="muted">{t("Ask an owner or admin to manage the subscription.")}</div>
          )}
        </div>
      );
    }

    const { members, pendingInvitations, limit } = orgBilling.seats;
    const used = members + pendingInvitations;
    return (
      <div className="billing-card">
        <div className="billing-plan-head">
          <span className="billing-plan-name">{t("Free")}</span>
        </div>
        <div className="menu-row">
          <span className="menu-row-label">{t("Members")}</span>
          <span>
            {t("{used} of {limit}", { used, limit: limit ?? "∞" })}
            {limit != null && used >= limit ? t(" · full") : ""}
          </span>
        </div>
        {pendingInvitations > 0 && (
          <div className="muted">
            {t(pendingInvitations === 1 ? "Includes {count} pending invitation." : "Includes {count} pending invitations.", {
              count: pendingInvitations,
            })}
          </div>
        )}

        <div className="subhead">{t("Upgrade to Pro unlocks")}</div>
        <div className="muted">{legacyFreePlanExplanation(billingConfig.freeLimits)}</div>
        <ul className="upgrade-features">
          {LEGACY_PRO_BENEFITS.map((benefit) => (
            <li key={benefit}>{t(benefit)}</li>
          ))}
        </ul>

        {canManage ? (
          <button className="primary billing-action" onClick={() => setUpgradeOrg(orgId)}>
            {t("Upgrade to Pro")}
          </button>
        ) : (
          <div className="muted">{t("Ask an owner or admin to upgrade this vault.")}</div>
        )}
      </div>
    );
  };

  /** One row of section 2. */
  const renderVaultRow = (v: MyBillingVault) => {
    const seatsUsed = v.seats.members + v.seats.pendingInvitations;
    // One meta line, not three: renewal + price (already joined by
    // `subscriptionStatusLine`), then seats, then who pays when that isn't the
    // reader. A row is a name and a fact line, so the list scans vertically.
    const meta = [
      subscriptionStatusLine(v, LINE_FORMAT),
      t(seatsUsed === 1 ? "{used} of {limit} member" : "{used} of {limit} members", {
        used: seatsUsed,
        limit: v.seats.limit ?? "∞",
      }),
      !v.canManage && v.billingOwner ? t("Billed to {name}", { name: v.billingOwner.name }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <li key={v.orgId} className="billing-sub-row">
        <span className="billing-sub-name">
          <span className="billing-sub-title">
            <span className="billing-sub-vault">{v.name}</span>
            {/* A pill, not muted trailing text: it labels the row the reader
                arrived from, so it has to survive the name's ellipsis. */}
            {v.orgId === orgId && <span className="member-role">{t("Current")}</span>}
          </span>
          {meta && <span className="billing-sub-meta">{meta}</span>}
        </span>
        {/* Owner is the default for a vault you are billed for, and the row
            already carries Current + plan pills plus up to three actions — so
            the role pill only appears when the role is worth saying. */}
        {v.role !== "owner" && <span className={`member-role ${v.role}`}>{t(ROLE_LABEL[v.role] ?? v.role)}</span>}
        <span className={`billing-status ${v.status}`}>{t(planPillLabel(v))}</span>
        <span className="vault-row-actions">
          {v.canManage && v.plan === "free" && (
            <AsyncButton
              className="link-btn"
              disabled={busy}
              onClick={() => setUpgradeOrg(v.orgId)}
            >
              {t("Upgrade")}
            </AsyncButton>
          )}
          {v.canManage && v.plan === "pro" && (
            <AsyncButton
              className="link-btn"
              disabled={busy}
              onClick={() => openPortal(v.orgId)}
            >
              {t("Manage")}
            </AsyncButton>
          )}
          {v.canTransfer && transferControl(v.orgId, v.name)}
        </span>
      </li>
    );
  };

  return (
    <>
      {renderVaultCard()}

      {/* ---- 2. Every vault on the account ---- */}
      <div className="subhead">{t("Subscriptions")}</div>
      {vaults.length === 0 ? (
        <div className="muted perm-empty">
          {myBilling ? t("No vaults on this account yet.") : t("Loading…")}
        </div>
      ) : (
        <ul className="member-list">{vaults.map(renderVaultRow)}</ul>
      )}

      {/* ---- 3. Tombstones: paid time that outlived its vault ---- */}
      {orphaned.length > 0 && (
        <>
          <div className="subhead">{t("From deleted vaults")}</div>
          <div className="billing-section-note">
            {t("These subscriptions belonged to vaults that were deleted. They still bill until they end — move one to a vault to use the time you've paid for, or cancel it now.")}
          </div>
          <ul className="member-list">
            {orphaned.map((o) => {
              const label = o.orgName ?? t("Deleted vault");
              // Same two-line shape as a live vault row: the name leads, and
              // when it was deleted is a fact on the meta line, not a
              // parenthetical that competes with the name for the ellipsis.
              const meta = [
                t("Deleted {date}", { date: formatDate(o.deletedAt) }),
                subscriptionStatusLine(o, LINE_FORMAT),
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={o.orgId} className="billing-sub-row">
                  <span className="billing-sub-name">
                    <span className="billing-sub-title">
                      <span className="billing-sub-vault">{label}</span>
                    </span>
                    <span className="billing-sub-meta">{meta}</span>
                  </span>
                  <span className={`billing-status ${o.status}`}>
                    {o.status === "past_due" ? t("Past due") : "Pro"}
                  </span>
                  <span className="vault-row-actions">
                    {transferControl(o.orgId, label)}
                    <AsyncButton
                      className="link-btn danger"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setCancelling({ orgId: o.orgId, label });
                      }}
                    >
                      {t("Cancel now")}
                    </AsyncButton>
                    <AsyncButton
                      className="link-btn"
                      disabled={busy}
                      onClick={() => openPortal(o.orgId)}
                    >
                      {t("Manage")}
                    </AsyncButton>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ---- 4. What the free tier allows ---- */}
      {freeLimits && (
        <div className="menu-row settings-footer-row">
          <span className="menu-row-label">{t("Free vaults")}</span>
          <span>
            {t("{used} of {limit} used", { used: freeLimits.freeVaultsUsed, limit: freeLimits.vaultsPerUser })}
          </span>
        </div>
      )}

      {error && <div className="auth-error">{error}</div>}

      {upgradeOrg && (
        <UpgradeDialog orgId={upgradeOrg} onClose={() => setUpgradeOrg(null)} />
      )}

      {renderTransferDialog()}

      {cancelling && (
        <ConfirmDialog
          title={t("Cancel the subscription for {name}?", { name: cancelling.label })}
          confirmLabel={t("Cancel subscription")}
          cancelLabel={t("Keep it")}
          onCancel={() => setCancelling(null)}
          onConfirm={runCancelNow}
        >
          <p>
            {t("Billing stops now and the rest of the period is given up. There is no vault left to use it on, so nothing else is lost.")}
          </p>
          <p>
            {t("If you'd rather keep the time you've paid for, move it to another vault instead.")}
          </p>
          {error && <div className="auth-error">{error}</div>}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Wire role → the English label the dictionary knows; shown through `t()`. */
const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };

/** Compact absolute date for renewal/period-end lines. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * How a subscription row writes its date and price. Both formatters already
 * exist — reused here rather than re-implemented so `lib/billing.ts` can stay
 * pure and there is exactly one definition of how we print money.
 */
const LINE_FORMAT = {
  date: formatDate,
  price: (amount: number, currency: string, interval: "month" | "year" | null) =>
    `${formatPrice({ amount, currency })}${interval ? perLabel(interval) : ""}`,
};

/**
 * Versioning: the vault-wide safety net. Lists the vault's checkpoints (max 5 —
 * a daily automatic one plus manual ones), and lets an owner OR admin take one
 * and roll the whole vault back to it. Per-note history lives in the editor's
 * version panel; this page is for the blast-radius case ("the reorg went wrong,
 * put everything back").
 *
 * Revert used to be owner-only. It is the recovery half of an action admins
 * could already take (create/delete a checkpoint), so a team whose owner was
 * away could take checkpoints and not use them.
 */
function VersioningTab({ canManage }: { canManage: boolean }) {
  const t = useT();
  const checkpoints = useStore((s) => s.checkpoints);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<VaultCheckpoint | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void useStore.getState().refreshCheckpoints();
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const create = async () => {
    setError(null);
    try {
      await useStore.getState().createCheckpoint(label);
      setLabel("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await useStore.getState().deleteCheckpoint(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** `checkpointTitle`, but through the dictionary: a label is the user's own text. */
  const cpTitle = (cp: VaultCheckpoint) => {
    const trimmed = cp.label?.trim();
    if (trimmed) return trimmed;
    return t(cp.kind === "manual" ? "Manual checkpoint · {ago}" : "Daily checkpoint · {ago}", {
      ago: agoFromIso(cp.createdAt, now),
    });
  };

  const revert = async (cp: VaultCheckpoint) => {
    setError(null);
    try {
      const result = await useStore.getState().revertVaultToCheckpoint(cp.id);
      setConfirming(null);
      toast(
        t("Vault reverted — {changed} notes changed, {restored} restored, {removed} removed", {
          changed: result.docsChanged,
          restored: result.docsRestored,
          removed: result.docsDeleted,
        }),
        "success",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="versioning-tab">
      <div className="muted">
        {t("A checkpoint captures every note in this vault — content and folder structure. One is taken automatically each day the vault changes; the vault keeps its 5 most recent. Reverting rolls every member's vault back and broadcasts live.")}
      </div>
      <div className="menu-sep" />
      {canManage && (
        <>
          <div className="subhead">{t("Create checkpoint")}</div>
          <div className="row invite-bar">
            <input
              type="text"
              placeholder={t("Label (optional) — e.g. Before the big reorg")}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <AsyncButton className="primary" onClick={create}>
              {t("Create")}
            </AsyncButton>
          </div>
          <div className="menu-sep" />
        </>
      )}
      <div className="subhead">{t("Checkpoints")}</div>
      {error && <div className="auth-error">{error}</div>}
      {checkpoints == null ? (
        <div className="muted perm-empty">{t("Loading…")}</div>
      ) : checkpoints.length === 0 ? (
        <div className="muted perm-empty">
          {canManage
            ? t("No checkpoints yet. One is captured automatically within a day of the vault changing, or create one above.")
            : t("No checkpoints yet. One is captured automatically within a day of the vault changing.")}
        </div>
      ) : (
        <ul className="checkpoint-list">
          {checkpoints.map((cp) => (
            <li key={cp.id} className="checkpoint-row">
              <span className="checkpoint-main">
                <span className="checkpoint-title">
                  {cpTitle(cp)}
                </span>
                <span className="checkpoint-sub">
                  {agoFromIso(cp.createdAt, now)} · {count(cp.noteCount, "{count} note", "{count} notes")}
                  {cp.createdByName ? ` · ${t("by {name}", { name: cp.createdByName })}` : ""}
                </span>
              </span>
              {canManage && (
                <button className="link-btn" onClick={() => setConfirming(cp)}>
                  {t("Revert")}
                </button>
              )}
              {canManage && (
                <AsyncButton className="link-btn danger" onClick={() => remove(cp.id)}>
                  {t("Delete")}
                </AsyncButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {!canManage && (
        <div className="muted checkpoint-note">
          {t("Only a vault owner or admin can revert to a checkpoint.")}
        </div>
      )}
      {confirming && (
        <div className="modal-backdrop" onClick={() => setConfirming(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t("Revert the entire vault?")}</h2>
            </div>
            <p className="muted">
              {fill(
                t("Every note goes back to {title} ({ago}) — content, names and folders — for every member, live. Notes created since then are moved to trash. Attachments are not reverted. A checkpoint of the current state is taken first, so this can be undone."),
                {
                  title: <strong>{cpTitle(confirming)}</strong>,
                  ago: agoFromIso(confirming.createdAt, now),
                },
              )}
            </p>
            <div className="banner-actions">
              <button className="secondary" onClick={() => setConfirming(null)}>
                {t("Cancel")}
              </button>
              <AsyncButton
                className="primary danger"
                spinnerTone="on-accent"
                onClick={() => revert(confirming)}
              >
                {t("Revert vault")}
              </AsyncButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function McpTab({ canManage }: { canManage: boolean }) {
  const t = useT();
  const session = useStore((s) => s.session);
  const serverUrl = useStore((s) => s.serverUrl);

  const mcpUrl = `${serverUrl.replace(/\/+$/, "")}/api/mcp`;
  const hasVault = !!session?.activeOrganizationId;

  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [target, setTarget] = useState<AiTarget>("claude");
  const [preset, setPreset] = useState("write");
  const [manageAccess, setManageAccess] = useState(false);
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<{ id: string; name: string; token: string } | null>(
    null,
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Bumps every 20s so "connected" dots + relative times stay live while open.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!hasVault) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setConnections([]);
    setJustCreated(null);
    setManageAccess(false);
    setExpanded(null);
    let cancelled = false;
    const load = () =>
      authManager.api
        .listMcpConnections()
        .then(({ connections, tools }) => {
          if (cancelled) return;
          setConnections(connections);
          setError(null);
          setTools(tools);
        })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    void load();
    // Poll so a connection that goes active/idle while the panel is open shows it.
    const poll = window.setInterval(() => void load(), 20_000);
    const tickle = window.setInterval(() => setTick((n) => n + 1), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(tickle);
    };
  }, [hasVault, session?.activeOrganizationId, serverUrl]);

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      window.setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1500);
    } catch {
      setError(t("Clipboard unavailable. Select and copy the text manually."));
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await authManager.api.createMcpToken(name.trim() || "MCP token", connectionScopes(preset, canManage && manageAccess));
      setJustCreated({ id: created.id, name: created.name, token: created.token });
      const { token: _t, ...row } = created;
      setConnections((prev) => [{ ...row, kind: "token" }, ...prev]);
      setName("");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      // Otherwise the button just returns to idle and the user clicks again,
      // minting duplicate tokens on a server that is actually failing (#85).
      toast(t("Couldn't create the MCP token — {message}", { message }), "error");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (connection: McpConnection) => {
    setBusy(true);
    setError(null);
    try {
      await authManager.api.revokeMcpConnection(connection.kind, connection.id);
      if (connection.kind === "token") setJustCreated((current) => current?.id === connection.id ? null : current);
      setConnections((prev) => prev.filter((c) => c.kind !== connection.kind || c.id !== connection.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!hasVault) {
    return (
      <div className="muted perm-empty">
        {t("MCP needs an active vault — create or switch to one first.")}
      </div>
    );
  }

  const snippet = connectionSnippet(target, mcpUrl, justCreated?.token);

  return (
    <>
      <div className="muted">{t("Connect an AI to this vault. Choose its access when you sign in; your existing sharing permissions still apply.")}</div>
      <label className="subhead" htmlFor="ai-connect-target">{t("Choose your AI")}</label>
      <select id="ai-connect-target" value={target} onChange={(e) => setTarget(e.target.value as AiTarget)}>
        {AI_TARGETS.map((item) => <option key={item.id} value={item.id}>{t(item.label)}</option>)}
      </select>
      <ol className="ai-connect-steps">{CONNECTION_STEPS[target].map((step) => <li key={step}>{t(step)}</li>)}</ol>
      <div className="subhead">{t("Connector URL")}</div>
      <div className="join-code-row">
        <code className="vault-root-path" title={mcpUrl}>{mcpUrl}</code>
        <button className="link-btn" onClick={() => void copy(mcpUrl, "url")}>{copied === "url" ? t("Copied ✓") : t("Copy URL")}</button>
      </div>
      {snippet && <div className="join-code-row">
        <code className="mcp-snippet">{snippet}</code>
        <button className="link-btn" onClick={() => void copy(snippet, "snippet")}>{copied === "snippet" ? t("Copied ✓") : t("Copy settings")}</button>
      </div>}
      {target === "cli" && <div className="join-code-row">
        <code className="mcp-snippet">{codexSnippet(mcpUrl)}</code>
        <button className="link-btn" onClick={() => void copy(codexSnippet(mcpUrl), "codex")}>{copied === "codex" ? t("Copied ✓") : t("Copy Codex settings")}</button>
      </div>}
      {error && <div className="auth-error">{error}</div>}

      <div className="menu-sep" />
      <details className="ai-connect-advanced">
        <summary>{t("Advanced · Access tokens")}</summary>
        <div className="muted">
          {fill(
            t("A token authenticates the client and scopes it to you in this vault. Add it as an {header} header. Revoke any time."),
            { header: <code>Authorization: Bearer</code> },
          )}
        </div>

        <label className="subhead" htmlFor="ai-token-scope">{t("Token access")}</label>
        <select id="ai-token-scope" value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="read">{t("Read only")}</option>
          <option value="write">{t("Read + write")}</option>
          <option value="delete">{t("Read + write + delete/move")}</option>
        </select>
        {canManage && <SpringCheck label={t("Manage team access (off by default)")} checked={manageAccess} onChange={setManageAccess} />}
        <div className="row invite-bar">
          <input
            aria-label={t("Token name")}
            placeholder={t("Token name, e.g. Claude Desktop")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
          />
          <button className="primary" disabled={busy} onClick={() => void create()}>
            {t("Create token")}
          </button>
        </div>

        {justCreated && (
          <div className="mcp-new-token">
            <div className="subhead">{t("Copy your token now — it won't be shown again")}</div>
            <div className="join-code-row">
              <code className="join-code mcp-token-value" title={justCreated.token}>
                {justCreated.token}
              </code>
              <button
                className="link-btn"
                onClick={() => void copy(justCreated.token, "token")}
              >
                {copied === "token" ? t("Copied ✓") : t("Copy")}
              </button>
            </div>
            <button className="link-btn" onClick={() => setJustCreated(null)}>
              {t("Done")}
            </button>
          </div>
        )}

        <div className="menu-sep" />
      </details>
      <div className="subhead">{t("Connections")}</div>
      <div className="muted">{t("OAuth and token connections. Disconnect to stop their next request. Status reflects recent requests, not a live socket.")}</div>

      {loading ? (
        <div className="muted">{t("Loading…")}</div>
      ) : connections.length === 0 ? (
        <div className="muted">{t("No connections yet.")}</div>
      ) : (
        <ul className="mcp-conn-list">
          {connections.map((conn) => {
            const key = `${conn.kind}:${conn.id}`;
            const allowedTools = connectionTools(conn.scopes, tools);
            const live = isConnected(conn.lastUsedAt);
            const open = expanded === key;
            return (
              <li key={key} className={`mcp-conn${open ? " open" : ""}`}>
                <div className="mcp-conn-head">
                  <span
                    className={`mcp-dot ${live ? "on" : "off"}`}
                    title={live ? t("Connected") : t("Disconnected")}
                    aria-hidden="true"
                  />
                  <div className="mcp-conn-main">
                    <div className="mcp-conn-title">
                      {conn.name}
                      <span className={`mcp-status ${live ? "on" : "off"}`}>
                        {live ? t("Connected") : t("Disconnected")}
                      </span>
                    </div>
                    <div className="mcp-conn-sub muted">
                      {clientLabel(conn.lastClient)}
                      {" · "}
                      {conn.kind === "oauth" ? "OAuth" : conn.tokenPrefix}
                      {" · "}
                      {count(conn.useCount, "{count} call", "{count} calls")}
                      {" · "}
                      {conn.lastUsedAt ? t("last active {ago}", { ago: relTimeAgo(conn.lastUsedAt) }) : t("never used")}
                    </div>
                    <div className="mcp-conn-scopes">{conn.scopes?.join(" · ") ?? t("Full access (legacy)")}</div>
                  </div>
                  <button
                    className="link-btn"
                    aria-expanded={open}
                    onClick={() => setExpanded((e) => (e === key ? null : key))}
                  >
                    {open ? t("Hide tools") : t("Tools · {count}", { count: allowedTools.length })}
                  </button>
                  <AsyncButton
                    className="link-btn danger"
                    disabled={busy}
                    onClick={() => revoke(conn)}
                  >
                    {t("Disconnect")}
                  </AsyncButton>
                </div>
                {open && (
                  <ul className="mcp-tool-list">
                    {allowedTools.map((tool) => (
                      <li key={tool.name} title={tool.description}>
                        <span className={`mcp-tool-badge ${tool.access}`}>
                          {tool.access === "read"
                            ? t("read")
                            : tool.access === "destructive"
                              ? t("delete")
                              : t("write")}
                        </span>
                        <code>{tool.name}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Best-effort human name for a client from its User-Agent. */
function clientLabel(ua: string | null): string {
  if (!ua) return t("Unknown client");
  const s = ua.toLowerCase();
  if (s.includes("claude-code") || s.includes("claude code")) return "Claude Code";
  if (s.includes("claude")) return "Claude";
  if (s.includes("cursor")) return "Cursor";
  if (s.includes("node")) return t("Node client");
  // Fall back to the leading token of the UA (e.g. "MyApp/1.2" → "MyApp").
  return ua.split(/[\s/]/)[0].slice(0, 40) || t("Unknown client");
}

/** `relTime` from `lib/aiConnection`, through the dictionary. */
function relTimeAgo(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  if (diff < 60_000) return t("{n}s ago", { n: Math.max(0, Math.floor(diff / 1000)) });
  const m = Math.floor(diff / 60_000);
  if (m < 60) return t("{n}m ago", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("{n}h ago", { n: h });
  const d = Math.floor(h / 24);
  if (d < 7) return t("{n}d ago", { n: d });
  return new Date(iso).toLocaleDateString();
}


function importSummaryText(s: ipc.ImportSummary): string {
  const parts = [count(s.files, "Imported {count} file", "Imported {count} files")];
  if (s.skipped > 0) parts.push(t("{count} skipped", { count: s.skipped }));
  return parts.join(" · ") + ".";
}

/**
 * Import / Export — vault-level data operations on the open local vault. Imports
 * land at the vault root; exports copy out to a chosen folder. The same commands
 * back the sidebar ⋮ menu and drag-and-drop, so behavior is identical everywhere.
 */
function ImportExportTab() {
  const t = useT();
  const [busy, setBusy] = useState<null | "files" | "folder" | "export">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    await useStore.getState().refreshTree();
    await useStore.getState().refreshTitles();
  }

  async function run(
    kind: "files" | "folder" | "export",
    fn: () => Promise<string | null>,
  ) {
    setBusy(kind);
    setError(null);
    setMsg(null);
    try {
      const result = await fn();
      if (result) setMsg(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const importFiles = () =>
    run("files", async () => {
      // Captured before the native picker — a vault switch while it is open must
      // not redirect the import into the vault the user landed in.
      const epoch = useStore.getState().vault?.epoch;
      const sources = await ipc.pickFiles();
      if (!sources || sources.length === 0) return null;
      const summary = await ipc.importPaths("", sources, epoch);
      await refresh();
      return importSummaryText(summary);
    });

  const importFolder = () =>
    run("folder", async () => {
      const epoch = useStore.getState().vault?.epoch; // before the dialog
      const src = await ipc.pickFolder();
      if (!src) return null;
      const summary = await ipc.importPaths("", [src], epoch);
      await refresh();
      return importSummaryText(summary);
    });

  const exportVault = () =>
    run("export", async () => {
      const epoch = useStore.getState().vault?.epoch; // before the dialog
      const dest = await ipc.pickFolder();
      if (!dest) return null;
      await ipc.exportPath("", dest, epoch);
      return t("Exported the vault.");
    });

  return (
    <div className="io-tab">
      <section className="io-section">
        <h3 className="io-heading">{t("Import")}</h3>
        <p className="io-desc">
          {t("Bring existing files and folders into this vault — any format. Markdown and text become notes; everything else is kept as-is, with its folder structure. Existing names are never overwritten.")}
        </p>
        <div className="io-actions">
          <button className="primary" disabled={busy !== null} onClick={() => void importFiles()}>
            {busy === "files" ? t("Importing…") : t("Import files…")}
          </button>
          <button className="primary" disabled={busy !== null} onClick={() => void importFolder()}>
            {busy === "folder" ? t("Importing…") : t("Import folder…")}
          </button>
        </div>
        <p className="io-hint">
          {t("You can also right-click any folder in the sidebar, or drag files straight onto it.")}
        </p>
      </section>

      <section className="io-section">
        <h3 className="io-heading">{t("Export")}</h3>
        <p className="io-desc">
          {fill(t("Save a copy of this whole vault to a folder on your computer. The hidden {context} index is skipped."), {
            context: <code>.context</code>,
          })}
        </p>
        <div className="io-actions">
          <button className="primary" disabled={busy !== null} onClick={() => void exportVault()}>
            {busy === "export" ? t("Exporting…") : t("Export entire vault…")}
          </button>
        </div>
      </section>

      {error ? (
        <div className="auth-error">{error}</div>
      ) : (
        msg && <div className="io-result">{msg}</div>
      )}
    </div>
  );
}

function AppearanceTab({ canManage, isSynced }: { canManage: boolean; isSynced: boolean }) {
  const t = useT();
  const orgId = useStore((s) => s.session?.activeOrganizationId ?? null);
  const settings = useStore((s) => (orgId ? s.vaultAppearance[orgId] : undefined)) ?? EMPTY_APPEARANCE;
  // Sliders fire on every pixel of a drag: apply locally at once, PUT once
  // the thumb rests for 300 ms. Everything else saves on change.
  const pending = useRef<{ timer: number; settings: AppearanceSettings } | null>(null);

  useEffect(() => {
    if (orgId && isSynced) void useStore.getState().loadVaultAppearance(orgId);
  }, [orgId, isSynced]);
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function save(next: AppearanceSettings) {
    if (!orgId) return;
    useStore.getState().saveVaultAppearance(orgId, next).catch((e: unknown) => {
      // The change was applied optimistically and has just been rolled back:
      // say so, with the server's reason, so a refused save is never silent.
      const body = e instanceof ApiError ? (e.body as { error?: string; key?: string } | undefined) : undefined;
      const reason =
        body?.error === "invalid_appearance"
          ? body.key
            ? t('the server refused "{key}"', { key: body.key })
            : t("the server refused a value")
          : e instanceof Error
            ? e.message
            : String(e);
      toast(t("Couldn't save the vault's appearance, so it was put back: {reason}.", { reason }), "error");
    });
  }
  function flush() {
    const p = pending.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    pending.current = null;
    save(p.settings);
  }
  // Every save is the whole, concrete object: a key an older row never saved
  // is written as the app default it was already showing.
  const change = <K extends AppearanceKey>(key: K, value: ResolvedAppearance[K]) => {
    if (!orgId) return;
    const next: AppearanceSettings = {
      ...useStore.getState().vaultAppearance[orgId],
      ...vaultAppearanceValues(useStore.getState().vaultAppearance[orgId]),
      [key]: value,
    };
    if (key === "contentWidth" || key === "textSize") {
      useStore.getState().receiveVaultAppearance(orgId, next); // optimistic
      if (pending.current) window.clearTimeout(pending.current.timer);
      pending.current = { settings: next, timer: window.setTimeout(flush, 300) };
      return;
    }
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
    save(next);
  };
  const resetToDefaults = () => {
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
    save({ ...APPEARANCE_DEFAULTS });
  };

  return (
    <>
      {isSynced && orgId ? (
        <>
          <div className="subhead appearance-defaults-head">
            {t("Defaults for everyone in this vault")}
            {!canManage && <span className="appearance-tag">{t("Set by the vault owner")}</span>}
          </div>
          <div className="muted">
            {t("People can still override these in their own Appearance settings.")}
          </div>
          <AppearanceRows
            mode="vault"
            values={vaultAppearanceValues(settings)}
            onChange={change}
            readOnly={!canManage}
          />
          {canManage && (
            <button className="link-btn" onClick={resetToDefaults}>
              {t("Reset to defaults")}
            </button>
          )}
        </>
      ) : (
        <div className="menu-row">
          <span className="menu-row-label">{t("Theme")}</span>
          <ThemeToggle />
        </div>
      )}
    </>
  );
}

const EMPTY_APPEARANCE: AppearanceSettings = {};

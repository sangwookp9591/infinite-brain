/* Account Settings → Vaults → one vault, as a page inside the settings content
   area with a back link: the same shell as Vault Settings' member profile
   (`MemberProfilePage.tsx`). The Vaults tab hosts it and hands over its own
   actions (the card's ⋯ menu, the two-click delete, the missing-folder
   recovery), so nothing here re-implements a vault action. */
import type { ReactNode } from "react";
import type { BillingUsageVault } from "../lib/api";
import {
  orderPageActions,
  VAULT_SETTINGS_UNAVAILABLE_HINT,
  type VaultPageDetail,
  vaultPageTiles,
} from "../lib/accountVaultPage";
import { useT } from "../lib/i18n";
import { AsyncButton } from "./AsyncButton";
import type { RowAction } from "./RowActionsMenu";
import { VaultTile } from "./VaultSwitcher";

export function AccountVaultPage({
  orgId,
  name,
  slug,
  isCurrent,
  lapsed,
  busy,
  showStats,
  usage,
  usageLoading,
  details,
  actions,
  folderMissing,
  settingsAction,
  onSwitch,
  onOpenSettings,
  onBack,
}: {
  orgId: string;
  name: string;
  slug: string | null;
  isCurrent: boolean;
  lapsed: boolean;
  busy: boolean;
  /** False when the server does not report per-vault usage (billing off). */
  showStats: boolean;
  usage: BillingUsageVault | null;
  usageLoading: boolean;
  details: VaultPageDetail[];
  /** The card's ⋯ menu actions. */
  actions: RowAction[];
  /** Restore here / Locate folder… when the open vault's folder is gone. */
  folderMissing: ReactNode | null;
  settingsAction: "open" | "switch-then-open" | "unavailable";
  onSwitch: () => Promise<void>;
  onOpenSettings: () => Promise<void>;
  onBack: () => void;
}) {
  const tr = useT();
  const tiles = vaultPageTiles(usage);
  const ordered = orderPageActions(actions);
  const switchChip = (
    <AsyncButton className="vault-switch-chip" disabled={busy} onClick={onSwitch}>
      {tr("Switch here")}
    </AsyncButton>
  );
  return (
    <section className="member-profile account-vault-page" aria-label={name}>
      <button type="button" className="link-btn member-profile-back" onClick={onBack}>
        {tr("← Vaults")}
      </button>
      <header className="member-profile-head">
        <VaultTile identity={`org:${orgId}`} name={name} />
        <span className="member-profile-names">
          <span className="member-profile-name">{name}</span>
          {slug && <span className="muted">{slug}</span>}
        </span>
        <span className="account-vault-page-pills">
          {lapsed && <span className="billing-status canceled">{tr("Read-only")}</span>}
          {isCurrent ? (folderMissing ? null : <span className="member-role">{tr("Current")}</span>) : switchChip}
        </span>
      </header>

      {showStats && (
        <>
          <div className="subhead">{tr("Stats")}</div>
          <div className="vault-usage-tiles">
            {tiles.map((t) => (
              <div key={t.key} className="vault-usage-tile">
                <span className="vault-usage-caption">{tr(t.caption)}</span>
                {usageLoading ? (
                  <span className="skel-line account-vault-page-skel" aria-hidden="true" />
                ) : (
                  <span className="vault-usage-value">{t.value ?? "—"}</span>
                )}
                <span className="vault-usage-sub" title={tr(t.sub)}>{tr(t.sub)}</span>
              </div>
            ))}
          </div>
          {!usageLoading && !usage && (
            <p className="muted account-vault-page-note">{tr("Usage is shown for vaults on your account.")}</p>
          )}
        </>
      )}

      <div className="subhead">{tr("Details")}</div>
      <dl className="member-profile-about">
        {details.map((d) => (
          <DetailRow key={d.key} label={tr(d.label)} value={tr(d.value)} />
        ))}
      </dl>

      <div className="subhead">{tr("Actions")}</div>
      <ul className="account-vault-actions">
        {!isCurrent && (
          <ActionRow title={tr("Switch here")} description={tr("Open this vault in the sidebar.")}>
            {switchChip}
          </ActionRow>
        )}
        {folderMissing && (
          <ActionRow title={tr("Folder missing")} description={tr("This vault's folder is gone from this device.")}>
            {folderMissing}
          </ActionRow>
        )}
        <ActionRow
          title={tr("Open Vault Settings")}
          description={
            settingsAction === "unavailable"
              ? tr(VAULT_SETTINGS_UNAVAILABLE_HINT)
              : tr("Members and access, appearance and more.")
          }
        >
          <AsyncButton
            className="ghost-pill sm"
            disabled={busy || settingsAction === "unavailable"}
            title={settingsAction === "unavailable" ? VAULT_SETTINGS_UNAVAILABLE_HINT : undefined}
            onClick={onOpenSettings}
          >
            {tr("Open")}
          </AsyncButton>
        </ActionRow>
        {ordered.map((a) => (
          <ActionRow key={a.key} title={a.label} description={a.title ?? ""} danger={a.danger}>
            <AsyncButton
              className={a.danger ? "link-btn danger" : "ghost-pill sm"}
              disabled={busy}
              onClick={async () => { await a.onSelect(); }}
            >
              {a.label}
            </AsyncButton>
          </ActionRow>
        ))}
      </ul>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </>
  );
}

function ActionRow({
  title,
  description,
  danger,
  children,
}: {
  title: string;
  description: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <li className={`account-vault-action${danger ? " danger" : ""}`}>
      <span className="account-vault-action-copy">
        <span className="account-vault-action-title">{title}</span>
        {description && <span className="muted">{description}</span>}
      </span>
      <span className="account-vault-action-control">{children}</span>
    </li>
  );
}

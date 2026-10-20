import { useCallback, useEffect, useRef, useState } from "react";
import type { BillingConfig, BillingUsage, MyBillingAccount } from "../lib/api";
import { authManager } from "../lib/auth/authManager";
import {
  classifyBillingConfigResult,
  type BillingConfigState,
  billingErrorMessage,
  discountLine,
  formatBytes,
  invitedVaultAction,
  invitedVaultFallbackToast,
  type InvitedVault,
  isLegacyPlan,
  LAPSED_COPY,
  legacyPlanLine,
  peopleTableCopy,
  PLAN_LOAD_ERROR_COPY,
  planStatusPill,
  planPriceLine,
  seatUsageLines,
  SELF_HOSTED_PLAN_COPY,
} from "../lib/billing";
import { useT } from "../lib/i18n";
import * as ipc from "../lib/ipc";
import { toast } from "../lib/toast";
import { readOrgVaults, useStore } from "../store";
import { AsyncButton } from "./AsyncButton";
import { ConfirmDialog } from "./ConfirmDialog";
import { ManageSeatsDialog } from "./ManageSeatsDialog";
import { PlanHeader } from "./PlanHeader";
import { SeatUsageBreakdown } from "./SeatUsageBreakdown";
import { UpgradeDialog } from "./UpgradeDialog";

/** Compact absolute date, same shape as the vault Billing tab's. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

type Loaded = {
  state: Exclude<BillingConfigState, "error">;
  config: BillingConfig;
  account: MyBillingAccount | null;
  usage: BillingUsage | null;
};

/** How long the tab waits before its one automatic retry of a failed fetch. */
const RETRY_DELAY_MS = 2000;

/** A request's value, or null when it failed — for the self-hosted page, which
 *  shows what answers and never an error. */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

/**
 * Account Settings → Plan & Billing (Team model). One billing account per owner:
 * one plan card (name, pill, price line, actions; seat breakdown on Team), the
 * account's usage as tiles, and the people on the account as a table. Usage is per vault and lives in Vault Settings → Usage. Old
 * servers (`model !== "team"`) bill per vault, so this tab only points at each
 * vault's own Billing tab there.
 */
export function AccountPlanTab() {
  const t = useT();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [managingSeats, setManagingSeats] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** One attempt. Throws on anything that is not a definitive answer. */
  const fetchOnce = useCallback(async (refresh = false): Promise<Loaded> => {
    let config: BillingConfig;
    let state: BillingConfigState;
    try {
      config = await authManager.api.probeBillingConfig();
      state = classifyBillingConfigResult(config);
    } catch (e) {
      state = classifyBillingConfigResult(e);
      if (state !== "disabled") throw e;
      config = { enabled: false };
    }
    if (state === "error") throw new Error("unclassifiable billing config");
    if (state === "disabled") {
      // Billing off (self-hosted without a provider): the account routes may
      // 404 too. Show whatever answers; never an error for this case.
      const [account, usage] = await Promise.all([
        orNull(authManager.api.getBillingAccount({ refresh })),
        orNull(authManager.api.getBillingUsage()),
      ]);
      return { state, config, account, usage };
    }
    if (state === "vault") return { state, config, account: null, usage: null };
    const [account, usage] = await Promise.all([
      authManager.api.getBillingAccount({ refresh }),
      authManager.api.getBillingUsage(),
    ]);
    return { state, config, account, usage };
  }, []);

  /** A failed fetch is never a verdict: retry once after 2 s, then show the
   *  error with Try again. */
  const load = useCallback(async (opts: { refresh?: boolean } = {}) => {
    setError(null);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const loaded = await fetchOnce(opts.refresh === true);
        if (mounted.current) setData(loaded);
        return;
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
    if (mounted.current) setError(PLAN_LOAD_ERROR_COPY);
  }, [fetchOnce]);

  const organizations = useStore((s) => s.organizations);

  // The mount load asks the server to re-read the live subscription once;
  // reloads after an action read the stored account.
  useEffect(() => {
    void load({ refresh: true });
  }, [load]);

  if (error) {
    return (
      <>
        <div className="auth-error">{t(error)}</div>
        <AsyncButton className="secondary" onClick={load}>
          {t("Try again")}
        </AsyncButton>
      </>
    );
  }
  if (!data) return <div className="muted">{t("Loading…")}</div>;

  const { config, account, usage } = data;
  if (data.state === "disabled") {
    return (
      <SelfHostedPlan account={account} usage={usage} fallbackVaults={organizations.length} />
    );
  }
  if (data.state === "vault" || !account) {
    return (
      <div className="muted perm-empty">
        {t("Billing is per vault on this server; manage it in each vault's settings.")}
      </div>
    );
  }

  const ownsVaults = account.vaults.length > 0;
  const isTeam = account.plan === "team";
  const statusPill = planStatusPill(account, formatDate);
  const discount = discountLine({ ...account, currency: config.team?.currency ?? "usd" });

  // The store's billing mirror and locks feed Vault Settings and the lapse
  // padlocks; a plan change here must reach them too, not only this tab.
  const refreshShared = () => {
    const st = useStore.getState();
    void st.refreshMyBilling();
    void st.refreshOrgBilling();
    void st.refreshLocks();
  };

  // A vault in the Invited popover opens that vault's Vault Settings → Members and
  // access (the two settings dialogs are exclusive, so this closes Account
  // Settings). Another vault is switched to first; one with no folder on this
  // device cannot be, so the Vaults tab is the way in.
  const openInvitedVault = async (v: InvitedVault) => {
    const st = useStore.getState();
    const action = invitedVaultAction({
      orgId: v.orgId,
      activeOrgId: st.session?.activeOrganizationId ?? null,
      openPath: st.vault?.path ?? null,
      boundPath: readOrgVaults()[v.orgId] ?? null,
    });
    if (action === "vaults-tab") {
      st.requestAccountSettings("vaults");
      toast(invitedVaultFallbackToast(v.name), "neutral");
      return;
    }
    if (action === "switch-then-members") {
      try {
        await st.setActiveOrganization(v.orgId);
      } catch {
        // The switch reports its own failure; stay where we are.
      }
      if (useStore.getState().session?.activeOrganizationId !== v.orgId) return;
    }
    useStore.getState().requestSettings("members");
  };

  const run = async (fn: () => Promise<unknown>, done: string): Promise<boolean> => {
    setActionError(null);
    try {
      await fn();
      toast(done);
      await load();
      refreshShared();
      return true;
    } catch (e) {
      const message = billingErrorMessage(e);
      setActionError(message);
      toast(message, "error");
      return false;
    }
  };

  const openPortal = async () => {
    setActionError(null);
    try {
      const { url } = await authManager.api.accountPortalUrl();
      await ipc.openExternal(url);
    } catch (e) {
      setActionError(billingErrorMessage(e));
    }
  };

  // ---- Header line under the plan name ----
  const seatsBought = account.seats.purchased;
  const legacy = isTeam && isLegacyPlan(account);
  const peopleCopy = peopleTableCopy({ ...account, legacyPlan: legacy });
  const summary = legacy
    ? legacyPlanLine(account, config.team?.currency ?? "usd", formatDate)
    : isTeam
    ? [
        planPriceLine(account.plan, account.interval, config.team),
        seatsBought != null
          ? seatsBought === 1
            ? t("{count} seat", { count: seatsBought })
            : t("{count} seats", { count: seatsBought })
          : null,
        account.currentPeriodEnd
          ? account.cancelAtPeriodEnd
            ? t("cancels on {date}", { date: formatDate(account.currentPeriodEnd) })
            : t("renews {date}", { date: formatDate(account.currentPeriodEnd) })
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : t("For you and one teammate · $0");

  // ---- Usage tiles: meters against the Free ceilings, plain counts on Team ----
  const syncedVaults = usage ? (usage.totals.vaults ?? usage.vaults.length) : 0;
  const vaultLimit = isTeam ? null : (usage?.limits.vaults ?? account.limits.vaults);
  const peopleLimit = isTeam ? null : (usage?.limits.people ?? account.limits.people);
  const freeBase = config.free?.syncedVaults ?? null;
  const [bytesValue, bytesUnit] = formatBytes(usage?.totals.storageBytes ?? 0).split(" ");
  const tiles: {
    key: string;
    caption: string;
    value: string;
    sub: string;
    meter: { used: number; limit: number } | null;
  }[] = usage
    ? [
        {
          key: "vaults",
          caption: t("Synced vaults"),
          value: String(syncedVaults),
          sub:
            vaultLimit != null
              ? freeBase != null && vaultLimit > freeBase
                ? t("of {limit} · includes vaults you had before", { limit: vaultLimit })
                : t("of {limit}", { limit: vaultLimit })
              : syncedVaults === 1 ? t("vault") : t("vaults"),
          meter: vaultLimit != null ? { used: syncedVaults, limit: vaultLimit } : null,
        },
        {
          key: "people",
          caption: t("People"),
          value: String(usage.totals.people),
          sub:
            peopleLimit != null
              ? t("of {limit} on this account", { limit: peopleLimit })
              : usage.totals.people === 1 ? t("person") : t("people"),
          meter: peopleLimit != null ? { used: usage.totals.people, limit: peopleLimit } : null,
        },
        {
          key: "notes",
          caption: t("Notes"),
          value: String(usage.totals.notes),
          sub: t("across your vaults"),
          meter: null,
        },
        {
          key: "attachments",
          caption: t("Attachments"),
          value: bytesValue ?? "0",
          sub: bytesUnit ?? "B",
          meter: null,
        },
      ]
    : [];

  return (
    <>
      {/* ---- Plan: one card, summary left, actions right ---- */}
      <div className={`billing-card${isTeam ? " plan-pro" : ""}`}>
        <div className="plan-page-head">
          <div className="plan-page-summary">
            <PlanHeader name={isTeam ? "Team" : "Free"} pill={statusPill} />
            <div className="billing-section-note">{summary}</div>
            {discount && <div className="billing-section-note muted">{discount}</div>}
            {account.complimentaryUntil && (
              <div className="billing-section-note">
                {t("Complimentary Team until {date}", { date: formatDate(account.complimentaryUntil) })}
              </div>
            )}
          </div>
          {account.canManage && (
            <div className="plan-page-actions">
              {!isTeam ? (
                <button className="primary" onClick={() => setUpgrading(true)}>
                  {t("Upgrade to Team")}
                </button>
              ) : (
                <>
                  <AsyncButton className="secondary" onClick={openPortal}>
                    {t("Manage billing")}
                  </AsyncButton>
                  {account.cancelAtPeriodEnd || account.lapsed ? (
                    <AsyncButton
                      className="secondary"
                      onClick={() => run(() => authManager.api.accountResume(), t("Plan resumed."))}
                    >
                      {t("Resume plan")}
                    </AsyncButton>
                  ) : (
                    <AsyncButton
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setActionError(null);
                        setConfirmCancel(true);
                      }}
                    >
                      {t("Cancel plan")}
                    </AsyncButton>
                  )}
                  {!legacy && (
                    <AsyncButton className="primary" onClick={() => setManagingSeats(true)}>
                      {t("Add or change seats")}
                    </AsyncButton>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {isTeam &&
          (account.seats.purchased != null ? (
            <SeatUsageBreakdown
              seats={account.seats}
              canManage={account.canManage}
              showManage={false}
              onManage={() => setManagingSeats(true)}
              invitedByVault={account.invitedByVault}
              onOpenInvitedVault={(v) => void openInvitedVault(v)}
            />
          ) : (
            seatUsageLines(account.seats, formatDate).map((line) => (
              <div key={line} className="billing-section-note">
                {line}
              </div>
            ))
          ))}
        {account.lapsed && <div className="auth-error">{t(LAPSED_COPY)}</div>}
        {!account.canManage && (
          <div className="billing-section-note">
            {ownsVaults
              ? t("Billing is handled by the vault owner.")
              : t("You don't own any vaults; billing is handled by each vault's owner.")}
          </div>
        )}
      </div>
      {actionError && !confirmCancel && <div className="auth-error">{actionError}</div>}

      {/* ---- Usage on this account ---- */}
      {ownsVaults && tiles.length > 0 && (
        <>
          <div className="subhead">{t("Usage on this account")}</div>
          <div className="vault-usage-tiles">
            {tiles.map((tile) => {
              const full = !!tile.meter && tile.meter.limit > 0 && tile.meter.used >= tile.meter.limit;
              const pct =
                tile.meter && tile.meter.limit > 0
                  ? Math.min(100, Math.round((tile.meter.used / tile.meter.limit) * 100))
                  : 0;
              return (
                <div key={tile.key} className="vault-usage-tile">
                  <span className="vault-usage-caption">{tile.caption}</span>
                  <span className="vault-usage-value">{tile.value}</span>
                  <span className="vault-usage-sub" title={tile.sub}>
                    {tile.sub}
                  </span>
                  {tile.meter && (
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
        </>
      )}

      {/* ---- People on this account (owners only) ---- */}
      {account.canManage && account.people.length > 0 && (
        <>
          <div className="subhead">{t("People on this account")}</div>
          {peopleCopy.note && <div className="billing-section-note muted">{peopleCopy.note}</div>}
          <table className="members-table plan-page-people">
            <thead>
              <tr>
                <th>{t("Person")}</th>
                <th>{t("Vaults")}</th>
                {peopleCopy.seatColumn && <th className="plan-page-seat-col">{t("Seat")}</th>}
              </tr>
            </thead>
            <tbody>
              {account.people.map((p) => {
                return (
                  <tr key={p.userId}>
                    <td>
                      <div className="members-table-names">
                        <span className="members-table-name">{p.name || p.email}</span>
                        {p.name && <span className="muted">{p.email}</span>}
                      </div>
                    </td>
                    <td>
                      <div className="plan-page-vault-chips">
                        {p.vaults.map((id) => {
                          const name = account.vaults.find((v) => v.orgId === id)?.name ?? id;
                          return (
                            <span key={id} className="plan-page-vault-chip">
                              {name}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    {peopleCopy.seatColumn && <td className="muted plan-page-seat-col">{t("1 seat")}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {upgrading && (
        <UpgradeDialog
          onClose={() => {
            setUpgrading(false);
            void load();
          }}
        />
      )}
      {managingSeats && (
        <ManageSeatsDialog
          account={account}
          config={config}
          formatDate={formatDate}
          onClose={() => setManagingSeats(false)}
          onChanged={() => {
            void load();
            refreshShared();
          }}
          onResume={() => run(() => authManager.api.accountResume(), t("Plan resumed."))}
          onKeepSeats={() =>
            run(
              () => authManager.api.setSeats(account.seats.purchased ?? 0),
              t("Seat change cancelled."),
            )
          }
        />
      )}
      {confirmCancel && (
        <ConfirmDialog
          title={t("Cancel the Team plan?")}
          confirmLabel={t("Cancel plan")}
          cancelLabel={t("Keep it")}
          onCancel={() => setConfirmCancel(false)}
          onConfirm={async () => {
            const ok = await run(
              () => authManager.api.accountCancel(),
              t("Plan will cancel at the end of the period."),
            );
            if (ok) setConfirmCancel(false);
          }}
        >
          <p>
            {account.currentPeriodEnd
              ? t("Team stays on until {date}. After that, sync becomes read-only for vaults with more than 2 people until you resume.", { date: formatDate(account.currentPeriodEnd) })
              : t("Team stays on until the end of the current period. After that, sync becomes read-only for vaults with more than 2 people until you resume.")}
          </p>
          {actionError && <div className="auth-error">{actionError}</div>}
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * Plan & Billing on a server with billing off (self-hosted without a provider):
 * no plan to buy, so no Upgrade. Usage and people come from the account routes
 * when they answer; otherwise the vault count falls back to the account's
 * vault list and sections without data are left out.
 */
function SelfHostedPlan({
  account,
  usage,
  fallbackVaults,
}: {
  account: MyBillingAccount | null;
  usage: BillingUsage | null;
  fallbackVaults: number;
}) {
  const t = useT();
  const vaults = usage ? (usage.totals.vaults ?? usage.vaults.length) : fallbackVaults;
  const tiles: { key: string; caption: string; value: string; sub: string }[] = [
    { key: "vaults", caption: t("Synced vaults"), value: String(vaults), sub: vaults === 1 ? t("vault") : t("vaults") },
  ];
  if (usage) {
    const [bytesValue, bytesUnit] = formatBytes(usage.totals.storageBytes ?? 0).split(" ");
    tiles.push(
      {
        key: "people",
        caption: t("People"),
        value: String(usage.totals.people),
        sub: usage.totals.people === 1 ? t("person") : t("people"),
      },
      { key: "notes", caption: t("Notes"), value: String(usage.totals.notes), sub: t("across your vaults") },
      { key: "attachments", caption: t("Attachments"), value: bytesValue ?? "0", sub: bytesUnit ?? "B" },
    );
  }
  const people = account?.canManage ? account.people : [];
  return (
    <>
      <div className="billing-card">
        <div className="plan-page-head">
          <div className="plan-page-summary">
            <div className="billing-plan-head">
              <span className="billing-plan-name">{t("Self-hosted")}</span>
              <span className="billing-status none">{t("No limits")}</span>
            </div>
            <div className="billing-section-note">{t(SELF_HOSTED_PLAN_COPY)}</div>
          </div>
        </div>
      </div>

      {(usage || vaults > 0) && (
        <>
          <div className="subhead">{t("Usage on this account")}</div>
          <div className="vault-usage-tiles">
            {tiles.map((tile) => (
              <div key={tile.key} className="vault-usage-tile">
                <span className="vault-usage-caption">{tile.caption}</span>
                <span className="vault-usage-value">{tile.value}</span>
                <span className="vault-usage-sub" title={tile.sub}>
                  {tile.sub}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {account && people.length > 0 && (
        <>
          <div className="subhead">{t("People on this account")}</div>
          <table className="members-table plan-page-people">
            <thead>
              <tr>
                <th>{t("Person")}</th>
                <th>{t("Vaults")}</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.userId}>
                  <td>
                    <div className="members-table-names">
                      <span className="members-table-name">{p.name || p.email}</span>
                      {p.name && <span className="muted">{p.email}</span>}
                    </div>
                  </td>
                  <td>
                    <div className="plan-page-vault-chips">
                      {p.vaults.map((id) => {
                        const name = account.vaults.find((v) => v.orgId === id)?.name ?? id;
                        return (
                          <span key={id} className="plan-page-vault-chip">
                            {name}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

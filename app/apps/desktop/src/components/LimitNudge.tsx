import { vaultLimitReason, type LimitKind } from "../lib/billing";
import { useT } from "../lib/i18n";
import { useStore } from "../store";

/**
 * Inline upgrade nudge shown in the create-vault / invite-member error slot
 * when the server rejects with a 402 free-plan limit. Styled with --warning-soft
 * (reserved for upgrade nudges), not the danger palette — this isn't an error.
 */
export function LimitNudge({
  kind,
  limit,
  onUpgrade,
}: {
  kind: LimitKind;
  limit: number | null;
  onUpgrade: () => void;
}) {
  const t = useT();
  const freeLimits = useStore((s) => s.billingConfig?.freeLimits);
  const teamMode = useStore((s) => s.billingConfig?.model === "team");
  // The server is the authority (the 402 carries `limit`, and billingConfig
  // reports both caps); these are last-resort defaults for a nudge rendered
  // before either arrived. Kept separate per kind so the two caps can move
  // independently (members were 10 for a while; both are 3 since 2026-09-09).
  const n =
    limit ??
    (kind === "note_limit" ? 20000 : kind === "member_limit"
      ? (freeLimits?.membersPerVault ?? 3)
      : (freeLimits?.vaultsPerUser ?? (teamMode ? 1 : 3)));
  // Team model: no per-vault upgrade to "make room"; the account upgrades, and
  // the button opens the plan comparison right here rather than a settings tab.
  const teamVault = teamMode && kind === "vault_limit";
  const message = teamVault
    ? n === 1
      ? t("Free includes {count} synced vault on your account. Upgrade to Team for unlimited synced vaults.", { count: n })
      : t("Free includes {count} synced vaults on your account. Upgrade to Team for unlimited synced vaults.", { count: n })
    : kind === "note_limit" ? (teamMode ? t("This vault has reached its sync limit. Upgrade to Team to lift it.") : t("This Free vault has reached {count} synced notes. Upgrade to Team to sync more; additional notes stay on this device.", { count: n.toLocaleString() })) : kind === "member_limit"
      ? n === 1
        ? t("Free plan limit reached — this vault allows {count} member.", { count: n })
        : t("Free plan limit reached — this vault allows {count} members.", { count: n })
      : // The cap counts FREE vaults only: a Team vault leaves the count, so
        // upgrading one of them opens a slot for another free vault.
        n === 1
          ? t("You're using all {count} free vault. Move one to a Team account ($10/seat/month, minimum 3 seats) — Team vaults don't count toward that limit — and you can create another.", { count: n })
          : t("You're using all {count} free vaults. Move one to a Team account ($10/seat/month, minimum 3 seats) — Team vaults don't count toward that limit — and you can create another.", { count: n });
  return (
    <div className="limit-nudge">
      <span>{message}</span>
      {teamVault ? (
        <button
          className="link-btn"
          onClick={() => useStore.getState().requestUpgradeDialog({ reason: vaultLimitReason(n) })}
        >
          {t("Upgrade to Team")}
        </button>
      ) : (
        <button className="link-btn" onClick={onUpgrade}>
          {t("Upgrade →")}
        </button>
      )}
    </div>
  );
}

import type { PlanStatusPill } from "../lib/billing";
import { useT } from "../lib/i18n";

/**
 * The "CURRENT PLAN" eyebrow, the plan name and its status pill. Shared by
 * Plan & Billing and Vault Settings → Usage so the two headers cannot drift.
 * Render it inside `.plan-page-summary` (large name) and under a `.plan-pro`
 * ancestor on Team (accent name).
 */
export function PlanHeader({ name, pill }: { name: string; pill: PlanStatusPill | null }) {
  const t = useT();
  return (
    <>
      <div className="subhead">{t("Current plan")}</div>
      <div className="billing-plan-head">
        <span className="billing-plan-name">{t(name)}</span>
        {pill ? (
          <span className={`billing-status ${pill.tone}`}>{pill.label}</span>
        ) : (
          <span className="muted">{t("Free forever")}</span>
        )}
      </div>
    </>
  );
}

// SPDX-License-Identifier: Apache-2.0
// What changed, one row per change, in a single white card: the heading is the
// card's first row, each change sits under a hairline with a small tinted trend
// mark. Adapted from the "Change Summary (Clean)" snippet the project owner
// supplied; colours come from the app's tokens so it follows the theme and the
// chosen accent, and the styles live in ChangeSummary.css like the rest of the app.
import type { ReactNode } from "react";
import "./ChangeSummary.css";

export type ChangeTone = "good" | "bad" | "neutral";

export interface MetricChange {
  label: string;
  /** What happened, in words. */
  change: string;
  /** good: green arrow · bad: red arrow · neutral: gray dash. */
  tone?: ChangeTone;
  /** Direction of the arrow; defaults to up for good, down for bad. */
  direction?: "up" | "down";
}

export interface ChangeSummaryProps {
  title: string;
  /** Small text on the right of the heading, e.g. a version. */
  period?: string;
  icon?: ReactNode;
  changes: MetricChange[];
  className?: string;
}

export function ChangeSummary({ title, period, icon, changes, className }: ChangeSummaryProps) {
  return (
    <section className={["ui-csc", className].filter(Boolean).join(" ")} aria-label={title}>
      <header className="ui-csc__head">
        <span className="ui-csc__title">
          <span className="ui-csc__icon">{icon ?? <ChangesIcon />}</span>
          {title}
        </span>
        {period && <span className="ui-csc__period">{period}</span>}
      </header>
      <dl className="ui-csc__list">
        {changes.map((c, i) => {
          const tone = c.tone ?? "neutral";
          const direction = c.direction ?? (tone === "bad" ? "down" : "up");
          return (
            <div key={`${i}:${c.label}`} className="ui-csc__row" style={{ animationDelay: `${120 + i * 70}ms` }}>
              <dt className="ui-csc__label">{c.label}</dt>
              <dd className="ui-csc__change">
                <span className="ui-csc__trend" data-tone={tone} aria-hidden="true">
                  {tone === "neutral" ? <DashIcon /> : <ArrowIcon down={direction === "down"} />}
                </span>
                <span className="ui-csc__text">{c.change}</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

const ChangesIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" aria-hidden="true">
    <path d="M2.5 4h4M2.5 8h8M6.5 12h7M9.5 4h1" />
  </svg>
);
const ArrowIcon = ({ down }: { down?: boolean }) => (
  <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {down ? <path d="M6 2.5v7M3 6.5l3 3 3-3" /> : <path d="M6 9.5v-7M3 5.5l3-3 3 3" />}
  </svg>
);
const DashIcon = () => (
  <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
    <path d="M3 6h6" />
  </svg>
);

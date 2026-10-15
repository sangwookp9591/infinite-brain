// SPDX-License-Identifier: Apache-2.0 AND LicenseRef-ReactBits-MIT-CommonsClause
// Adapted from React Bits Lattice Loader (https://reactbits.dev), Copyright (c) 2026 David Haz.
// See ./LICENSE-react-bits.md.
import { useEffect, useState } from "react";
import "./ActivityLattice.css";

export function formatActivityTime(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export interface ActivityLatticeProps { label: string; status?: "working" | "done" | "error"; }
export function ActivityLattice({ label, status = "working" }: ActivityLatticeProps) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (status !== "working") return;
    const start = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - start), 250);
    return () => window.clearInterval(timer);
  }, [status]);
  const pattern = status === "done" ? [0, 0, 1, 1, 1, 0, 0, 1, 0] : status === "error" ? [1, 0, 1, 0, 1, 0, 1, 0, 1] : [1, 1, 1, 1, 1, 1, 1, 1, 1];
  return <div className="kit-lattice" data-status={status} role="status" aria-live="polite">
    <span className="kit-lattice-grid" aria-hidden="true">{pattern.map((lit, i) => <span key={i} style={{ opacity: lit ? undefined : 0.12, animationDelay: `${(i % 3 + Math.floor(i / 3)) * 110}ms` }} />)}</span>
    <span>{label}</span><span className="kit-lattice-time" aria-hidden="true">{formatActivityTime(elapsed)}</span>
  </div>;
}

// SPDX-License-Identifier: Apache-2.0 AND LicenseRef-ReactBits-MIT-CommonsClause
// Adapted from React Bits Border Glow (https://reactbits.dev), Copyright (c) 2026 David Haz.
// See ./LICENSE-react-bits.md.
import { type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import "./GlowCard.css";

export function glowPosition(x: number, y: number, width: number, height: number) {
  return { angle: Math.atan2(y - height / 2, x - width / 2) * 180 / Math.PI + 90,
    edge: Math.min(1, Math.max(Math.abs(x - width / 2) / (width / 2 || 1), Math.abs(y - height / 2) / (height / 2 || 1))) };
}
export function GlowCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return <div className={`kit-glow ${className}`} onPointerMove={e => {
    if (reduced) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const { angle, edge } = glowPosition(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    e.currentTarget.style.setProperty("--glow-angle", `${angle}deg`);
    e.currentTarget.style.setProperty("--glow-strength", String(Math.max(0, (edge - .5) * 2) ** 3));
  }} onPointerLeave={e => e.currentTarget.style.setProperty("--glow-strength", "0")}>
    <div className="kit-glow-content">{children}</div>
  </div>;
}

// SPDX-License-Identifier: Apache-2.0 AND LicenseRef-ReactBits-MIT-CommonsClause
// Adapted from React Bits Fuse Button (https://reactbits.dev), Copyright (c) 2026 David Haz.
// See ./LICENSE-react-bits.md.
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import "./FuseButton.css";

export function fuseRemaining(deadline: number, now: number): number { return Math.max(0, deadline - now); }
export function fuseDuration(seconds: number): number { return Number.isFinite(seconds) ? Math.max(0, seconds) * 1000 : 4000; }
export function FuseButton({ label, doneLabel = "Done", seconds = 4, onAction, onUndo, onCommit, disabled = false }: {
  label: string; doneLabel?: string; seconds?: number; onAction: () => void; onUndo: () => void;
  onCommit: () => void; disabled?: boolean;
}) {
  const [phase, setPhase] = useState<"idle" | "armed" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armed = useRef(false);
  const reduce = useReducedMotion();
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const undo = () => {
    if (!armed.current) return;
    armed.current = false;
    if (timer.current !== null) clearTimeout(timer.current);
    onUndo(); setPhase("idle");
  };
  return <span className="kit-fuse-wrap">
    <motion.button className="kit-fuse" type="button" data-phase={phase}
      disabled={phase === "done" || (disabled && phase === "idle")}
      aria-keyshortcuts={phase === "armed" ? "Escape" : undefined}
      onKeyDown={event => { if (event.key === "Escape" && armed.current) { event.preventDefault(); undo(); } }}
      onClick={() => {
        if (phase === "armed") { undo(); return; }
        if (armed.current || disabled || phase !== "idle") return;
        onAction(); armed.current = true; setPhase("armed");
        timer.current = setTimeout(() => {
          if (!armed.current) return;
          armed.current = false; setPhase("done"); onCommit();
        }, fuseRemaining(Date.now() + fuseDuration(seconds), Date.now()));
      }}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d={phase === "armed" ? "M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12" : phase === "done" ? "m5 12 4 4 10-10" : "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"} /></svg>
      {phase === "idle" ? label : phase === "armed" ? "Undo" : doneLabel}
      {phase === "armed" && <motion.i aria-hidden="true" className="kit-fuse-line" initial={{ scaleX: 1 }}
        animate={{ scaleX: reduce ? 1 : 0 }} transition={{ duration: fuseDuration(seconds) / 1000, ease: "linear" }} />}
    </motion.button>
    <span className="kit-fuse-status" role="status">{phase === "armed" ? `${doneLabel}. Undo available for ${seconds} seconds. Press Escape to cancel.` : phase === "done" ? `${doneLabel}. Confirmed.` : ""}</span>
  </span>;
}

// SPDX-License-Identifier: Apache-2.0 AND LicenseRef-ReactBits-MIT-CommonsClause
// Adapted from React Bits Swipe Row (https://reactbits.dev), Copyright (c) 2026 David Haz.
// See ./LICENSE-react-bits.md.
import { useState, useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { SOFT, useSpring } from "./motion";
import "./SwipeRow.css";

export function swipeOutcome(offset: number, width: number): "commit" | "open" | "close" {
  return offset <= -Math.max(160, width * .65) ? "commit" : offset < -50 ? "open" : "close";
}
export interface SwipeAction { id: string; label: string; destructive?: boolean; onSelect: () => void; }
export interface SwipeRowProps { label: string; children: ReactNode; actions: SwipeAction[]; onPrimary?: () => void; }
export function SwipeRow({ label, children, actions, onPrimary }: SwipeRowProps) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const wheel = useRef(0);
  const row = useRef<HTMLDivElement>(null);
  const wheelGesture = useRef({ at: 0, committed: false });
  const dragStart = useRef(0);
  const transition = useSpring(SOFT);
  const reduced = useReducedMotion();
  const drawer = actions.length * 76;
  const visible = !cancelled && (open || hover || focused);
  const destructive = actions.find(a => a.destructive);
  const perform = (action: SwipeAction) => { wheel.current = 0; setOpen(false); setCancelled(true); action.onSelect(); };
  return <div ref={row} className="kit-swipe" role="group" aria-label={label}
    onMouseEnter={() => { setHover(true); setCancelled(false); }} onMouseLeave={() => setHover(false)}
    onFocus={() => { setFocused(true); setCancelled(false); }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}
    onWheel={e => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (e.timeStamp - wheelGesture.current.at > 200) { wheel.current = 0; wheelGesture.current.committed = false; }
      wheelGesture.current.at = e.timeStamp;
      if (wheelGesture.current.committed) return;
      wheel.current = Math.max(-e.currentTarget.clientWidth, Math.min(0, wheel.current - e.deltaX));
      const outcome = swipeOutcome(wheel.current, e.currentTarget.clientWidth);
      setCancelled(false); setOpen(outcome !== "close");
      if (outcome === "commit" && destructive) { wheelGesture.current.committed = true; perform(destructive); }
    }}>
    <div className="kit-swipe-actions" style={{ visibility: visible ? "visible" : "hidden" }} aria-hidden={!visible}>
      {actions.map(action => <button key={action.id} type="button" tabIndex={visible ? 0 : -1} data-destructive={action.destructive || undefined} onClick={() => perform(action)}>{action.destructive ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v5H4zM6 9v11h12V9M10 13h4" /></svg>}{action.label}</button>)}
    </div>
    <motion.div className="kit-swipe-surface" role="button" aria-label={`Open ${label}`} tabIndex={0}
      drag="x" dragConstraints={{ left: -drawer, right: 0 }} dragElastic={{ left: .8, right: .05 }} dragMomentum={false}
      animate={{ x: visible ? -drawer : 0 }} transition={reduced ? { duration: 0 } : transition}
      onClick={() => onPrimary?.()}
      onDragStart={() => { dragStart.current = visible ? -drawer : 0; setOpen(true); setCancelled(false); }}
      onDragEnd={(_, info) => {
        const width = row.current?.clientWidth || 340;
        const outcome = swipeOutcome(dragStart.current + info.offset.x, width);
        if (outcome === "commit" && destructive) perform(destructive);
        else { setOpen(outcome === "open"); setCancelled(outcome === "close"); }
      }}
      onKeyDown={e => {
        if (e.key === "Delete" || e.key === "Backspace") { if (destructive) { e.preventDefault(); perform(destructive); } }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPrimary?.(); }
        else if (e.key === "Escape") { setOpen(false); setCancelled(true); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); setOpen(true); setCancelled(false); }
      }}>
      {children}
    </motion.div>
  </div>;
}

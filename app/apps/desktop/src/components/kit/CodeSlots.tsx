// SPDX-License-Identifier: Apache-2.0 AND LicenseRef-ReactBits-MIT-CommonsClause
// Adapted from React Bits Code Slots (https://reactbits.dev), Copyright (c) 2026 David Haz.
// See ./LICENSE-react-bits.md.
import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SNAPPY, useSpring } from "./motion";
import "./CodeSlots.css";

export function parseJoinCode(raw: string, length = 8): string {
  return raw.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, Math.max(0, length));
}
export function CodeSlots({ value, onChange, onComplete, length = 8, label = "Enter your team's join code", error, disabled = false }: {
  value: string; onChange: (value: string) => void; onComplete?: (value: string) => void;
  length?: number; label?: string; error?: string; disabled?: boolean;
}) {
  const id = useId();
  const spring = useSpring(SNAPPY);
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const clean = parseJoinCode(value, length);
  return <div className="kit-code" data-error={!!error}>
    <motion.label className="kit-code-row" animate={{ x: error && !reduce ? [0, -5, 5, -3, 3, 0] : 0 }} transition={{ duration: reduce ? 0 : .3 }}>
      <input aria-label={label} aria-invalid={!!error} aria-describedby={error ? id : undefined}
        autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} type="text" value={clean} disabled={disabled}
        onSelect={event => setActive(event.currentTarget.selectionStart ?? clean.length)}
        onChange={event => {
          const next = parseJoinCode(event.target.value, length);
          onChange(next);
          if (next.length === length && next !== clean) onComplete?.(next);
        }} />
      <span className="kit-code-slots" aria-hidden="true">
        {Array.from({ length }, (_, i) => <span className="kit-code-slot" key={i} data-active={i === Math.min(active, length - 1)} data-filled={!!clean[i]}>
          <AnimatePresence initial={false}><motion.span key={clean[i] || "empty"}
            initial={{ opacity: 0, y: reduce ? 0 : 8, scale: reduce ? 1 : .7 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }} transition={spring}>{clean[i] || ""}</motion.span></AnimatePresence>
        </span>)}
      </span>
    </motion.label>
    {error && <span id={id} role="alert" className="kit-code-error">{error}</span>}
  </div>;
}

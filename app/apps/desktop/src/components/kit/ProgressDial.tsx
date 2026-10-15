// SPDX-License-Identifier: Apache-2.0 AND LicenseRef-ReactBits-MIT-CommonsClause
// Adapted from React Bits Comet Dial (https://reactbits.dev), Copyright (c) 2026 David Haz.
// See ./LICENSE-react-bits.md.
import { useRef, type PointerEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { SNAPPY, useSpring } from "./motion";
import "./ProgressDial.css";

export function dialValueToAngle(value: number, min = 0, max = 100) {
  return 110 + Math.max(0, Math.min(1, (value - min) / (max - min || 1))) * 320;
}
export function dialAngleToValue(angle: number, min = 0, max = 100, step = 1) {
  const relative = ((angle - 110) % 360 + 360) % 360;
  const fraction = (relative > 340 ? 0 : Math.min(relative, 320)) / 320;
  const raw = min + fraction * (max - min);
  return Math.min(max, Math.max(min, Number((min + Math.round((raw - min) / (step > 0 ? step : 1)) * (step > 0 ? step : 1)).toFixed(8))));
}
export interface ProgressDialProps {
  value: number;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  interactive?: boolean;
  onChange?: (value: number) => void;
}
export function ProgressDial({ value, label, unit = "%", min = 0, max = 100, step = 1, interactive = false, onChange }: ProgressDialProps) {
  const ref = useRef<HTMLDivElement>(null);
  const transition = useSpring(SNAPPY);
  const reduced = useReducedMotion();
  const shown = Math.max(min, Math.min(max, value));
  const angle = dialValueToAngle(shown, min, max);
  const point = (a: number, radius: number) => ({ x: 100 + Math.cos(a * Math.PI / 180) * radius, y: 100 + Math.sin(a * Math.PI / 180) * radius });
  const changeFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onChange?.(dialAngleToValue(Math.atan2(e.clientY - rect.top - rect.height / 2, e.clientX - rect.left - rect.width / 2) * 180 / Math.PI, min, max, step));
  };
  return <div ref={ref} className="kit-dial" role={interactive ? "slider" : "progressbar"} aria-label={label}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={shown} aria-valuetext={`${shown}${unit}`} tabIndex={interactive ? 0 : undefined}
    onPointerDown={e => { if (!interactive || e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); changeFromPointer(e); }}
    onPointerMove={e => { if (interactive && e.currentTarget.hasPointerCapture(e.pointerId)) changeFromPointer(e); }}
    onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
    onKeyDown={e => {
      if (!interactive) return;
      const next = e.key === "Home" ? min : e.key === "End" ? max : ["ArrowUp", "ArrowRight"].includes(e.key) ? shown + step : ["ArrowDown", "ArrowLeft"].includes(e.key) ? shown - step : null;
      if (next !== null) { e.preventDefault(); onChange?.(Math.max(min, Math.min(max, Number(next.toFixed(8))))); }
    }}>
    <svg viewBox="0 0 200 200" aria-hidden="true">
      {Array.from({ length: 65 }, (_, i) => { const a = 110 + i * 5; const p = point(a, 83); const q = point(a, i % 4 === 0 ? 74 : 78); return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={a <= angle ? "kit-dial-lit" : "kit-dial-tick"} />; })}
      </svg>
    <motion.svg className="kit-dial-orbit" viewBox="0 0 200 200" aria-hidden="true" initial={false} animate={{ rotate: angle }} transition={reduced ? { duration: 0 } : transition}>
        {!reduced && Array.from({ length: 12 }, (_, i) => { const p = point(-i * 3, 66); return <circle key={i} cx={p.x} cy={p.y} r={3 - i * .16} className="kit-dial-comet" opacity={1 - i / 12} />; })}
        <circle cx="166" cy="100" r="4" className="kit-dial-head" />
      </motion.svg>
    <span className="kit-dial-value">{shown}<small>{unit}</small></span>
    <span className="kit-dial-label">{label}</span>
  </div>;
}

// SPDX-License-Identifier: Apache-2.0 AND LicenseRef-ReactBits-MIT-CommonsClause
// Adapted from React Bits Spring Check (https://reactbits.dev), Copyright (c) 2026 David Haz.
// See ./LICENSE-react-bits.md.
import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { SNAPPY, useSpring } from "./motion";
import "./SpringCheck.css";

export function checkProgress(progress: number): number { return Math.min(1, Math.max(0, progress)); }
export function SpringCheck({ label, checked, onChange, disabled = false }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean;
}) {
  const spring = useSpring(SNAPPY);
  const reduce = useReducedMotion();
  const progress = useMotionValue(checked ? 1 : 0);
  const fill = useTransform(progress, checkProgress);
  const rule = useTransform(progress, v => checkProgress((v - .12) / .72));
  const opacity = useTransform(progress, v => 1 - checkProgress(v) * .55);
  useEffect(() => {
    if (reduce) { progress.jump(checked ? 1 : 0); return; }
    const controls = animate(progress, checked ? 1 : 0, spring);
    return () => controls.stop();
  }, [checked, progress, reduce, spring]);
  return <button className="kit-check" type="button" role="checkbox" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
    <span className="kit-check-box" aria-hidden="true">
      <motion.span className="kit-check-fill" style={{ scale: fill }} />
      <svg viewBox="0 0 24 24"><motion.path d="m5 12 4 4 10-10" style={{ pathLength: fill, opacity: fill }} /></svg>
    </span>
    <span className="kit-check-label"><motion.span style={{ opacity }}>{label}</motion.span><motion.i aria-hidden="true" style={{ scaleX: rule }} /></span>
  </button>;
}

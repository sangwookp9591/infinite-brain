// SPDX-License-Identifier: Apache-2.0 AND LicenseRef-ReactBits-MIT-CommonsClause
// Adapted from React Bits Pulse Heart (https://reactbits.dev), Copyright (c) 2026 David Haz.
// See ./LICENSE-react-bits.md.
//
// A pill with a star: pressing it shrinks the star to a dot at 40% of the run,
// flips it to the filled colour, rebounds past its size and settles, while the
// pill dips and recovers. The star is drawn here (no icon-library dependency)
// and the count is replaced by a label, because "Star on GitHub" is a request,
// not a counter. `onDone` fires when the run has finished, so the caller can do
// what the press means (open the browser) after the person has seen it land.
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import "./PulseStar.css";

const OUT = 0.4; // the flip happens at 40% of the run
const STAR_PATH = "M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z";

/** easeOutBack: 0 at k=0 … 1 at k=1, overshooting by `c` on the way. */
export function backEase(k: number, c: number): number {
  const u = k - 1;
  return 1 + (c + 1) * u ** 3 + c * u ** 2;
}

/** 0 → 1 over the first 40% (ease out), then 1 → 0 with a rebound. Pure, tested. */
export function swellOf(t: number, c: number): number {
  if (t <= 0) return 0;
  if (t < OUT) return 1 - (1 - t / OUT) ** 3;
  return 1 - backEase((t - OUT) / (1 - OUT), c);
}

export interface PulseStarProps {
  /** Text beside the star. */
  label: string;
  /** Text once pressed. Falls back to `label`. */
  doneLabel?: string;
  onDone?: () => void;
  /** Length of the whole run in ms. */
  duration?: number;
  /** How small the star gets at the flip, as a fraction of its size. */
  dotSize?: number;
  /** Rebound past rest on the way back; 0 lands without one. */
  overshoot?: number;
  /** Percent the pill dips at the flip. */
  beat?: number;
  size?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}

export function PulseStar({
  label, doneLabel, onDone, duration = 560, dotSize = 0.3, overshoot = 1.7, beat = 3,
  size = 22, autoFocus = false, disabled = false, className = "",
}: PulseStarProps) {
  const reduced = useReducedMotion() ?? false;
  const [pressed, setPressed] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const pillRef = useRef<HTMLSpanElement>(null);
  const glyphRef = useRef<SVGGElement>(null);
  const raf = useRef(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const press = () => {
    if (disabled || pressed) return;
    setPressed(true);
    if (reduced) {
      // No spring under reduced motion: show the result, then carry on.
      setFlipped(true);
      raf.current = window.setTimeout(() => done.current?.(), 300);
      return;
    }
    const t0 = performance.now();
    let swapped = false;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const s = swellOf(t, overshoot);
      const k = 1 - (1 - dotSize) * s;
      glyphRef.current?.setAttribute("transform", `translate(12 12) scale(${k}) translate(-12 -12)`);
      if (pillRef.current) pillRef.current.style.transform = `scale(${1 - (beat / 100) * s})`;
      if (!swapped && t >= OUT) { swapped = true; setFlipped(true); }
      if (t < 1) { raf.current = requestAnimationFrame(tick); return; }
      glyphRef.current?.removeAttribute("transform");
      if (pillRef.current) pillRef.current.style.transform = "";
      // Let the filled star be seen for a beat before the browser takes focus.
      raf.current = window.setTimeout(() => done.current?.(), 220);
    };
    raf.current = requestAnimationFrame(tick);
  };

  return (
    <button
      type="button"
      className={`kit-pulse-star${className ? ` ${className}` : ""}`}
      data-flipped={flipped ? "" : undefined}
      aria-pressed={pressed}
      disabled={disabled}
      autoFocus={autoFocus}
      style={{ "--ps-size": `${size}px` } as React.CSSProperties}
      onClick={press}
    >
      <span ref={pillRef} className="kit-pulse-star-pill">
        <span className="kit-pulse-star-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24"><g ref={glyphRef}><path d={STAR_PATH} vectorEffect="non-scaling-stroke" /></g></svg>
        </span>
        <span className="kit-pulse-star-label">{flipped && doneLabel ? doneLabel : label}</span>
      </span>
    </button>
  );
}

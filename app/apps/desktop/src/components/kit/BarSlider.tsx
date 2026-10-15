// SPDX-License-Identifier: Apache-2.0 AND LicenseRef-ReactBits-MIT-CommonsClause
// Adapted from React Bits Wake Slider (https://reactbits.dev), Copyright (c) 2026 David Haz.
// See ./LICENSE-react-bits.md.
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { SOFT, useSpring } from "./motion";
import "./BarSlider.css";

export function snapSlider(value: number, min: number, max: number, step: number): number {
  if (!(max > min)) return min;
  const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  if (!(step > 0)) return clamped;
  const grid = Math.min(max, Math.max(min, min + Math.round((clamped - min) / step) * step));
  return +((Math.abs(max - clamped) <= Math.abs(grid - clamped) ? max : grid).toFixed(8));
}
export function sliderPosition(value: number, min: number, max: number): number {
  return max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
}
export function sliderValue(position: number, min: number, max: number, step: number): number {
  return snapSlider(min + Math.min(1, Math.max(0, position)) * (max - min), min, max, step);
}
export function BarSlider({ value, onChange, min = 0, max = 100, step = 1, label, showValue = true, formatValue = String, disabled = false }: {
  value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number;
  label: string; showValue?: boolean; formatValue?: (value: number) => string; disabled?: boolean;
}) {
  const reduce = useReducedMotion();
  const spring = useSpring(SOFT);
  const [wake, setWake] = useState({ strength: 0, direction: 1 });
  const last = useRef({ x: 0, time: 0 });
  const decay = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (decay.current !== null) clearTimeout(decay.current); }, []);
  const clean = snapSlider(value, min, max, step);
  const head = sliderPosition(clean, min, max) * 39;
  return <div className="kit-slider">
    <div className="kit-slider-track" role="slider" tabIndex={disabled ? -1 : 0} aria-label={label}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={clean} aria-valuetext={formatValue(clean)} aria-disabled={disabled}
      onPointerDown={event => {
        if (disabled || event.button !== 0) return;
        event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        const rect = event.currentTarget.getBoundingClientRect();
        let pos = (event.clientX - rect.left) / rect.width;
        if (getComputedStyle(event.currentTarget).direction === "rtl") pos = 1 - pos;
        onChange(sliderValue(pos, min, max, step));
        last.current = { x: event.clientX, time: event.timeStamp };
      }} onPointerMove={event => {
        if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
        const delta = event.clientX - last.current.x;
        const speed = Math.abs(delta) / Math.max(1, event.timeStamp - last.current.time);
        setWake({ strength: Math.min(1, speed / 1.2), direction: Math.sign(delta) * (rtl ? -1 : 1) });
        if (decay.current !== null) clearTimeout(decay.current);
        decay.current = setTimeout(() => setWake({ strength: 0, direction: 1 }), 90);
        onChange(sliderValue(rtl ? 1 - (event.clientX - rect.left) / rect.width : (event.clientX - rect.left) / rect.width, min, max, step));
        last.current = { x: event.clientX, time: event.timeStamp };
      }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setWake({ strength: 0, direction: 1 }); }}
      onPointerCancel={() => setWake({ strength: 0, direction: 1 })} onLostPointerCapture={() => setWake({ strength: 0, direction: 1 })}
      onKeyDown={event => {
        if (disabled) return;
        const dir = getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
        const values: Record<string, number> = { ArrowRight: clean + step * dir, ArrowLeft: clean - step * dir, ArrowUp: clean + step, ArrowDown: clean - step, Home: min, End: max, PageUp: clean + step * 10, PageDown: clean - step * 10 };
        if (!(event.key in values)) return;
        event.preventDefault(); onChange(snapSlider(values[event.key], min, max, step));
      }}>
      {Array.from({ length: 40 }, (_, i) => {
        const distance = i - head;
        const reach = distance * wake.direction < 0 ? 10 : 3;
        const lift = reduce ? 0 : Math.max(0, 1 - Math.abs(distance) / reach) * wake.strength;
        return <motion.i key={i} aria-hidden="true" data-filled={i <= Math.round(head)}
          animate={{ scaleY: 1 + lift * 3.5 }} transition={spring} />;
      })}
    </div>
    {showValue && <output>{formatValue(clean)}</output>}
  </div>;
}

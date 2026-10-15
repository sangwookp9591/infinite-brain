// SPDX-License-Identifier: Apache-2.0 AND LicenseRef-ReactBits-MIT-CommonsClause
// Adapted from React Bits Jelly Radio (https://reactbits.dev), Copyright (c) 2026 David Haz.
// See ./LICENSE-react-bits.md.
import { useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { SNAPPY, useSpring } from "./motion";
import "./SegmentedChips.css";

export interface ChipOption { value: string; label: string; disabled?: boolean }
export function nextChip(items: readonly ChipOption[], from: number, direction: number): number {
  for (let n = 1; n <= items.length; n++) {
    const i = ((from + n * direction) % items.length + items.length) % items.length;
    if (!items[i].disabled) return i;
  }
  return from;
}
export function SegmentedChips({ items, value, onChange, label, size = "md", disabled = false }: {
  items: readonly ChipOption[]; value: string; onChange: (value: string) => void;
  label: string; size?: "sm" | "md" | "lg"; disabled?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const spring = useSpring(SNAPPY);
  const reduce = useReducedMotion();
  const selected = items.findIndex(item => item.value === value);
  const tabbable = selected >= 0 && !items[selected].disabled ? selected : items.findIndex(item => !item.disabled);
  return <div className="kit-chips" data-size={size} role="radiogroup" aria-label={label} aria-disabled={disabled}>
    {items.map((item, i) => <motion.button key={item.value} layout={!reduce} type="button" role="radio"
      ref={el => { refs.current[i] = el; }} disabled={disabled || item.disabled}
      aria-checked={i === selected} tabIndex={i === tabbable ? 0 : -1}
      initial={false} animate={{ x: reduce || selected < 0 ? 0 : Math.sign(i - selected) * 7,
        scaleX: reduce ? 1 : i === selected ? 1.12 : 0.97, scaleY: reduce ? 1 : i === selected ? 1.1 : 0.97 }}
      transition={{ ...spring, x: { ...spring, delay: reduce ? 0 : Math.abs(i - selected) * 0.022 }, scaleY: { ...spring, delay: reduce ? 0 : 0.05 } }}
      onClick={() => onChange(item.value)} onKeyDown={event => {
        const dir = getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
        let next: number;
        if (event.key === "ArrowRight") next = nextChip(items, i, dir);
        else if (event.key === "ArrowLeft") next = nextChip(items, i, -dir);
        else if (event.key === "ArrowDown") next = nextChip(items, i, 1);
        else if (event.key === "ArrowUp") next = nextChip(items, i, -1);
        else if (event.key === "Home") next = nextChip(items, -1, 1);
        else if (event.key === "End") next = nextChip(items, items.length, -1);
        else return;
        event.preventDefault();
        if (items[next] && !items[next].disabled) { onChange(items[next].value); refs.current[next]?.focus(); }
      }}>{item.label}</motion.button>)}
  </div>;
}

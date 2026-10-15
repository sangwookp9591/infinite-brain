// SPDX-License-Identifier: Apache-2.0
// The kit's only two springs (spec §6.3). Components pick one; nothing else
// tunes stiffness/damping inline, so the whole UI settles with one feel.
import { useReducedMotion, type Transition } from "motion/react";

/** Chips, checks, slots: small things that should land fast. */
export const SNAPPY: Transition = { type: "spring", stiffness: 520, damping: 34 };
/** Rows, cards, folders: larger surfaces that ease in. */
export const SOFT: Transition = { type: "spring", stiffness: 260, damping: 26 };
/** Reduced motion: no spring, a short opacity-safe step. */
export const INSTANT: Transition = { duration: 0.12 };

/** The spring to use, or INSTANT when the viewer asked for reduced motion. */
export function useSpring(spring: Transition): Transition {
  return useReducedMotion() ? INSTANT : spring;
}

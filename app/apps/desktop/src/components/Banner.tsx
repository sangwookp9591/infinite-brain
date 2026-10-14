import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * Every banner in the app slides down out of the chrome it belongs to and
 * collapses its own height on the way out.
 *
 * The height animation is the part that matters: a banner that appears with
 * `display: none → block` shoves the editor down by 44px in one frame, and the
 * eye reads that as the *content* jumping rather than as a message arriving.
 * Animating `height` means the layout opens up for it, so attention follows the
 * banner instead of chasing the text that moved.
 *
 * Lives here rather than in `App.tsx` so components outside that file (the
 * not-syncing banner) can use the exact same shape instead of growing a second,
 * subtly different strip.
 */
export function Banner({
  children,
  show,
  className = "",
  role,
}: {
  children: React.ReactNode;
  show: boolean;
  className?: string;
  role?: "status" | "alert";
}) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          className="banner-slot"
          initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={
            reduceMotion
              ? { duration: 0.12 }
              : { type: "spring", stiffness: 380, damping: 34 }
          }
        >
          <div className={`banner ${className}`.trim()} role={role}>
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

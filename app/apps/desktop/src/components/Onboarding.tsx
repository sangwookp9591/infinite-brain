// SPDX-License-Identifier: Apache-2.0
// First-launch intro: four short motion scenes over the Orbit night sky, then
// the welcome screen. Shown once per device; Skip, Esc or the last button end
// it. Under reduced motion the scenes render in their settled state and do not
// auto-advance.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { markOnboardingSeen } from "../lib/onboardingIntro";
import { useT } from "../lib/i18n";
import "./Onboarding.css";

const SCENE_MS = 6000;
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export interface Star { x: number; y: number; r: number; arm: number }

/** A two-armed spiral of `n` stars inside a 0–100 box, deterministic so the
 *  scene looks the same on every launch. */
export function galaxyStars(n: number): Star[] {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stars: Star[] = [];
  for (let i = 0; i < n; i++) {
    const arm = i % 2;
    const t = (i / n) * 1.0;
    const angle = t * Math.PI * 3.2 + arm * Math.PI;
    const dist = 6 + t * 40;
    const jitter = (rand() - 0.5) * (4 + t * 8);
    stars.push({
      x: 50 + Math.cos(angle) * dist + jitter,
      y: 50 + Math.sin(angle) * dist * 0.62 + (rand() - 0.5) * 4,
      r: 0.45 + rand() * (1 - t * 0.6) * 1.1,
      arm,
    });
  }
  return stars;
}

const SCENES = [
  {
    eyebrow: "Yours, on disk",
    title: "Your notes are files.",
    body: "Every note is a Markdown file in a folder you own. Open it anywhere, back it up any way, keep it forever.",
  },
  {
    eyebrow: "Together",
    title: "Write together, live.",
    body: "Invite your team with a link. See who is in a note and watch their words appear as they type.",
  },
  {
    eyebrow: "AI, on a leash",
    title: "AI edits you can undo.",
    body: "Connect Claude or ChatGPT to your vault. Every change it makes is shown as a diff and can be undone.",
  },
  {
    eyebrow: "The big picture",
    title: "Watch ideas connect.",
    body: "Link notes with [[double brackets]] and your vault grows into a galaxy you can explore.",
  },
] as const;

export function Onboarding({ onDone }: { onDone: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const tr = useT();
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const last = index === SCENES.length - 1;

  // Fade out first; the welcome screen underneath takes over once it lands.
  const finish = useCallback(() => {
    markOnboardingSeen(window.localStorage);
    setLeaving(true);
  }, []);
  const go = useCallback(
    (to: number) => setIndex(Math.max(0, Math.min(SCENES.length - 1, to))),
    [],
  );

  useEffect(() => {
    if (reduced || last) return;
    const t = window.setTimeout(() => setIndex((i) => i + 1), SCENE_MS);
    return () => window.clearTimeout(t);
  }, [index, last, reduced]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") {
        if (last) finish();
        else go(index + 1);
      }
      else if (e.key === "ArrowLeft") go(index - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, go, index, last]);

  const scene = SCENES[index];
  return (
    <motion.div
      className="onboarding"
      role="dialog"
      aria-modal="true"
      aria-label={tr("Welcome to Infinite Brain")}
      initial={{ opacity: 0 }}
      animate={leaving ? { opacity: 0, scale: 1.04 } : { opacity: 1, scale: 1 }}
      transition={{ duration: leaving ? (reduced ? 0.12 : 0.5) : 0.4 }}
      onAnimationComplete={() => leaving && onDone()}
      style={leaving ? { pointerEvents: "none" } : undefined}
      tabIndex={-1}
      ref={(node: HTMLDivElement | null) => node?.focus({ preventScroll: true })}
    >
      <Sky reduced={reduced} />

      <header className="onboarding-top">
        <span className="onboarding-wordmark">Infinite Brain</span>
        <button type="button" className="onboarding-skip" onClick={finish}>{tr("Skip")}</button>
      </header>

      <div className="onboarding-stage" aria-hidden="true">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            className="onboarding-art"
            initial={{ opacity: 0, scale: 0.96, filter: "blur(10px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE_OUT } }}
            exit={{ opacity: 0, scale: 1.03, filter: "blur(8px)", transition: { duration: 0.35 } }}
          >
            {index === 0 && <FilesScene reduced={reduced} />}
            {index === 1 && <TogetherScene reduced={reduced} />}
            {index === 2 && <UndoScene reduced={reduced} />}
            {index === 3 && <GalaxyScene reduced={reduced} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="onboarding-copy" aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.6, delay: 0.15, ease: EASE_OUT } }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.25 } }}
          >
            <div className="onboarding-eyebrow">{tr(scene.eyebrow)}</div>
            <h1 className="onboarding-title">{tr(scene.title)}</h1>
            <p className="onboarding-body">{tr(scene.body)}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="onboarding-nav">
        <div className="onboarding-progress" role="tablist" aria-label={tr("Intro steps")}>
          {SCENES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${i + 1}: ${tr(s.title)}`}
              className="onboarding-bar"
              onClick={() => go(i)}
            >
              <motion.span
                className="onboarding-bar-fill"
                initial={{ scaleX: i < index || reduced || (i === index && last) ? 1 : 0 }}
                animate={{ scaleX: i <= index ? 1 : 0 }}
                transition={i === index && !reduced && !last ? { duration: SCENE_MS / 1000, ease: "linear" } : { duration: 0.2 }}
                key={i === index ? `active-${index}` : `bar-${i}`}
                style={{ originX: 0 }}
              />
            </button>
          ))}
        </div>
        <div className="onboarding-actions">
          {index > 0 && (
            <button type="button" className="onboarding-back" onClick={() => go(index - 1)}>{tr("Back")}</button>
          )}
          <motion.button
            type="button"
            className="onboarding-next"
            onClick={() => (last ? finish() : go(index + 1))}
            whileHover={reduced ? undefined : { scale: 1.03 }}
            whileTap={reduced ? undefined : { scale: 0.97 }}
          >
            {last ? tr("Get started") : tr("Next")}
          </motion.button>
        </div>
      </footer>
    </motion.div>
  );
}

/** Slow twinkling backdrop shared by every scene. */
function Sky({ reduced }: { reduced: boolean }) {
  const dots = useMemo(() => galaxyStars(70).map((s, i) => ({ ...s, x: (s.x * 7.3 + i * 13) % 100, y: (s.y * 5.1 + i * 7) % 100 })), []);
  return (
    <div className="onboarding-sky" aria-hidden="true">
      <motion.div
        className="onboarding-nebula"
        animate={reduced ? undefined : { x: [0, 40, -20, 0], y: [0, -30, 20, 0], scale: [1, 1.1, 0.95, 1] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {dots.map((d, i) => (
          <motion.circle
            key={i}
            cx={d.x}
            cy={d.y}
            r={d.r * 0.18}
            fill="#fff"
            initial={{ opacity: 0.2 }}
            animate={reduced ? { opacity: 0.4 } : { opacity: [0.15, 0.7, 0.15] }}
            transition={{ duration: 3 + (i % 5), repeat: Infinity, delay: (i % 7) * 0.4 }}
          />
        ))}
      </svg>
    </div>
  );
}

const FILES = ["Q3 plan.md", "Meeting notes.md", "Hiring loop.md", "Ideas.md", "Decisions.md"];

/** Markdown files drift in as cards, then collapse into the stars they become. */
function FilesScene({ reduced }: { reduced: boolean }) {
  const [phase, setPhase] = useState<"files" | "stars">(reduced ? "stars" : "files");
  useEffect(() => {
    if (reduced) return;
    const t = window.setTimeout(() => setPhase("stars"), 2600);
    return () => window.clearTimeout(t);
  }, [reduced]);
  const starAt = [[30, 34], [58, 22], [72, 52], [42, 66], [22, 58]];
  return (
    <div className="ob-files">
      <svg className="ob-files-links" viewBox="0 0 100 100" preserveAspectRatio="none">
        {phase === "stars" &&
          [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 2]].map(([a, b], i) => (
            <motion.line
              key={i}
              x1={starAt[a][0]} y1={starAt[a][1]} x2={starAt[b][0]} y2={starAt[b][1]}
              className="ob-link ob-link-flat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduced ? 0 : 0.9, delay: reduced ? 0 : 0.5 + i * 0.15 }}
            />
          ))}
      </svg>
      {FILES.map((name, i) => {
        const [sx, sy] = starAt[i];
        return (
          <motion.div
            key={name}
            className="ob-file"
            style={{ left: `${sx}%`, top: `${sy}%` }}
            initial={reduced ? false : { opacity: 0, y: 40, rotate: (i - 2) * 6 }}
            animate={
              phase === "files"
                ? { opacity: 1, y: 0, rotate: (i - 2) * 4, scale: 1, transition: { delay: i * 0.18, type: "spring", stiffness: 160, damping: 18 } }
                : { opacity: 0, scale: 0.2, rotate: 0, transition: { duration: reduced ? 0 : 0.5, delay: reduced ? 0 : i * 0.06 } }
            }
          >
            <span className="ob-file-ext">MD</span>
            {name}
          </motion.div>
        );
      })}
      {starAt.map(([x, y], i) => (
        <motion.span
          key={i}
          className="ob-star"
          style={{ left: `${x}%`, top: `${y}%` }}
          initial={{ opacity: 0, scale: 0 }}
          animate={phase === "stars" ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 14, delay: reduced ? 0 : 0.2 + i * 0.06 }}
        />
      ))}
    </div>
  );
}

const SENTENCE = "Launch the beta on Thursday; Min owns the checklist.";

/** A note with two teammates: avatars arrive, cursors move, words type in. */
function TogetherScene({ reduced }: { reduced: boolean }) {
  const [typed, setTyped] = useState(reduced ? SENTENCE.length : 0);
  useEffect(() => {
    if (reduced) return;
    let n = 0;
    let tick = 0;
    const start = window.setTimeout(() => {
      tick = window.setInterval(() => {
        n += 1;
        setTyped(n);
        if (n >= SENTENCE.length) window.clearInterval(tick);
      }, 55);
    }, 900);
    return () => { window.clearTimeout(start); window.clearInterval(tick); };
  }, [reduced]);
  return (
    <div className="ob-note">
      <div className="ob-note-head">
        <span className="ob-note-title">Launch plan</span>
        <div className="ob-avatars">
          {[["S", "#ff8a65"], ["M", "#4dd0e1"], ["You", "#a29bff"]].map(([who, color], i) => (
            <motion.span
              key={who}
              className="ob-avatar"
              style={{ background: color }}
              initial={reduced ? false : { opacity: 0, scale: 0.4, x: 12 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 22, delay: 0.2 + i * 0.15 }}
            >
              {who === "You" ? "Y" : who}
            </motion.span>
          ))}
        </div>
      </div>
      <div className="ob-line ob-line-w80" />
      <div className="ob-line ob-line-w60" />
      <div className="ob-typing">
        {SENTENCE.slice(0, typed)}
        <span className="ob-caret" style={{ ["--c" as string]: "#4dd0e1" }}>
          <span className="ob-caret-tag">Min</span>
        </span>
      </div>
      <div className="ob-typing ob-sara-line">
        <span className="ob-sara-sel">
          Budget review
          <motion.span
            className="ob-sara-hl"
            initial={reduced ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: reduced ? 0 : 1.6, duration: reduced ? 0 : 0.7, ease: EASE_OUT }}
          />
          <motion.span
            className="ob-caret-tag ob-caret-tag-sara"
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduced ? 0 : 2.1 }}
          >
            Sara
          </motion.span>
        </span>{" "}
        moves to Friday.
      </div>
      <div className="ob-line ob-line-w70" />
      <motion.div
        className="ob-synced"
        initial={reduced ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduced ? 0 : 3.6 }}
      >
        <span className="ob-dot" /> Synced · just now
      </motion.div>
    </div>
  );
}

/** An AI rewrites a line, the diff shows, then Undo puts it back. */
function UndoScene({ reduced }: { reduced: boolean }) {
  const [step, setStep] = useState(reduced ? 1 : 0); // 0 original, 1 AI diff, 2 undone
  useEffect(() => {
    if (reduced) return;
    const a = window.setTimeout(() => setStep(1), 1100);
    const b = window.setTimeout(() => setStep(2), 3900);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [reduced]);
  return (
    <div className="ob-note">
      <div className="ob-note-head">
        <span className="ob-note-title">Pricing ideas</span>
        <motion.span
          className="ob-ai-chip"
          animate={step === 1 && !reduced ? { boxShadow: ["0 0 0 0 rgba(162,155,255,.6)", "0 0 0 10px rgba(162,155,255,0)"] } : {}}
          transition={{ duration: 1.2, repeat: step === 1 ? Infinity : 0 }}
        >
          ✦ Claude
        </motion.span>
      </div>
      <div className="ob-line ob-line-w70" />
      <div className="ob-diff">
        <motion.span
          className="ob-old"
          animate={{ textDecorationColor: step === 1 ? "#ff7a8a" : "rgba(255,122,138,0)" }}
        >
          Two plans: Free and Pro.
        </motion.span>
        <AnimatePresence>
          {step === 1 && (
            <motion.span
              className="ob-new"
              initial={reduced ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8, filter: "blur(4px)" }}
              transition={{ duration: 0.5 }}
            >
              {" "}Three plans: Free, Team and Business.
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="ob-line ob-line-w60" />
      <div className="ob-undo-row">
        <span className="ob-ai-meta">
          {step === 2 ? "Change undone. The note is back to what it said." : "Claude changed 1 line · just now"}
        </span>
        <motion.span
          className={`ob-undo ${step === 2 ? "is-done" : ""}`}
          animate={step === 1 && !reduced ? { scale: [1, 1.06, 1] } : { scale: 1 }}
          transition={{ duration: 0.9, repeat: step === 1 ? Infinity : 0 }}
        >
          {step === 2 ? "✓ Undone" : "Undo"}
        </motion.span>
      </div>
    </div>
  );
}

/** Notes become a slowly turning spiral galaxy with links drawing in. */
function GalaxyScene({ reduced }: { reduced: boolean }) {
  const stars = useMemo(() => galaxyStars(140), []);
  const links = useMemo(() => stars.slice(0, 60).map((s, i) => [s, stars[i + 2]] as const), [stars]);
  return (
    <motion.div
      className="ob-galaxy"
      animate={reduced ? undefined : { rotate: 360 }}
      transition={{ duration: 120, repeat: Infinity, ease: "linear" }}
    >
      <svg viewBox="0 0 100 100">
        <defs>
          <radialGradient id="ob-core">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="35%" stopColor="#a29bff" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#a29bff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="16" fill="url(#ob-core)" />
        {links.map(([a, b], i) => (
          <motion.line
            key={i}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            className="ob-link"
            initial={reduced ? false : { pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.5 }}
            transition={{ duration: 0.8, delay: 0.8 + i * 0.03 }}
          />
        ))}
        {stars.map((s, i) => (
          <motion.circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={s.r}
            fill={s.arm ? "#cfc9ff" : "#9fe7ff"}
            initial={reduced ? false : { opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: i * 0.012 }}
          />
        ))}
      </svg>
    </motion.div>
  );
}

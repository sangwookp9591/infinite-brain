// SPDX-License-Identifier: Apache-2.0
// The one-time "Enjoying Infinite Brain?" card (policy: lib/starPrompt.ts).
// A small card in the bottom-right corner, not a modal: it must never block a
// note. It also has no timer — a card that vanishes by itself would be missed
// and then asked about again; any answer, including closing it, ends it.
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import * as ipc from "../lib/ipc";
import { useStore } from "../store";
import {
  answered, loadStarState, recordOpen, REPO_URL, saveStarState, shouldAskForStar, type StarState,
} from "../lib/starPrompt";
import { toast } from "../lib/toast";
import { PulseStar } from "./kit/PulseStar";
import { t, useT } from "../lib/i18n";
import { shouldAskSmartSearch, useSmartSearch, useSmartSearchCardOpen } from "../lib/smartSearch";

/** The repository's star page opens in the user's browser. */
export function openRepoForStar(): Promise<void> {
  return ipc.openExternal(REPO_URL);
}

const DELAY_MS = 45_000;

export function StarPrompt() {
  const reduced = useReducedMotion() ?? false;
  const tr = useT();
  const [state, setState] = useState<StarState>(() => {
    const s = recordOpen(loadStarState(window.localStorage), new Date());
    saveStarState(window.localStorage, s);
    return s;
  });
  const [show, setShow] = useState(false);
  // Anything that already wants the user's attention wins: the auth/invite
  // prompts, and a sync that is not healthy. Asking for a favour then is rude.
  // The smart search question goes first; both live in the same corner.
  const smart = useSmartSearch();
  const smartCard = useSmartSearchCardOpen();
  const smartBusy =
    smartCard ||
    shouldAskSmartSearch(window.localStorage, smart) ||
    smart?.state === "downloading" || smart?.state === "preparing";
  const busy = useStore((s) => s.authPrompt !== null) || smartBusy;

  useEffect(() => {
    if (!shouldAskForStar(state, { busy })) { setShow(false); return; }
    // A beat after the app settles, so it reads as a pause rather than a pop-up.
    const t = window.setTimeout(() => setShow(true), DELAY_MS);
    return () => window.clearTimeout(t);
  }, [state, busy]);

  const finish = () => {
    const next = answered(state);
    saveStarState(window.localStorage, next);
    setState(next);
    setShow(false);
  };

  // Runs after PulseStar's animation has finished, so the person sees the star
  // fill before the browser takes over; the card ends with the press.
  const star = () => {
    finish();
    void openRepoForStar().catch(() => toast(t("Couldn't open the browser. Find us at github.com/sangwookp9591/infinite-brain"), "neutral"));
  };

  if (!show) return null;
  return (
    <motion.div
      className="star-prompt"
      role="dialog"
      aria-label={tr("Enjoying Infinite Brain?")}
      initial={reduced ? false : { opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduced ? { duration: 0.12 } : { type: "spring", stiffness: 260, damping: 26 }}
    >
      <button type="button" className="star-prompt-x" aria-label={tr("Close")} onClick={finish}>×</button>
      <div className="star-prompt-title">{tr("Enjoying Infinite Brain?")}</div>
      <p className="star-prompt-body">
        {tr("It's free and open source. A star on GitHub is the easiest way to say thanks, and it helps other teams find it.")}
      </p>
      <div className="star-prompt-actions">
        <PulseStar label={tr("Star on GitHub")} doneLabel={tr("Thank you!")} onDone={star} autoFocus />
        <button type="button" className="secondary sm" onClick={finish}>{tr("Not now")}</button>
      </div>
    </motion.div>
  );
}

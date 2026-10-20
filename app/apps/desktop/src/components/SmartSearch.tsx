// SPDX-License-Identifier: Apache-2.0
// Smart search surfaces (PRD §5.8 F8.3a; design: dev/design-lab/smartSearchScene.tsx):
// the one-time question, the Settings tab, and the hint in the search box.
// State lives in lib/smartSearch.ts; the engine is src-tauri/src/semantic.rs.
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { SmartSearchStatus } from "../lib/ipc";
import * as ipc from "../lib/ipc";
import {
  clearSmartSearch, disableSmartSearch, enableSmartSearch, markSmartSearchAsked, megabytes, MODEL_MB,
  refreshSmartSearch, setSmartSearchCardOpen, shouldAskSmartSearch, useSmartSearch,
} from "../lib/smartSearch";
import { t, useT } from "../lib/i18n";
import { toast } from "../lib/toast";
import { useStore } from "../store";
import { SpringCheck } from "./kit/SpringCheck";
import "./SmartSearch.css";

const ASK_DELAY_MS = 15_000;

async function turnOn() {
  const s = await enableSmartSearch();
  if (s.state === "on") toast(t("Smart search is on"), "success");
}

/** What a status means right now, for the card and the tab. */
function Progress({ status }: { status: SmartSearchStatus }) {
  const tr = useT();
  if (status.state === "downloading") {
    const pct = status.total ? Math.floor((status.received / status.total) * 100) : 0;
    return (
      <>
        <div className="ss-bar" role="progressbar" aria-label={tr("Getting smart search ready")}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="ss-meta">
          <span>{tr("{received} MB of {total} MB", { received: megabytes(status.received), total: megabytes(status.total) })}</span>
          <span>{pct}%</span>
        </p>
        <p className="ss-note">{tr("You can close this; it keeps downloading. Your notes work as usual meanwhile.")}</p>
      </>
    );
  }
  if (status.state === "preparing") {
    return <p className="ss-note">{tr("Preparing… this takes a few seconds the first time.")}</p>;
  }
  if (status.state === "limited") {
    return (
      <p className="ss-note" role="status">
        {status.reason === "storage"
          ? tr("Not enough storage to turn it on. Free up at least {size} MB and try again.", { size: megabytes(status.neededBytes) })
          : tr("This device doesn't have enough memory to turn it on.")}
      </p>
    );
  }
  if (status.state === "failed") {
    return <p className="auth-error">{tr("Couldn't turn on smart search: {message}", { message: status.message })}</p>;
  }
  return null;
}

/** The one-time question, a corner card like the star ask: never blocks a note. */
export function SmartSearchPrompt() {
  const tr = useT();
  const reduced = useReducedMotion() ?? false;
  const status = useSmartSearch();
  const busy = useStore((s) => s.authPrompt !== null);
  const [open, setOpen] = useState(false);
  // Once asked, the card stays to show progress until it is on or closed.
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    if (open || busy || !shouldAskSmartSearch(window.localStorage, status)) return;
    const timer = window.setTimeout(() => setOpen(true), ASK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, busy, status]);

  useEffect(() => {
    if (answered && status?.state === "on") setOpen(false);
  }, [answered, status]);

  useEffect(() => {
    setSmartSearchCardOpen(open);
    return () => setSmartSearchCardOpen(false);
  }, [open]);

  if (!open || !status) return null;
  const close = () => {
    markSmartSearchAsked(window.localStorage);
    setOpen(false);
  };
  const working = status.state === "downloading" || status.state === "preparing";

  return (
    <motion.div
      className="star-prompt smart-search-card"
      role="dialog"
      aria-label={tr("Turn on smart search?")}
      initial={reduced ? false : { opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduced ? { duration: 0.12 } : { type: "spring", stiffness: 260, damping: 26 }}
    >
      <button type="button" className="star-prompt-x" aria-label={tr("Close")} onClick={close}>×</button>
      <div className="star-prompt-title">
        {working ? tr("Getting smart search ready") : tr("Turn on smart search?")}
      </div>
      {!answered || status.state === "off" ? (
        <>
          <p className="star-prompt-body">
            {tr("Finds notes with a similar meaning, not just the same words. It downloads about {size} MB once, and your notes never leave this device.", { size: MODEL_MB })}
          </p>
          <div className="star-prompt-actions">
            <button type="button" className="primary sm" autoFocus onClick={() => {
              markSmartSearchAsked(window.localStorage);
              setAnswered(true);
              void turnOn();
            }}>{tr("Turn on")}</button>
            <button type="button" className="secondary sm" onClick={close}>{tr("Not now")}</button>
          </div>
        </>
      ) : (
        <div className="star-prompt-body">
          <Progress status={status} />
          <div className="star-prompt-actions">
            {working && status.state === "downloading" && (
              <button type="button" className="secondary sm" onClick={() => void ipc.smartSearchCancel()}>{tr("Cancel")}</button>
            )}
            {status.state === "limited" && (
              <button type="button" className="primary sm" onClick={close}>{tr("Keep using word search")}</button>
            )}
            {status.state === "failed" && (
              <button type="button" className="primary sm" onClick={() => void turnOn()}>{tr("Try again")}</button>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}

/** Vault settings → Smart search. Applies to the whole device. */
export function SmartSearchTab() {
  const tr = useT();
  const status = useSmartSearch();
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void refreshSmartSearch(), []);
  if (!status) return null;

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    void fn().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  if (status.state === "unsupported") {
    return (
      <div className="io-tab">
        <p className="io-desc">{tr("Smart search isn't available on this computer yet. Word search works as usual.")}</p>
      </div>
    );
  }

  const on = status.state === "on";
  const working = status.state === "downloading" || status.state === "preparing";
  // Failed and Limited carry it too: a model on disk can be cleared whatever went wrong.
  const usedBytes = "modelBytes" in status ? status.modelBytes : 0;

  return (
    <div className="io-tab smart-search-tab">
      <section className="io-section">
        <div className="ss-row">
          <div>
            <h3 className="io-heading">{tr("Use smart search")}</h3>
            <p className="io-desc">
              {tr("Finds notes with a similar meaning, not just the same words. Your notes never leave this device.")}{" "}
              {tr("It applies on this device, to every vault.")}
            </p>
          </div>
          <SpringCheck
            label={tr("Use smart search")}
            checked={on || working}
            disabled={working}
            onChange={(next) => run(next ? turnOn : disableSmartSearch)}
          />
        </div>
        {on && (
          <p className="io-hint" role="status">
            {status.total > 0 && status.indexed >= status.total
              ? tr("Ready for all {total} notes", { total: status.total })
              : tr("Read {indexed} of {total} notes", { indexed: status.indexed, total: status.total })}
          </p>
        )}
        <Progress status={status} />
        {status.state === "downloading" && (
          <div className="io-actions">
            <button type="button" className="secondary" onClick={() => void ipc.smartSearchCancel()}>{tr("Cancel")}</button>
          </div>
        )}
      </section>

      <section className="io-section">
        <div className="ss-row">
          <div>
            <h3 className="io-heading">{tr("Include images")}</h3>
            <p className="io-desc">{tr("Find images in notes and in this vault by meaning. Downloads another 555 MB once; images stay on this device.")}</p>
          </div>
          <SpringCheck label={tr("Include images")}
            checked={"includeImages" in status && !!status.includeImages}
            disabled={!on || working}
            onChange={(next) => run(() => enableSmartSearch(next))} />
        </div>
        {on && status.includeImages && (
          <p className="io-hint" role="status">{tr("Read {indexed} of {total} images", { indexed: status.imagesIndexed ?? 0, total: status.imagesTotal ?? 0 })}</p>
        )}
      </section>

      <section className="io-section">
        <div className="ss-row">
          <div>
            <h3 className="io-heading">{tr("Space used")}</h3>
            <p className="io-desc" role="status">
              {usedBytes > 0 ? tr("{size} MB", { size: megabytes(usedBytes) }) : tr("Nothing downloaded.")}
            </p>
          </div>
          {confirmClear ? (
            <div className="io-actions">
              <button type="button" className="primary danger" onClick={() => {
                setConfirmClear(false);
                run(clearSmartSearch);
              }}>{tr("Clear")}</button>
              <button type="button" className="secondary" autoFocus onClick={() => setConfirmClear(false)}>{tr("Keep it")}</button>
            </div>
          ) : (
            <button type="button" className="secondary" disabled={usedBytes === 0 || working} onClick={() => setConfirmClear(true)}>
              {tr("Clear…")}
            </button>
          )}
        </div>
        <p className="io-hint">{tr("Removes the smart search file and its search data. Your notes stay as they are.")}</p>
      </section>

      {error && <div className="auth-error">{error}</div>}
      <p className="io-hint">{tr("Model: EmbeddingGemma 2 by Google (Apache 2.0), run on this device with llama.cpp (MIT).")}</p>
    </div>
  );
}

/** The line under the search box: an offer while off, progress while it reads. */
export function SmartSearchHint({ onOpenSettings }: { onOpenSettings: () => void }) {
  const tr = useT();
  const status = useSmartSearch();
  useEffect(() => void refreshSmartSearch(), []);
  if (!status) return null;
  if (status.state === "off") {
    return (
      <div className="search-smart-hint">
        <span>{tr("Searching by words.")}</span>
        <button type="button" className="ss-chip" onClick={onOpenSettings}>{tr("Turn on smart search")}</button>
      </div>
    );
  }
  if (status.state === "on" && status.indexed < status.total) {
    return (
      <div className="search-smart-hint" role="status">
        {tr("Smart search is reading your notes ({indexed}/{total})", { indexed: status.indexed, total: status.total })}
      </div>
    );
  }
  if (status.state === "downloading" || status.state === "preparing") {
    return <div className="search-smart-hint" role="status">{tr("Getting smart search ready")}</div>;
  }
  return null;
}

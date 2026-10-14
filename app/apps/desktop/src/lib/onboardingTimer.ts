// SPDX-License-Identifier: Apache-2.0

/** Local-only onboarding milestones. Values contain no account or vault identifiers. */
export type OnboardingStage = "invite_opened" | "signed_in" | "invite_accepted" | "vault_opened" | "first_note_synced";

const KEY = "baalda.onboarding-log.v1";

export interface OnboardingEvent {
  stage: OnboardingStage;
  at: number;
  elapsedMs: number;
}

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function decodeEvents(value: unknown): OnboardingEvent[] {
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.stage === "string" && typeof e.at === "number") : [];
  } catch { return []; }
}

/** Begin a local-only run when the recipient opens an invitation. */
export function startOnboarding(at = Date.now(), target = storage()): void {
  if (!target) return;
  const current = readOnboardingRun(target);
  if (current && !current.events.some((event) => event.stage === "first_note_synced")) return;
  try { target.setItem(KEY, JSON.stringify({ startedAt: at, events: [{ stage: "invite_opened", at, elapsedMs: 0 }] })); } catch { /* local storage is best effort */ }
}

/** Record a milestone; the first confirmed note ends the measurable run. */
export function recordOnboardingStage(stage: OnboardingStage, at = Date.now(), target = storage()): void {
  if (!target) return;
  let run: { startedAt: number; events: OnboardingEvent[] };
  try {
    const parsed = JSON.parse(target.getItem(KEY) ?? "null") as { startedAt?: unknown; events?: unknown } | null;
    if (!parsed || typeof parsed.startedAt !== "number" || !Array.isArray(parsed.events)) return;
    run = { startedAt: parsed.startedAt, events: decodeEvents(parsed.events) };
  } catch { return; }
  if (run.events.some((e) => e.stage === stage) || run.events.some((e) => e.stage === "first_note_synced")) return;
  run.events.push({ stage, at, elapsedMs: Math.max(0, at - run.startedAt) });
  try { target.setItem(KEY, JSON.stringify(run)); } catch { /* local storage is best effort */ }
}

/** Read the current local run for diagnostics and pure-logic tests. */
export function readOnboardingRun(target = storage()): { startedAt: number; events: OnboardingEvent[] } | null {
  if (!target) return null;
  try {
    const parsed = JSON.parse(target.getItem(KEY) ?? "null") as { startedAt?: unknown; events?: unknown } | null;
    if (!parsed || typeof parsed.startedAt !== "number" || !Array.isArray(parsed.events)) return null;
    return { startedAt: parsed.startedAt, events: decodeEvents(parsed.events) };
  } catch { return null; }
}

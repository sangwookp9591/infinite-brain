// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { readOnboardingRun, recordOnboardingStage, startOnboarding } from "../onboardingTimer";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

describe("onboarding timer", () => {
  it("records local timestamps and elapsed time through the first confirmed note", () => {
    const storage = memoryStorage();
    startOnboarding(100, storage);
    recordOnboardingStage("signed_in", 250, storage);
    recordOnboardingStage("invite_accepted", 400, storage);
    recordOnboardingStage("first_note_synced", 1_100, storage);
    recordOnboardingStage("first_note_synced", 1_200, storage);
    expect(readOnboardingRun(storage)).toEqual({
      startedAt: 100,
      events: [
        { stage: "invite_opened", at: 100, elapsedMs: 0 },
        { stage: "signed_in", at: 250, elapsedMs: 150 },
        { stage: "invite_accepted", at: 400, elapsedMs: 300 },
        { stage: "first_note_synced", at: 1_100, elapsedMs: 1_000 },
      ],
    });
  });

  it("ignores milestones unless an invitation run has started", () => {
    const storage = memoryStorage();
    recordOnboardingStage("signed_in", 250, storage);
    expect(readOnboardingRun(storage)).toBeNull();
  });

  it("does not reset a run when the same deep link is replayed", () => {
    const storage = memoryStorage();
    startOnboarding(100, storage);
    recordOnboardingStage("signed_in", 250, storage);
    startOnboarding(500, storage);
    expect(readOnboardingRun(storage)?.startedAt).toBe(100);
  });
});

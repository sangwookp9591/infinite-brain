// SPDX-License-Identifier: Apache-2.0
// Whether this device has seen the first-launch intro (components/Onboarding).
// Kept apart from the component so App can decide without loading its chunk.
const SEEN_KEY = "infinitebrain.onboarding.v1";

export function shouldShowOnboarding(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(SEEN_KEY) !== "seen";
  } catch {
    return false; // Storage blocked: never trap someone in a loop of intros.
  }
}

export function markOnboardingSeen(storage: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(SEEN_KEY, "seen");
  } catch {
    /* Showing it again next launch is the only cost. */
  }
}

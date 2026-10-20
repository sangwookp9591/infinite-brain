// SPDX-License-Identifier: Apache-2.0
// What sign-in and sign-up say when no server answered.
//
// fetch() rejects with a bare TypeError when nothing answers: "Load failed" in
// WebKit (macOS), "Failed to fetch" in Chromium (Windows WebView2). Shown as-is,
// that reads as "sign-up is broken". Until a hosted server exists the app's
// default server is this computer, so this is the first thing a new user sees.
import { t } from "../i18n";

/** True for the error fetch() throws when the request never got an answer. */
export function isNetworkFailure(e: unknown): boolean {
  return e instanceof TypeError;
}

/** The sentence to show instead, naming the server that did not answer. */
export function unreachableAuthMessage(serverUrl: string): string {
  let host = serverUrl;
  try {
    host = new URL(serverUrl).host || serverUrl;
  } catch {
    /* not a URL: show what we were given */
  }
  return t(
    "Couldn't reach the server at {host}. An account is for working with a team and needs an Infinite Brain server. You can keep using your notes on this computer without one.",
    { host },
  );
}

/** Re-throw a network failure as that sentence; anything else passes through untouched. */
export function explainUnreachable(e: unknown, serverUrl: string): unknown {
  return isNetworkFailure(e) ? new Error(unreachableAuthMessage(serverUrl)) : e;
}

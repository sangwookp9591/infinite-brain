// Which `<scheme>://` this build of the app owns, and which ones its link
// parsers accept.
//
// The released app registers `infinitebrain://`; the Staging app registers
// `infinitebrain-staging://` (tauri.staging.conf.json overrides the deep-link schemes,
// and staging-release.yml inlines VITE_DEEP_LINK_SCHEME to match); a local
// `pnpm run dev:desktop` build registers `infinitebrain-dev://` (tauri.dev.conf.json). They HAVE to
// differ: with both apps installed on one machine and both claiming `infinitebrain://`,
// the OS hands every link — a production invitation email included — to
// whichever app registered the scheme last, which is how clicking a link from
// the production server opened the Staging app.
//
// Parsers accept all three schemes regardless of build. Being strict about
// the scheme buys nothing (the OS already routed the link here) and would make
// a link pasted between builds silently do nothing.

/**
 * The scheme this build registers and puts in links it constructs itself.
 * Release and Staging builds inline it at build time (VITE_DEEP_LINK_SCHEME);
 * the `tauri dev` build (Vite's "development" mode) owns `infinitebrain-dev://`, which
 * tauri.dev.conf.json registers, so a link meant for a local build never opens
 * the installed app. Tests run in Vite's "test" mode and use the release scheme.
 */
export const APP_SCHEME: string =
  (import.meta.env.VITE_DEEP_LINK_SCHEME as string | undefined)?.trim() ||
  (import.meta.env.MODE === "development" ? "infinitebrain-dev" : "infinitebrain");

/** Which build this is, named for the server (checkout hand-back). */
export type AppChannel = "production" | "staging" | "dev";

export const APP_CHANNEL: AppChannel =
  APP_SCHEME === "infinitebrain-staging" ? "staging" : APP_SCHEME === "infinitebrain-dev" ? "dev" : "production";

const ACCEPTED_PROTOCOLS = new Set([
  "infinitebrain:",
  "infinitebrain-staging:",
  "infinitebrain-dev:",
  `${APP_SCHEME}:`,
]);

/** Is this `URL.protocol` (with its trailing colon) one of ours? */
export function isAppProtocol(protocol: string): boolean {
  return ACCEPTED_PROTOCOLS.has(protocol);
}

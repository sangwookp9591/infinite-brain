/**
 * Release-note parsing for the What's New modal.
 *
 * The GitHub release body arrives as `latest.json`'s `notes` and is whatever
 * `.github/workflows/release.yml` put there — normally the ONE `## <version>`
 * section of `docs/RELEASE_NOTES.md` that matches the version being released.
 * `notesForVersion` is the belt to that workflow's braces: a body that still
 * carries several sections (an older release, a hand-edited body, a staging
 * build whose notes append the queued section under the tester warning) is
 * narrowed to the version the user actually received, so an update can never
 * show points from a release they installed weeks ago.
 */

/** A `## 0.1.61` heading line, with any surrounding whitespace. */
const HEADING = /^[ \t]*##[ \t]+(.+?)[ \t]*$/;

/** Strip `<!-- … -->` blocks, including multi-line ones. */
function stripHtmlComments(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, "");
}

/** `0.1.61`, `v0.1.61` and `## 0.1.61` all name the same release. */
function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, "").toLowerCase();
}

/**
 * Narrow a release body to the section for `version`.
 *
 * - No `## ` heading anywhere → the body is already one release's notes, so it
 *   comes back whole.
 * - A heading matches → only that section's lines.
 * - No heading matches (or no version given) → the FIRST section, which is the
 *   newest one by the file's newest-first rule.
 *
 * Lines before the first heading are preamble, never part of a section.
 */
export function notesForVersion(
  body: string | null | undefined,
  version?: string | null,
): string {
  if (!body) return "";
  const lines = stripHtmlComments(body).split(/\r?\n/);
  const want = version ? normalizeVersion(version) : null;

  const sections: { name: string; lines: string[] }[] = [];
  let current: { name: string; lines: string[] } | null = null;
  let sawHeading = false;
  for (const line of lines) {
    const m = HEADING.exec(line);
    if (m) {
      sawHeading = true;
      current = { name: normalizeVersion(m[1]), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  if (!sawHeading) return stripHtmlComments(body);
  if (sections.length === 0) return "";

  const picked =
    (want != null ? sections.find((s) => s.name === want) : undefined) ??
    sections[0];
  return picked.lines.join("\n");
}

/**
 * The release body as display lines: bullets and bold markers unwrapped,
 * headings and the shippable-fallback placeholder dropped, capped at `max`.
 *
 * Five is deliberate. A release section is written as 2–5 combined points, so
 * the cap is a guard against a hand-written body rather than a summary of a
 * long list — a modal that scrolls is a modal nobody reads.
 */
export function releaseNoteLines(
  notes: string | null | undefined,
  max = 5,
): string[] {
  if (!notes) return [];
  return stripHtmlComments(notes)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .filter((line) => !line.startsWith("See the assets below"))
    .map((line) => line.replace(/^[-*•]\s+/, ""))
    .map((line) => line.replace(/\*\*(.+?)\*\*/g, "$1"))
    .slice(0, max);
}

/** One row of the What's New card: a short label and what changed. */
export interface ReleaseChange {
  /** The part before the first ": ". Empty when the line has none. */
  label: string;
  change: string;
  /** good = new or improved (arrow up); neutral = worth knowing, not a gain (dash). */
  tone: "good" | "neutral";
}

/** A label is a short theme name — "Sync light", "Health page" — not the start of a sentence. */
const LABELLED = /^([^:.!?]{2,28}):\s+(\S.*)$/;
const NEUTRAL_LABEL = /^(changed|note|heads[- ]?up|deprecated|removed|moved)\b/i;

/**
 * Split a note line written as `Label: what changed` into a card row.
 *
 * `docs/RELEASE_NOTES.md` already asks for themed points ("Sync light: …"), so
 * most lines have a label. A line without one still shows, under an empty label
 * the caller replaces with a generic word, and is never cut: the whole line is
 * the change. A colon later in a long sentence is not a label (the length and
 * punctuation guard), so "Note that 12:30 is now supported" stays one piece.
 */
export function releaseChange(line: string): ReleaseChange {
  const m = LABELLED.exec(line.trim());
  if (!m) return { label: "", change: line.trim(), tone: "good" };
  const label = m[1].trim();
  return { label, change: m[2].trim(), tone: NEUTRAL_LABEL.test(label) ? "neutral" : "good" };
}

/**
 * The release workflows append this to a release body whose version section in
 * `docs/RELEASE_NOTES.md` was left empty: "ship it, but don't announce it". It
 * is an HTML comment, so the GitHub release page never shows it.
 */
export const SILENT_RELEASE_MARKER = "<!-- infinitebrain:silent -->";

/**
 * Should the What's New modal stay closed for this update? Yes when the
 * workflow marked it silent, and yes when there is nothing to list anyway — a
 * modal that says "here's what changed" over an empty list tells the user an
 * update happened and nothing else.
 */
export function isSilentRelease(
  body: string | null | undefined,
  version?: string | null,
): boolean {
  if (body?.includes(SILENT_RELEASE_MARKER)) return true;
  return releaseNoteLines(notesForVersion(body, version)).length === 0;
}

// One answer to "may this URL attribute survive sanitisation?", shared by the
// two sanitizers that need it: `renderEmbeddedHtml` (livePreview.ts, for raw
// HTML in a note) and `sanitizeMermaidSvg` (mermaid/sanitize.ts). They keep
// very different things — mermaid's output is mostly CSS, which the HTML one
// drops outright — but a dangerous scheme is dangerous in both, and a fix
// found in one must not have to be remembered in the other.
//
// Lives in its own module rather than being exported from livePreview.ts so
// the mermaid tree does not import the CodeMirror module that imports it.

/**
 * Is a URL attribute value dangerous to keep? Browsers ignore ASCII whitespace
 * and control chars inside a scheme, so `java\tscript:` executes — strip those
 * before checking, then block script-y schemes and non-image `data:` (which can
 * carry `data:text/html`). A tab/newline no longer defeats the check.
 */
export function isDangerousUrl(raw: string): boolean {
  const v = raw.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  if (v.startsWith("data:")) return !v.startsWith("data:image/");
  return v.startsWith("javascript:") || v.startsWith("vbscript:");
}

// The block widget a ```mermaid fence is replaced with off the active line.
//
// A plain `WidgetType`, not a `ReactWidget`: there is no interactive React tree
// here, so `flushSync` would buy nothing over setting `innerHTML` to a string
// the sanitizer already vetted.
//
// The one contract worth stating: `updateDOM` ALWAYS returns true. CM6 then
// keeps the existing host node when a same-class widget replaces this one, so
// the SVG already on screen SURVIVES an edit to the diagram's source. That is
// what makes "a half-typed diagram keeps showing the last good render" true,
// and what makes a remote teammate typing in the block a soft blur rather than
// a flicker. (`reactWidget.ts` and `table/TableWidget` are the two other block
// widgets that depend on the same behaviour.)
//
// Reveal scope is LINE, inherited from `activeLineChecker` at the call site in
// livePreview.ts: caret anywhere in the fence AND the editor focused → raw
// source, so the widget does not even exist while you type in it. `ignoreEvent`
// is false so a click lands the caret in the fence — click the diagram, get the
// text back.

import { type EditorView, WidgetType } from "@codemirror/view";
import { type DiagramResult, heightFor, rememberHeight, requestDiagram } from "./cache";
import { currentMermaidTheme, mermaidRenderer, type MermaidTheme } from "./renderer";

const HOST_CLASS = "cm-md-mermaid";
/** Shared with the other block replace widgets — see `BLOCK_INSET_CLASS` in
 *  livePreview.ts. Spelled out rather than imported (as `table/TableWidget`
 *  does) so this file does not import the module that imports it. */
const INSET = "cm-block-inset";
const BODY_CLASS = "cm-md-mermaid-body";
const ERROR_CLASS = "cm-md-mermaid-error";
const PLACEHOLDER_CLASS = "cm-md-mermaid-placeholder";

/** Per-host bookkeeping, parked ON the node (the `codeFence.ts` `_revert`
 *  trick): a rebuild replaces the widget object but keeps the node, so a late
 *  async result must be able to ask the NODE whether it is still wanted. */
interface MermaidHost extends HTMLElement {
  _mmdSeq?: number;
  _mmdUnsub?: () => void;
  _mmdSource?: string;
  _mmdView?: EditorView;
}

/** Every mounted host, so a theme flip can repaint them without a transaction. */
const liveHosts = new Set<MermaidHost>();
let themeObserver: MutationObserver | null = null;

function ensureThemeObserver(): void {
  if (themeObserver || typeof MutationObserver === "undefined") return;
  themeObserver = new MutationObserver(() => {
    for (const host of Array.from(liveHosts)) {
      // A node CM6 dropped without calling destroy (a torn-down view) would
      // otherwise leak; prune on the way past.
      if (!host.isConnected) {
        liveHosts.delete(host);
        continue;
      }
      if (host._mmdSource != null) paint(host, host._mmdSource, host._mmdView);
    }
  });
  themeObserver.observe(document.documentElement, { attributeFilter: ["data-theme"] });
}

function bodyOf(host: MermaidHost): HTMLElement {
  let body = host.querySelector(`.${BODY_CLASS}`) as HTMLElement | null;
  if (!body) {
    body = document.createElement("div");
    body.className = BODY_CLASS;
    host.insertBefore(body, host.firstChild);
  }
  return body;
}

function clearError(host: MermaidHost): void {
  host.querySelector(`.${ERROR_CLASS}`)?.remove();
}

function showError(host: MermaidHost, message: string): void {
  let strip = host.querySelector(`.${ERROR_CLASS}`) as HTMLElement | null;
  if (!strip) {
    strip = document.createElement("div");
    strip.className = ERROR_CLASS;
    host.appendChild(strip);
  }
  strip.textContent = message;
}

function hasDrawing(host: MermaidHost): boolean {
  return bodyOf(host).querySelector("svg") !== null;
}

function apply(
  host: MermaidHost,
  result: DiagramResult,
  key: string,
  view: EditorView | undefined,
  measure: boolean,
): void {
  host.removeAttribute("data-pending");
  const body = bodyOf(host);
  if ("svg" in result) {
    body.style.removeProperty("min-height");
    // Already scrubbed by sanitizeMermaidSvg (see its header for why mermaid
    // gets its own pass instead of renderEmbeddedHtml).
    body.innerHTML = result.svg;
    clearError(host);
  } else if (hasDrawing(host)) {
    // Keep the last good render and say what went wrong underneath it.
    showError(host, result.error);
  } else {
    body.style.removeProperty("min-height");
    body.replaceChildren();
    showError(host, result.error);
  }
  if (!measure || !view) return;
  view.requestMeasure({
    read: () => host.getBoundingClientRect().height,
    // jsdom (and a detached editor) measures zero — keep the last good value
    // rather than remembering a collapsed placeholder.
    write: (h: number) => rememberHeight(key, h),
  });
}

function pending(host: MermaidHost, source: string, theme: MermaidTheme): void {
  host.setAttribute("data-pending", "");
  if (hasDrawing(host)) return; // the previous render stays on screen, dimmed
  const body = bodyOf(host);
  const remembered = heightFor(source, theme);
  if (remembered) body.style.minHeight = `${Math.round(remembered)}px`;
  const note = document.createElement("div");
  note.className = PLACEHOLDER_CLASS;
  note.textContent = "Rendering diagram…";
  body.replaceChildren(note);
}

/** Request `source` for this host and swap the result in when it lands. */
function paint(host: MermaidHost, source: string, view: EditorView | undefined): void {
  host._mmdUnsub?.();
  host._mmdUnsub = undefined;
  host._mmdSource = source;
  host._mmdView = view;
  const theme = currentMermaidTheme();
  const seq = (host._mmdSeq = (host._mmdSeq ?? 0) + 1);
  const req = requestDiagram(source, theme, mermaidRenderer());
  if (req.cached) {
    // Synchronous: the host gets its real height on the first frame, so
    // scrolling back to a diagram never flashes a placeholder.
    apply(host, req.cached, req.key, view, false);
    return;
  }
  pending(host, source, theme);
  host._mmdUnsub = req.subscribe((result) => {
    // A newer source (or theme) has claimed this node since — drop the result.
    if (host._mmdSeq !== seq) return;
    host._mmdUnsub = undefined;
    apply(host, result, req.key, host._mmdView, true);
  });
}

export class MermaidWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  /** Source only. The theme is ambient: a flip repaints the live hosts
   *  directly (see the observer above), so it never has to reach a decoration
   *  and livePreview's block memo stays theme-free. */
  eq(other: MermaidWidget): boolean {
    return other.source === this.source;
  }

  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("div") as MermaidHost;
    host.className = `${HOST_CLASS} ${INSET}`;
    liveHosts.add(host);
    ensureThemeObserver();
    paint(host, this.source, view);
    return host;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const host = dom as MermaidHost;
    if (host._mmdSource !== this.source) paint(host, this.source, view);
    // ALWAYS true — see the file header. Returning false would make CM6 rebuild
    // the node and the previous diagram would vanish on every keystroke.
    return true;
  }

  destroy(dom: HTMLElement): void {
    const host = dom as MermaidHost;
    host._mmdUnsub?.();
    host._mmdUnsub = undefined;
    liveHosts.delete(host);
  }

  /** False, so a click reaches the editor and places the caret in the fence. */
  ignoreEvent(): boolean {
    return false;
  }
}

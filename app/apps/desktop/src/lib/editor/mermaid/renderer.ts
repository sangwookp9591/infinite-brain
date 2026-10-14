// The mermaid seam: "a diagram source plus a theme becomes a sanitized SVG
// string", and nothing else. Two reasons it is an interface rather than a
// function that calls mermaid:
//
//  1. LAZY LOADING. Mermaid (with d3, dagre, cytoscape, katex, roughjs) is
//     ~3 MB. The ONLY reference to the package in the whole app is the
//     `await import("mermaid")` below, memoised — so Rollup emits it as its own
//     chunk, fetched from disk the first time a note actually contains a
//     diagram and never at all in a vault without one. It is deliberately NOT
//     in `lib/prefetch.ts` (see the comment there): warming 3 MB for a feature
//     most notes never use is exactly the startup cost the code split removed.
//     Never import this package statically, anywhere.
//  2. TESTS. Mermaid touches the DOM at import time, and the desktop suite runs
//     in `environment: "node"` by default. `setMermaidRenderer` lets every test
//     drive the widget/cache with a fake, so no test ever loads mermaid.

import { sanitizeMermaidSvg } from "./sanitize";

/** Above this, we refuse rather than pay the render. Mermaid's own ceiling
 *  (`maxTextSize`) is 50 000; a note-sized diagram is far under either. */
export const MAX_MERMAID_CHARS = 20000;

export type MermaidTheme = "light" | "dark";

export interface MermaidRenderer {
  /** Resolves to sanitized SVG markup, or rejects with a short human message. */
  render(source: string, theme: MermaidTheme): Promise<string>;
}

/** A failure a human should read: "Diagram error: …", never a stack. */
export class MermaidError extends Error {}

/** Minimal shape of the bits of mermaid's default export we use. */
interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  parse(text: string, opts?: { suppressErrors?: boolean }): Promise<unknown>;
  render(id: string, text: string): Promise<{ svg: string }>;
}

let modulePromise: Promise<MermaidApi> | null = null;
let initializedFor: MermaidTheme | null = null;
let seq = 0;

/** A CSS custom property's computed value, or a fallback outside the app. */
function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Keys a diagram's own `%%{init: …}%%` directive may NOT override.
 *
 * A directive's `themeCSS` lands inside the generated `<style>` element — in a
 * synced vault that is a teammate's CSS running in your editor. Listing these
 * as `secure` makes mermaid ignore a directive that tries to set them. The
 * other half of the defence is `contain: paint` on the widget host (see
 * sanitize.ts's header); both are load-bearing, neither is dead config.
 */
const SECURE_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "themeCSS",
  "themeVariables",
  "theme",
  "htmlLabels",
  "fontFamily",
];

async function loadMermaid(): Promise<MermaidApi> {
  if (!modulePromise) {
    modulePromise = import("mermaid").then((m) => m.default as unknown as MermaidApi);
  }
  return modulePromise;
}

function configure(m: MermaidApi, theme: MermaidTheme): void {
  if (initializedFor === theme) return;
  m.initialize({
    startOnLoad: false,
    // Mermaid runs its own DOMPurify over the output, encodes HTML inside
    // labels and disables click/tooltip directives. Never expose 'loose'.
    securityLevel: "strict",
    // Don't let mermaid inject its own error graphic into the document when a
    // half-typed diagram fails; we own the error UI.
    suppressErrorRendering: true,
    // SVG text/tspan labels instead of HTML inside a foreignObject.
    flowchart: { htmlLabels: false },
    theme: theme === "dark" ? "dark" : "default",
    themeVariables: {
      fontFamily: cssVar("--font-body", "inherit"),
      background: cssVar("--bg-surface", "transparent"),
    },
    secure: SECURE_KEYS,
  });
  initializedFor = theme;
}

/** Trim mermaid's multi-line parser output down to one readable line. */
function shortMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const first = raw.split("\n").find((l) => l.trim().length > 0) ?? "could not be drawn";
  return first.trim().slice(0, 160);
}

const lazyRenderer: MermaidRenderer = {
  async render(source, theme) {
    if (source.length > MAX_MERMAID_CHARS) {
      throw new MermaidError("Diagram too large to render");
    }
    let m: MermaidApi;
    try {
      m = await loadMermaid();
    } catch {
      throw new MermaidError("Diagram renderer could not be loaded");
    }
    configure(m, theme);
    // Validate FIRST, so a half-typed diagram never reaches the renderer.
    // `suppressErrors` resolves `false` instead of throwing; older versions
    // resolve a boolean, newer ones an object — only an explicit `false` is a
    // syntax error.
    try {
      if ((await m.parse(source, { suppressErrors: true })) === false) {
        throw new MermaidError("Diagram error: check the syntax");
      }
    } catch (err) {
      throw err instanceof MermaidError ? err : new MermaidError(`Diagram error: ${shortMessage(err)}`);
    }
    try {
      // The id must be a unique, valid CSS id: with no container argument
      // mermaid parks a temporary `div#d<id>` on document.body and removes it.
      const { svg } = await m.render(`baalda-mermaid-${++seq}`, source);
      return sanitizeMermaidSvg(svg);
    } catch (err) {
      throw new MermaidError(`Diagram error: ${shortMessage(err)}`);
    }
  },
};

let override: MermaidRenderer | null = null;

/** Tests only: swap in a fake so mermaid itself is never imported. */
export function setMermaidRenderer(r: MermaidRenderer | null): void {
  override = r;
}

export function mermaidRenderer(): MermaidRenderer {
  return override ?? lazyRenderer;
}

/** The theme a diagram should be drawn for, read off `<html data-theme>`. */
export function currentMermaidTheme(): MermaidTheme {
  try {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

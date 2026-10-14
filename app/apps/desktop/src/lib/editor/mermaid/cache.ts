// Everything that makes an ASYNC renderer behave inside a SYNCHRONOUS widget:
// the result cache, in-flight de-duplication, the debounce, and the remembered
// heights. No DOM in this file, so it tests in plain Node with fake timers.
//
// Why each piece exists:
//  - CACHE. `toDOM` cannot await. A cache hit fills the host synchronously with
//    the right height, so scrolling a diagram back into view, reopening a note
//    or editing a paragraph three screens away repaints with zero flicker.
//    Errors are cached too, keyed by source — otherwise a broken diagram pays a
//    full mermaid round trip on every single rebuild. Fixing the diagram
//    changes the key, so a cached error can never be stale.
//  - DEDUPE. Two widgets showing the same diagram (or one widget rebuilt twice
//    in a frame) call mermaid once.
//  - DEBOUNCE. The case this protects is not your own typing — while your caret
//    is inside a fence the widget does not exist at all. It is a REMOTE
//    teammate, or an MCP/AI write, typing inside the block while you look at
//    it: every remote keystroke rebuilds the widget, and without the delay that
//    is one mermaid render per keystroke.
//  - HEIGHTS. A cache miss renders a placeholder; sizing it from the last
//    measured height of the same key keeps the scroll from jumping when the SVG
//    lands.

import { MAX_MERMAID_CHARS, type MermaidRenderer, type MermaidTheme } from "./renderer";

export type DiagramResult = { svg: string } | { error: string };

/** How long a cache miss waits before it actually calls mermaid. */
export const RENDER_DELAY_MS = 300;

/** Results kept. Small: a note with 50 distinct diagrams is not a thing. */
const CACHE_LIMIT = 50;

type Listener = (r: DiagramResult) => void;

interface Pending {
  timer: ReturnType<typeof setTimeout> | null;
  started: boolean;
  listeners: Set<Listener>;
}

const results = new Map<string, DiagramResult>();
const pending = new Map<string, Pending>();
const heights = new Map<string, number>();

/** The cache key: a diagram is a function of its source AND the theme. */
export function diagramKey(source: string, theme: MermaidTheme): string {
  return `${theme}\u0000${source}`;
}

function remember(key: string, r: DiagramResult): void {
  results.delete(key);
  results.set(key, r);
  // Map preserves insertion order, so the first key is the least recently used.
  while (results.size > CACHE_LIMIT) {
    const oldest = results.keys().next();
    if (oldest.done) break;
    results.delete(oldest.value);
  }
}

function lookup(key: string): DiagramResult | null {
  const hit = results.get(key);
  if (!hit) return null;
  // Touch, so the LRU keeps what is on screen.
  results.delete(key);
  results.set(key, hit);
  return hit;
}

/**
 * Ask for a diagram. The result is either already cached (use it synchronously)
 * or arrives through `subscribe`, whose disposer must be called when the widget
 * goes away: the last unsubscribe before the renderer has actually started
 * cancels the render outright.
 */
export function requestDiagram(
  source: string,
  theme: MermaidTheme,
  renderer: MermaidRenderer,
  opts: { delayMs?: number } = {},
): { key: string; cached: DiagramResult | null; subscribe(cb: Listener): () => void } {
  const key = diagramKey(source, theme);
  // Refuse before scheduling anything: an oversize source is a permanent,
  // free answer, not a render to debounce.
  if (source.length > MAX_MERMAID_CHARS) {
    return {
      key,
      cached: { error: "Diagram too large to render" },
      subscribe: () => () => {},
    };
  }
  const cached = lookup(key);
  if (cached) return { key, cached, subscribe: () => () => {} };

  const delayMs = opts.delayMs ?? RENDER_DELAY_MS;
  return {
    key,
    cached: null,
    subscribe(cb) {
      let entry = pending.get(key);
      if (!entry) {
        const fresh: Pending = { timer: null, started: false, listeners: new Set() };
        fresh.timer = setTimeout(() => {
          fresh.timer = null;
          fresh.started = true;
          void renderer
            .render(source, theme)
            .then(
              (svg): DiagramResult => ({ svg }),
              (err): DiagramResult => ({
                error: err instanceof Error ? err.message : "Diagram could not be drawn",
              }),
            )
            .then((result) => {
              pending.delete(key);
              remember(key, result);
              // Copy: a listener may unsubscribe (widget destroyed) as it runs.
              for (const fn of Array.from(fresh.listeners)) fn(result);
              fresh.listeners.clear();
            });
        }, delayMs);
        pending.set(key, fresh);
        entry = fresh;
      }
      entry.listeners.add(cb);
      const live = entry;
      return () => {
        live.listeners.delete(cb);
        // Nobody is waiting any more and mermaid was never called — drop it.
        if (live.listeners.size === 0 && !live.started && live.timer !== null) {
          clearTimeout(live.timer);
          live.timer = null;
          pending.delete(key);
        }
      };
    },
  };
}

/** Record a rendered diagram's measured height, for the next placeholder. */
export function rememberHeight(key: string, px: number): void {
  if (px > 0) heights.set(key, px);
}

/** The last measured height for this diagram, if we have ever drawn it. */
export function heightFor(source: string, theme: MermaidTheme): number | null {
  return heights.get(diagramKey(source, theme)) ?? null;
}

/** Tests only: forget everything. */
export function resetDiagramCache(): void {
  for (const entry of pending.values()) {
    if (entry.timer !== null) clearTimeout(entry.timer);
  }
  results.clear();
  pending.clear();
  heights.clear();
}

// The async plumbing behind a synchronous widget: debounce, de-dupe, cache,
// cancel. No DOM here — this is the half of the mermaid feature that can be
// reasoned about with fake timers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { heightFor, rememberHeight, requestDiagram, resetDiagramCache } from "./cache";
import { MAX_MERMAID_CHARS, type MermaidRenderer } from "./renderer";

/** A renderer that counts its calls and never touches mermaid. */
function fakeRenderer(impl?: (src: string) => Promise<string>) {
  const calls: string[] = [];
  const renderer: MermaidRenderer = {
    render(source) {
      calls.push(source);
      return impl ? impl(source) : Promise.resolve(`<svg>${source}</svg>`);
    },
  };
  return { renderer, calls };
}

beforeEach(() => {
  resetDiagramCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  resetDiagramCache();
});

describe("requestDiagram", () => {
  it("waits out the debounce before calling the renderer", async () => {
    const { renderer, calls } = fakeRenderer();
    const got: unknown[] = [];
    requestDiagram("graph TD; A-->B", "light", renderer).subscribe((r) => got.push(r));
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(299);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(["graph TD; A-->B"]);
    expect(got).toEqual([{ svg: "<svg>graph TD; A-->B</svg>" }]);
  });

  it("de-dupes two requests for the same diagram into one render", async () => {
    const { renderer, calls } = fakeRenderer();
    const a: unknown[] = [];
    const b: unknown[] = [];
    requestDiagram("pie", "light", renderer).subscribe((r) => a.push(r));
    requestDiagram("pie", "light", renderer).subscribe((r) => b.push(r));
    await vi.advanceTimersByTimeAsync(300);
    expect(calls).toHaveLength(1);
    // …and BOTH widgets are told.
    expect(a).toEqual([{ svg: "<svg>pie</svg>" }]);
    expect(b).toEqual(a);
  });

  it("never calls the renderer when the last subscriber leaves first", async () => {
    // The widget was destroyed (scrolled away, note closed) inside the debounce.
    const { renderer, calls } = fakeRenderer();
    const off = requestDiagram("gantt", "light", renderer).subscribe(() => {});
    off();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(0);
  });

  it("serves a second ask from cache, synchronously", async () => {
    const { renderer, calls } = fakeRenderer();
    requestDiagram("flowchart", "light", renderer).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(300);
    const again = requestDiagram("flowchart", "light", renderer);
    expect(again.cached).toEqual({ svg: "<svg>flowchart</svg>" });
    expect(calls).toHaveLength(1);
  });

  it("keys on the theme, so a flip re-renders rather than reusing light CSS", async () => {
    const { renderer, calls } = fakeRenderer();
    requestDiagram("flowchart", "light", renderer).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(300);
    expect(requestDiagram("flowchart", "dark", renderer).cached).toBeNull();
    requestDiagram("flowchart", "dark", renderer).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(300);
    expect(calls).toHaveLength(2);
  });

  it("caches an error too, so a broken diagram does not re-run mermaid forever", async () => {
    const { renderer, calls } = fakeRenderer(() => Promise.reject(new Error("Diagram error: nope")));
    const got: unknown[] = [];
    requestDiagram("broken", "light", renderer).subscribe((r) => got.push(r));
    await vi.advanceTimersByTimeAsync(300);
    expect(got).toEqual([{ error: "Diagram error: nope" }]);
    const again = requestDiagram("broken", "light", renderer);
    expect(again.cached).toEqual({ error: "Diagram error: nope" });
    expect(calls).toHaveLength(1);
    // Fixing the diagram changes the key, so a cached error can never be stale.
    expect(requestDiagram("broken!", "light", renderer).cached).toBeNull();
  });

  it("refuses an oversize source without scheduling anything", async () => {
    const { renderer, calls } = fakeRenderer();
    const req = requestDiagram("x".repeat(MAX_MERMAID_CHARS + 1), "light", renderer);
    expect(req.cached).toEqual({ error: "Diagram too large to render" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(0);
  });

  it("evicts the least recently used entry past the cap", async () => {
    const { renderer } = fakeRenderer();
    // 51 distinct diagrams; the cap is 50, so the FIRST one falls out.
    for (let i = 0; i <= 50; i++) {
      requestDiagram(`d${i}`, "light", renderer).subscribe(() => {});
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(requestDiagram("d0", "light", renderer).cached).toBeNull();
    expect(requestDiagram("d50", "light", renderer).cached).not.toBeNull();
  });
});

describe("remembered heights", () => {
  it("records a measured height per key and ignores a collapsed one", () => {
    const req = requestDiagram("seq", "light", fakeRenderer().renderer);
    expect(heightFor("seq", "light")).toBeNull();
    // jsdom measures 0 — that must never become the next placeholder's size.
    rememberHeight(req.key, 0);
    expect(heightFor("seq", "light")).toBeNull();
    rememberHeight(req.key, 240);
    expect(heightFor("seq", "light")).toBe(240);
    expect(heightFor("seq", "dark")).toBeNull();
  });
});

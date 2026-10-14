// @vitest-environment jsdom
//
// The mermaid block widget, driven through the REAL editor extension stack —
// a fence only becomes a diagram if livePreview's StateField, the reveal scope
// and the widget all agree.
//
// A fake renderer is injected with `setMermaidRenderer`, so mermaid itself is
// never imported here: it touches the DOM at import time and weighs ~3 MB, and
// the whole point of the injectable seam is that the test suite never pays for
// either.

import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditorState } from "../index";
import { setFocused } from "../reveal";
import { resetDiagramCache } from "./cache";
import { type MermaidRenderer, setMermaidRenderer } from "./renderer";

function mount(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: createEditorState({ doc, getTitles: () => [], onNavigate: () => {} } as never),
    parent,
  });
}

/** Longer than the cache's 300 ms debounce, so the render has actually run. */
function settle(ms = 380): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function install(impl: (src: string) => Promise<string>) {
  const calls: string[] = [];
  const r: MermaidRenderer = {
    render(source) {
      calls.push(source);
      return impl(source);
    },
  };
  setMermaidRenderer(r);
  return calls;
}

const FENCE = ["Intro.", "", "```mermaid", "flowchart TD", "  A-->B", "```", "", "Tail."].join("\n");

beforeEach(() => {
  resetDiagramCache();
});

afterEach(() => {
  setMermaidRenderer(null);
  resetDiagramCache();
  document.body.replaceChildren();
});

describe("mermaid block widget", () => {
  it("replaces a blurred ```mermaid fence with an inset block host", () => {
    install(() => Promise.resolve("<svg><rect/></svg>"));
    const view = mount(FENCE);
    const host = view.contentDOM.querySelector(".cm-md-mermaid") as HTMLElement;
    expect(host).not.toBeNull();
    // Block replace widgets are direct children of .cm-content and miss the
    // `.cm-line` inset, so they must carry the shared class by hand.
    expect(host.classList.contains("cm-block-inset")).toBe(true);
    expect(host.parentElement).toBe(view.contentDOM);
    // Nothing has resolved yet: a placeholder, not an empty hole.
    expect(host.querySelector(".cm-md-mermaid-placeholder")).not.toBeNull();
    view.destroy();
  });

  it("swaps the rendered SVG in once it lands", async () => {
    install(() => Promise.resolve('<svg id="d"><rect/></svg>'));
    const view = mount(FENCE);
    await settle();
    const host = view.contentDOM.querySelector(".cm-md-mermaid")!;
    expect(host.querySelector("svg")).not.toBeNull();
    expect(host.querySelector(".cm-md-mermaid-placeholder")).toBeNull();
    expect(host.hasAttribute("data-pending")).toBe(false);
    view.destroy();
  });

  it("passes the fence BODY to the renderer, never the fence lines", async () => {
    const calls = install(() => Promise.resolve("<svg/>"));
    const view = mount(FENCE);
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("flowchart TD");
    expect(calls[0]).toContain("A-->B");
    expect(calls[0]).not.toContain("```");
    expect(calls[0]).not.toContain("Intro.");
    view.destroy();
  });

  it("shows raw source while the caret is inside the fence", () => {
    install(() => Promise.resolve("<svg/>"));
    const view = mount(FENCE);
    // Focus first: a BLURRED editor has no active line at all (reveal.ts), so
    // an unfocused caret would leave the diagram rendered — which is the point.
    view.dispatch({ effects: setFocused.of(true) });
    view.dispatch({ selection: { anchor: FENCE.indexOf("flowchart") } });
    expect(view.contentDOM.querySelector(".cm-md-mermaid")).toBeNull();
    const text = Array.from(view.contentDOM.querySelectorAll(".cm-line"))
      .map((l) => l.textContent ?? "")
      .join("\n");
    expect(text).toContain("```mermaid");
    expect(text).toContain("flowchart TD");
    // …and the diagram comes back when the caret leaves.
    view.dispatch({ selection: { anchor: 0 } });
    expect(view.contentDOM.querySelector(".cm-md-mermaid")).not.toBeNull();
    view.destroy();
  });

  it("leaves an error strip when the renderer refuses", async () => {
    install(() => Promise.reject(new Error("Diagram error: unexpected token")));
    const view = mount(FENCE);
    await settle();
    const host = view.contentDOM.querySelector(".cm-md-mermaid")!;
    expect(host.querySelector(".cm-md-mermaid-error")?.textContent).toBe(
      "Diagram error: unexpected token",
    );
    expect(host.querySelector("svg")).toBeNull();
    view.destroy();
  });

  it("keeps the last good render on screen while a half-typed edit re-renders", async () => {
    // THE `updateDOM` PIN. CM6 calls updateDOM for a same-class block widget,
    // and ours returns true unconditionally — so the host node (and the SVG in
    // it) survives the edit. Returning false would rebuild the node and blank
    // the diagram on every keystroke, which is exactly the flicker this
    // feature is supposed to not have. A remote teammate typing in the block
    // is the case that makes it visible.
    const deferred: { resolve?: (svg: string) => void } = {};
    install((src) =>
      src.includes("A-->BC")
        ? new Promise<string>((r) => {
            deferred.resolve = r;
          })
        : Promise.resolve('<svg id="good"><rect/></svg>'),
    );
    const view = mount(FENCE);
    await settle();
    const host = view.contentDOM.querySelector(".cm-md-mermaid")!;
    expect(host.querySelector("svg")!.id).toBe("good");

    // A remote/AI edit inside the block, caret elsewhere.
    const at = FENCE.indexOf("A-->B") + "A-->B".length;
    view.dispatch({ changes: { from: at, insert: "C" } });
    const after = view.contentDOM.querySelector(".cm-md-mermaid")!;
    // Same node, same SVG — dimmed, not dropped.
    expect(after).toBe(host);
    expect(after.querySelector("svg")!.id).toBe("good");
    await settle();
    expect(after.hasAttribute("data-pending")).toBe(true);
    expect(after.querySelector("svg")!.id).toBe("good");
    deferred.resolve?.('<svg id="next"><rect/></svg>');
    await settle(20);
    expect(after.querySelector("svg")!.id).toBe("next");
    expect(after.hasAttribute("data-pending")).toBe(false);
    view.destroy();
  });

  it("renders two identical diagrams with one call to the renderer", async () => {
    const calls = install(() => Promise.resolve("<svg/>"));
    const twice = [
      "```mermaid",
      "flowchart TD",
      "  A-->B",
      "```",
      "",
      "```mermaid",
      "flowchart TD",
      "  A-->B",
      "```",
    ].join("\n");
    const view = mount(twice);
    await settle();
    expect(view.contentDOM.querySelectorAll(".cm-md-mermaid")).toHaveLength(2);
    expect(calls).toHaveLength(1);
    view.destroy();
  });

  it("leaves a plain code fence as source, with its copy button", () => {
    install(() => Promise.resolve("<svg/>"));
    const view = mount("```js\nconst a = 1;\n```");
    expect(view.contentDOM.querySelector(".cm-md-mermaid")).toBeNull();
    expect(view.contentDOM.querySelector(".cm-fence-copy")).not.toBeNull();
    view.destroy();
  });
});

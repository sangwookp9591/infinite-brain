// The single authority over which fences render instead of showing source.
// Three call sites depend on it agreeing with itself (livePreview's block field
// and inline plugin, codeFence's Copy button); a fence that renders in one and
// not the others is either a Copy button floating over a diagram or an unstyled
// fence body bleeding through a widget.

import { describe, expect, it } from "vitest";
import { fenceRenderKind } from "./fenceKind";

describe("fenceRenderKind", () => {
  it("claims mermaid fences", () => {
    expect(fenceRenderKind("mermaid")).toBe("mermaid");
    expect(fenceRenderKind("mmd")).toBe("mermaid");
  });

  it("ignores case and surrounding whitespace", () => {
    expect(fenceRenderKind("  MERMAID ")).toBe("mermaid");
    expect(fenceRenderKind("\tHtml")).toBe("html");
  });

  it("reads only the first word, so fence attributes do not hide the language", () => {
    expect(fenceRenderKind("mermaid {theme:dark}")).toBe("mermaid");
    expect(fenceRenderKind("html title=example")).toBe("html");
  });

  it("keeps claiming the html fences it inherited", () => {
    expect(fenceRenderKind("html")).toBe("html");
    expect(fenceRenderKind("htm")).toBe("html");
  });

  it("leaves plain code fences alone", () => {
    expect(fenceRenderKind("js")).toBeNull();
    expect(fenceRenderKind("typescript")).toBeNull();
    expect(fenceRenderKind("")).toBeNull();
    expect(fenceRenderKind("   ")).toBeNull();
    // Near misses must not render: `mermaidjs` is not a mermaid fence.
    expect(fenceRenderKind("mermaidjs")).toBeNull();
    expect(fenceRenderKind("htmlx")).toBeNull();
  });
});

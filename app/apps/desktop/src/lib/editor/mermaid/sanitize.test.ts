// @vitest-environment jsdom
//
// The mermaid-only SVG scrubber. It exists because the app's general HTML
// sanitizer (renderEmbeddedHtml) drops `<style>` and every `style=` — which is
// mermaid's entire visual output. So this file pins BOTH halves of the bargain:
// the CSS survives, and nothing executable does.

import { describe, expect, it } from "vitest";
import { sanitizeMermaidSvg } from "./sanitize";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("sanitizeMermaidSvg", () => {
  it("keeps the <style> element mermaid scopes its CSS in", () => {
    const out = sanitizeMermaidSvg(
      '<svg id="d1"><style>#d1 .node rect{fill:#eee}</style><rect/></svg>',
    );
    const style = parse(out).querySelector("style");
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain("fill:#eee");
  });

  it("keeps style= attributes — they are how mermaid paints every node", () => {
    const out = sanitizeMermaidSvg('<svg><g style="fill:red;stroke:blue"><path/></g></svg>');
    expect(parse(out).querySelector("g")!.getAttribute("style")).toBe("fill:red;stroke:blue");
  });

  it("drops a <script>, including a lowercase SVG one", () => {
    // In foreign (SVG) content `tagName` is lowercase, so a case-sensitive
    // blocklist would sail straight past this.
    const out = sanitizeMermaidSvg('<svg><script>alert(1)</script><rect/></svg>');
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out.toLowerCase()).not.toContain("alert(1)");
    expect(parse(out).querySelector("rect")).not.toBeNull();
  });

  it("drops iframes, objects, embeds, links, meta and base", () => {
    const out = sanitizeMermaidSvg(
      '<svg><iframe src="x"></iframe><object></object><embed/>' +
        '<link rel="stylesheet" href="x"><meta charset="utf-8"><base href="/"><rect/></svg>',
    );
    const doc = parse(out);
    for (const tag of ["iframe", "object", "embed", "link", "meta", "base"]) {
      expect(doc.querySelector(tag)).toBeNull();
    }
    expect(doc.querySelector("rect")).not.toBeNull();
  });

  it("drops every on* handler", () => {
    const out = sanitizeMermaidSvg(
      '<svg><rect onclick="steal()" onmouseover="x()" ONLOAD="y()" fill="red"/></svg>',
    );
    const rect = parse(out).querySelector("rect")!;
    expect(rect.getAttribute("onclick")).toBeNull();
    expect(rect.getAttribute("onmouseover")).toBeNull();
    expect(rect.getAttribute("onload")).toBeNull();
    // …and leaves the honest attributes alone.
    expect(rect.getAttribute("fill")).toBe("red");
  });

  it("drops a javascript: href, and one broken up by a tab", () => {
    // Browsers ignore ASCII whitespace inside a scheme, so `java\tscript:`
    // still executes — the check strips control chars before testing.
    const out = sanitizeMermaidSvg(
      '<svg><a href="javascript:alert(1)"><rect/></a>' +
        '<a xlink:href="java\tscript:alert(2)"><circle/></a>' +
        '<a href="https://example.com"><ellipse/></a></svg>',
    );
    const anchors = Array.from(parse(out).querySelectorAll("a"));
    expect(anchors[0].getAttribute("href")).toBeNull();
    expect(anchors[1].getAttribute("xlink:href")).toBeNull();
    // A real link survives: mermaid emits those for `click … href` directives.
    expect(anchors[2].getAttribute("href")).toBe("https://example.com");
  });

  it("drops a data:text/html URL but keeps a data: image", () => {
    const out = sanitizeMermaidSvg(
      '<svg><image href="data:text/html;base64,AA"/>' +
        '<image id="ok" href="data:image/png;base64,AA"/></svg>',
    );
    const images = Array.from(parse(out).querySelectorAll("image"));
    expect(images[0].getAttribute("href")).toBeNull();
    expect(images[1].getAttribute("href")).toBe("data:image/png;base64,AA");
  });

  it("keeps a foreignObject but scrubs what is inside it", () => {
    // KaTeX math labels land in a foreignObject; it must survive, and its
    // descendants must get exactly the same treatment as the rest of the tree.
    const out = sanitizeMermaidSvg(
      '<svg><foreignObject width="10" height="10">' +
        '<div style="color:red" onclick="boom()">x<script>bad()</script></div>' +
        "</foreignObject></svg>",
    );
    const doc = parse(out);
    const fo = doc.querySelector("foreignObject");
    expect(fo).not.toBeNull();
    expect(fo!.getAttribute("width")).toBe("10");
    const div = doc.querySelector("foreignObject div")!;
    expect(div.getAttribute("onclick")).toBeNull();
    expect(div.getAttribute("style")).toBe("color:red");
    expect(out.toLowerCase()).not.toContain("bad()");
  });
});

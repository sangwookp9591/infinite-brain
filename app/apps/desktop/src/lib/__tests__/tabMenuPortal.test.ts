import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The tab right-click menu must be portalled out of the header.
 *
 * `.main-header` is a size container (`container-type: inline-size`), and that
 * gives it layout containment: every `position: fixed` descendant is then placed
 * against the header, not the window, and paints in the header's stacking
 * context, UNDER the editor sheet that follows it. The menu showed up displaced
 * with only its first row visible. This suite runs without a DOM, so it guards
 * the two facts the bug needs rather than rendering it: the header is still a
 * container, and TabBar still portals its menu to <body>.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("tab context menu", () => {
  it("is rendered through a portal to document.body", () => {
    const src = read("../../components/TabBar.tsx");
    expect(src).toMatch(/import \{ createPortal \} from "react-dom"/);
    expect(src).toMatch(/createPortal\(\s*<ul\s+className="context-menu"/);
    expect(src).toMatch(/document\.body/);
  });

  it("still needs the portal while the header is a size container", () => {
    const css = read("../../App.css");
    // Any `.main-header { … }` rule (there is also a platform-specific one).
    const rules = [...css.matchAll(/(?:^|\n)\.main-header\s*\{[^}]*\}/g)].map((m) => m[0]);
    // If this ever stops being true the portal is merely harmless, not required.
    expect(rules.some((r) => /container-type:\s*inline-size/.test(r))).toBe(true);
  });
});

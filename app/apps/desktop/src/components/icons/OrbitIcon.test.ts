// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ORBIT_ICON_NAMES, OrbitIcon } from "./OrbitIcon";

describe("OrbitIcon", () => {
  it("renders every glyph as a 1.5px round line icon in currentColor", () => {
    expect(ORBIT_ICON_NAMES.length).toBeGreaterThan(10);
    for (const name of ORBIT_ICON_NAMES) {
      const html = renderToStaticMarkup(createElement(OrbitIcon, { name }));
      expect(html).toContain('stroke-width="1.5"');
      expect(html).toContain('stroke="currentColor"');
      expect(html).toContain('stroke-linecap="round"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toMatch(/<path d="M[^"]+"/);
    }
  });
});

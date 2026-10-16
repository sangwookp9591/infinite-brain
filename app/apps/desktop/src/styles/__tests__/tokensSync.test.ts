// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const block = (selector: string) => {
  const start = withoutComments.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return withoutComments.slice(start, withoutComments.indexOf("}", start));
};
const names = (text: string) => new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

describe("design tokens", () => {
  it("keeps explicit dark and pre-hydration fallback token names in sync", () => {
    expect(names(block('[data-theme="dark"]'))).toEqual(
      names(block(':root:not([data-theme="light"]):not([data-theme="dark"])')),
    );
  });

  it("defines every kit CSS variable in the light root", () => {
    const root = names(block(":root"));
    const kit = new URL("../../components/kit/", import.meta.url);
    const styles = readdirSync(kit).filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(new URL(file, kit), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
    const used = styles.flatMap((text) => [...text.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    const local = new Set(styles.flatMap((text) => [...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])));
    expect([...new Set(used)].filter((name) => !root.has(name) && !local.has(name))).toEqual([]);
  });
});

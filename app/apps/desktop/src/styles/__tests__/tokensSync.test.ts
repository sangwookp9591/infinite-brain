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
    const used = readdirSync(kit).filter((file) => file.endsWith(".css"))
      .flatMap((file) => [...readFileSync(new URL(file, kit), "utf8").matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    expect([...new Set(used)].filter((name) => !root.has(name))).toEqual([]);
  });
});

describe("Orbit default palette", () => {
  const hexIn = (text: string, name: string) => {
    const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(text);
    expect(m, name).not.toBeNull();
    return m![1];
  };
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const themes = {
    light: block(":root"),
    dark: block('[data-theme="dark"]'),
    "pre-hydration dark": block(':root:not([data-theme="light"]):not([data-theme="dark"])'),
  };

  for (const [name, text] of Object.entries(themes)) {
    it(`${name}: text pairs reach 4.5:1`, () => {
      const t = (token: string) => hexIn(text, token);
      for (const bg of ["--bg-app", "--bg-surface", "--bg-subtle"]) {
        for (const fg of ["--text-primary", "--text-secondary", "--text-tertiary"]) {
          expect(ratio(t(fg), t(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(ratio(t("--text-on-accent"), t("--accent"))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t("--text-on-accent"), t("--accent-hover"))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t("--text-on-accent"), t("--danger"))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t("--accent"), t("--bg-surface"))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t("--accent"), t("--accent-soft"))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t("--link"), t("--bg-surface"))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t("--danger"), t("--bg-surface"))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("matches the design-lab Orbit palette", () => {
    expect(hexIn(themes.light, "--accent").toLowerCase()).toBe("#4a3fd4");
    expect(hexIn(themes.dark, "--accent").toLowerCase()).toBe("#a29bff");
    expect(hexIn(themes.dark, "--bg-surface").toLowerCase()).toBe("#141830");
  });

  it("bundles only local, OFL fonts and respects reduced motion", () => {
    expect(css).toMatch(/--font-body:\s*"Geist",\s*"Pretendard"/);
    expect(css).toMatch(/--font-display:\s*"Fraunces"/);
    expect(css).toMatch(/--font-mono:\s*"Geist Mono"/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    const dir = new URL("../../assets/fonts/", import.meta.url);
    expect(readFileSync(new URL("fonts.css", dir), "utf8")).not.toMatch(/https?:\/\//);
    for (const license of ["Pretendard", "Fraunces", "Geist"]) {
      expect(readdirSync(dir)).toContain(`OFL-${license}.txt`);
    }
  });
});

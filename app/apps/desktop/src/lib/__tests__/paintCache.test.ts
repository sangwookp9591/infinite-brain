// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAINT_CACHE_KEY, readPaintCache } from "../paintCache";
import { applyAccent } from "../theme";
import { accentPalette } from "../accent";

const accentVars = {
  "--accent-custom-light": "#3b74d1",
  "--accent-custom-light-hover": "#2b64c1",
  "--on-accent-custom-light": "#ffffff",
  "--accent-custom-dark": "#83b2fe",
  "--accent-custom-dark-hover": "#93c2fe",
  "--on-accent-custom-dark": "#18181b",
};
const cache = { theme: "dark", accentVars };

describe("readPaintCache", () => {
  it("round-trips a complete custom palette and the ink default", () => {
    expect(readPaintCache(JSON.stringify(cache))).toEqual(cache);
    expect(readPaintCache(JSON.stringify({ theme: "system", accentVars: null })))
      .toEqual({ theme: "system", accentVars: null });
  });

  it.each([null, "{", "null", "[]", "3", '{}', '{"theme":"neon"}'])("ignores malformed cache %s", (raw) => {
    expect(readPaintCache(raw)).toBeNull();
  });

  it.each([
    { ...accentVars, "--bg-app": "#ffffff" },
    { ...accentVars, "--accent-custom-light": "url(https://example.com)" },
    { ...accentVars, "--accent-custom-light": "#FFFFFF" },
    { "--accent-custom-light": "#3b74d1" },
    {}, [], "#3b74d1", 3,
  ])("drops an invalid or incomplete palette while preserving the theme", (invalid) => {
    expect(readPaintCache(JSON.stringify({ theme: "dark", accentVars: invalid })))
      .toEqual({ theme: "dark", accentVars: null });
  });
});

describe("applyAccent", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sets both theme pairs, replaces a custom seed, then removes all six properties for Ink", () => {
    const properties = new Map<string, string>();
    const attributes = new Map<string, string>();
    vi.stubGlobal("document", { documentElement: {
      setAttribute: (key: string, value: string) => attributes.set(key, value),
      removeAttribute: (key: string) => attributes.delete(key),
      style: {
        setProperty: (key: string, value: string) => properties.set(key, value),
        removeProperty: (key: string) => properties.delete(key),
      },
    } });
    applyAccent("#3b74d1");
    const palette = accentPalette("#3b74d1");
    expect(properties.size).toBe(6);
    expect(properties.get("--accent-custom-light")).toBe(palette.light.accent);
    expect(properties.get("--on-accent-custom-dark")).toBe(palette.dark.onAccent);
    expect(attributes.get("data-accent")).toBe("custom");
    applyAccent("#ffff00");
    expect(properties.get("--accent-custom-light")).toBe(accentPalette("#ffff00").light.accent);
    applyAccent("ink");
    expect(properties.size).toBe(0);
    expect(attributes.has("data-accent")).toBe(false);
  });
});

describe("first paint inline script", () => {
  const html = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const paint = (raw: string | null, legacy = "light", osDark = false) => {
    const attributes = new Map<string, string>();
    const vars = new Map<string, string>();
    runInNewContext(script, {
      localStorage: { getItem: (key: string) => key === PAINT_CACHE_KEY ? raw : legacy },
      window: { matchMedia: () => ({ matches: osDark }) },
      document: { documentElement: {
        setAttribute: (key: string, value: string) => attributes.set(key, value),
        style: { setProperty: (key: string, value: string) => vars.set(key, value) },
      } },
    });
    return { attributes: Object.fromEntries(attributes), vars: Object.fromEntries(vars) };
  };

  it("paints cached dark custom colours before modules run", () => {
    expect(paint(JSON.stringify(cache))).toEqual({
      attributes: { "data-theme": "dark", "data-accent": "custom" }, vars: accentVars,
    });
  });

  it("uses the legacy theme after malformed JSON and resolves system", () => {
    expect(paint("{", "dark").attributes["data-theme"]).toBe("dark");
    expect(paint(JSON.stringify({ theme: "system", accentVars: null }), "light", true)
      .attributes["data-theme"]).toBe("dark");
  });

  it("rejects the whole palette before writing any property", () => {
    expect(paint(JSON.stringify({ ...cache, accentVars: { ...accentVars, "--bad": "#ffffff" } })))
      .toEqual({ attributes: { "data-theme": "dark" }, vars: {} });
    expect(paint(JSON.stringify({ ...cache, accentVars: {} })).vars).toEqual({});
  });
});

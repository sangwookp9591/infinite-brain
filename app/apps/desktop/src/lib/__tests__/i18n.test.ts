// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readLocaleChoice, resolveLocale, resolveSystemLocale, translate } from "../i18n";
import { ko, KO_PARTS } from "../i18n/ko";

describe("language choice", () => {
  it("follows the system language, Korean or English, and falls back to English", () => {
    expect(resolveSystemLocale(["ko-KR", "en-US"])).toBe("ko");
    expect(resolveSystemLocale(["en-GB"])).toBe("en");
    expect(resolveSystemLocale(["ja-JP", "ko"])).toBe("ko"); // first supported one wins
    expect(resolveSystemLocale(["fr-FR"])).toBe("en");
    expect(resolveSystemLocale(undefined)).toBe("en");
  });

  it("an explicit choice beats the system language", () => {
    expect(resolveLocale("en", ["ko-KR"])).toBe("en");
    expect(resolveLocale("ko", ["en-US"])).toBe("ko");
    expect(resolveLocale("system", ["ko-KR"])).toBe("ko");
  });

  it("reads a stored choice and ignores junk or blocked storage", () => {
    expect(readLocaleChoice({ getItem: () => "ko" })).toBe("ko");
    expect(readLocaleChoice({ getItem: () => "xx" })).toBe("system");
    expect(readLocaleChoice({ getItem: () => null })).toBe("system");
    expect(readLocaleChoice({ getItem: () => { throw new Error("blocked"); } })).toBe("system");
    expect(readLocaleChoice(null)).toBe("system");
  });
});

describe("translate", () => {
  it("translates, and shows the English text for anything not translated", () => {
    expect(translate("ko", "Appearance")).toBe("화면 설정");
    expect(translate("ko", "A string nobody translated yet")).toBe("A string nobody translated yet");
    expect(translate("en", "Appearance")).toBe("Appearance");
  });

  it("fills placeholders and leaves unknown ones visible instead of dropping them", () => {
    expect(translate("en", "Version {v} found", { v: "0.2.0" })).toBe("Version 0.2.0 found");
    expect(translate("en", "Hi {name}")).toBe("Hi {name}");
    expect(translate("en", "{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });
});

describe("Korean dictionary", () => {
  const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

  it("keeps every placeholder of its English key", () => {
    for (const [en, kr] of Object.entries(ko)) expect(placeholders(kr), en).toBe(placeholders(en));
  });

  it("has no empty entries and no entry that only repeats the key by mistake", () => {
    for (const [en, kr] of Object.entries(ko)) {
      expect(kr.trim().length, en).toBeGreaterThan(0);
    }
  });

  it("writes Korean in 해요체 for sentences, never 합니다체 mixed in", () => {
    for (const [en, kr] of Object.entries(ko)) expect(/(습니다|합니다)[.!]?$/.test(kr), en).toBe(false);
  });

  it("defines each key in exactly one file, so two screens never fight over a word", () => {
    const seen = new Map<string, string>();
    for (const [file, dict] of Object.entries(KO_PARTS)) {
      for (const key of Object.keys(dict)) {
        expect(seen.has(key), `"${key}" is in both ${seen.get(key)} and ${file}`).toBe(false);
        seen.set(key, file);
      }
    }
  });
});

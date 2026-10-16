// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyText, formatMs, highlightTokens, toText } from "../ToolCallCard";

describe("ToolCallCard helpers", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  it("formats milliseconds, seconds and minutes", () => {
    expect(formatMs(0)).toBe("1ms");
    expect(formatMs(2400)).toBe("2.4초");
    expect(formatMs(61_000)).toBe("1분 01초");
    expect(formatMs(2400, true)).toBe("2.4초");
  });
  it("formats JSON strings and objects while preserving ordinary text", () => {
    expect(toText('{"ok":true}')).toEqual({ text: '{\n  "ok": true\n}', json: true });
    expect(toText("plain text")).toEqual({ text: "plain text", json: false });
    expect(toText({ ok: true })).toEqual({ text: '{\n  "ok": true\n}', json: true });
  });
  it("classifies JSON syntax tokens", () => {
    expect(highlightTokens('{"n":2,"ok":true}').filter(t => t.kind !== "plain")).toEqual([
      { text: '"n"', kind: "key" }, { text: "2", kind: "num" }, { text: '"ok"', kind: "key" }, { text: "true", kind: "lit" },
    ]);
    expect(highlightTokens('"value"')[0]).toEqual({ text: '"value"', kind: "str" });
  });
  it("returns false when both clipboard paths throw and true when fallback succeeds", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => { throw new Error("unavailable"); }) });
    expect(await copyText("x")).toBe(false);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => true) });
    expect(await copyText("x")).toBe(true);
  });
});

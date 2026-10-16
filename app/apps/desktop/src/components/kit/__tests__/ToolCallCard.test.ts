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
  it("switches unit exactly at the 1s and 60s boundaries", () => {
    expect(formatMs(999)).toBe("999ms");
    expect(formatMs(999.6)).toBe("0.9초");
    expect(formatMs(1000)).toBe("1.0초");
    expect(formatMs(59_999)).toBe("59.9초");
    expect(formatMs(60_000)).toBe("1분 00초");
    expect(formatMs(3_599_000)).toBe("59분 59초");
  });
  it("keeps live timers in seconds and never shows negative time", () => {
    expect(formatMs(0, true)).toBe("0.0초");
    expect(formatMs(999, true)).toBe("0.9초");
    expect(formatMs(-500, true)).toBe("0.0초");
    expect(formatMs(-500)).toBe("1ms");
  });
  it("formats JSON strings and objects while preserving ordinary text", () => {
    expect(toText('{"ok":true}')).toEqual({ text: '{\n  "ok": true\n}', json: true });
    expect(toText("plain text")).toEqual({ text: "plain text", json: false });
    expect(toText({ ok: true })).toEqual({ text: '{\n  "ok": true\n}', json: true });
  });
  it("falls back to text for malformed JSON, circular objects and undefined", () => {
    expect(toText("{not json")).toEqual({ text: "{not json", json: false });
    expect(toText("[1, 2")).toEqual({ text: "[1, 2", json: false });
    expect(toText('  {"a":1}  ')).toEqual({ text: '{\n  "a": 1\n}', json: true });
    expect(toText("123")).toEqual({ text: "123", json: false });
    const loop: Record<string, unknown> = {}; loop.self = loop;
    const circular = toText(loop);
    expect(circular.json).toBe(false);
    expect(typeof circular.text).toBe("string");
    expect(toText(undefined)).toEqual({ text: "undefined", json: false });
    expect(toText(null)).toEqual({ text: "null", json: true });
    expect(toText(10n)).toEqual({ text: "10", json: false });
  });
  it("tokenizes keys, strings, numbers, literals and escaped quotes without losing text", () => {
    const src = '{\n  "k\\"q": "a \\"b\\" 12",\n  "n": -1.5e+3,\n  "xs": [false, null, 0]\n}';
    const kinds = highlightTokens(src).filter(t => t.kind !== "plain");
    expect(kinds).toEqual([
      { text: '"k\\"q"', kind: "key" }, { text: '"a \\"b\\" 12"', kind: "str" },
      { text: '"n"', kind: "key" }, { text: "-1.5e+3", kind: "num" },
      { text: '"xs"', kind: "key" }, { text: "false", kind: "lit" }, { text: "null", kind: "lit" }, { text: "0", kind: "num" },
    ]);
    expect(highlightTokens(src).map(t => t.text).join("")).toBe(src);
    expect(highlightTokens("")).toEqual([]);
  });
  it("treats markup in values as inert text", () => {
    const src = '{"x": "<img src=x onerror=alert(1)>"}';
    expect(highlightTokens(src).map(t => t.text).join("")).toBe(src);
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

// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolCallCard, ToolCallGroup, type ToolCallCardProps } from "../ToolCallCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
const render = (props: Partial<ToolCallCardProps>) => act(() => root.render(h(ToolCallCard, { name: "read_note", status: "success", ...props } as ToolCallCardProps)));
const head = () => host.querySelector<HTMLButtonElement>(".kit-tc-head")!;
const body = () => host.querySelector<HTMLElement>(".kit-tc-body")!;

describe("ToolCallCard behaviour", () => {
  it("toggles aria-expanded and inert on the body", () => {
    render({ args: { a: 1 } });
    expect(head().getAttribute("aria-expanded")).toBe("false"); expect(body().hasAttribute("inert")).toBe(true);
    expect(head().getAttribute("aria-controls")).toBe(body().id);
    act(() => head().click());
    expect(head().getAttribute("aria-expanded")).toBe("true"); expect(body().hasAttribute("inert")).toBe(false);
  });
  it("opens on error, closes when the next run starts, and respects a manual toggle", () => {
    render({ status: "running" }); render({ status: "error", error: "boom" });
    expect(head().getAttribute("aria-expanded")).toBe("true");
    render({ status: "running" });
    expect(head().getAttribute("aria-expanded")).toBe("false");
    render({ status: "error", error: "boom" }); act(() => head().click());
    expect(head().getAttribute("aria-expanded")).toBe("false");
    render({ status: "running" }); render({ status: "error", error: "boom" });
    expect(head().getAttribute("aria-expanded")).toBe("true");
    act(() => head().click()); render({ status: "running" });
    expect(head().getAttribute("aria-expanded")).toBe("false");
  });
  it("keeps a card the user opened open across error and retry", () => {
    render({ status: "running" }); act(() => head().click());
    render({ status: "error", error: "x" }); render({ status: "running" });
    expect(head().getAttribute("aria-expanded")).toBe("true");
  });
  it("does not auto-open when openOnError is off or the card is controlled", () => {
    render({ status: "error", openOnError: false }); expect(head().getAttribute("aria-expanded")).toBe("false");
    render({ status: "error", open: false }); expect(head().getAttribute("aria-expanded")).toBe("false");
  });
  it("announces state through role=status and calls onRetry", () => {
    const onRetry = vi.fn();
    render({ status: "error", error: "권한 없음", onRetry });
    expect(host.querySelector('[role="status"]')!.textContent).toBe("read_note: 실패: 권한 없음");
    act(() => host.querySelector<HTMLButtonElement>(".kit-tc-retry")!.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });
  it("ticks a live timer and releases the interval when it stops or unmounts", () => {
    const clear = vi.spyOn(window, "clearInterval");
    render({ status: "running", startedAt: Date.now() });
    act(() => { vi.advanceTimersByTime(2500); });
    expect(host.querySelector(".kit-tc-time")!.textContent).toBe("2.5초");
    render({ status: "success", duration: 2400 });
    expect(clear).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    expect(host.querySelector(".kit-tc-time")!.textContent).toBe("2.4초");
  });
  it("clears the copied-state timeout on unmount", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render({ args: { a: 1 } });
    const copy = host.querySelector<HTMLButtonElement>(".kit-tc-copy")!;
    await act(async () => { copy.click(); });
    expect(copy.dataset.copied).toBe("true"); expect(copy.getAttribute("aria-label")).toBe("복사했어요");
    act(() => { vi.advanceTimersByTime(1400); });
    expect(copy.dataset.copied).toBeUndefined();
    await act(async () => { copy.click(); }); act(() => root.unmount()); expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);
  });
  it("never injects HTML from args or results", () => {
    render({ args: { x: "<img src=x onerror=alert(1)>" }, result: "<b>hi</b>" });
    expect(host.querySelector("img, b")).toBeNull();
    expect(host.querySelector(".kit-tc-code")!.textContent).toContain("<img src=x");
  });
  it("summarises a group with failures and runs its timer only while a call runs", () => {
    const mk = (status: ToolCallCardProps["status"], duration?: number) => h(ToolCallCard, { name: status, status, duration });
    act(() => root.render(h(ToolCallGroup, null, mk("success", 800), mk("error", 0))));
    expect(host.querySelector(".kit-tc-group-title")!.textContent).toBe("도구 2개 사용· 1개 실패· 800ms");
    expect(host.querySelector(".kit-tc-group-head")!.getAttribute("aria-expanded")).toBe("false");
    act(() => root.render(h(ToolCallGroup, null, mk("running"))));
    expect(host.querySelector(".kit-tc-group")!.hasAttribute("data-running")).toBe(true);
    expect(host.querySelector(".kit-tc-group .kit-tc-shine")!.textContent).toBe("도구 사용 중…");
  });
});

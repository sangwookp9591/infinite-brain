// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requestDashboardAgent } from "../../lib/dashboard/agentLaunch";
import { DashboardAgentRunner } from "../DashboardAgentRunner";

const mocks = vi.hoisted(() => ({ detect: vi.fn(), run: vi.fn(), cancel: vi.fn() }));
vi.mock("../../lib/dashboard/agent", () => ({
  detectInstalledAgents: mocks.detect, runDashboardAgent: mocks.run,
  cancelDashboardAgent: mocks.cancel, appendAgentLog: (old: string, next: string) => old + next,
}));
const nativeFocus = vi.hoisted(() => ({ handler: null as null | ((event: { payload: boolean }) => void), stop: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({
  onFocusChanged: vi.fn(async (handler: (event: { payload: boolean }) => void) => {
    nativeFocus.handler = handler;
    return nativeFocus.stop;
  }),
}) }));
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.detect.mockReset().mockResolvedValue(["claude", "codex"].map(agent => ({ agent, runnable: true, signedIn: true })));
  mocks.run.mockReset().mockImplementation(async (request, onEvent) => {
    onEvent({ type: "started", runId: request.runId });
    onEvent({ type: "finished", cancelled: false, success: true, exitCode: 0 });
  });
  mocks.cancel.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(createElement(DashboardAgentRunner, { path: "Home.html", expectedEpoch: 1 })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function click(label: string) {
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === label)!.click());
}
async function prompt() {
  await act(async () => {
    const field = document.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Add hello world");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it.each(["Claude", "Codex"])("runs the explicitly selected %s provider", async name => {
  await click(`Update with ${name}`); await prompt(); await click(`Run ${name}`);
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ agent: name.toLowerCase(), prompt: "Add hello world", dashboardPath: "Home.html", expectedEpoch: 1 }), expect.any(Function));
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Finished");
});
it("cancels an active run when the vault epoch changes and ignores late output", async () => {
  let finish!: () => void;
  mocks.run.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await click("Update with Claude"); await prompt(); await click("Run Claude");
  const id = mocks.run.mock.calls[0][0].runId;
  await act(async () => root.render(createElement(DashboardAgentRunner, { path: "Other.html", expectedEpoch: 2 })));
  expect(mocks.cancel).toHaveBeenCalledWith(id);
  await act(async () => finish());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("keeps a hidden run alive across pages, reopens its captured request, and retains completion", async () => {
  let emit!: (event: unknown) => void;
  let finish!: () => void;
  mocks.run.mockImplementation((_request, onEvent) => { emit = onEvent; return new Promise<void>(resolve => { finish = resolve; }); });
  await click("Update with Claude"); await prompt(); await click("Run Claude");
  expect(document.querySelector<HTMLButtonElement>('[data-agent="codex"]')?.disabled).toBe(true);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close agent dialog"]')!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => root.render(createElement(DashboardAgentRunner, { path: null, expectedEpoch: 1, showLaunchers: false })));
  await act(async () => emit({ type: "text", text: "Updated the overview." }));
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(document.querySelector('[data-agent="claude"]')).toBeNull();
  await act(async () => root.render(createElement(DashboardAgentRunner, { path: "Home.html", expectedEpoch: 1, showLaunchers: true })));
  expect(document.querySelector('[data-agent="claude"]')?.getAttribute("aria-label")).toContain("running");
  await act(async () => document.querySelector<HTMLButtonElement>('[data-agent="claude"]')!.click());
  expect(document.querySelector("textarea")?.value).toBe("");
  expect(document.querySelector(".dashboard-chat-user")?.textContent).toBe("Add hello world");
  expect(document.querySelector(".dashboard-agent-path")?.textContent).toBe("Home.html");
  expect(document.querySelector(".dashboard-agent-output")?.textContent).toContain("Updated the overview.");
  await act(async () => {
    emit({ type: "finished", cancelled: false, success: true, exitCode: 0 }); finish();
  });
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close agent dialog"]')!.click());
  expect(document.querySelector('[data-agent="claude"]')?.getAttribute("aria-label")).toContain("completed");
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Finished");
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
it("reserves output before running and keeps repeated statuses out of the response", async () => {
  let emit!: (event: unknown) => void;
  let finish!: () => void;
  mocks.run.mockImplementation((_request, onEvent) => {
    emit = onEvent;
    return new Promise<void>(resolve => { finish = resolve; });
  });
  await click("Update with Claude");
  const output = document.querySelector(".dashboard-agent-output");
  expect(output).not.toBeNull();
  await prompt(); await click("Run Claude");
  await act(async () => {
    emit({ type: "status", text: "Editing dashboard…" });
    emit({ type: "status", text: "Editing dashboard…" });
    emit({ type: "text", text: "Updated the weekly overview." });
    emit({ type: "status", text: "Updated files in the vault." });
    emit({ type: "text", text: "Updated the weekly overview." });
  });
  expect(document.querySelector(".dashboard-agent-output")).toBe(output);
  expect(output?.textContent).not.toContain("Editing dashboard");
  expect(output?.textContent?.match(/Updated the weekly overview\./g)).toHaveLength(1);
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Updated files in the vault.");
  await act(async () => {
    emit({ type: "finished", cancelled: false, success: true, exitCode: 0 }); finish();
  });
  expect(document.querySelector(".phase-success")).not.toBeNull();
});
it("keeps stopping visible despite late progress, then clearly marks the stopped run", async () => {
  let emit!: (event: unknown) => void;
  let finish!: () => void;
  mocks.run.mockImplementation((_request, onEvent) => {
    emit = onEvent; return new Promise<void>(resolve => { finish = resolve; });
  });
  await click("Update with Codex"); await prompt(); await click("Run Codex"); await click("Stop");
  await act(async () => emit({ type: "status", text: "Editing dashboard…" }));
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Stopping Codex");
  expect(mocks.cancel).toHaveBeenCalledWith(mocks.run.mock.calls[0][0].runId);
  await act(async () => { emit({ type: "finished", cancelled: true, success: false, exitCode: null }); finish(); });
  expect(document.querySelector(".phase-stopped")).not.toBeNull();
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Changes already written remain");
});
it("attaches to a late header host and preserves an active run when that host is replaced", async () => {
  let finish!: () => void;
  mocks.run.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const first = document.createElement("div"), replacement = document.createElement("div");
  document.body.append(first, replacement);
  try {
    await act(async () => root.render(createElement(DashboardAgentRunner, { path: "Home.html", expectedEpoch: 1, launchTarget: null })));
    expect(document.querySelector(".dashboard-agent-launch")).toBeNull();
    await act(async () => root.render(createElement(DashboardAgentRunner, { path: "Home.html", expectedEpoch: 1, launchTarget: first })));
    expect(first.querySelectorAll(".dashboard-agent-launch")).toHaveLength(2);
    await click("Update with Claude"); await prompt(); await click("Run Claude");
    const dialog = document.querySelector('[role="dialog"]');
    first.remove();
    await act(async () => root.render(createElement(DashboardAgentRunner, { path: "Home.html", expectedEpoch: 1, launchTarget: replacement })));
    expect(replacement.querySelectorAll(".dashboard-agent-launch")).toHaveLength(2);
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(document.querySelector("textarea")?.value).toBe("");
  expect(document.querySelector(".dashboard-chat-user")?.textContent).toBe("Add hello world");
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  } finally { first.remove(); replacement.remove(); }
});

it("launches a newly created non-Home dashboard without showing header actions", async () => {
  await act(async () => root.render(createElement(DashboardAgentRunner, { path: null, expectedEpoch: 1, showLaunchers: false })));
  await act(async () => requestDashboardAgent({ agent: "codex", path: "Created.html", expectedEpoch: 0 }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => requestDashboardAgent({ agent: "codex", path: "Created.html", expectedEpoch: 1 }));
  expect(document.querySelector(".dashboard-agent-path")?.textContent).toBe("Created.html");
  expect(document.querySelector(".dashboard-agent-launch")).toBeNull();
  await prompt(); await click("Run Codex");
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ agent: "codex", dashboardPath: "Created.html", expectedEpoch: 1 }), expect.any(Function));
});
it("reopens an active run instead of replacing it from a creation request", async () => {
  let finish!: () => void;
  mocks.run.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await click("Update with Claude"); await prompt(); await click("Run Claude");
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close agent dialog"]')!.click());
  await act(async () => requestDashboardAgent({ agent: "codex", path: "Created.html", expectedEpoch: 1 }));
  expect(document.querySelector(".dashboard-agent-path")?.textContent).toBe("Home.html");
  expect(document.querySelector("textarea")?.value).toBe("");
  expect(document.querySelector(".dashboard-chat-user")?.textContent).toBe("Add hello world");
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(mocks.cancel).not.toHaveBeenCalled();
  await act(async () => finish());
});
it("dismisses outside the chat while preserving the draft", async () => {
  await click("Update with Codex"); await prompt();
  await act(async () => document.querySelector("textarea")!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(document.querySelector(".dashboard-agent-dialog")).not.toBeNull();
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(document.querySelector(".dashboard-agent-dialog")).toBeNull();
  await click("Update with Codex");
  expect(document.querySelector("textarea")!.value).toBe("Add hello world");
});
it("closes for Activity and closes Activity before opening chat", async () => {
  const onOpen = vi.fn();
  await act(async () => root.render(createElement(DashboardAgentRunner, { path: "Home.html", expectedEpoch: 1, onOpen })));
  await click("Update with Codex");
  expect(onOpen).toHaveBeenCalledOnce();
  await act(async () => root.render(createElement(DashboardAgentRunner, { path: "Home.html", expectedEpoch: 1, onOpen, rightPanelOpen: true })));
  expect(document.querySelector(".dashboard-agent-dialog")).toBeNull();
});
it("dismisses when focus moves into the dashboard iframe", async () => {
  await click("Update with Codex");
  const frame = document.createElement("iframe"); document.body.append(frame);
  await act(async () => {
    frame.focus(); window.dispatchEvent(new Event("blur"));
    await new Promise(resolve => setTimeout(resolve, 5));
  });
  expect(document.querySelector(".dashboard-agent-dialog")).toBeNull();
  frame.remove();
});
it("clears a sent message and keeps the next draft editable during a run", async () => {
  let finish!: () => void;
  mocks.run.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await click("Update with Codex"); await prompt(); await click("Run Codex");
  expect(document.querySelector("textarea")!.value).toBe("");
  expect(document.querySelector("textarea")!.disabled).toBe(false);
  await prompt();
  await act(async () => finish());
  expect(document.querySelector("textarea")!.value).toBe("Add hello world");
});
it("dismisses through the transparent backdrop around an embedded page", async () => {
  await click("Update with Codex");
  await act(async () => document.querySelector(".dashboard-agent-backdrop")!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(document.querySelector(".dashboard-agent-dialog")).toBeNull();
});

it("closes on app focus loss and keeps the draft when reopened", async () => {
  await click("Update with Codex"); await prompt();
  await act(async () => nativeFocus.handler?.({ payload: false }));
  expect(document.querySelector(".dashboard-agent-dialog")).toBeNull();
  expect(nativeFocus.stop).toHaveBeenCalled();
  await click("Update with Codex");
  expect(document.querySelector("textarea")!.value).toBe("Add hello world");
});
it("closes on browser window blur even when the composer retains focus", async () => {
  await click("Update with Codex");
  await act(async () => window.dispatchEvent(new Event("blur")));
  expect(document.querySelector(".dashboard-agent-dialog")).toBeNull();
});

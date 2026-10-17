// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvitePeopleDialog } from "../InvitePeopleDialog";
import { useStore } from "../../store";

const api = vi.hoisted(() => ({ getJoinCodeDetails: vi.fn(), rotateJoinCode: vi.fn(), getAccessDefault: vi.fn(), setAccessDefault: vi.fn(), inviteMany: vi.fn() }));
vi.mock("../../lib/auth/authManager", () => ({ authManager: { api, getServerUrl: () => "http://test.invalid" } }));
vi.mock("../../store", async () => {
  const { create } = await import("zustand");
  return { useStore: create(() => ({})) };
});
vi.mock("../UpgradeDialog", () => ({ UpgradeDialog: () => null }));

describe("Invite people dialog", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    (useStore as unknown as { setState: (s: Record<string, unknown>) => void }).setState({
      serverUrl: "http://test.invalid", refreshVault: vi.fn().mockResolvedValue(undefined),
    });
    api.getJoinCodeDetails.mockResolvedValue({ code: "2TG7KNEA", expiresAt: "2026-11-01T00:00:00Z" });
    api.rotateJoinCode.mockResolvedValue({ code: "NEWCODEA", expiresAt: "2026-11-08T00:00:00Z" });
    api.getAccessDefault.mockResolvedValue({ mode: "readonly" });
    api.setAccessDefault.mockImplementation(async (_org: string, mode: string) => ({ mode }));
    api.inviteMany.mockResolvedValue([]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const send = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Send"))!;
  const type = async (value: string) => {
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="Email addresses"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("shows code expiry and regenerates the code", async () => {
    await act(async () => root.render(createElement(InvitePeopleDialog, { orgId: "org-1", onClose: vi.fn(), onInvited: vi.fn() })));
    expect(document.body.textContent).toContain("Expires");
    const rotate = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Create new code")!;
    await act(async () => rotate.click());
    expect(api.rotateJoinCode).toHaveBeenCalledOnce();
    expect(document.body.querySelector(".invite-people-code-value")?.textContent).toBe("NEWCODEA");
  });

  it("lays out Role and Access as labelled boxes and pluralises Send", async () => {
    await act(async () => root.render(createElement(InvitePeopleDialog, { orgId: "org-1", onClose: vi.fn(), onInvited: vi.fn() })));
    const fields = [...document.body.querySelectorAll(".invite-field")];
    expect(fields.map((f) => f.querySelector(".invite-field-label")?.textContent)).toEqual(["New members", "Role", "Access"]);
    expect(fields[2].querySelector(".invite-field-trigger")?.textContent).toContain("Use New members default");
    expect(fields[0].querySelector(".invite-field-trigger")?.textContent).toContain("Can view");
    expect(document.body.querySelector(".invite-people-code-value")?.textContent).toBe("2TG7KNEA");
    expect(send().textContent).toBe("Send invite");
    expect(send().disabled).toBe(true);
    await type("maya@team.com, jo@team.com ");
    expect(document.body.querySelectorAll(".invite-chip")).toHaveLength(2);
    expect(send().textContent).toBe("Send invites");
    expect(send().disabled).toBe(false);
  });

  it("lets an emailed invitation link be copied too", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    api.inviteMany.mockResolvedValue([{ email: "maya@team.com", invitationId: "invite-1", emailed: true }]);
    await act(async () => root.render(createElement(InvitePeopleDialog, { orgId: "org-1", onClose: vi.fn(), onInvited: vi.fn() })));
    await type("maya@team.com");
    await act(async () => send().click());
    const copy = document.body.querySelector<HTMLButtonElement>('button[aria-label="Copy invitation link for maya@team.com"]');
    expect(document.body.textContent).toContain("You can also share this link");
    await act(async () => copy?.click());
    expect(writeText).toHaveBeenCalledWith("http://test.invalid/invite/invite-1");
  });

  it("shows a shareable link when the server does not send email", async () => {
    api.inviteMany.mockResolvedValue([{ email: "maya@team.com", invitationId: "invite-1", emailed: false }]);
    await act(async () => root.render(createElement(InvitePeopleDialog, { orgId: "org-1", onClose: vi.fn(), onInvited: vi.fn() })));
    await type("maya@team.com");
    await act(async () => send().click());
    expect(document.body.textContent).toContain("Share this link with maya@team.com");
    expect(document.body.querySelector(".invite-notice-link code")?.textContent).toBe("http://test.invalid/invite/invite-1");
  });

  it("keeps the email failure reason beside the shareable link", async () => {
    api.inviteMany.mockResolvedValue([{ email: "maya@team.com", invitationId: "invite-1", emailed: false, error: "smtp_unavailable" }]);
    await act(async () => root.render(createElement(InvitePeopleDialog, { orgId: "org-1", onClose: vi.fn(), onInvited: vi.fn() })));
    await type("maya@team.com");
    await act(async () => send().click());
    expect(document.body.textContent).toContain("couldn't be sent (smtp_unavailable)");
    expect(document.body.querySelector(".invite-notice-link code")?.textContent).toBe("http://test.invalid/invite/invite-1");
  });

  it("updates the existing New members default from the invite dialog", async () => {
    await act(async () => root.render(createElement(InvitePeopleDialog, { orgId: "org-1", onClose: vi.fn(), onInvited: vi.fn() })));
    await act(async () => document.body.querySelector<HTMLButtonElement>('button[aria-label="New members access"]')!.click());
    const edit = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent?.trim() === "Can edit");
    await act(async () => edit!.click());
    expect(api.setAccessDefault).toHaveBeenCalledWith("org-1", "open");
  });
});

// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { initialOfficeFlowState, officeErrorCopy } from "../../lib/officeFlow";
import { OfficeScreens } from "./OfficeScreens";

const noop = vi.fn();
const props = {
  t: (text: string) => text, state: initialOfficeFlowState, nickname: "", candidates: [], requests: [], hostRunning: false, mode: "choice" as const,
  onNicknameChange: noop, onSaveNickname: noop, onDiscover: noop, onSelect: noop,
  onConfirm: noop, onJoin: noop, onRetry: noop, onDecide: noop, onHostToggle: noop, onMode: noop,
  onPasteInvitation: noop, onCreateInvitation: noop, onCopyInvitation: noop,
  onConfirmSas: noop,
};

describe("OfficeScreens", () => {
  it("renders a labeled nickname form with a disabled empty submit", () => {
    const html = renderToStaticMarkup(createElement(OfficeScreens, props));
    expect(html).toContain('aria-labelledby="office-title"');
    expect(html).toContain('for="office-nickname"');
    expect(html).toContain("disabled");
    expect(html).toContain("How should coworkers see you?");
  });
  it("shows only the setup step before revealing the join/share choice", () => {
    const html = renderToStaticMarkup(createElement(OfficeScreens, props));
    expect(html).toContain('id="office-nickname"');
    expect(html).not.toContain("Approval inbox");
    expect(html).not.toContain("Start sharing");
    const choice = renderToStaticMarkup(createElement(OfficeScreens, { ...props, state: { ...initialOfficeFlowState, phase: "browsing", nickname: "민수" } }));
    expect(choice).toContain("Join a workspace");
    expect(choice).toContain("Share from this computer");
    expect(choice).not.toContain("Approval inbox");
  });
  it("shows join code entry and nearby candidates together", () => {
    const html = renderToStaticMarkup(createElement(OfficeScreens, { ...props, mode: "join", state: { ...initialOfficeFlowState, phase: "browsing", nickname: "민수" } }));
    expect(html).toContain('id="office-invitation"');
    expect(html).toContain("Find nearby workspaces");
    expect(html).not.toContain("Approval inbox");
  });
  it("shows formatted, screen-reader clear SAS and locks approval until it matches", () => {
    const html = renderToStaticMarkup(createElement(OfficeScreens, {
      ...props,
      state: { ...initialOfficeFlowState, phase: "browsing", nickname: "민수" }, mode: "share", hostRunning: true,
      requests: [{ id: "r1", nickname: "민수", device: "노트북", platform: "Windows", status: "pending", confirmationNumber: "482193" }],
    }));
    expect(html).toContain("482 193");
    expect(html).toContain('aria-label="Six-digit confirmation number: 4 8 2 1 9 3"');
    expect(html).toMatch(/disabled=""[^>]*>Approve/);
  });
  it("keeps the approval inbox private until this computer is sharing", () => {
    const state = { ...initialOfficeFlowState, phase: "browsing" as const, nickname: "민수" };
    const off = renderToStaticMarkup(createElement(OfficeScreens, { ...props, mode: "share", state, hostRunning: false }));
    const on = renderToStaticMarkup(createElement(OfficeScreens, { ...props, mode: "share", state, hostRunning: true }));
    expect(off).not.toContain("Approval inbox");
    expect(on).toContain("Approval inbox");
  });
  it("enables approval only after the matching choice and leaves rejection available after mismatch", () => {
    const request = { id: "r1", nickname: "민수", device: "노트북", platform: "Windows" as const, status: "pending" as const, confirmationNumber: "482193" };
    const matched = renderToStaticMarkup(createElement(OfficeScreens, { ...props, state: { ...initialOfficeFlowState, phase: "browsing", nickname: "민수" }, mode: "share", hostRunning: true, requests: [{ ...request, sasMatches: true }] }));
    expect(matched).toContain('<button class="primary">Approve</button>');
    const mismatched = renderToStaticMarkup(createElement(OfficeScreens, { ...props, state: { ...initialOfficeFlowState, phase: "browsing", nickname: "민수" }, mode: "share", hostRunning: true, requests: [{ ...request, sasMatches: false }] }));
    expect(mismatched).toContain("The numbers differ. Do not approve this request.");
    expect(mismatched).toContain('<button class="office-secondary">Reject</button>');
    expect(mismatched).toContain('<button class="primary" disabled="">Approve</button>');
  });
  it("puts every error cause and next action in the top alert", () => {
    for (const [code, copy] of Object.entries(officeErrorCopy)) {
      const html = renderToStaticMarkup(createElement(OfficeScreens, {
        ...props,
        state: { ...initialOfficeFlowState, phase: "error", error: code as keyof typeof officeErrorCopy },
        errorCopy: copy,
      }));
      expect(html.indexOf('role="alert"'), code).toBeLessThan(html.indexOf('id="office-title"'));
      expect(html, code).toContain(copy.cause);
      expect(html, code).toContain(copy.next);
      expect(html, code).not.toContain('class="office-card office-flow"');
    }
  });
});

it.each([0, 1, 3])("renders %i approved vault choices with names only and explicit confirmation", (count) => {
  const vaults = Array.from({ length: count }, (_, i) => ({ id: `secret-id-${i}`, name: `작업 공간 ${i + 1}` }));
  const html = renderToStaticMarkup(createElement(OfficeScreens, { ...props, state: { ...initialOfficeFlowState, phase: "vault-selecting" }, vaults }));
  expect(html).toContain("Which workspace would you like to connect to?");
  expect(html).not.toContain("secret-id");
  if (!count) expect(html).toContain("Ask your administrator");
  if (count === 1) expect(html).toContain("Confirm connection");
  if (count > 1) expect(html).toContain("Connect workspace");
  expect(html).not.toContain("Saved to the company workspace");
});
it("separates connection from local storage and never claims a durable ACK on approval", () => {
  const html = renderToStaticMarkup(createElement(OfficeScreens, { ...props, state: { ...initialOfficeFlowState, phase: "connected" } }));
  expect(html).toContain("Connected"); expect(html).toContain("This computer only");
  expect(html).not.toContain("Saved to the company workspace");
});

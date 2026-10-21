// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { initialOfficeFlowState, officeErrorCopy } from "../../lib/officeFlow";
import { OfficeScreens } from "./OfficeScreens";

const noop = vi.fn();
const props = {
  t: (text: string) => text, state: initialOfficeFlowState, nickname: "", candidates: [], requests: [], hostRunning: false,
  onNicknameChange: noop, onSaveNickname: noop, onDiscover: noop, onSelect: noop,
  onConfirm: noop, onJoin: noop, onRetry: noop, onDecide: noop, onHostToggle: noop,
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
  it("renders one flow step at a time and groups local administration separately", () => {
    const html = renderToStaticMarkup(createElement(OfficeScreens, props));
    expect(html).toContain('id="office-nickname"');
    expect(html).toContain('class="office-card office-flow"');
    expect(html).toContain('class="office-card office-local"');
    expect(html).toContain("Approval inbox");
    expect(html).toContain("Start sharing");
  });
  it("shows formatted, screen-reader clear SAS and locks approval until it matches", () => {
    const html = renderToStaticMarkup(createElement(OfficeScreens, {
      ...props,
      requests: [{ id: "r1", nickname: "민수", device: "노트북", platform: "Windows", status: "pending", confirmationNumber: "482193" }],
    }));
    expect(html).toContain("482 193");
    expect(html).toContain('aria-label="Six-digit confirmation number: 4 8 2 1 9 3"');
    expect(html).toMatch(/disabled=""[^>]*>Approve/);
  });
  it("enables approval only after the matching choice and leaves rejection available after mismatch", () => {
    const request = { id: "r1", nickname: "민수", device: "노트북", platform: "Windows" as const, status: "pending" as const, confirmationNumber: "482193" };
    const matched = renderToStaticMarkup(createElement(OfficeScreens, { ...props, requests: [{ ...request, sasMatches: true }] }));
    expect(matched).toContain('<button class="primary">Approve</button>');
    const mismatched = renderToStaticMarkup(createElement(OfficeScreens, { ...props, requests: [{ ...request, sasMatches: false }] }));
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

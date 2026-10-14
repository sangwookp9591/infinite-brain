// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { JSDOM, type DOMWindow } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../../../../public/dashboard-templates/orbit-agentic-os.html", import.meta.url), "utf8");
let dom: JSDOM;
const node = (id: string) => dom.window.document.getElementById(id)!;
const click = (selector: string) => (dom.window.document.querySelector(selector) as HTMLElement).click();
beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(window: DOMWindow) {
      window.matchMedia = (() => ({ matches: false, addEventListener() {} })) as unknown as typeof window.matchMedia;
      window.HTMLCanvasElement.prototype.getContext = () => null;
      window.scrollTo = () => {};
      window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
      window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    },
  });
});
afterEach(() => { dom.window.close(); vi.useRealTimers(); });

it("navigates pages, filters skills and memory, and opens the selected sample document", () => {
  click('[data-page="skills"]');
  click('[data-filter="Research"]');
  expect(node("page-command").hidden).toBe(true);
  expect(node("skill-library").querySelectorAll("article")).toHaveLength(3);
  const search = node("skill-search") as HTMLInputElement;
  search.value = "deep"; search.dispatchEvent(new dom.window.Event("input"));
  expect(node("skill-library").querySelectorAll("article")).toHaveLength(1);
  click('[data-page="memory"]'); click('[data-folder="Raw"]');
  expect(node("memory-list").querySelectorAll("button")).toHaveLength(2);
  click('[data-doc="d4"]');
  expect(node("detail-title").textContent).toBe("Customer interview observations");
  expect(node("detail-body").textContent).toContain("Sample observations");
});

it("clears submitted text, prevents duplicate in-flight runs and moves a demo output through review", async () => {
  const input = node("command-text") as HTMLInputElement;
  input.value = '<script>alert("test")</script> research';
  node("command-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  expect(input.value).toBe("");
  expect(node("mission-count").textContent).toBe("05");
  input.value = "Next idea";
  node("command-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  expect(input.value).toBe("Next idea");
  expect(node("mission-count").textContent).toBe("05");
  expect(node("mission-board").querySelector("script")).toBeNull();
  await vi.advanceTimersByTimeAsync(3300);
  click('[data-page="missions"]');
  const review = node("mission-board").querySelectorAll(".board-column")[1];
  expect(review.querySelectorAll(".mission-card")).toHaveLength(2);
  (review.querySelector("button") as HTMLButtonElement).click();
  expect(node("detail-action").textContent).toBe("Mark complete");
  click("#detail-action");
  expect(node("mission-board").querySelectorAll(".board-column")[2].querySelectorAll(".mission-card")).toHaveLength(2);
  click('[data-page="activity"]');
  expect(node("activity-list").textContent).toContain('alert("test")');
  expect(node("activity-list").querySelector("script")).toBeNull();
});

it("defaults to dark independently of the host, with an explicit light toggle", () => {
  const theme = { channel: "baalda.dashboard.v1", event: "theme", result: { theme: "light" } };
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: theme, source: dom.window as unknown as Window }));
  expect(dom.window.document.documentElement.dataset.theme).toBe("dark");
  click("#light-theme");
  expect(dom.window.document.documentElement.dataset.theme).toBe("light");
  expect(node("light-theme").getAttribute("aria-pressed")).toBe("true");
  click("#dark-theme");
  expect(dom.window.document.documentElement.dataset.theme).toBe("dark");
});

// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { JSDOM, type DOMWindow } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dom: JSDOM;
const node = (id: string) => dom.window.document.getElementById(id)!;
const click = (selector: string) => dom.window.document.querySelector(selector)!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
function open(id: string) {
  return new JSDOM(readFileSync(new URL(`../../../../public/dashboard-templates/${id}-agentic-os.html`, import.meta.url), "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(window: DOMWindow) {
      window.matchMedia = (() => ({ matches: false, addEventListener() {} })) as unknown as typeof window.matchMedia;
      window.requestAnimationFrame = () => 1;
      window.cancelAnimationFrame = () => {};
      window.scrollTo = () => {};
      window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
      window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    },
  });
}
const search = (id: string, value: string) => {
  (node(id) as HTMLInputElement).value = value;
  node(id).dispatchEvent(new dom.window.Event("input"));
};
afterEach(() => { dom?.window.close(); vi.useRealTimers(); });

describe("Waystation template", () => {
  beforeEach(() => { vi.useFakeTimers(); dom = open("waystation"); });
  it("connects the room, roster, routines and searchable archive", () => {
    click('g[data-station="skills"]');
    expect(node("station-detail").textContent).toContain("Ember is drafting");
    expect(node("roster").querySelector('[data-station="skills"]')?.getAttribute("aria-pressed")).toBe("true");
    click('[data-page="routines"]');
    click('[data-routine="0"]');
    expect(node("routines").querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
    click('[data-page="archive"]'); search("archive-search", "quieter");
    expect(node("archive").querySelectorAll("button")).toHaveLength(1);
    click('[data-artifact="a1"]');
    expect(node("detail-body").textContent).toContain("Sample research brief");
  });
  it("clears requests, avoids duplicate runs, escapes text, and supports output review", async () => {
    search("request", '<img src=x onerror=alert(1)>');
    node("dispatch").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    expect((node("request") as HTMLInputElement).value).toBe("");
    expect(node("queue").querySelectorAll(".queue-row")).toHaveLength(3);
    expect(node("queue").querySelector("img")).toBeNull();
    search("request", "Next request");
    node("dispatch").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    expect((node("request") as HTMLInputElement).value).toBe("Next request");
    await vi.advanceTimersByTimeAsync(3100);
    click('[data-review="run1"]'); click("#detail-action");
    expect(node("queue").querySelector(".queue-row")?.textContent).toContain("Done");
    expect(node("queue-count").textContent).toBe("2 open");
    expect(node("journal").querySelector("img")).toBeNull();
  });
  it("starts dark and lets users change theme and pause motion", () => {
    expect(dom.window.document.documentElement.dataset.theme).toBe("dark");
    click("#light-theme");
    expect(dom.window.document.documentElement.dataset.theme).toBe("light");
    click("#motion-toggle");
    expect(dom.window.document.body.classList.contains("paused")).toBe(true);
  });
});

describe("Meridian template", () => {
  beforeEach(() => { vi.useFakeTimers(); dom = open("meridian"); });
  it("browses artifacts and memory, marks sample messages read and toggles routines", () => {
    click('[data-artifact="a2"]');
    expect(node("detail-title").textContent).toBe("Signals worth keeping");
    click("#close-detail"); click('[data-mail="m1"]'); click("#detail-action");
    expect(node("inbox-count").textContent).toBe("2 unread");
    click('[data-routine="0"]');
    expect(node("routines").querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
    click('[data-page="library"]'); click('[data-filter="Tool"]');
    expect(node("library").querySelectorAll("button")).toHaveLength(2);
    search("library-search", "planning");
    expect(node("library").querySelectorAll("button")).toHaveLength(1);
    click('[data-page="memory"]'); click('[data-collection="Playbooks"]'); click('[data-doc="1"]');
    expect(node("detail-title").textContent).toBe("Draft review checklist");
  });
  it("uses the selected agent and effort for a demo and adds an output to the library", async () => {
    (node("model") as HTMLSelectElement).value = "Codex";
    (node("effort") as HTMLSelectElement).value = "Deep";
    click('[data-skill="research"]'); click("#detail-action");
    expect(node("run-status").textContent).toContain("Codex");
    expect(node("skills").querySelector("button")?.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(2500);
    expect(node("skills").querySelector("button")?.disabled).toBe(false);
    expect(node("library").querySelectorAll("button")).toHaveLength(7);
    click("#latest-open");
    expect(node("detail-body").textContent).toContain("Effort: Deep");
    expect(node("detail-body").textContent).toContain("No model was called");
  });
  it("starts dark and supports a manual light theme and motion pause", () => {
    expect(dom.window.document.documentElement.dataset.theme).toBe("dark");
    click("#light-theme");
    expect(dom.window.document.documentElement.dataset.theme).toBe("light");
    click("#motion-toggle");
    expect(dom.window.document.body.classList.contains("paused")).toBe(true);
  });
});

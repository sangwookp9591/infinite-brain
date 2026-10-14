// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole, type DOMWindow } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { DEPLOYED_OS_TEMPLATES } from "../deployedTemplates";
let dom: JSDOM, errors: Error[], requests: ReturnType<typeof vi.fn<typeof fetch>>;
const node = (id: string) => dom.window.document.getElementById(id)!;
const click = (s: string) => dom.window.document.querySelector(s)!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const source = (id: string) => readFileSync(new URL(`../../../../public/dashboard-templates/${id}.html`, import.meta.url), "utf8");
function open(id: string) {
  errors = []; requests = vi.fn<typeof fetch>(() => { throw new Error("Unexpected network request"); });
  const console = new VirtualConsole(); console.on("jsdomError", e => errors.push(e));
  const parsed = new JSDOM(source(id));
  // Test our behavior with a drawing stub; artifact checks parse the bundled libraries.
  parsed.window.document.querySelectorAll("script").forEach(s => {
    if (s.hasAttribute("data-library")) s.remove();
  });
  const html = parsed.serialize(); parsed.window.close();
  dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: console,
    beforeParse(w: DOMWindow) {
      w.fetch = requests;
      Object.defineProperty(w, "localStorage", { get() { throw new Error("Opaque preview"); } });
      w.matchMedia = (() => ({ matches: true, addEventListener() {} })) as unknown as typeof w.matchMedia;
      w.requestAnimationFrame = () => 1; w.cancelAnimationFrame = () => {}; w.scrollTo = () => {};
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
      w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
      w.HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
        return new Proxy({ canvas: this }, { get(target, name) {
          if (name === "canvas") return target.canvas;
          if (name === "measureText") return () => ({ width: 20 });
          if (String(name).startsWith("create")) return () => ({ addColorStop() {} });
          return () => {};
        }, set() { return true; } });
      } as unknown as typeof w.HTMLCanvasElement.prototype.getContext;
      w.Chart = class { static defaults = { font: {}, plugins: { datalabels: {} } }; static instances = {}; static register() {} destroy() {} };
    },
  });
}
afterEach(() => { dom?.window.close(); vi.useRealTimers(); });
it("registers offline templates with no original customer records or service endpoints", () => {
  expect(DEPLOYED_OS_TEMPLATES).toHaveLength(3);
  for (const t of DEPLOYED_OS_TEMPLATES) {
    const html = source(t.id), page = new JSDOM(html);
    expect(page.window.document.querySelector('meta[name="baalda-template"]')?.getAttribute("content")).toBe(t.id);
    expect(page.window.document.querySelector('script[src],link[rel="stylesheet"],img[src^="http"]')).toBeNull();
    expect(html).not.toMatch(/Naveed Harri|Oskar Johnston|Rob Lucier|cockpitPw|obsidian:\/\/|\/api\/feedback|new EventSource|new WebSocket|\bfetch\(/);
    expect(t.author).toContain("Ben AI"); page.window.close();
  }
});
it("runs Cosmos search, briefing, radar and escaped session captures in an opaque preview", async () => {
  vi.useFakeTimers(); open("cosmos-agentic-os"); await flush();
  expect(node("mode-badge").textContent).toBe("◇ SAMPLE WORKSPACE");
  expect(node("agentlist").children).toHaveLength(7);
  click("#btn-brief"); await flush(); expect(node("brief-body").textContent).toContain("Launch review");
  click("#btn-radar"); await flush(); expect(node("radar-body").textContent).toContain("Northstar Studio");
  click("#searchbtn"); (node("query") as HTMLInputElement).value = "Launch";
  node("query").dispatchEvent(new dom.window.Event("input")); expect(node("results").textContent).toContain("Launch brief");
  click('[data-mode="fulltext"]'); await vi.advanceTimersByTimeAsync(300); expect(node("results").textContent).toContain("Launch brief");
  click("#btn-capture"); (node("capture-text") as HTMLTextAreaElement).value = '<img src=x onerror="alert(1)">';
  click("#capture-send"); await flush();
  expect((node("capture-text") as HTMLTextAreaElement).value).toBe("");
  expect(node("feedlist").textContent).toContain('<img src=x'); expect(node("feedlist").querySelector("img")).toBeNull();
  click("#theme-toggle"); expect(dom.window.document.documentElement.dataset.theme).toBe("light");
  expect(requests).not.toHaveBeenCalled(); expect(errors).toEqual([]);
});
it("defaults Sales to light and connects pages, decisions, notes and playbook dialogs", async () => {
  open("sales-os"); expect(dom.window.document.documentElement.dataset.theme).toBe("light");
  for (const id of ["pipeline", "decisions", "execlog", "context", "caps", "stack", "today"]) {
    click(`[data-t="${id}"]`); dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange"));
    expect(node(id).classList.contains("show")).toBe(true);
  }
  click('[data-action="option:Cedar first"]'); click('[data-action="option:Harbor first"]');
  expect(dom.window.document.querySelector('[data-action="option:Cedar first"]')?.getAttribute("aria-pressed")).toBe("false");
  (node("os-note") as HTMLTextAreaElement).value = "Prepare next week"; click("#save-note");
  expect(node("os-note-status").textContent).toContain("Prepare next week"); expect((node("os-note") as HTMLTextAreaElement).value).toBe("");
  click("[data-prompt]"); expect(node("prompt-dialog").hasAttribute("open")).toBe(true);
  click("#close-prompt"); expect(node("prompt-dialog").hasAttribute("open")).toBe(false);
  click("#theme-toggle"); expect(dom.window.document.documentElement.dataset.theme).toBe("dark");
  await flush(); expect(requests).not.toHaveBeenCalled(); expect(errors).toEqual([]);
});
it("connects Marketing pages, filters, calendar, profiles, themes and reduced motion", () => {
  open("marketing-os"); expect(dom.window.document.documentElement.dataset.theme).toBe("carbon");
  for (const id of ["cal", "content", "camp", "funnel", "perf", "aud", "intel", "team", "system", "today"]) {
    click(`[data-p="${id}"]`); expect(node(`p-${id}`).classList.contains("on")).toBe(true);
  }
  click('[data-filter="Published"]'); expect(node("p-content").querySelectorAll(".vc")).toHaveLength(2);
  click('[data-content="4"]'); expect(node("detail-title").textContent).toBe("A field guide to better briefs"); click("#close-detail");
  click("#next-month"); expect(node("p-cal").textContent).toContain("November 2026");
  click('[data-person="1"]'); expect(node("p-team").textContent).toContain("Taylor Quinn");
  click("[data-complete]"); expect(node("demo-status").textContent).toContain("this session only");
  click("[data-team-back]"); expect(node("p-team").querySelectorAll(".pcard")).toHaveLength(4);
  (node("theme") as HTMLSelectElement).value = "cream"; node("theme").dispatchEvent(new dom.window.Event("change"));
  expect(dom.window.document.documentElement.dataset.theme).toBe("cream"); expect(node("pause-core").textContent).toBe("Resume motion");
  expect(requests).not.toHaveBeenCalled(); expect(errors).toEqual([]);
});

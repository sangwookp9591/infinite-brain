// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DashboardTemplateGallery } from "../DashboardTemplateGallery";
import { DASHBOARD_TEMPLATES } from "../../lib/dashboard/templates";

vi.mock("../VaultDashboardPreview", () => ({ VaultDashboardPreview: ({ path }: { path: string }) => createElement("iframe", { title:path }) }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.callback([{ isIntersecting:true }]); }
    disconnect() {}
  });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("registers the eight Infinite Brain templates in spec order", () => {
  expect(DASHBOARD_TEMPLATES.map(({ id }) => id)).toEqual([
    "ib-daily", "ib-team-hub", "ib-projects", "ib-research",
    "ib-knowledge-map", "ib-weekly-review", "ib-meetings", "ib-blank",
  ]);
  for (const template of DASHBOARD_TEMPLATES) {
    expect(template.author).toBe("Infinite Brain");
    expect(template.source).toBe("Infinite Brain original · Apache-2.0");
    expect(template.previewUrl).toBe(`/dashboard-templates/${template.id}.html`);
    expect(template.thumbnailUrl).toBe(`/dashboard-thumbnails/${template.id}.webp`);
    expect(template.description.length).toBeLessThanOrEqual(110);
    expect(template.prompt).toContain("never invent facts");
    expect(template.loadHtml).toBeTypeOf("function");
  }
});

it("lists all templates as lazy images without starting dashboard scripts, then mounts only the clicked preview", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(createElement(DashboardTemplateGallery, { onUse:vi.fn() })));
  expect(host.querySelectorAll("img[loading='lazy']")).toHaveLength(DASHBOARD_TEMPLATES.length);
  expect(host.querySelectorAll(".dashboard-gallery-card.kit-glow")).toHaveLength(DASHBOARD_TEMPLATES.length);
  expect(host.querySelectorAll("iframe")).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Show preview of Daily"]')!.click());
  expect(host.querySelectorAll("iframe")).toHaveLength(1);
  expect(host.querySelector("iframe")?.title).toBe("Daily preview");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "← All templates")!.click());
  expect(host.querySelectorAll("iframe")).toHaveLength(0);
});

it("opens the saved dashboard only on click while retaining the static card and Current Home label", async () => {
  const onOpen = vi.fn(), onUnset = vi.fn();
  await act(async () => root.render(createElement(DashboardTemplateGallery, { onUse:vi.fn(), saved:{"ib-daily":"My dashboard.html"}, currentId:"ib-daily", onOpen, onUnset })));
  expect(host.textContent).toContain("Current Home");
  expect(host.querySelectorAll("iframe")).toHaveLength(0);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Show preview of Daily"]')!.click());
  expect(host.querySelector("iframe")?.title).toBe("My dashboard.html");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Open")!.click());
  expect(onOpen).toHaveBeenCalledWith("My dashboard.html");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Unset Home")!.click());
  expect(onUnset).toHaveBeenCalledOnce();
});

// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DASHBOARD_TEMPLATES } from "../../lib/dashboard/templates";
import { VaultDashboardsTab } from "../VaultDashboardsTab";

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, read: vi.fn(), gallery: vi.fn() }));
vi.mock("../../store", () => ({ useStore: () => mocks.state }));
vi.mock("../../lib/ipc", () => ({ readNote: mocks.read, onFileChanged: async () => () => {} }));
vi.mock("../DashboardTemplateGallery", () => ({ DashboardTemplateGallery: (props: unknown) => { mocks.gallery(props); return null; } }));

it("recognizes all eight saved templates by their exact id line, regardless of names in content", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const titles = DASHBOARD_TEMPLATES.map(t => ({ id:t.id, path:`${t.id}.html` }));
  mocks.state = { titles, vault:{epoch:1}, personalHomeDocId:"ib-weekly-review", members:[], syncEnabled:false, session:null, vaultAppearance:{} };
  const contents = DASHBOARD_TEMPLATES.map(t => readFileSync(`public/dashboard-templates/${t.id}.html`, "utf8"));
  mocks.read.mockImplementation(async (path: string) => contents[titles.findIndex(n => n.path === path)] + "\nDaily Research Weekly Review");
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => { root.render(createElement(VaultDashboardsTab, {onClose:vi.fn()})); });
    expect(mocks.gallery.mock.lastCall?.[0]).toMatchObject({
      saved:Object.fromEntries(titles.map(n => [n.id,n.path])), currentId:"ib-weekly-review",
    });
    mocks.read.mockResolvedValue("<!-- infinitebrain-template-id: ib-daily-edited -->\nDaily — Infinite Brain original template");
    mocks.state = { ...mocks.state, vault:{epoch:2} };
    await act(async () => { root.render(createElement(VaultDashboardsTab, {onClose:vi.fn()})); });
    expect(mocks.gallery.mock.lastCall?.[0].saved).toEqual({});
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../lib/auth/authManager", () => ({ authManager: { getServerUrl: () => "http://localhost:3010", api: { patchVaultAppearance: vi.fn(), toggleVaultPin: vi.fn() } }, api: {} }));
vi.mock("../lib/sync/docSession", () => ({ syncManager: { isSyncable: () => false, handleRegistryChanged: vi.fn(), prepareSharedHome: vi.fn(), registry: { registerNote: vi.fn(), registerFolder: vi.fn() } } }));
vi.mock("../lib/bridge", () => ({ bridgeManager: {} }));
vi.mock("../components/FileTree", () => ({ iconForPath: () => null, SidebarPresence: () => null }));
import { useStore } from "../store";
import { authManager } from "../lib/auth/authManager";
import { syncManager } from "../lib/sync/docSession";
import { HomeSection, PinnedSection } from "../components/HomeNavigation";
import { readHomeSectionHidden } from "../lib/prefs";
import { readPersonalHome, writePersonalHome, effectiveHomeNote } from "../lib/pins";
import * as ipc from "../lib/ipc";

const vault = { path: "/vault", name: "Vault", epoch: 1 };
const home = { id: "home", path: "Start here.md", title: "Start here" };
const initial = useStore.getInitialState();
const renderHome = () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(HomeSection)));
  const html = host.innerHTML;
  act(() => root.unmount());
  return html;
};

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useStore.setState({ ...initial, vault, titles: [home], personalHomeDocId: home.id,
    syncEnabled: false, session: null, activeVirtualTab: null, openingNotePath: null,
    homeActivation: null, openNote: null,
    openNoteByPath: vi.fn(async (path: string, source?: "home") => {
      useStore.setState({ openNote: { ...home, path }, activeVirtualTab: null, homeNavigationPath: source === "home" ? path : null });
    }),
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Home navigation", () => {
  it("reveals the section when assigning even the existing Home, without expanding the page", async () => {
    useStore.getState().setHomeSectionHidden(true);
    await useStore.getState().setHome(home.path);
    expect(useStore.getState().homeSectionHidden).toBe(false);
    expect(readHomeSectionHidden()).toBe(false);
    expect(useStore.getState().homeActivation).toBeNull();
  });
  it("unsets personal Home when hidden and keeps it unset when the section is shown again", () => {
    writePersonalHome(vault.path, home.id);
    useStore.getState().setHomeSectionHidden(true);
    expect(readHomeSectionHidden()).toBe(true);
    expect(renderHome()).toBe("");
    expect(useStore.getState().personalHomeDocId).toBeNull();
    expect(readPersonalHome(vault.path)).toBeNull();
    useStore.getState().setHomeSectionHidden(false);
    expect(readHomeSectionHidden()).toBe(false);
    expect(renderHome()).toContain("Set a home");
  });
  it("retires an older saved personal Home when loading a vault with Home hidden", () => {
    writePersonalHome(vault.path, home.id);
    expect(readPersonalHome(vault.path, true)).toBeNull();
    expect(readPersonalHome(vault.path)).toBeNull();
  });
  it.each([false, true])("does not land on personal or shared Home after refreshing with the section hidden (shared: %s)", async (shared) => {
    useStore.setState({ homeSectionHidden: true, homeLandingPending: true,
      personalHomeDocId: shared ? null : home.id,
      syncEnabled: shared, session: shared ? { user: { id: "me" }, activeOrganizationId: "org" } as never : null,
      vaultAppearance: { org: { homeDocId: home.id } }, loadVaultAppearance: vi.fn(async () => {}),
    });
    expect(effectiveHomeNote(useStore.getState())).toBeUndefined();
    await useStore.getState().openWelcomeIfPresent();
    expect(useStore.getState().openNoteByPath).not.toHaveBeenCalled();
    expect(useStore.getState().homeLandingPending).toBe(false);
    expect(await useStore.getState().openHome()).toBe(false);
    expect(useStore.getState().homePickerOpen).toBe(false);
  });
  it("disables shared Home locally without publishing a change to the team", async () => {
    const patch = vi.mocked(authManager.api.patchVaultAppearance);
    patch.mockClear();
    useStore.setState({ syncEnabled: true, personalHomeDocId: null,
      session: { user: { id: "me" }, activeOrganizationId: "org" } as never,
      vaultAppearance: { org: { homeDocId: home.id } },
      homeNavigationPath: home.path, openNote: home,
      homeActivation: { vaultPath: vault.path, path: home.path, revision: 1 },
    });
    useStore.getState().setHomeSectionHidden(true);
    expect(useStore.getState().vaultAppearance.org.homeDocId).toBe(home.id);
    expect(useStore.getState().homeNavigationPath).toBeNull();
    expect(useStore.getState().homeActivation).toBeNull();
    expect(patch).not.toHaveBeenCalled();
    useStore.setState({ openNote: null, homeLandingPending: true });
    useStore.getState().receiveVaultAppearance("org", { homeDocId: home.id });
    expect(useStore.getState().openNoteByPath).not.toHaveBeenCalled();
    useStore.getState().setHomeSectionHidden(false);
    expect(renderHome()).toContain("Start here");
  });
  it("cancels a Home open still reading metadata when the section is hidden", async () => {
    let finish!: (value: ipc.NoteMeta | null) => void;
    vi.spyOn(ipc, "getNoteMeta").mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    useStore.setState({ openNoteByPath: initial.openNoteByPath });
    const opening = useStore.getState().openHome(true, true);
    expect(useStore.getState().openingNotePath).toBe(home.path);
    useStore.getState().setHomeSectionHidden(true);
    finish(null);
    await opening;
    expect(useStore.getState().openNote).toBeNull();
    expect(useStore.getState().openingNotePath).toBeNull();
    expect(useStore.getState().homeActivation).toBeNull();
  });
  it("collapses only for explicit sidebar Home activations", async () => {
    await useStore.getState().openHome();
    expect(useStore.getState().homeActivation).toBeNull();
    await useStore.getState().openHome(true, true);
    expect(useStore.getState().homeActivation).toEqual({ vaultPath: "/vault", path: home.path, revision: 1 });
    await useStore.getState().openHome(true, true);
    expect(useStore.getState().homeActivation).toEqual({ vaultPath: "/vault", path: home.path, revision: 2 });
  });

  it("does not collapse an unrelated note after a superseded open", async () => {
    useStore.setState({ openNoteByPath: async () => {
      useStore.setState({ openNote: { id: "other", path: "Other.md", title: "Other" } });
    } });
    await useStore.getState().openHome(true, true);
    expect(useStore.getState().homeActivation).toBeNull();
  });

  it("ignores a late open after the vault epoch changes", async () => {
    useStore.setState({ openNoteByPath: async () => {
      useStore.setState({ vault: { ...vault, epoch: 2 }, openNote: home });
    } });
    await useStore.getState().openHome();
    expect(useStore.getState().homeActivation).toBeNull();
  });

  it("does not publish a collapse when opening fails", async () => {
    useStore.setState({ openNoteByPath: async () => { throw new Error("Unavailable"); } });
    await expect(useStore.getState().openHome()).rejects.toThrow("Unavailable");
    expect(useStore.getState().homeActivation).toBeNull();
  });

  it.each(["Change Home…", "Unset Home"])("keeps %s actionable through WebKit's null-target blur", async (label) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(HomeSection)));
    const menu = host.querySelector("details")!;
    const summary = host.querySelector("summary")!;
    act(() => { menu.open = true; summary.focus(); });
    const button = Array.from(menu.querySelectorAll("button")).find((item) => item.textContent === label)!;
    act(() => {
      button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      summary.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    });
    expect(menu.open).toBe(true);
    await act(async () => button.click());
    expect(menu.open).toBe(false);
    if (label === "Change Home…") expect(useStore.getState().homePickerOpen).toBe(true);
    else {
      expect(useStore.getState().personalHomeDocId).toBeNull();
      expect(useStore.getState().titles).toEqual([home]);
    }
    act(() => root.unmount());
    host.remove();
  });

  it("dismisses Home options on an outside pointer press", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(HomeSection)));
    const menu = host.querySelector("details")!;
    menu.open = true;
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(menu.open).toBe(false);
    act(() => root.unmount());
    host.remove();
  });

  it("shows the effective Home name and current-page marker for a Home visit", async () => {
    await useStore.getState().openHome(true, true);
    const html = renderHome();
    expect(html).toContain('aria-label="Home"');
    expect(html).toContain("Start here");
    expect(html).toContain('aria-current="page"');
  });
  it("highlights Home on automatic startup without collapsing the sidebar", async () => {
    await useStore.getState().openHome(false);
    expect(renderHome()).toContain('aria-current="page"');
    expect(useStore.getState().homeActivation).toBeNull();
  });
  it("does not highlight Home when its original file is opened directly", async () => {
    await useStore.getState().openNoteByPath(home.path);
    expect(renderHome()).not.toContain('aria-current="page"');
  });
  it("offers Unset Home for a personal Home without changing the file", () => {
    const clear = vi.fn(async () => {});
    useStore.setState({ setHome: clear });
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      act(() => root.render(createElement(HomeSection)));
      const button = [...host.querySelectorAll("button")].find((el) => el.textContent === "Unset Home");
      expect(button).toBeDefined();
      act(() => button!.click());
      expect(clear).toHaveBeenCalledWith(null, "personal");
    } finally { act(() => root.unmount()); }
  });
  it("describes shared fallback and restricts clearing shared Home to vault managers", () => {
    useStore.setState({ syncEnabled: true,
      session: { user: { id: "me", name: "Me", email: "me@example.com" }, activeOrganizationId: "org" },
      vaultAppearance: { org: { homeDocId: home.id } }, members: [],
    });
    expect(renderHome()).toContain("Use vault Home instead");
    expect(renderHome()).not.toContain("Unset vault Home for everyone");
    useStore.setState({ members: [{ id: "membership", userId: "me", organizationId: "org", role: "admin" }] });
    expect(renderHome()).toContain("Unset vault Home for everyone");
  });

  it("follows a live shared Home change while visiting Home, without interrupting an ordinary file", async () => {
    const next = { id: "next", path: "Dashboards/Next.html", title: "Next" };
    useStore.setState({ syncEnabled: true, personalHomeDocId: null,
      session: { user: { id: "me", name: "Me", email: "me@example.com" }, activeOrganizationId: "org" },
      vaultAppearance: { org: { homeDocId: home.id } }, titles: [home, next],
      openNote: home, homeNavigationPath: home.path,
    });
    useStore.getState().receiveVaultAppearance("org", { homeDocId: next.id });
    expect(useStore.getState().openNoteByPath).toHaveBeenCalledWith(next.path, "home");
    vi.mocked(useStore.getState().openNoteByPath).mockClear();
    useStore.setState({ homeNavigationPath: null, openNote: home });
    useStore.getState().receiveVaultAppearance("org", { homeDocId: home.id });
    expect(useStore.getState().openNoteByPath).not.toHaveBeenCalled();
  });

  it("requests missing shared Home and pin files through normal sync when the setting arrives first", () => {
    const refreshTitles = vi.fn(async () => {}), refreshTree = vi.fn(async () => {});
    useStore.setState({ syncEnabled: true, personalHomeDocId: null,
      session: { user: { id: "me", name: "Me", email: "me@example.com" }, activeOrganizationId: "org" },
      vaultAppearance: {}, refreshTitles, refreshTree,
    });
    const settings = { homeDocId: "new-home", pinnedItems: [{ kind: "note" as const, docId: "new-pin" }] };
    useStore.getState().receiveVaultAppearance("org", settings);
    expect(syncManager.handleRegistryChanged).toHaveBeenCalledWith("shared-navigation");
    expect(refreshTitles).toHaveBeenCalledOnce();
    expect(refreshTree).toHaveBeenCalledOnce();
    expect(useStore.getState().vaultAppearance.org).toEqual(settings);
    useStore.getState().receiveVaultAppearance("org", settings);
    expect(refreshTitles).toHaveBeenCalledOnce();
  });

  it("offers templates without overwriting an unavailable Home preference", async () => {
    useStore.setState({ titles: [] });
    expect(renderHome()).toContain("Set a home");
    const requested = vi.fn();
    window.addEventListener("baalda:new-dashboard", requested);
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      act(() => root.render(createElement(HomeSection)));
      act(() => host.querySelector("button")!.click());
      expect(requested).toHaveBeenCalledOnce();
      expect(useStore.getState().personalHomeDocId).toBe(home.id);
      expect(useStore.getState().homePickerOpen).toBe(false);
    } finally {
      act(() => root.unmount());
      window.removeEventListener("baalda:new-dashboard", requested);
    }
    expect(useStore.getState().homeActivation).toBeNull();
  });
});


it("settles a shared Home under its canonical synced identity before publishing it", async () => {
  useStore.setState({ syncEnabled: true, session: { user: { id: "owner" }, activeOrganizationId: "org" } as never,
    refreshTitles: vi.fn(async () => {}), refreshTree: vi.fn(async () => {}) });
  const calls: string[] = [];
  vi.mocked(syncManager.registry.registerNote).mockResolvedValue({ docId: "canonical-home", vaultId: "collection" });
  vi.mocked(syncManager.prepareSharedHome).mockImplementation(async () => { calls.push("content-confirmed"); });
  vi.mocked(authManager.api.patchVaultAppearance).mockImplementation(async (_org, settings) => {
    calls.push("published"); return { settings, updatedAt: null, updatedBy: null };
  });
  await useStore.getState().setHome(home.path, "vault");
  expect(calls).toEqual(["content-confirmed", "published"]);
  expect(syncManager.prepareSharedHome).toHaveBeenCalledWith("canonical-home", home.path, 1);
  expect(authManager.api.patchVaultAppearance).toHaveBeenCalledWith("org", { homeDocId: "canonical-home" });
  expect(useStore.getState().personalHomeDocId).toBeNull();
});

it("pins a new note using its canonical server identity", async () => {
  useStore.setState({ syncEnabled: true, session: { user: { id: "owner" }, activeOrganizationId: "org" } as never,
    refreshTitles: vi.fn(async () => {}), refreshTree: vi.fn(async () => {}) });
  vi.mocked(syncManager.registry.registerNote).mockResolvedValue({ docId: "canonical-note", vaultId: "collection" });
  vi.mocked(authManager.api.toggleVaultPin).mockResolvedValue({ settings: { pinnedItems: [{ kind: "note", docId: "canonical-note" }] }, updatedAt: null, updatedBy: null });
  await useStore.getState().togglePin(home.path, false, "vault");
  expect(authManager.api.toggleVaultPin).toHaveBeenCalledWith("org", { kind: "note", docId: "canonical-note" });
});


describe("Pinned options", () => {
  it.each(["owner", "admin", "member"])("offers shared Unpin only to managers (%s)", async (role) => {
    const togglePin = vi.fn(async () => {});
    useStore.setState({ syncEnabled: true,
      session: { user: { id: "me" }, activeOrganizationId: "org" } as never,
      members: [{ id: "membership", userId: "me", organizationId: "org", role }],
      vaultAppearance: { org: { pinnedItems: [{ kind: "note", docId: home.id }] } },
      personalPins: [], togglePin, automaticItemColors: false,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      act(() => root.render(createElement(PinnedSection)));
      const options = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
      if (role === "member") { expect(options).toBeNull(); return; }
      await act(async () => options!.click());
      const action = document.querySelector<HTMLElement>('[role="menuitemradio"]')!;
      expect(action.textContent).toContain("Unpin for everyone");
      await act(async () => action.click());
      expect(togglePin).toHaveBeenCalledWith(home.path, false, "vault");
      expect(useStore.getState().openNoteByPath).not.toHaveBeenCalled();
    } finally { act(() => root.unmount()); host.remove(); }
  });

  it("unpins personal notes through their options without opening the file", async () => {
    const togglePin = vi.fn(async () => {});
    useStore.setState({ personalPins: [{ kind: "note", docId: home.id }], togglePin, automaticItemColors: false });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      act(() => root.render(createElement(PinnedSection)));
      await act(async () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
      const action = document.querySelector<HTMLElement>('[role="menuitemradio"]')!;
      expect(action.textContent).toContain("Unpin");
      await act(async () => action.click());
      expect(togglePin).toHaveBeenCalledWith(home.path, false, "personal");
      expect(useStore.getState().openNoteByPath).not.toHaveBeenCalled();
    } finally { act(() => root.unmount()); host.remove(); }
  });
});

// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: {
    vault: { epoch: 7, name: "Vault" }, syncEnabled: false,
    session: null as { user: { id: string; name: string } } | null,
    titles: [{ id: "home", path: "Home.html", title: "Home" }, { id: "note", path: "Notes/A.md", title: "A" }],
    docSyncState: {} as Record<string, string>, docIdByPath: {} as Record<string, string>,
    openNoteByPath: vi.fn(),
  },
  invoke: vi.fn(), queryNotes: vi.fn(), listNotes: vi.fn(),
  ipc: { searchNotes: vi.fn(), getBacklinks: vi.fn(), getGraphEdges: vi.fn(), getNoteUiState: vi.fn(), setNoteUiState: vi.fn(), vaultStats: vi.fn(), openExternal: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../../store", () => ({ useStore: { getState: () => mocks.state } }));
vi.mock("../../auth/authManager", () => ({ authManager: { api: { listNotes: mocks.listNotes } } }));
vi.mock("../../sync/docSession", () => ({ syncManager: { registry: { vaultId: "server-vault" } } }));
vi.mock("../../ipc", () => mocks.ipc);
vi.mock("../queries", () => ({ queryNotes: mocks.queryNotes }));

import { dashboardHost } from "../host";

const home = { id: "home", path: "Home.html", title: "Home", mtime: 1, frontmatter: null, tags: [] };
const note = { id: "note", path: "Notes/A.md", title: "A", mtime: 2, frontmatter: '{"status":"active"}', tags: ["project"] };
const secret = { id: "secret", path: "Private.md", title: "Private", mtime: 3, frontmatter: '{"private":"secret-value"}', tags: ["secret-tag"] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.vault.epoch = 7;
  mocks.state.syncEnabled = false;
  mocks.state.session = null;
  mocks.state.titles = [home, note];
  mocks.state.docSyncState = {};
  mocks.state.docIdByPath = {};
  mocks.invoke.mockResolvedValue("safe note");
  mocks.listNotes.mockResolvedValue([{ id: "home" }, { id: "note" }]);
  mocks.queryNotes.mockImplementation(async (query) => [home, note, secret].filter((row) => !query.docIds || query.docIds.includes(row.id)));
  mocks.ipc.searchNotes.mockResolvedValue([note, secret]);
  mocks.ipc.getGraphEdges.mockResolvedValue([{ source: "home", target: "note" }, { source: "home", target: "secret" }]);
  mocks.ipc.getNoteUiState.mockResolvedValue(null);
  mocks.ipc.setNoteUiState.mockResolvedValue(undefined);
  mocks.ipc.vaultStats.mockResolvedValue({ notes: { count: 2 } });
});
function synced() {
  mocks.state.syncEnabled = true;
  mocks.state.session = { user: { id: "user", name: "User" } };
  mocks.state.titles = [home, note, secret];
  mocks.state.docIdByPath = { "Home.html": "home", "Notes/A.md": "note", "Private.md": "secret" };
}

describe("dashboard host reads", () => {
  it("uses the guarded epoch reader and rejects private paths even if indexed", async () => {
    const host = dashboardHost(7, "home", () => {});
    expect(await host["notes.read"]("note")).toBe("safe note");
    expect(mocks.invoke).toHaveBeenCalledWith("dashboard_read_note", { path: "Notes/A.md", epoch: 7 });
    mocks.state.titles.push({ id: "hidden", path: ".context/secret.md", title: "Secret" });
    await expect(host["notes.read"]({ docId: "hidden" })).rejects.toThrow("Note unavailable");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it("filters stale indexed notes against a fresh server answer", async () => {
    synced();
    const host = dashboardHost(7, "home", () => {});
    expect(await host["notes.list"]({})).toEqual([home, note]);
    expect(await host["notes.search"]({ q: "project" })).toEqual([note]);
    await expect(host["notes.read"]("secret")).rejects.toThrow("Note unavailable");
    mocks.listNotes.mockResolvedValue([{ id: "home" }]);
    expect(await host["notes.list"]({})).toEqual([home]);
    await expect(host["notes.read"]("note")).rejects.toThrow("Note unavailable");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("fails closed when the server cannot confirm access and rejects mismatched mappings", async () => {
    synced();
    const host = dashboardHost(7, "home", () => {});
    mocks.state.docIdByPath["Notes/A.md"] = "another-id";
    expect(await host["notes.list"]({})).toEqual([home]);
    mocks.listNotes.mockRejectedValue(new Error("offline"));
    await expect(host["notes.list"]({})).rejects.toThrow("offline");
    mocks.listNotes.mockResolvedValue([{ id: "note" }]);
    await expect(host["notes.list"]({})).rejects.toThrow("Dashboard unavailable");
  });
  it("only aggregates readable metadata and hides Health's private census", async () => {
    synced();
    const host = dashboardHost(7, "home", () => {});
    expect(await host["tags.list"](undefined)).toEqual([{ name: "project", count: 1 }]);
    expect(await host["properties.keys"](undefined)).toEqual([{ key: "status", count: 1 }]);
    expect(await host["properties.values"]({ key: "status" })).toEqual(["active"]);
    expect(await host["graph.edges"](undefined)).toEqual([{ source: "home", target: "note" }]);
    expect(await host["vault.stats"](undefined)).toMatchObject({ notes: { count: 2 }, tags: 1, links: 1 });
    expect(mocks.ipc.vaultStats).not.toHaveBeenCalled();
    expect(mocks.queryNotes).toHaveBeenCalledWith({ docIds: ["home", "note"], limit: 200 }, 7);
  });
  it("passes the inverted registry and epoch to local stats", async () => {
    mocks.state.docIdByPath = { "Notes/A.md": "note" };
    const host = dashboardHost(7, "home", () => {});
    await host["vault.stats"](undefined);
    expect(mocks.ipc.vaultStats).toHaveBeenCalledWith({ note: "Notes/A.md" }, 7);
  });
  it("rejects untrusted shortcut modifiers before dispatch", () => {
    const host = dashboardHost(7, "home", () => {});
    expect(() => host["app.keydown"]({ key: "k", ctrlKey: "yes" })).toThrow("Unsupported shortcut");
    expect(() => host["app.keydown"]({ key: "r", ctrlKey: true })).toThrow("Unsupported shortcut");
  });
  it("shares concurrent permission reads without retaining a settled authority", async () => {
    synced();
    let finish!: (notes: { id: string }[]) => void;
    mocks.listNotes.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const host = dashboardHost(7, "home", () => {});
    const list = host["notes.list"]({}), search = host["notes.search"]({ q: "A" });
    expect(mocks.listNotes).toHaveBeenCalledTimes(1);
    finish([{ id: "home" }, { id: "note" }]); await Promise.all([list, search]);
    mocks.listNotes.mockResolvedValue([{ id: "home" }]);
    expect(await host["notes.list"]({})).toEqual([home]);
    expect(mocks.listNotes).toHaveBeenCalledTimes(2);
  });
  it("refuses an in-flight read after the vault switches", async () => {
    let done!: (value: string) => void;
    mocks.invoke.mockImplementation(() => new Promise<string>((resolve) => { done = resolve; }));
    const host = dashboardHost(7, "home", () => {});
    const work = host["notes.read"]("note");
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
    mocks.state.vault.epoch = 8; done("old value");
    await expect(work).rejects.toThrow("Vault changed");
  });
});

describe("dashboard UI state", () => {
  it("preserves editor fields and repairs only a malformed dashboard namespace", async () => {
    mocks.ipc.getNoteUiState.mockResolvedValue('{"v":1,"folds":[{"line":4}],"dashboard":"old-invalid"}');
    const host = dashboardHost(7, "home", () => {});
    await host["state.set"]({ key: "widget", value: { collapsed: true } });
    const [, serialized, epoch] = mocks.ipc.setNoteUiState.mock.calls[0];
    expect(JSON.parse(serialized)).toEqual({ v: 1, folds: [{ line: 4 }], dashboard: { widget: { collapsed: true } } });
    expect(epoch).toBe(7);
    expect(() => host["state.set"]({ key: "__proto__", value: {} })).toThrow("Invalid state key");
  });
  it("serializes reload scroll reads after accepted writes from the old host", async () => {
    let finish!: () => void, saved: string | null = null;
    mocks.ipc.getNoteUiState.mockImplementation(async () => saved);
    mocks.ipc.setNoteUiState.mockImplementation((_, value) => new Promise<void>((resolve) => { finish = () => { saved = value; resolve(); }; }));
    const old = dashboardHost(7, "home", () => {});
    const write = old["state.set"]({ key: "__scroll", value: [0, 450] });
    await vi.waitFor(() => expect(mocks.ipc.setNoteUiState).toHaveBeenCalled());
    const replacement = dashboardHost(7, "home", () => {});
    const restore = replacement["state.get"]({ key: "__scroll" });
    finish(); await write;
    expect(await restore).toEqual([0, 450]);
  });
});

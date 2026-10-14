// SPDX-License-Identifier: Apache-2.0
import { invoke } from "@tauri-apps/api/core";
import * as ipc from "../ipc";
import { authManager } from "../auth/authManager";
import { syncManager } from "../sync/docSession";
import { useStore } from "../../store";
import { DASHBOARD_PROTOCOL, dashboardExternalUrl, dashboardPath, type DashboardMethods } from "./bridge";
import { queryNotes, type DashboardNote, type NoteQuery } from "./queries";

function object(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 4096): string {
  if (typeof value !== "string" || value.length > max) throw new Error("Expected text");
  return value;
}
function limit(value: unknown, fallback = 50): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid limit");
  return Math.min(200, Math.floor(value));
}
function propertyObject(note: DashboardNote): Record<string, unknown> {
  try { return object(note.frontmatter ? JSON.parse(note.frontmatter) : {}); } catch { return {}; }
}
// A watcher reload creates a new host, but its scroll restore must wait for the
// old frame's already-accepted state write. Entries disappear when work settles.
const stateQueues = new Map<string, Promise<unknown>>();

export function dashboardTheme() {
  const css = getComputedStyle(document.documentElement);
  const names: Record<string, string> = { "--bg": "--bg-app", "--fg": "--text-primary", "--surface": "--bg-surface", "--muted": "--text-secondary", "--accent": "--accent", "--accent-soft": "--accent-soft", "--border": "--border" };
  return { theme: document.documentElement.dataset.theme ?? "light", tokens: Object.fromEntries(Object.entries(names).map(([key, token]) => [key, css.getPropertyValue(token).trim()])) };
}

/** Local reads are epoch-pinned. Synced guests additionally require a fresh
 * server-readable listing; a local title/cache never supplies that authority. */
export function dashboardHost(epoch: number, docId: string, focusHost: () => void): DashboardMethods {
  const initial = useStore.getState();
  const synced = initial.syncEnabled;
  const userId = initial.session?.user.id;
  const vaultId = synced ? syncManager.registry.vaultId : null;
  let readableInFlight: Promise<Set<string> | null> | undefined;
  function current() {
    const store = useStore.getState();
    if (store.vault?.epoch !== epoch || store.syncEnabled !== synced || store.session?.user.id !== userId) throw new Error("Vault changed");
    if (["no-access", "deleted"].includes(String(store.docSyncState[docId] ?? ""))) throw new Error("Dashboard unavailable");
  }
  function visible(id: string, path: string): boolean {
    const store = useStore.getState();
    try { dashboardPath(path); } catch { return false; }
    return !["no-access", "deleted"].includes(String(store.docSyncState[id] ?? ""))
      && (!synced || store.docIdByPath[path] === id)
      && store.titles.some((note) => note.id === id && note.path === path);
  }
  function permitted(note: { id: string; path: string }, readable: Set<string> | null) {
    return visible(note.id, note.path) && (readable === null || readable.has(note.id));
  }
  async function readable(): Promise<Set<string> | null> {
    current();
    if (!synced) return null;
    if (!vaultId || !userId || syncManager.registry.vaultId !== vaultId) throw new Error("Vault access unavailable");
    // Share only concurrent requests. Keeping a settled cache would let a
    // revoked note leak until a timer or UI title refresh caught up.
    if (!readableInFlight) readableInFlight = authManager.api.listNotes(vaultId).then((notes) => {
      current();
      const ids = new Set(notes.map((note) => note.docId ?? note.doc_id ?? note.id));
      if (!ids.has(docId)) throw new Error("Dashboard unavailable");
      return ids;
    });
    const pending = readableInFlight;
    try { return await pending; } finally { if (readableInFlight === pending) readableInFlight = undefined; }
  }
  async function resolve(value: unknown) {
    current();
    const params = typeof value === "string" ? { path: value } : object(value);
    const input = params.docId ?? params.path;
    text(input, 4096);
    const note = useStore.getState().titles.find((row) => params.docId ? row.id === input : row.path === input || row.id === input);
    const allowed = await readable();
    current();
    if (!note || !permitted(note, allowed)) throw new Error("Note unavailable");
    return note;
  }
  async function rows<T extends { id: string; path: string }>(work: Promise<T[]>): Promise<T[]> {
    const [result, allowed] = await Promise.all([work, readable()]);
    current();
    return result.filter((row) => permitted(row, allowed));
  }
  async function metadata(): Promise<DashboardNote[]> {
    const allowed = await readable();
    current();
    const ids = useStore.getState().titles.filter((note) => permitted(note, allowed)).map((note) => note.id);
    if (ids.length > 10000) throw new Error("Aggregate is too large; use a filtered notes.list query");
    const result: DashboardNote[] = [];
    for (let start = 0; start < ids.length; start += 200) {
      current();
      const query = { docIds: ids.slice(start, start + 200), limit: 200 };
      const notes = await queryNotes(query, epoch);
      current();
      result.push(...notes.filter((note) => permitted(note, allowed)));
    }
    // Re-check after a potentially long aggregate instead of returning data
    // authorized before a revocation that arrived during the batches.
    const latest = await readable();
    return result.filter((note) => permitted(note, latest));
  }
  function stateKey(value: unknown) {
    const key = text(object(value).key, 100);
    if (!key || ["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Invalid state key");
    return key;
  }
  function uiState(value: unknown, write: boolean) {
    const key = stateKey(value), params = object(value), queueKey = `${epoch}:${docId}`;
    const work = (stateQueues.get(queueKey) ?? Promise.resolve()).catch(() => {}).then(async () => {
      current();
      await readable();
      const raw = await ipc.getNoteUiState(docId, epoch);
      current();
      let state: Record<string, unknown> = {};
      try { state = object(raw ? JSON.parse(raw) : {}); } catch { /* old/bad UI state is disposable */ }
      let dashboard: Record<string, unknown> = Object.create(null);
      try { dashboard = Object.assign(dashboard, object(state.dashboard)); } catch { /* only discard this namespace */ }
      if (!write) return dashboard[key] ?? null;
      dashboard[key] = params.value ?? null;
      const serialized = JSON.stringify({ ...state, dashboard });
      if (serialized.length > 64 * 1024) throw new Error("Dashboard state exceeds 64 KB");
      current();
      await ipc.setNoteUiState(docId, serialized, epoch);
      current();
      return null;
    });
    stateQueues.set(queueKey, work);
    void work.then(() => { if (stateQueues.get(queueKey) === work) stateQueues.delete(queueKey); }, () => { if (stateQueues.get(queueKey) === work) stateQueues.delete(queueKey); });
    return work;
  }
  return {
    "vault.info": () => {
      current(); const store = useStore.getState();
      return { name: store.vault?.name, user: store.session?.user.name ?? null, platform: document.documentElement.dataset.platform ?? "other", ...dashboardTheme() };
    },
    "notes.search": async (value) => {
      current(); const params = object(value), count = limit(params.limit);
      return (await rows(ipc.searchNotes(text(params.q, 1000)))).slice(0, count);
    },
    "notes.list": async (value) => {
      current(); const query = object(value);
      const count = limit(query.limit);
      return rows(queryNotes({ ...query, limit: count } as NoteQuery, epoch));
    },
    "notes.read": async (value) => {
      const note = await resolve(value);
      const result = await invoke<string>("dashboard_read_note", { path: note.path, epoch });
      current();
      if (!permitted(note, await readable())) throw new Error("Note unavailable");
      return result;
    },
    "notes.meta": async (value) => {
      const note = await resolve(value);
      const query = { docIds: [note.id], limit: 1 };
      return (await rows(queryNotes(query, epoch)))[0] ?? null;
    },
    "notes.backlinks": async (value) => { const note = await resolve(value); return rows(ipc.getBacklinks(note.id)); },
    "graph.edges": async () => {
      current();
      const [edges, allowed] = await Promise.all([ipc.getGraphEdges(), readable()]);
      current();
      const ids = new Set(useStore.getState().titles.filter((note) => permitted(note, allowed)).map((note) => note.id));
      return edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    },
    "tags.list": async () => {
      const counts = new Map<string, number>();
      for (const note of await metadata()) for (const tag of new Set(note.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 200);
    },
    "properties.keys": async () => {
      const counts = new Map<string, number>();
      for (const note of await metadata()) for (const key of Object.keys(propertyObject(note))) counts.set(key, (counts.get(key) ?? 0) + 1);
      return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 200);
    },
    "properties.values": async (value) => {
      const key = text(object(value).key, 100), values = new Set<string>();
      for (const note of await metadata()) {
        const props = propertyObject(note);
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
        const found = props[key];
        for (const member of Array.isArray(found) ? found : [found]) {
          if (member !== null && ["string", "number", "boolean"].includes(typeof member)) values.add(String(member));
        }
      }
      return [...values].sort().slice(0, 200);
    },
    "vault.stats": async () => {
      current();
      const store = useStore.getState();
      const liveDocs = Object.fromEntries(Object.entries(store.docIdByPath).map(([path, id]) => [id, path]));
      if (!synced) { const result = await ipc.vaultStats(liveDocs, epoch); current(); return result; }
      // Health's raw disk census includes orphan histories and local remnants
      // that are not readable. A synced page gets only its authorized notes.
      const notes = await metadata(), paths = new Set(notes.map((note) => note.path)), ids = new Set(notes.map((note) => note.id));
      const folders = new Set<string>();
      for (const path of paths) { const parts = path.split("/"); parts.pop(); while (parts.length) { folders.add(parts.join("/")); parts.pop(); } }
      const edges = await ipc.getGraphEdges(); current();
      const now = Date.now();
      return { computedAt: now, notes: { count: notes.length }, folders: folders.size, tags: new Set(notes.flatMap((note) => note.tags)).size,
        links: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).length,
        activity: { modifiedLast7d: notes.filter((note) => note.mtime * 1000 >= now - 7 * 86400000).length, modifiedLast30d: notes.filter((note) => note.mtime * 1000 >= now - 30 * 86400000).length } };
    },
    "state.get": (value) => uiState(value, false),
    "state.set": (value) => uiState(value, true),
    "app.open": async (value) => { const note = await resolve(value); current(); await useStore.getState().openNoteByPath(note.path); return null; },
    "app.openExternal": (value) => { current(); return ipc.openExternal(dashboardExternalUrl(object(value).url)); },
    "app.keydown": (value) => {
      current(); const params = object(value), key = text(params.key, 20);
      if (key !== "Escape" && (!(params.metaKey === true || params.ctrlKey === true) || !["k", "p", "w", "f", "g", "h", "tab", "[", "]"].includes(key.toLowerCase()))) throw new Error("Unsupported shortcut");
      focusHost();
      window.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: params.metaKey === true, ctrlKey: params.ctrlKey === true, shiftKey: params.shiftKey === true, altKey: params.altKey === true, bubbles: true, cancelable: true }));
      return null;
    },
  };
}

export function pushDashboardTheme(frame: HTMLIFrameElement) {
  frame.contentWindow?.postMessage({ channel: DASHBOARD_PROTOCOL, event: "theme", result: dashboardTheme() }, "*");
}

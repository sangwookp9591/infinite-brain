// SPDX-License-Identifier: Apache-2.0

export type PinnedItem = { kind: "note"; docId: string } | { kind: "folder"; path: string };
const ID = /^[A-Za-z0-9._-]{1,128}$/;
export function validPin(value: unknown): value is PinnedItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "note") return typeof v.docId === "string" && ID.test(v.docId) && Object.keys(v).length === 2;
  return v.kind === "folder" && typeof v.path === "string" && v.path.length > 0 && v.path.length <= 4096 &&
    !/[\\\x00]/.test(v.path) && !v.path.startsWith("/") &&
    v.path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.startsWith(".")) && Object.keys(v).length === 2;
}
export function pinKey(pin: PinnedItem): string {
  return pin.kind === "note" ? `note:${pin.docId}` : `folder:${pin.path.toLocaleLowerCase()}`;
}
export function parsePins(raw: unknown): PinnedItem[] {
  return Array.isArray(raw) ? raw.filter(validPin).slice(0, 200) : [];
}
export function mergePins(shared: readonly PinnedItem[], personal: readonly PinnedItem[]) {
  const seen = new Set<string>();
  return [...shared.map((item) => ({ item, shared: true })), ...personal.map((item) => ({ item, shared: false }))]
    .filter(({ item }) => !seen.has(pinKey(item)) && !!seen.add(pinKey(item)));
}
/** Hide unavailable references, retaining preferences for recovery and partial startup lists. */
export function visiblePinnedItems(
  shared: readonly PinnedItem[], personal: readonly PinnedItem[],
  notes: readonly { id: string; path: string }[], folderAvailable: (path: string) => boolean,
) {
  const paths = new Map(notes.map((note) => [note.id, note.path]));
  return mergePins(shared, personal).flatMap(({ item, shared }) => {
    const path = item.kind === "note" ? paths.get(item.docId) : folderAvailable(item.path) ? item.path : null;
    return path ? [{ item, shared, path }] : [];
  });
}
export function togglePinned(items: readonly PinnedItem[], item: PinnedItem): PinnedItem[] {
  return items.some((p) => pinKey(p) === pinKey(item))
    ? items.filter((p) => pinKey(p) !== pinKey(item)) : [...items, item].slice(0, 200);
}
export function renamePinnedFolders(items: readonly PinnedItem[], from: string, to: string): PinnedItem[] {
  return items.map((item) => item.kind === "folder" &&
    (item.path.toLowerCase() === from.toLowerCase() || item.path.toLowerCase().startsWith(from.toLowerCase() + "/"))
    ? { kind: "folder", path: to + item.path.slice(from.length) } : item);
}
export function resolveHome(personal: string | null, shared: string | null | undefined): string | null {
  return personal ?? shared ?? null;
}
/** The same effective Home identity drives navigation and dashboard actions. */
export function effectiveHomeNote(state: {
  homeSectionHidden?: boolean;
  personalHomeDocId: string | null;
  syncEnabled: boolean;
  session: { activeOrganizationId?: string | null } | null;
  vaultAppearance: Record<string, { homeDocId?: string | null }>;
  titles: readonly { id: string; path: string }[];
}) {
  if (state.homeSectionHidden) return undefined;
  const orgId = state.syncEnabled ? state.session?.activeOrganizationId : null;
  const homeId = resolveHome(state.personalHomeDocId, orgId ? state.vaultAppearance[orgId]?.homeDocId : null);
  return state.titles.find((note) => note.id === homeId);
}
/** Home navigation highlights the shortcut; direct file navigation highlights the file. */
export function isHomeNavigation(state: Parameters<typeof effectiveHomeNote>[0] & {
  homeNavigationPath: string | null;
  openNote: { path: string } | null;
  activeVirtualTab: string | null;
}): boolean {
  const home = effectiveHomeNote(state);
  return !!home && !state.activeVirtualTab && state.homeNavigationPath === home.path && state.openNote?.path === home.path;
}
/** Follow a changed shared Home only while visiting Home, never interrupt a file edit. */
export function shouldFollowSharedHome(state: Parameters<typeof isHomeNavigation>[0]): boolean {
  const home = effectiveHomeNote(state);
  return !state.personalHomeDocId && !!home && !state.activeVirtualTab &&
    !!state.homeNavigationPath && state.homeNavigationPath === state.openNote?.path &&
    state.openNote.path !== home.path;
}
/** Only today's effective Home owns the temporary full-width layout. */
export function homeSidebarVisitKey(state: Parameters<typeof effectiveHomeNote>[0] & {
  vault: { path: string } | null;
  openNote: { path: string } | null;
  activeVirtualTab: string | null;
  homeActivation: { vaultPath: string; path: string; revision: number } | null;
}): string | null {
  const home = effectiveHomeNote(state);
  if (!state.vault || !home || state.activeVirtualTab || state.openNote?.path !== home.path) return null;
  const activation = state.homeActivation;
  if (activation?.vaultPath !== state.vault.path || activation.path !== home.path) return null;
  return `${state.vault.path}/${home.id}/${home.path}:${activation.revision}`;
}
/** Repeated Home activation toggles only its current visit, never the saved preference. */
export function nextHomeSidebarShown(shown: string | null, previousVisit: string | null, nextVisit: string | null, toggle: boolean): string | null {
  const sameHome = previousVisit && nextVisit &&
    previousVisit.slice(0, previousVisit.lastIndexOf(":")) === nextVisit.slice(0, nextVisit.lastIndexOf(":"));
  return toggle && sameHome && shown !== previousVisit ? nextVisit : null;
}
export function isDashboard(path: string): boolean {
  return /\.(html?|url|webloc)$/i.test(path);
}
export function readPersonalPins(vault: string | undefined): PinnedItem[] {
  if (!vault) return [];
  try { return parsePins(JSON.parse(localStorage.getItem(`context.pins:${vault}`) ?? "[]")); } catch { return []; }
}
export function readPersonalHome(vault: string | undefined, hidden = false): string | null {
  if (!vault) return null;
  // Retire preferences saved before hiding Home also disabled it.
  if (hidden) { writePersonalHome(vault, null); return null; }
  try { const v = localStorage.getItem(`context.home:${vault}`); return v && ID.test(v) ? v : null; } catch { return null; }
}
export function writePersonalPins(vault: string, pins: PinnedItem[]) {
  try { localStorage.setItem(`context.pins:${vault}`, JSON.stringify(pins)); } catch { /* device storage unavailable */ }
}
export function writePersonalHome(vault: string, docId: string | null) {
  try { if (docId) localStorage.setItem(`context.home:${vault}`, docId); else localStorage.removeItem(`context.home:${vault}`); } catch { /* device storage unavailable */ }
}

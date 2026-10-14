// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useStore } from "../store";
import { requestNewDashboard as dispatchNewDashboard, type DashboardCreationIntent } from "../lib/homeEvents";
import { mergePins, visiblePinnedItems, pinKey, effectiveHomeNote, isHomeNavigation } from "../lib/pins";
import { displayName } from "../lib/notePath";
import { nodeAt } from "../lib/tree/lazyTree";
import { itemColorValue, itemColorFill, automaticTreeColors } from "../lib/appearance";
import { applyOrder } from "../lib/ordering";
import { sortTree } from "../lib/tree/sort";
import { effectiveLockForPath, lockScopesByPath, LOCK_TITLES } from "../lib/locks";
import { iconForPath, SidebarPresence } from "./FileTree";
import { toast } from "../lib/toast";
import { MenuSelect } from "./MenuSelect";
import "./HomeNavigation.css";

export function requestNewDashboard(kind?: "link", intent?: DashboardCreationIntent) {
  useStore.setState({ homePickerOpen: false });
  dispatchNewDashboard(kind, intent);
}
const onError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), "error");

export function HomeSection() {
  const st = useStore();
  const home = effectiveHomeNote(st);
  const menu = useRef<HTMLDetailsElement>(null);
  const orgId = st.syncEnabled ? st.session?.activeOrganizationId : null;
  const sharedHome = orgId ? st.vaultAppearance[orgId]?.homeDocId : null;
  const canManage = !!orgId && st.members.some((member) => member.userId === st.session?.user.id && (member.role === "owner" || member.role === "admin"));
  const closeMenu = () => { if (menu.current) menu.current.open = false; };
  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, []);
  if (st.homeSectionHidden) return null;
  const selected = isHomeNavigation(st);
  const label = home ? displayName(home.path.split("/").pop() ?? home.path, false) : "Set a home";
  return <section className="home-section" aria-label="Home">
    <div className="pinned-label">Home</div>
    <div className="home-sidebar-entry" onContextMenu={(event) => {
      if (!menu.current) return;
      event.preventDefault(); menu.current.open = true;
      menu.current.querySelector<HTMLButtonElement>("button")?.focus();
    }}>
    <button className={`home-sidebar-row${selected ? " selected" : ""}${!home ? " is-unset" : ""}`}
      aria-current={selected ? "page" : undefined}
      title={home ? `Open Home: ${home.path}` : "Choose a template for your Home dashboard"}
      onClick={() => { if (home) void st.openHome(true, true).catch(onError); else requestNewDashboard(undefined, { setAsHome: true }); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z" /></svg>
      <span>{label}</span>
    </button>
    <details ref={menu} className="home-sidebar-menu"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      // WebKit may blur the summary with no relatedTarget before a menu button
      // click. Outside pointerdown handles that case without removing its target.
      onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) closeMenu(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeMenu(); menu.current?.querySelector<HTMLElement>("summary")?.focus(); } }}>
      <summary className="icon-btn" aria-label="Home options" title="Home options">···</summary>
      <div className="home-sidebar-menu-items">
        <button type="button" onClick={() => { closeMenu(); useStore.setState({ homePickerOpen: true }); }}>Change Home…</button>
        {st.personalHomeDocId && <button type="button" onClick={() => { closeMenu(); void st.setHome(null, "personal").catch(onError); }}>{sharedHome ? "Use vault Home instead" : "Unset Home"}</button>}
        {sharedHome && canManage && <button type="button" onClick={() => { closeMenu(); void st.setHome(null, "vault").catch(onError); }}>Unset vault Home for everyone</button>}
        <button type="button" onClick={() => { closeMenu(); st.setHomeSectionHidden(true); }}>Hide Home section</button>
      </div>
    </details>
    </div>
  </section>;
}

export function PinnedSection() {
  const st = useStore();
  const orgId = st.syncEnabled ? st.session?.activeOrganizationId : null;
  const shared = orgId ? st.vaultAppearance[orgId]?.pinnedItems ?? [] : [];
  const canManage = !!orgId && st.members.some((member) => member.userId === st.session?.user.id && (member.role === "owner" || member.role === "admin"));
  const pins = mergePins(shared, st.personalPins);
  const pinSignature = JSON.stringify(pins);
  useEffect(() => {
    const epoch = st.vault?.epoch;
    if (!st.tree || epoch === undefined) return;
    void (async () => {
      // Only load ancestors of pinned folders; a lazy tree is not evidence that
      // the pin disappeared. Preferences are never pruned by incomplete lists.
      for (const { item } of pins) {
        const path = item.kind === "folder" ? item.path : st.titles.find((note) => note.id === item.docId)?.path;
        if (!path) continue;
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i++) {
          if (useStore.getState().vault?.epoch !== epoch) return;
          const ancestor = parts.slice(0, i).join("/");
          const currentTree = useStore.getState().tree;
          if (currentTree && nodeAt(currentTree, ancestor)?.childrenLoaded) continue;
          await useStore.getState().loadChildren(ancestor).catch(() => {});
        }
      }
    })();
  }, [st.vault?.epoch, st.tree?.path, pinSignature, st.titles]);
  const automatic = useMemo(() => st.automaticItemColors
    ? automaticTreeColors(st.session?.user.id ?? "local", st.session?.activeOrganizationId ?? st.vault?.path ?? "vault", applyOrder(sortTree(st.tree?.children ?? [], st.treeSort, st.folderSorts), "", st.itemOrder), st.docIdByPath, st.itemColors)
    : {}, [st.automaticItemColors, st.session?.user.id, st.session?.activeOrganizationId, st.vault?.path, st.tree, st.treeSort, st.folderSorts, st.itemOrder, st.docIdByPath, st.itemColors]);
  const locks = lockScopesByPath(st.tree, st.locks, st.session?.user.id, st.lifts);
  const rows = visiblePinnedItems(shared, st.personalPins, st.titles, (path) => Boolean(st.tree && nodeAt(st.tree, path)));
  if (!rows.length) return null;
  return <section className="pinned-section" aria-label="Pinned notes and folders">
    <div className="pinned-label">Pinned</div>
    {rows.map(({ item, shared, path }) => {
      const color = st.itemColors[path] ?? automatic[path];
      const lock = st.syncEnabled ? effectiveLockForPath(locks, path) : null;
      const peers = st.vaultPresence.filter((peer) => peer.docId && (item.kind === "note" ? peer.docId === item.docId : st.titles.some((t) => t.id === peer.docId && t.path.startsWith(path + "/"))));
      return <div key={pinKey(item)} className={`tree-row pinned-row${item.kind === "folder" ? " is-dir" : ""}${st.openNote?.path === path && (st.homeSectionHidden || !isHomeNavigation(st)) ? " selected" : ""}`}>
        <button className="pinned-open" title={path} onClick={() => item.kind === "folder"
          ? useStore.setState({ revealRequest: { path, edit: false, token: (st.revealRequest?.token ?? 0) + 1 } })
          : void st.openNoteByPath(path).catch(onError)}>
          <span className={`tree-glyph${itemColorValue(color) ? " colored" : ""}`} style={{ color: itemColorValue(color), "--glyph-fill": itemColorFill(color) } as CSSProperties} aria-hidden="true">
            {item.kind === "folder" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 7h6l2-3h10v16H3z" /></svg> : iconForPath(path)}
          </span>
          <span className="pinned-name">{displayName(path.split("/").pop() ?? path, item.kind === "folder")}</span>
          <SidebarPresence peers={peers} />
          {lock && <span className="pinned-lock" title={LOCK_TITLES[lock]} aria-label={LOCK_TITLES[lock]}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg></span>}
          {shared && <span className="pinned-shared" title="Pinned for everyone by a vault admin">Everyone</span>}
        </button>
        {(!shared || canManage) && <MenuSelect<"none" | "unpin">
          value="none"
          options={[{ value: "unpin", label: shared ? "Unpin for everyone" : "Unpin" }]}
          ariaLabel={`Pinned options for ${displayName(path.split("/").pop() ?? path, item.kind === "folder")}`}
          triggerClassName="row-more-btn pinned-more"
          triggerContent="···"
          caret={false}
          onSelect={() => void st.togglePin(path, item.kind === "folder", shared ? "vault" : "personal").catch(onError)}
        />}
      </div>;
    })}
  </section>;
}

/** All Home entry points open the same dashboard gallery. */
export function HomePicker() {
  const open = useStore((s) => s.homePickerOpen);
  useEffect(() => {
    if (open) requestNewDashboard(undefined, { manage: true, setAsHome: true });
  }, [open]);
  return null;
}

// SPDX-License-Identifier: Apache-2.0

import { noteLabel } from "../lib/notePath";
import { useStore } from "../store";

/**
 * Where you are: vault / folders / note, read-only context at the left of the
 * main header (the open-file tabs stay beside it, so opening several notes
 * keeps working). It only reads the store — it never navigates.
 */
export function Breadcrumb() {
  const vaultName = useStore((s) => s.vault?.name ?? "");
  const syncEnabled = useStore((s) => s.syncEnabled);
  const session = useStore((s) => s.session);
  const organizations = useStore((s) => s.organizations);
  const notePath = useStore((s) => s.openNote?.path ?? null);
  const virtualTabs = useStore((s) => s.virtualTabs);
  const activeVirtual = useStore((s) => s.activeVirtualTab);

  const org = syncEnabled
    ? organizations.find((o) => o.id === session?.activeOrganizationId)
    : undefined;
  const root = org?.name ?? vaultName;
  if (!root) return null;

  const virtual = activeVirtual ? virtualTabs.find((t) => t.id === activeVirtual) : undefined;
  const folders = !virtual && notePath ? notePath.split("/").slice(0, -1) : [];
  const leaf = virtual ? virtual.title : notePath ? noteLabel(notePath) : null;
  const trail = [root, ...folders, ...(leaf ? [leaf] : [])];

  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <ol>
        {trail.map((part, i) => (
          <li key={`${i}:${part}`} aria-current={i === trail.length - 1 ? "page" : undefined}>
            {part}
          </li>
        ))}
      </ol>
    </nav>
  );
}

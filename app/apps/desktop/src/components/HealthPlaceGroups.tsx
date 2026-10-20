/* Vault Settings → Health — the two "where does it live" groups under Needs
   attention: "Only on this computer" and "Only on the Remote Vault". Each is one
   group in the same style as the issue groups, holding notes, then folders,
   then files (alphabetical within each), one line per item with a type icon
   and the item's action. Paths an issue already lists never reach here — the
   caller passes the inventory through `dedupeDifferences` first. */
import { useState } from "react";
import type { HealthActions, HealthInventory } from "../lib/health/types";
import { AsyncButton } from "./AsyncButton";
import { ConfirmDialog } from "./ConfirmDialog";
import { Glyph, withCode, type GlyphName } from "./HealthShared";
import { t, useT } from "../lib/i18n";

/** Rows shown before "Show more". */
const PAGE = 20;

type PlaceKind = "note" | "folder" | "file";
interface PlaceRow {
  kind: PlaceKind;
  path: string;
}

const KIND_ICON: Record<PlaceKind, GlyphName> = { note: "note", folder: "folder", file: "file" };
const KIND_LABEL: Record<PlaceKind, string> = { note: "Note", folder: "Folder", file: "File" };

/** Notes, then folders, then files; alphabetical within each. */
export function placeRows(notes: string[], folders: string[], files: string[]): PlaceRow[] {
  const sorted = (paths: string[], kind: PlaceKind) =>
    [...paths].sort((a, b) => a.localeCompare(b)).map((path) => ({ kind, path }));
  return [...sorted(notes, "note"), ...sorted(folders, "folder"), ...sorted(files, "file")];
}

const count = (n: number) =>
  t(n === 1 ? "{count} item" : "{count} items", { count: n.toLocaleString() });

function RowLabel({ row }: { row: PlaceRow }) {
  const t = useT();
  return (
    <span className="health-place-row" title={row.path}>
      <span className="health-place-kind" aria-label={t(KIND_LABEL[row.kind])}>
        <Glyph name={KIND_ICON[row.kind]} size={14} />
      </span>
      <span className="health-missing-path">{row.path}</span>
    </span>
  );
}

/** One line in whichever group holds Team-blocked files. */
export const PRO_FILES_LINE =
  "PDFs, images and other files need Team to sync. Notes and folders sync on every plan.";

/** "2 notes, 1 folder, 3 files" — the confirm names exactly what goes. */
export function describeSelection(rows: PlaceRow[]): string {
  const n = (kind: PlaceKind) => rows.filter((r) => r.kind === kind).length;
  const part = (count: number, one: string, many: string) =>
    count > 0 ? t(count === 1 ? one : many, { count: count.toLocaleString() }) : null;
  return [
    part(n("note"), "{count} note", "{count} notes"),
    part(n("folder"), "{count} folder", "{count} folders"),
    part(n("file"), "{count} file", "{count} files"),
  ]
    .filter(Boolean)
    .join(", ");
}

const rowKey = (row: PlaceRow) => `${row.kind}:${row.path}`;

/** Checkbox + icon + path, or an empty checkbox slot so rows stay aligned. */
function SelectableRow({
  row,
  selectable,
  checked,
  onToggle,
}: {
  row: PlaceRow;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <label className="health-missing-row">
      {selectable ? (
        <input
          type="checkbox"
          className="health-issue-check"
          checked={checked}
          onChange={onToggle}
          aria-label={t("Select {path}", { path: row.path })}
        />
      ) : (
        <span className="health-place-checkslot" aria-hidden="true" />
      )}
      <RowLabel row={row} />
    </label>
  );
}

function useSelection(rows: PlaceRow[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const live = new Map(rows.map((r) => [rowKey(r), r]));
  const picked = [...selected].map((k) => live.get(k)).filter((r): r is PlaceRow => r != null);
  const toggle = (row: PlaceRow) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const k = rowKey(row);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const drop = (paths: string[]) =>
    setSelected((prev) => {
      const gone = new Set(paths);
      return new Set([...prev].filter((k) => !gone.has(k.slice(k.indexOf(":") + 1))));
    });
  return { selected, setSelected, picked, toggle, drop };
}

export function LocalOnlyGroup({
  inventory,
  actions,
  filesBlocked,
  onOpen,
  onShow,
  stale,
}: {
  inventory: HealthInventory;
  actions: HealthActions;
  /** Syncing standalone files needs Team here. */
  filesBlocked: boolean;
  onOpen: (path: string) => void;
  onShow: (path: string) => void;
  stale: boolean;
}) {
  const t = useT();
  const rows = placeRows(inventory.deviceOnlyNotes, inventory.deviceOnlyFolders, inventory.deviceOnlyFiles);
  const [limit, setLimit] = useState(PAGE);
  const sel = useSelection(rows);
  const [confirmDelete, setConfirmDelete] = useState<PlaceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) return null;

  const files = inventory.deviceOnlyFiles;
  const canSync =
    inventory.deviceOnlyNotes.length + inventory.deviceOnlyFolders.length > 0 ||
    (!filesBlocked && files.length > 0);
  const allPicked = sel.picked.length === rows.length;

  return (
    <div className="health-difference-group health-place-group">
      <div className="health-difference-grouphead">
        <h4>{t(stale ? "Only on this computer · {count} (last known view)" : "Only on this computer · {count}", { count: count(rows.length) })}</h4>
        <div className="health-group-actions">
          {canSync && (
            <AsyncButton
              className="ghost-pill sm"
              onClick={async () => {
                if (!filesBlocked && files.length > 0) await actions.retryLocalFiles(files);
                await actions.syncNow();
              }}
            >
              {t("Check again")}
            </AsyncButton>
          )}
          <button
            type="button"
            className="ghost-pill sm"
            onClick={() => sel.setSelected(allPicked ? new Set() : new Set(rows.map(rowKey)))}
          >
            {allPicked ? t("Clear selection") : t("Select all")}
          </button>
          {sel.picked.length > 0 && (
            <button
              type="button"
              className="ghost-pill sm danger"
              onClick={() => { setError(null); setConfirmDelete(sel.picked); }}
            >
              {t("Delete selected ({count})", { count: sel.picked.length.toLocaleString() })}
            </button>
          )}
        </div>
      </div>
      {filesBlocked && files.length > 0 && <p>{t(PRO_FILES_LINE)}</p>}
      {error && !confirmDelete && <p role="alert" className="auth-error health-missing-error">{error}</p>}
      <ul>
        {rows.slice(0, limit).map((row) => (
          <li key={rowKey(row)}>
            <SelectableRow
              row={row}
              selectable
              checked={sel.selected.has(rowKey(row))}
              onToggle={() => sel.toggle(row)}
            />
            <span className="health-missing-actions">
              {row.kind === "file" && filesBlocked && <span className="health-pro-tag">Team</span>}
              <button
                type="button"
                className="ghost-pill sm"
                onClick={() => (row.kind === "note" ? onOpen(row.path) : onShow(row.path))}
              >
                {row.kind === "note" ? t("Open") : t("Show")}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <button type="button" className="link-btn" onClick={() => setLimit(limit + PAGE)}>
          {t("Show more ({count} remaining)", { count: (rows.length - limit).toLocaleString() })}
        </button>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={t("Delete {what} from this computer?", { what: describeSelection(confirmDelete) })}
          confirmLabel={t("Delete")}
          onCancel={() => { setConfirmDelete(null); setError(null); }}
          onConfirm={async () => {
            setError(null);
            try {
              // The same path-safe delete the Health "Delete" remedy runs
              // (server row first, then disk; folders go recursively).
              const { deleted, failed } = await actions.deleteLocalFiles(confirmDelete.map((r) => r.path));
              sel.drop(deleted);
              if (failed.length > 0) {
                setError(failed.map((f) => `${f.path}: ${f.reason}`).join("\n"));
                return;
              }
              setConfirmDelete(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          {error && <p role="alert" className="auth-error">{error}</p>}
          <p>
            {t("These exist only on this computer — the Remote Vault has no copy — so deleting them removes them for good. Save a copy first if you need them.")}
          </p>
          {confirmDelete.some((r) => r.kind === "folder") && (
            <p>{t("Folders are deleted with everything inside them.")}</p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

export function RemoteOnlyGroup({
  inventory,
  actions,
  downloadsBlocked,
  showCheckAgain,
  stale,
}: {
  inventory: HealthInventory;
  actions: HealthActions;
  /** Downloading standalone files needs Team here. */
  downloadsBlocked: boolean;
  showCheckAgain: boolean;
  stale: boolean;
}) {
  const t = useT();
  const rows = placeRows(inventory.serverOnlyNotes, inventory.serverOnlyFolders, inventory.serverOnlyFiles);
  const [limit, setLimit] = useState(PAGE);
  const sel = useSelection(rows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remove, setRemove] = useState<string[] | null>(null);
  if (rows.length === 0) return null;
  const files = inventory.serverOnlyFiles;
  const pickedFiles = sel.picked.filter((r) => r.kind === "file").map((r) => r.path);

  const download = async (paths: string[]) => {
    setError(null);
    setNotice(null);
    try {
      await actions.downloadFiles(paths);
      setNotice(t("Download complete."));
      sel.drop(paths);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="health-difference-group health-place-group">
      <div className="health-difference-grouphead">
        <h4>{t(stale ? "Only on the Remote Vault · {count} (last known view)" : "Only on the Remote Vault · {count}", { count: count(rows.length) })}</h4>
        <div className="health-group-actions">
          {showCheckAgain && (
            <AsyncButton className="ghost-pill sm" onClick={() => actions.syncNow()}>
              {t("Check again")}
            </AsyncButton>
          )}
          {files.length > 0 && !downloadsBlocked && pickedFiles.length === 0 && (
            <AsyncButton className="ghost-pill sm" onClick={() => download(files)}>
              {t("Download all")}
            </AsyncButton>
          )}
          {pickedFiles.length > 0 && !downloadsBlocked && (
            <AsyncButton className="ghost-pill sm" onClick={() => download(pickedFiles)}>
              {t("Download selected ({count})", { count: pickedFiles.length.toLocaleString() })}
            </AsyncButton>
          )}
          {pickedFiles.length > 0 && (
            <button
              type="button"
              className="ghost-pill sm danger"
              onClick={() => { setError(null); setRemove(pickedFiles); }}
            >
              {t("Remove from server ({count})", { count: pickedFiles.length.toLocaleString() })}
            </button>
          )}
        </div>
      </div>
      {downloadsBlocked && files.length > 0 && <p>{t(PRO_FILES_LINE)}</p>}
      {notice && <p role="status">{notice}</p>}
      {error && !remove && <p role="alert" className="auth-error health-missing-error">{error}</p>}
      <ul>
        {rows.slice(0, limit).map((row) => (
          <li key={rowKey(row)}>
            <SelectableRow
              row={row}
              selectable={row.kind === "file"}
              checked={sel.selected.has(rowKey(row))}
              onToggle={() => sel.toggle(row)}
            />
            {row.kind === "file" && (
              <span className="health-missing-actions">
                {downloadsBlocked ? (
                  <span className="health-pro-tag">Team</span>
                ) : (
                  <AsyncButton className="ghost-pill sm" onClick={() => download([row.path])}>
                    {t("Download")}
                  </AsyncButton>
                )}
                <button
                  type="button"
                  className="ghost-pill sm danger"
                  onClick={() => { setError(null); setRemove([row.path]); }}
                >
                  {t("Remove from server")}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <button type="button" className="link-btn" onClick={() => setLimit(limit + PAGE)}>
          {t("Show more ({count} remaining)", { count: (rows.length - limit).toLocaleString() })}
        </button>
      )}
      {remove && (
        <ConfirmDialog
          title={
            remove.length === 1
              ? t("Remove this file from the server?")
              : t("Remove {count} files from the server?", { count: remove.length.toLocaleString() })
          }
          confirmLabel={t("Remove from server")}
          onCancel={() => { setRemove(null); setError(null); }}
          onConfirm={async () => {
            setError(null);
            const failed: string[] = [];
            const done: string[] = [];
            for (const path of remove) {
              try {
                await actions.removeServerFile(path);
                done.push(path);
              } catch (e) {
                failed.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
            sel.drop(done);
            if (failed.length > 0) {
              setError(failed.join("\n"));
              return;
            }
            setRemove(null);
          }}
        >
          {error && <p role="alert" className="auth-error">{error}</p>}
          <p>
            {remove.length === 1
              ? withCode(t("{code} will be permanently removed from the Remote Vault. Other members lose access and synced devices may remove their copies. This cannot be undone. Save a copy first if you need it."), remove[0])
              : t("These {count} files will be permanently removed from the Remote Vault. Other members lose access and synced devices may remove their copies. This cannot be undone. Save a copy first if you need them.", { count: remove.length.toLocaleString() })}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { authManager } from "../lib/auth/authManager";
import { ApiError } from "../lib/api";
import { aiConflictFrom, aiConnections, aiTextDiff, type AiChange, type AiChangeConflict, type AiChangeDetail, type AiRevertResult } from "../lib/aiChanges";
import { syncManager } from "../lib/sync/docSession";
import { AsyncButton } from "./AsyncButton";
import { ConfirmDialog } from "./ConfirmDialog";
import { FuseButton } from "./kit/FuseButton";
import "./aiChanges.css";

function TextDiff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => aiTextDiff(before, after), [before, after]);
  return <pre className="ai-change-diff" aria-label="Before and after">{parts.map(([op, text], i) =>
    op < 0 ? <del key={i}>{text}</del> : op > 0 ? <ins key={i}>{text}</ins> : <span key={i}>{text}</span>)}</pre>;
}

export function AiChanges() {
  const enabled = useStore(s => s.syncEnabled);
  const user = useStore(s => s.session?.user.id);
  const status = useStore(s => s.syncStatus);
  const vaultId = syncManager.registry.vaultId;
  if (!enabled || !user || !vaultId) return null;
  return <AiChangesBody key={`${user}:${vaultId}`} vaultId={vaultId} online={status === "synced"} />;
}

function AiChangesBody({ vaultId, online }: { vaultId: string; online: boolean }) {
  const [items, setItems] = useState<AiChange[]>([]);
  const [connection, setConnection] = useState("");
  const [detail, setDetail] = useState<AiChangeDetail | null>(null);
  const [conflict, setConflict] = useState<AiChangeConflict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [batchTruncated, setBatchTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fuseAttempt, setFuseAttempt] = useState(0);
  const [confirm, setConfirm] = useState<AiChange | "batch" | null>(null);
  const [results, setResults] = useState<AiRevertResult[]>([]);
  const alive = useRef(true);
  const previewRequest = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = async () => {
    try {
      const list = await authManager.api.listAiChanges(vaultId);
      if (alive.current) { setItems(list.items); setTruncated(list.truncated); setError(null); }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { if (online) void refresh(); }, [vaultId, online]);
  const preview = async (id: string) => {
    const request = ++previewRequest.current;
    setConflict(null); setError(null); setDetail(null);
    try {
      const next = await authManager.api.getAiChange(id);
      if (alive.current && request === previewRequest.current) setDetail(next);
    } catch (e) { if (alive.current && request === previewRequest.current) setError(e instanceof Error ? e.message : String(e)); }
  };
  // A completed revert has no redo API, so the fuse delays this request until commit.
  const revert = async (target = confirm) => {
    setConfirm(null); setBusy(true); setError(null); setConflict(null); setResults([]); setBatchTruncated(false);
    try {
      if (target === "batch") {
        const batch = await authManager.api.revertAiChanges(vaultId, connection, new Date(Date.now() - 3600000).toISOString());
        if (alive.current) {
          setResults(batch.results);
          setBatchTruncated(batch.truncated);
        }
      } else if (target) {
        const result = await authManager.api.revertAiChange(target.id);
        if (alive.current) setResults([result]);
      }
      await refresh();
      if (alive.current) setDetail(null);
    } catch (e) {
      if (alive.current) {
        setConflict(e instanceof ApiError && e.status === 409 ? aiConflictFrom(e.body) : null);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally { if (alive.current) { setBusy(false); setFuseAttempt(n => n + 1); } }
  };
  const shown = connection ? items.filter(i => i.connection_id === connection) : items;
  return <section className="ai-changes" aria-label="AI changes">
    <details open>
      <summary>AI changes</summary>
      <div className="ai-change-toolbar">
        <label>Connection <select value={connection} disabled={busy} onChange={e => { previewRequest.current++; setConnection(e.target.value); setDetail(null); setConflict(null); setResults([]); }}>
          <option value="">All connections</option>
          {aiConnections(items).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select></label>
        <AsyncButton className="ghost-pill sm" disabled={!online || busy} onClick={refresh}>Refresh</AsyncButton>
        <button type="button" className="ghost-pill sm" disabled={!online || busy || !connection}
          onClick={() => setConfirm("batch")}>Undo everything from the last hour</button>
      </div>
      {!online && <p className="muted">Connect to refresh the list and undo changes.</p>}
      {error && <p role="alert" className="auth-error">{error}</p>}
      {conflict && <div role="alert"><p>This note changed after the AI edit, so it was not undone. Struck-through text is what the AI left; underlined text is what is there now.</p>
        <TextDiff before={conflict.expected ?? ""} after={conflict.current} />
        {conflict.currentPath && <p>{conflict.expectedPath} → {conflict.currentPath}</p>}</div>}
      {batchTruncated && <p role="status">Too many changes for one batch. Check the results, then run the rest again.</p>}
      {results.length > 0 && <ul aria-label="Undo results">{results.map(r => <li key={r.id}>
        {items.find(i => i.id === r.id)?.after_path ?? r.id}: {r.status === "failed" ? r.error ?? "Failed" : "Undone"}
        {r.diff && <TextDiff before={r.diff.expected ?? ""} after={r.diff.current} />}
      </li>)}</ul>}
      {shown.length === 0 && <p className="muted">No AI changes recorded.</p>}
      <ul className="ai-change-list">{shown.map(item => <li key={item.id}>
        <button type="button" className="ai-change-preview" disabled={busy || !online} onClick={() => void preview(item.id)}>
          <strong>{item.after_path}</strong><span>{item.connection_label} · {item.op}</span>
          <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
        </button>
        <FuseButton key={`${item.id}:${fuseAttempt}`} label={item.reverted_at ? "Undone" : "Undo"}
          doneLabel="Undoing…" disabled={busy || !online || !!item.reverted_at || item.diff_summary.oversized}
          onAction={() => setBusy(true)} onUndo={() => setBusy(false)} onCommit={() => void revert(item)} />
        {detail?.id === item.id && <div className="ai-change-detail">
          {item.before_path !== item.after_path && <p>{item.before_path} → {item.after_path}</p>}
          <p>Struck through: before · Underlined: after</p>
          {detail.before_text === null || detail.after_text === null ? <p>Too large (over 1 MiB) to show a comparison or undo.</p>
            : <TextDiff before={detail.before_text} after={detail.after_text} />}
        </div>}
      </li>)}</ul>
      {truncated && <p className="muted">Showing the latest 100 changes. Undoing in bulk looks at the last hour on the server.</p>}
    </details>
    {confirm && <ConfirmDialog title="Undo this AI change?" confirmLabel="Undo" onConfirm={() => void revert()} onCancel={() => setConfirm(null)}>
      {confirm === "batch" ? "Undoes the selected connection’s changes from the last hour, newest first. You will see which ones worked and which conflicted." : `Undoes the AI change to ${confirm.after_path}. If the note changed since, it will not be overwritten.`}
    </ConfirmDialog>}
  </section>;
}

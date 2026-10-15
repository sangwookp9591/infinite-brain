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
  return <pre className="ai-change-diff" aria-label="변경 전후 diff">{parts.map(([op, text], i) =>
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
  return <section className="ai-changes" aria-label="AI 변경">
    <details open>
      <summary>AI 변경</summary>
      <div className="ai-change-toolbar">
        <label>연결 <select value={connection} disabled={busy} onChange={e => { previewRequest.current++; setConnection(e.target.value); setDetail(null); setConflict(null); setResults([]); }}>
          <option value="">모든 연결</option>
          {aiConnections(items).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select></label>
        <AsyncButton className="ghost-pill sm" disabled={!online || busy} onClick={refresh}>새로고침</AsyncButton>
        <button type="button" className="ghost-pill sm" disabled={!online || busy || !connection}
          onClick={() => setConfirm("batch")}>최근 1시간 모두 되돌리기</button>
      </div>
      {!online && <p className="muted">연결 후 변경 목록을 새로고침하고 되돌릴 수 있습니다.</p>}
      {error && <p role="alert" className="auth-error">{error}</p>}
      {conflict && <div role="alert"><p>AI 변경 이후 내용이 달라져 되돌리지 않았습니다. 삭제선은 AI가 남긴 내용, 밑줄은 현재 내용입니다.</p>
        <TextDiff before={conflict.expected ?? ""} after={conflict.current} />
        {conflict.currentPath && <p>{conflict.expectedPath} → {conflict.currentPath}</p>}</div>}
      {batchTruncated && <p role="status">일괄 처리 한도를 초과했습니다. 결과를 확인한 뒤 나머지를 다시 실행하세요.</p>}
      {results.length > 0 && <ul aria-label="되돌리기 결과">{results.map(r => <li key={r.id}>
        {items.find(i => i.id === r.id)?.after_path ?? r.id}: {r.status === "failed" ? r.error ?? "실패" : "되돌림"}
        {r.diff && <TextDiff before={r.diff.expected ?? ""} after={r.diff.current} />}
      </li>)}</ul>}
      {shown.length === 0 && <p className="muted">기록된 AI 변경이 없습니다.</p>}
      <ul className="ai-change-list">{shown.map(item => <li key={item.id}>
        <button type="button" className="ai-change-preview" disabled={busy || !online} onClick={() => void preview(item.id)}>
          <strong>{item.after_path}</strong><span>{item.connection_label} · {item.op}</span>
          <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
        </button>
        <FuseButton key={`${item.id}:${fuseAttempt}`} label={item.reverted_at ? "되돌림" : "되돌리기"}
          doneLabel="되돌리기 대기" disabled={busy || !online || !!item.reverted_at || item.diff_summary.oversized}
          onAction={() => setBusy(true)} onUndo={() => setBusy(false)} onCommit={() => void revert(item)} />
        {detail?.id === item.id && <div className="ai-change-detail">
          {item.before_path !== item.after_path && <p>{item.before_path} → {item.after_path}</p>}
          <p>삭제선: 변경 전 · 밑줄: 변경 후</p>
          {detail.before_text === null || detail.after_text === null ? <p>1MiB를 초과하여 본문 diff와 되돌리기를 제공하지 않습니다.</p>
            : <TextDiff before={detail.before_text} after={detail.after_text} />}
        </div>}
      </li>)}</ul>
      {truncated && <p className="muted">최근 변경 100개를 표시합니다. 일괄 되돌리기는 서버에서 최근 1시간을 조회합니다.</p>}
    </details>
    {confirm && <ConfirmDialog title="AI 변경을 되돌릴까요?" confirmLabel="되돌리기" onConfirm={() => void revert()} onCancel={() => setConfirm(null)}>
      {confirm === "batch" ? "선택한 연결의 최근 1시간 변경을 최신순으로 되돌립니다. 항목별 성공과 충돌 결과를 표시합니다." : `${confirm.after_path}의 AI 변경을 되돌립니다. 이후 내용이 달라졌으면 덮어쓰지 않습니다.`}
    </ConfirmDialog>}
  </section>;
}

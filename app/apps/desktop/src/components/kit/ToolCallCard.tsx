// SPDX-License-Identifier: Apache-2.0
// Adapted from /private/tmp/claude-501/-Users-iron-Project-psw-infinite-brain/7dd0ad66-d583-481d-bb04-d8b07e6c8d31/scratchpad/specs/toolcall-src.tsx; source origin and license require confirmation.
import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import "./ToolCallCard.css";

export type ToolCallStatus = "running" | "success" | "error";
export type ToolCallCardProps = { name: string; summary?: ReactNode; icon?: ReactNode; status: ToolCallStatus; args?: unknown; result?: unknown; error?: string; startedAt?: number; duration?: number; defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; openOnError?: boolean; onRetry?: () => void; maxCodeHeight?: number; className?: string };
export type ToolCallGroupProps = { children: ReactNode; label?: string; runningLabel?: string; duration?: number; defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; className?: string };

export function formatMs(ms: number, live = false) {
  if (!live && ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)}초`;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, "0")}초`;
}

export function toText(value: unknown): { text: string; json: boolean } {
  if (typeof value === "string") {
    const t = value.trim();
    if (t.startsWith("{") || t.startsWith("[")) try { return { text: JSON.stringify(JSON.parse(t), null, 2), json: true }; } catch { /* plain text */ }
    return { text: value, json: false };
  }
  try { const s = JSON.stringify(value, null, 2); return s === undefined ? { text: String(value), json: false } : { text: s, json: true }; }
  catch { return { text: String(value), json: false }; }
}

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
export type HighlightToken = { text: string; kind: "plain" | "key" | "str" | "lit" | "num" };
export function highlightTokens(text: string): HighlightToken[] {
  const out: HighlightToken[] = []; const re = new RegExp(TOKEN.source, "g"); let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), kind: "plain" });
    if (m[1] && m[2]) { out.push({ text: m[1], kind: "key" }, { text: m[2], kind: "plain" }); }
    else out.push({ text: m[0], kind: m[1] ? "str" : /^[tfn]/.test(m[0]) ? "lit" : "num" });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: "plain" });
  return out;
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* try the legacy path */ }
  let area: HTMLTextAreaElement | undefined;
  try {
    area = document.createElement("textarea"); area.value = text; area.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(area); area.select(); return document.execCommand("copy");
  } catch { return false; } finally { area?.remove(); }
}

function useStopwatch(running: boolean, startedAt: number | undefined, accumulate: boolean) {
  const start = useRef<number | null>(null); const base = useRef(0); const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    if (!running) { if (start.current !== null) { base.current += Date.now() - start.current; start.current = null; setMs(base.current); } return; }
    if (!accumulate) base.current = 0; start.current = startedAt ?? Date.now();
    const tick = () => setMs(base.current + Date.now() - (start.current ?? Date.now())); tick();
    const t = window.setInterval(tick, 100); return () => window.clearInterval(t);
  }, [running, startedAt, accumulate]);
  return ms;
}

export function ToolCallCard({ name, summary, icon, status, args, result, error, startedAt, duration, defaultOpen = false, open: openProp, onOpenChange, openOnError = true, onRetry, maxCodeHeight = 220, className }: ToolCallCardProps) {
  const id = useId(); const [openState, setOpenState] = useState(defaultOpen); const open = openProp ?? openState;
  const setOpen = (next: boolean) => { if (openProp === undefined) setOpenState(next); onOpenChange?.(next); };
  const [prevStatus, setPrevStatus] = useState(status); const [autoOpened, setAutoOpened] = useState(false);
  if (status !== prevStatus) { setPrevStatus(status); if (openProp === undefined && openOnError) { if (status === "error" && !openState) { setOpenState(true); setAutoOpened(true); } else if (prevStatus === "error" && autoOpened) { setOpenState(false); setAutoOpened(false); } } }
  const measured = useStopwatch(status === "running", startedAt, false); const ms = status === "running" ? measured ?? 0 : duration ?? measured;
  const announce = status === "running" ? `${name}: 도구 사용 중` : status === "success" ? `${name}: 완료` : `${name}: 실패${error ? `: ${error}` : ""}`;
  return <div className={`kit-tc ${className ?? ""}`} data-status={status} data-open={open || undefined}>
    <span className="kit-tc-sr" role="status" aria-live="polite">{announce}</span>
    <button type="button" className="kit-tc-head" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => { setAutoOpened(false); setOpen(!open); }}>
      <span className="kit-tc-icon" aria-hidden="true">{icon ?? <WrenchIcon />}</span><span className="kit-tc-main"><code className="kit-tc-name">{name}</code>{summary != null && <span className="kit-tc-summary" title={typeof summary === "string" ? summary : undefined}>{summary}</span>}</span>
      <span className="kit-tc-status" key={status}>{status === "running" && <Spinner />}{status === "success" && <CheckIcon />}{status === "error" && <ErrorIcon />}<span className="kit-tc-time">{status === "error" ? "실패" : ms != null ? formatMs(ms, status === "running") : null}</span></span><Chevron />
    </button>
    <div className="kit-tc-body" id={`${id}-body`} inert={!open}><div className="kit-tc-clip"><div className="kit-tc-sections">
      {status === "error" && <div className="kit-tc-error"><ErrorIcon /><p className="kit-tc-error-text">{error ?? "도구 호출에 실패했습니다."}</p>{onRetry && <button type="button" className="kit-tc-retry" onClick={onRetry}><RetryIcon />다시 시도</button>}</div>}
      {args !== undefined && <CodeSection label="입력" value={args} cap={maxCodeHeight} />}
      {result !== undefined ? <CodeSection label="결과" value={result} cap={maxCodeHeight} /> : status === "running" ? <div className="kit-tc-section"><div className="kit-tc-section-head"><span className="kit-tc-label">결과</span></div><p className="kit-tc-pending">결과를 기다리는 중…</p></div> : null}
      {args === undefined && result === undefined && status === "success" && <p className="kit-tc-pending">입력 또는 결과가 없습니다.</p>}
    </div></div></div>
  </div>;
}

export function ToolCallGroup({ children, label, runningLabel = "도구 사용 중…", duration, defaultOpen = false, open: openProp, onOpenChange, className }: ToolCallGroupProps) {
  const id = useId(); const [openState, setOpenState] = useState(defaultOpen); const open = openProp ?? openState;
  const calls = Children.toArray(children).filter(isValidElement).map(c => (c as ReactElement<Partial<ToolCallCardProps>>).props);
  const running = calls.some(c => c.status === "running"); const failed = calls.filter(c => c.status === "error").length;
  const measured = useStopwatch(running, undefined, true); const sum = calls.length && calls.every(c => c.duration != null) ? calls.reduce((t, c) => t + (c.duration ?? 0), 0) : null;
  const ms = running ? measured : duration ?? sum ?? measured; const count = `도구 ${calls.length}개 사용`; const title = running ? runningLabel : label ?? count; const icons = calls.slice(-3);
  return <div className={`kit-tc-group ${className ?? ""}`} data-running={running || undefined} data-open={open || undefined}>
    <span className="kit-tc-sr" role="status" aria-live="polite">{running ? runningLabel : `${count}${failed ? ` · ${failed}개 실패` : ""}`}</span>
    <button type="button" className="kit-tc-group-head" aria-expanded={open} aria-controls={`${id}-list`} onClick={() => { if (openProp === undefined) setOpenState(!open); onOpenChange?.(!open); }}>
      <span className="kit-tc-stack" aria-hidden="true">{icons.map((c, i) => <span className="kit-tc-icon" key={calls.length - icons.length + i}>{c.icon ?? <WrenchIcon />}</span>)}</span>
      <span className="kit-tc-group-title" key={running ? "busy" : "done"}><span className={running ? "kit-tc-group-label kit-tc-shine" : "kit-tc-group-label"}>{title}</span>{!running && failed > 0 && <span className="kit-tc-group-failed">· {failed}개 실패</span>}{ms != null && <span className="kit-tc-group-time">· {formatMs(ms, running)}</span>}</span><Chevron />
    </button><div className="kit-tc-body" id={`${id}-list`} inert={!open}><div className="kit-tc-clip"><div className="kit-tc-group-list">{children}</div></div></div>
  </div>;
}

function CodeSection({ label, value, cap }: { label: string; value: unknown; cap: number }) {
  const { text, json } = toText(value); const pre = useRef<HTMLPreElement>(null); const [full, setFull] = useState(false); const [height, setHeight] = useState(0);
  useLayoutEffect(() => { const el = pre.current; const inner = el?.firstElementChild; if (!el || !inner) return; const measure = () => setHeight(el.scrollHeight); measure(); const ro = new ResizeObserver(measure); ro.observe(inner); return () => ro.disconnect(); }, [text]);
  const capped = height > cap + 24;
  return <div className="kit-tc-section"><div className="kit-tc-section-head"><span className="kit-tc-label">{label}</span><CopyButton text={text} label={label.toLowerCase()} /></div><pre ref={pre} className="kit-tc-code" data-capped={(capped && !full) || undefined} style={capped ? { maxHeight: full ? height : cap } : undefined}><code>{json ? highlightTokens(text).map((t, i) => t.kind === "plain" ? t.text : <span key={i} className={`kit-tc-t-${t.kind}`}>{t.text}</span>) : text}</code></pre>{capped && <button type="button" className="kit-tc-more" aria-expanded={full} onClick={() => setFull(!full)}>{full ? "접기" : "모두 보기"}</button>}</div>;
}
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false); useEffect(() => { if (!copied) return; const t = window.setTimeout(() => setCopied(false), 1400); return () => window.clearTimeout(t); }, [copied]);
  return <button type="button" className="kit-tc-copy" data-copied={copied || undefined} aria-label={copied ? "복사했어요" : `${label} 복사`} title={copied ? "복사했어요" : `${label} 복사`} onClick={() => void copyText(text).then(ok => { if (ok) setCopied(true); })}><CopyIcon /><CheckIcon /></button>;
}
function Icon({ children }: { children: ReactNode }) { return <svg viewBox="0 0 16 16" aria-hidden="true">{children}</svg>; }
function Spinner() { return <Icon><circle className="kit-tc-spinner" cx="8" cy="8" r="5.75" /><path className="kit-tc-spinner-arc" d="M8 2.25a5.75 5.75 0 0 1 5.75 5.75" /></Icon>; }
function ErrorIcon() { return <Icon><circle className="kit-tc-err" cx="8" cy="8" r="6" /><path className="kit-tc-err" d="M8 5v3.4M8 10.9v.1" /></Icon>; }
function CheckIcon() { return <Icon><path className="kit-tc-ok" d="M3.5 8.4 6.6 11.3 12.5 4.9" pathLength={1} /></Icon>; }
function Chevron() { return <Icon><path className="kit-tc-chevron" d="M4.5 6.25 8 9.75l3.5-3.5" /></Icon>; }
function WrenchIcon() { return <Icon><path d="M10.2 2.4a3.5 3.5 0 0 0-4.3 4.6L2.6 10.3a1.4 1.4 0 0 0 2 2L7.9 9a3.5 3.5 0 0 0 4.6-4.3l-2 2-1.6-.4-.4-1.6 1.7-2.3Z" /></Icon>; }
function CopyIcon() { return <Icon><rect x="5.25" y="5.25" width="8" height="8" rx="2" /><path d="M10.75 5.25v-1a1.5 1.5 0 0 0-1.5-1.5h-4.5a2 2 0 0 0-2 2v4.5a1.5 1.5 0 0 0 1.5 1.5h1" /></Icon>; }
function RetryIcon() { return <Icon><path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.77M2.5 2.5v2.75h2.75" /></Icon>; }

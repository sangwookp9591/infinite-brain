/* Vault Settings → Health — "Check a note".
   The issue list answers "what is wrong"; this answers "what about THIS one?",
   which is the question someone actually arrives with. Every field it shows is
   a fact the sync layer already holds (`HealthActions.inspectNote`), so the
   card can never be more optimistic than the machinery it describes. */
import { useEffect, useMemo, useRef, useState } from "react";
import type { NoteInspection } from "../lib/health/types";
import type { NoteTitle } from "../lib/ipc";
import { formatBytes, relativeTime } from "../lib/health/format";
import { copyText } from "../lib/clipboard";
import { t, useT } from "../lib/i18n";
import { AsyncButton } from "./AsyncButton";
import { CopyButton, Glyph, PathText, type HealthHandlers } from "./HealthShared";

/** More than this and the list stops being a shortcut and starts being a tree. */
const MAX_MATCHES = 8;

export function HealthInspector({
  notes,
  handlers,
  onShowIssue,
  request,
}: {
  notes: NoteTitle[];
  handlers: HealthHandlers;
  /** Scroll the matching Needs-attention row into view and expand it. */
  onShowIssue: (key: string) => void;
  /** An inspection asked for from elsewhere on the page (a timeline line names
   *  a path). `n` bumps on every request, so asking twice for the same path
   *  re-runs it rather than being swallowed as an unchanged prop. */
  request?: { path: string; n: number } | null;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [openList, setOpenList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NoteInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which query the in-flight lookup belongs to, so a slow answer for an
  // abandoned path cannot overwrite a newer one.
  const token = useRef(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return [];
    const out: NoteTitle[] = [];
    for (const n of notes) {
      if (n.path.toLowerCase().includes(q) || n.title.toLowerCase().includes(q)) {
        out.push(n);
        if (out.length >= MAX_MATCHES) break;
      }
    }
    return out;
  }, [notes, query]);

  const inspect = async (path: string) => {
    const mine = ++token.current;
    setOpenList(false);
    setQuery(path);
    setBusy(true);
    setError(null);
    try {
      const out = await handlers.actions.inspectNote(path);
      if (token.current === mine) setResult(out);
    } catch (e) {
      if (token.current === mine) {
        setResult(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (token.current === mine) setBusy(false);
    }
  };

  // The prop is the trigger; the lookup itself is the same one the input runs.
  const inspectRef = useRef(inspect);
  inspectRef.current = inspect;
  const n = request?.n;
  const requestedPath = request?.path;
  useEffect(() => {
    if (n == null || !requestedPath) return;
    void inspectRef.current(requestedPath);
  }, [n, requestedPath]);

  return (
    <div className="health-inspector">
      <div className="health-inspector-field">
        <span className="health-inspector-icon" aria-hidden="true">
          <Glyph name="search" />
        </span>
        <input
          type="text"
          className="health-inspector-input"
          placeholder={t("Type a note's path or name…")}
          aria-label={t("Check one note")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpenList(true);
          }}
          onFocus={() => setOpenList(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void inspect(matches[0]?.path ?? query.trim());
            }
            if (e.key === "Escape") setOpenList(false);
          }}
        />
        {openList && matches.length > 0 && (
          <ul className="health-suggest">
            {matches.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => void inspect(n.path)}>
                  <span className="health-suggest-title">{n.title}</span>
                  <PathText path={n.path} chars={44} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {busy && <p className="muted">{t("Looking…")}</p>}
      {error && <div className="auth-error">{error}</div>}
      {!busy && result && (
        <InspectionCard result={result} handlers={handlers} onShowIssue={onShowIssue} />
      )}
    </div>
  );
}

/** Exported for the render test: the card is the half worth asserting on, and
 *  the input around it cannot resolve an async lookup under
 *  `renderToStaticMarkup`. */
export function InspectionCard({
  result,
  handlers,
  onShowIssue,
}: {
  result: NoteInspection;
  handlers: HealthHandlers;
  onShowIssue: (key: string) => void;
}) {
  const t = useT();
  if (!result.exists) {
    return (
      <div className="health-inspection" data-tone="warn">
        <p className="health-inspection-verdict">{t("There is no file at this path.")}</p>
        <PathText path={result.path} />
      </div>
    );
  }

  const facts: Array<[string, string, boolean?]> = [
    [t("State"), stateLabel(result)],
    [t("On Remote Vault"), yesNo(result.pushed)],
    [t("Waiting to push"), yesNo(result.queued)],
    [t("Has unsent edits"), yesNo(result.diverged)],
    [t("Size"), result.bytes != null ? formatBytes(result.bytes) : t("Not measured")],
    [
      t("Modified"),
      result.mtime != null ? relativeTime(result.mtime, handlers.now) : t("Unknown"),
    ],
    [
      t("History size"),
      result.historyBytes != null ? formatBytes(result.historyBytes) : t("Unknown"),
    ],
    [t("Doc id"), result.docId ?? t("Not registered"), result.docId != null],
  ];

  const copyFacts = async () => {
    const text = [
      `Infinite Brain — ${result.path}`,
      result.verdict,
      "",
      ...facts.map(([label, value]) => `${label}: ${value}`),
    ].join("\n");
    await copyText(text);
  };

  return (
    <div className="health-inspection" data-tone={result.issue ? "warn" : "good"}>
      <p className="health-inspection-verdict">{result.verdict}</p>
      <PathText path={result.path} />

      <dl className="health-facts health-facts-grid">
        {facts.map(([label, value, copyable]) => (
          <div className="health-fact" key={label}>
            <dt>{label}</dt>
            <dd>
              <span className="health-fact-value">{value}</span>
              {copyable && <CopyButton value={value} label={t("Copy {label}", { label })} />}
            </dd>
          </div>
        ))}
      </dl>

      {result.issue && (
        <button
          type="button"
          className="link-btn"
          onClick={() => onShowIssue((result.issue as { key: string }).key)}
        >
          {t("See its entry above")}
        </button>
      )}

      <div className="health-remedies">
        <button
          type="button"
          className="link-btn"
          onClick={() => handlers.openNote(result.path)}
        >
          {t("Open")}
        </button>
        <AsyncButton className="link-btn" onClick={() => handlers.actions.reveal(result.path)}>
          {t("Reveal")}
        </AsyncButton>
        {result.docId && (
          <AsyncButton
            className="link-btn"
            onClick={() => handlers.actions.retryDoc(result.docId as string)}
          >
            {t("Retry")}
          </AsyncButton>
        )}
        <AsyncButton className="link-btn" onClick={copyFacts}>
          {t("Copy facts")}
        </AsyncButton>
      </div>
    </div>
  );
}

function yesNo(v: boolean): string {
  return v ? t("Yes") : t("No");
}

/** The reported per-doc state in the page's own words. `null` is not "unsynced"
 *  — it means nothing has spoken for this note since launch, which is a
 *  different thing and reads as such. */
function stateLabel(r: NoteInspection): string {
  if (r.permanentFailure) return t("Stopped trying");
  switch (r.state) {
    case "synced":
      return t("Synced");
    case "syncing":
      return t("Syncing");
    case "queued":
      return t("Queued");
    case "error":
      return t("Failed");
    case "unsynced":
      return t("Not on the Remote Vault");
    default:
      return r.emptyEverywhere ? t("Empty here and on the Remote Vault") : t("Nothing reported yet");
  }
}

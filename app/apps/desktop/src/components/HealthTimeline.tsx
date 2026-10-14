/* Vault Settings → Health — the sync timeline.
   The sync manager keeps a ring buffer of what it did this session; this is the
   only place a person can read it. It exists because "it says Syncing and
   nothing happens" is unanswerable without a sequence of events, and asking
   someone to open a devtools console is not an answer. */
import { useMemo, useState } from "react";
import type { SyncLogEntry, SyncLogLevel } from "../lib/health/types";
import { clockTime, dayLabel } from "../lib/health/format";
import { Chip, PathText } from "./HealthShared";

/** Rendered at once. The buffer holds 200; a wall of them helps nobody. */
const PAGE = 100;
/** Lines shown before "Show all": enough to answer "what just happened"
 *  without turning the page into a log viewer. */
const COLLAPSED = 6;

type Filter = "all" | "warn" | "error";

export function HealthTimeline({
  log,
  now,
  onInspect,
}: {
  log: SyncLogEntry[];
  now: number;
  /** A line that names a path hands it to the inspector above. */
  onInspect: (path: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    let warn = 0;
    let error = 0;
    for (const e of log) {
      if (e.level === "warn") warn++;
      else if (e.level === "error") error++;
    }
    return { warn, error };
  }, [log]);

  // The buffer is oldest-first; the page reads newest-first, because the answer
  // to "what just happened" is at the end of the tape.
  const shown = useMemo(() => {
    const out: SyncLogEntry[] = [];
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (filter === "warn" && e.level === "info") continue;
      if (filter === "error" && e.level !== "error") continue;
      out.push(e);
    }
    return out;
  }, [log, filter]);

  if (log.length === 0) {
    return <p className="muted">Nothing yet this session.</p>;
  }

  const page = shown.slice(0, expanded ? limit : COLLAPSED);
  const hidden = Math.max(0, shown.length - page.length);
  const days: Array<{ label: string; entries: SyncLogEntry[] }> = [];
  for (const e of page) {
    const label = dayLabel(e.at, now);
    const last = days[days.length - 1];
    if (last && last.label === label) last.entries.push(e);
    else days.push({ label, entries: [e] });
  }

  return (
    <>
      <div className="health-chips" role="group" aria-label="Filter the timeline">
        <Chip active={filter === "all"} onClick={() => setFilter("all")} count={log.length}>
          All
        </Chip>
        <Chip
          active={filter === "warn"}
          onClick={() => setFilter("warn")}
          count={counts.warn + counts.error}
        >
          Warnings
        </Chip>
        <Chip active={filter === "error"} onClick={() => setFilter("error")} count={counts.error}>
          Errors
        </Chip>
      </div>

      {page.length === 0 ? (
        <p className="muted">Nothing at this level.</p>
      ) : (
        <div className={`health-timeline${expanded ? " is-expanded" : ""}`}>
          {days.map((day) => (
            <div className="health-day" key={day.label}>
              <div className="health-day-label">{day.label}</div>
              <ul className="health-log">
                {day.entries.map((e, i) => (
                  <li key={`${e.at}-${e.event}-${i}`} className="health-log-line">
                    <span className="health-log-time">{clockTime(e.at)}</span>
                    <span
                      className="health-log-dot"
                      data-level={e.level}
                      aria-label={levelWord(e.level)}
                    />
                    <span className="health-log-body">
                      <span className="health-log-message">{e.message}</span>
                      {(e.count ?? 1) > 1 && (
                        <span
                          className="health-log-count"
                          title={`Happened ${e.count} times within a minute`}
                        >
                          ×{e.count}
                        </span>
                      )}
                      {e.path && (
                        <button
                          type="button"
                          className="health-log-path"
                          onClick={() => onInspect(e.path as string)}
                          title={`Check ${e.path}`}
                        >
                          <PathText path={e.path} chars={44} />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="health-timeline-actions">
        {!expanded && hidden > 0 && (
          <button type="button" className="ghost-pill sm" onClick={() => setExpanded(true)}>
            Show all {shown.length.toLocaleString()}
          </button>
        )}
        {expanded && shown.length > limit && (
          <button
            type="button"
            className="ghost-pill sm"
            onClick={() => setLimit((n) => n + PAGE)}
          >
            Show older
          </button>
        )}
        {expanded && (
          <button
            type="button"
            className="ghost-pill sm"
            onClick={() => {
              setExpanded(false);
              setLimit(PAGE);
            }}
          >
            Show less
          </button>
        )}
      </div>
    </>
  );
}

function levelWord(level: SyncLogLevel): string {
  return level === "error" ? "Error" : level === "warn" ? "Warning" : "Info";
}

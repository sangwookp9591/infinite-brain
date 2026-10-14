// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import * as ipc from "../lib/ipc";
import { DashboardLinkLoader } from "./DashboardLinkLoader";
import { NativeDashboardLink } from "./NativeDashboardLink";
import { useStore } from "../store";
import { effectiveHomeNote } from "../lib/pins";
import { knownFrameBlocked, readDashboardLink } from "../lib/dashboard/links";
import "../styles/dashboard.css";

function EmbeddedDashboardLink({ url, title }: { url: string; title: string }) {
  const [loading, setLoading] = useState(true);
  return <div className="dashboard-embedded-link" aria-busy={loading}>
    {loading && <DashboardLinkLoader url={url} />}
    <iframe title={title} src={url} onLoad={() => setLoading(false)} referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'" style={{ visibility: loading ? "hidden" : "visible" }} />
  </div>;
}
export function RemoteDashboardView({ path }: { path: string }) {
  const isHome = useStore((s) => effectiveHomeNote(s)?.path === path);
  const epoch = useStore((s) => s.vault?.epoch);
  const [url, setUrl] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let sequence = 0;
    setUrl(null); setError(null);
    const load = () => {
      const request = ++sequence;
      void ipc.readNote(path, epoch).then((content) => {
        if (!cancelled && request === sequence) { setUrl(readDashboardLink(content, path)); setError(null); }
      }).catch((e) => {
        if (!cancelled && request === sequence) { setUrl(null); setError(String(e)); }
      });
    };
    load(); let unlisten: (() => void) | undefined;
    void ipc.onFileChanged((event) => { if (event.path === path && event.kind === "modified" && !event.unchanged) load(); }).then((fn) => { if (cancelled) fn(); else unlisten = fn; });
    return () => { cancelled = true; unlisten?.(); };
  }, [path, epoch]);
  const blocked = url ? knownFrameBlocked(url) : false;
  return <div className={`dashboard-link-view${blocked ? " has-native-viewer" : ""}`}>
    <div className="dashboard-link-actions">
      <div className="dashboard-toolbar-actions">
        {!isHome && <button type="button" className="ghost-pill sm" onClick={() => window.dispatchEvent(new CustomEvent("baalda:set-home", { detail: { path, scope: "personal" } }))}>Set as my home</button>}
        <button type="button" className="primary sm" disabled={!url} onClick={() => { if (url) void ipc.openExternal(url).catch((e) => setError(String(e))); }}>Open in browser</button>
      </div>
    </div>
    {error ? <div className="dashboard-link-empty" role="alert">{error}</div> : !url ? <div className="dashboard-link-empty">Loading…</div> : blocked ? <NativeDashboardLink key={`${epoch}:${path}:${url}`} url={url} /> : <EmbeddedDashboardLink key={`${epoch}:${path}:${url}`} url={url} title={path} />}
  </div>;
}

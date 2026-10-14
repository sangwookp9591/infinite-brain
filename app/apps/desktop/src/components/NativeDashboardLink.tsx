// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { DashboardLinkLoader } from "./DashboardLinkLoader";
import * as ipc from "../lib/ipc";

/** An unprivileged native webview occupying this tab's content rectangle. */
export function NativeDashboardLink({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false, busy = false, failed = false, loaded = false;
    let label: string | undefined, previous = "", frame = 0;
    setError(null); setLoading(true);
    const tick = () => {
      if (disposed) return;
      frame = requestAnimationFrame(tick);
      if (busy || failed || !host.current) return;
      const rect = host.current.getBoundingClientRect();
      const bounds = { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.max(1, Math.min(rect.right, innerWidth) - Math.max(0, rect.x)), height: Math.max(1, Math.min(rect.bottom, innerHeight) - Math.max(0, rect.y)) };
      // Native views are above DOM layers. Hide while a menu/dialog/panel owns
      // that layer; retain the loaded page so closing it restores the viewer.
      const overlay = document.querySelector('[role="menu"], [role="dialog"], [aria-modal="true"], .modal-backdrop, .context-menu, .dashboard-agent-backdrop');
      const visible = !document.hidden && !overlay && rect.width > 1 && rect.height > 1;
      const key = JSON.stringify([bounds, visible && loaded]);
      if (key === previous || (!label && !visible)) return;
      previous = key;
      busy = true;
      void (async () => {
        try {
          if (!label) {
            const created = await ipc.mountDashboardLink(url, bounds, () => { if (!disposed) { loaded = true; setLoading(false); previous = ""; } });
            if (disposed) { await ipc.unmountDashboardLink(created); return; }
            label = created;
            previous = "";
          } else { await ipc.updateDashboardLink(label, bounds, visible && loaded); }
        } catch (e) {
          if (!disposed) { failed = true; setError(String(e)); }
        } finally { busy = false; }
      })();
    };
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (label) void ipc.unmountDashboardLink(label).catch(console.error);
    };
  }, [url]);
  return <div ref={host} className="dashboard-native-link" aria-busy={loading && !error}>
    {loading && !error && <DashboardLinkLoader url={url} />}
    {error && <div className="dashboard-link-empty" role="alert">Couldn’t load this linked dashboard. {error}</div>}
  </div>;
}

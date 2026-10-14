// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store";
import * as ipc from "../lib/ipc";
import { dashboardUrl } from "../lib/dashboard/bridge";

/** Mounted only after Preview is clicked. No SDK bridge is attached. */
export function VaultDashboardPreview({ path }: { path: string }) {
  const epoch = useStore((s) => s.vault?.epoch);
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [height, setHeight] = useState(650);
  const [content, setContent] = useState<string | null>(null);
  const [lease, setLease] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const html = /\.html?$/i.test(path);
  const markdown = /\.(md|markdown|mdx|txt)$/i.test(path);
  useEffect(() => {
    if (!host.current) return;
    const resize = new ResizeObserver(([e]) => { setWidth(e.contentRect.width); setHeight(e.contentRect.height); });
    resize.observe(host.current);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    setContent(null); setLease(null); setError(false);
    if (epoch == null || (!html && !markdown)) return;
    let alive = true, granted: string | null = null;
    const release = (value: string) => { void invoke("dashboard_unmount_view", { lease: value, epoch }).catch(() => {}); };
    let unlisten: (() => void) | undefined;
    let loaded: string | null = null, loadNumber = 0;
    const load = async () => {
      const number = ++loadNumber;
      try {
        const value = await ipc.readNote(path, epoch);
        if (!alive || number !== loadNumber || value === loaded) return;
        loaded = value; setContent(value); setError(false); setRevision((r) => r + 1);
      } catch { if (alive) setError(true); }
    };
    void ipc.onFileChanged((event) => {
      if (event.path === path && event.kind !== "removed" && !event.gone) void load();
    }).then((fn) => { if (!alive) fn(); else { unlisten = fn; void load(); } });
    if (html && import.meta.env.MODE !== "simulator") {
      void invoke<string>("dashboard_mount_view", { path, epoch }).then((value) => {
        if (!alive) release(value);
        else { granted = value; setLease(value); }
      }).catch(() => { if (alive) setError(true); });
    }
    return () => { alive = false; unlisten?.(); if (granted) release(granted); };
  }, [path, epoch, html, markdown]);
  const frameWidth = Math.max(720, width);
  const scale = width / frameWidth;
  return <div ref={host} className="dashboard-template-preview expanded vault-dashboard-preview">
    {html && (lease || content !== null) && epoch != null ? <iframe key={`${path}:${epoch}:${revision}`} title={`${path} preview`} scrolling="auto" sandbox="allow-scripts" referrerPolicy="no-referrer"
      src={lease ? `${dashboardUrl(path, epoch, document.documentElement.dataset.platform ?? "other")}?lease=${encodeURIComponent(lease)}&revision=${revision}` : undefined}
      srcDoc={lease ? undefined : content ?? undefined}
      style={{ width:frameWidth, height:height / scale, transform:`scale(${scale})` }} />
    : markdown && content !== null ? <div className="vault-dashboard-markdown">{content.slice(0, 1400)}</div>
    : <div className="dashboard-preview-placeholder"><span>{error ? "Preview unavailable" : html || markdown ? "Loading preview…" : "Linked dashboard · Open to view"}</span></div>}
  </div>;
}

// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { effectiveHomeNote, isDashboard } from "../lib/pins";
import { readNote, onFileChanged } from "../lib/ipc";
import { requestNewDashboard } from "../lib/homeEvents";
import { DASHBOARD_TEMPLATES } from "../lib/dashboard/templates";
import { toast } from "../lib/toast";
import { DashboardTemplateGallery } from "./DashboardTemplateGallery";
import "./VaultDashboardsTab.css";

/** One library in Settings and Change Home, with live previews of used designs. */
export function VaultDashboardsTab({ onClose, onNew, resetToken = 0 }: { onClose: () => void; onNew?: (templateId?: string) => void; resetToken?: number }) {
  const st = useStore();
  const home = effectiveHomeNote(st);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [contentRevision, setContentRevision] = useState(0);
  useEffect(() => {
    let alive = true, off: (() => void) | undefined;
    void onFileChanged((event) => {
      if (/\.html?$/i.test(event.path)) setContentRevision((r) => r + 1);
    }).then((fn) => { if (alive) off = fn; else fn(); });
    return () => { alive = false; off?.(); };
  }, []);
  const paths = st.titles.filter((n) => isDashboard(n.path) && /\.html?$/i.test(n.path)).map((n) => n.path);
  const signature = JSON.stringify(paths);
  useEffect(() => {
    let alive = true;
    const epoch = st.vault?.epoch;
    setSaved({});
    if (epoch == null) return;
    void (async () => {
      const result: Record<string, string> = {};
      // Resolve current Home last so its actual, edited preview wins over copies.
      for (const path of [...paths.filter((p) => p !== home?.path), ...(home && paths.includes(home.path) ? [home.path] : [])]) {
        try {
          const html = await readNote(path, epoch);
          if (!alive) return;
          const id = html.match(/<meta\s+name="baalda-template"\s+content="([^"]+)"/)?.[1]
            ?? DASHBOARD_TEMPLATES.find((t) => html.includes(`github.com/`) && (html.includes(`/${t.id}\n`) || html.includes(`>${t.id} · Original template`)))?.id;
          if (id && DASHBOARD_TEMPLATES.some((t) => t.id === id)) result[id] = path;
        } catch { /* A missing preview does not prevent choosing another template. */ }
      }
      if (alive) setSaved(result);
    })();
    return () => { alive = false; };
  }, [signature, home?.path, st.vault?.epoch, contentRevision]);
  const canUnset = !!st.personalHomeDocId || st.members.some((m) => m.userId === st.session?.user.id && ["owner", "admin"].includes(m.role));
  const currentId = Object.keys(saved).find((id) => saved[id] === home?.path);
  const useTemplate = async (id: string) => {
    if (!saved[id]) {
      if (onNew) onNew(id);
      else { onClose(); requestNewDashboard(undefined, { templateId:id, setAsHome:true }); }
      return;
    }
    setBusy(true);
    try { await st.setHome(saved[id], "personal"); }
    catch (e) { toast(String(e), "error"); }
    finally { setBusy(false); }
  };
  return <div className="vault-dashboards">
    {st.homeSectionHidden && <button className="secondary vault-dashboards-restore-home" type="button" onClick={() => st.setHomeSectionHidden(false)}>Show Home in sidebar</button>}
    <p className="vault-dashboards-description">Choose a dashboard for your Home. Preview a design, then make it yours with Claude or Codex.</p>
    <DashboardTemplateGallery key={resetToken} saved={saved} currentId={currentId} disabled={busy} onUse={(t) => void useTemplate(t.id)}
      onOpen={(path) => { void st.openNoteByPath(path).then(onClose).catch((e) => toast(String(e), "error")); }}
      onUnset={canUnset ? () => {
        setBusy(true);
        void st.setHome(null, st.personalHomeDocId ? "personal" : "vault").catch((e) => toast(String(e), "error")).finally(() => setBusy(false));
      } : undefined} />
    <button className="vault-dashboards-link" type="button" onClick={() => { onClose(); requestNewDashboard("link", { setAsHome:!home }); }}>Add a dashboard from a link ↗</button>
  </div>;
}

// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { DASHBOARD_TEMPLATES, type DashboardTemplate } from "../lib/dashboard/templates";
import { useT } from "../lib/i18n";
import "./DashboardTemplateGallery.css";
import { GlowCard } from "./kit/GlowCard";
import { VaultDashboardPreview } from "./VaultDashboardPreview";

export async function templateHtml(template: DashboardTemplate): Promise<string> {
  return template.html ?? await template.loadHtml!();
}

// Template palettes are user-content colours, isolated from the app theme.
// Previews are opaque, network-free frames. They never receive the vault bridge.
const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
export function DashboardTemplatePreview({ template, expanded = false }: { template: DashboardTemplate; expanded?: boolean }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState(320);
  const [height, setHeight] = useState(650);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const resize = new ResizeObserver(([entry]) => { setWidth(entry.contentRect.width); setHeight(entry.contentRect.height); });
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "80px" });
    resize.observe(node); observer.observe(node);
    return () => { resize.disconnect(); observer.disconnect(); };
  }, []);
  useEffect(() => {
    if (!visible) { setHtml(null); return; }
    let alive = true;
    setError(false);
    if (template.previewUrl) return;
    void templateHtml(template).then((value) => {
      if (!alive) return;
      // Place CSP before every upstream resource. Escaping keeps a trusted attribute literal.
      setHtml(`<!doctype html><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><style>.infinitebrain-template-credit{display:none!important}</style>${value}`);
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [visible, template]);
  const origin = document.documentElement.dataset.platform === "windows" ? "http://infinitebrain-view.localhost" : "infinitebrain-view://localhost";
  const url = template.previewUrl && (import.meta.env.MODE === "simulator" ? template.previewUrl : `${origin}/__infinitebrain/template/${template.id}`);
  const frameWidth = expanded ? Math.max(720, width) : 1200;
  const scale = width / frameWidth;
  return <div ref={host} className={`dashboard-template-preview${expanded ? " expanded" : ""}`}>
    {visible && (html || url) ? <iframe title={t("{name} preview", { name: t(template.name) })} scrolling={expanded ? "auto" : "no"} sandbox="allow-scripts" referrerPolicy="no-referrer" src={url || undefined} srcDoc={url ? undefined : html ?? undefined} tabIndex={-1} aria-hidden={!expanded}
      style={{ width: frameWidth, height: expanded ? height / scale : 1200, transform: `scale(${scale})` }} />
      : <div className="dashboard-preview-placeholder" style={{ background: template.palette?.[2] }}><span>{error ? t("Preview unavailable") : t("Loading preview…")}</span></div>}
  </div>;
}

export function DashboardTemplateGallery({ selectedId, onUse, disabled = false, saved = {}, currentId, onOpen, onUnset }: {
  selectedId?: string; onUse: (template: DashboardTemplate) => void; disabled?: boolean;
  saved?: Record<string, string>; currentId?: string; onOpen?: (path: string) => void; onUnset?: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All styles");
  const [preview, setPreview] = useState<DashboardTemplate | null>(null);
  const categories = ["All styles", ...new Set(DASHBOARD_TEMPLATES.map((tpl) => tpl.category).filter(Boolean))];
  // Search matches the English wire text and what the user sees.
  const templates = DASHBOARD_TEMPLATES.filter((tpl) => (category === "All styles" || tpl.category === category) && `${tpl.name} ${t(tpl.name)} ${tpl.author ?? ""} ${tpl.description} ${t(tpl.description)}`.toLowerCase().includes(query.toLowerCase()));
  if (preview) return <div className="dashboard-gallery-expanded">
    <div className="dashboard-gallery-toolbar">
      <button type="button" className="secondary" onClick={() => setPreview(null)}>{t("← All templates")}</button>
      <span><strong>{t(preview.name)}</strong> · {preview.author}</span>
      <div className="dashboard-gallery-preview-actions">
        {currentId === preview.id ? <>
          {onOpen && <button type="button" className="primary" onClick={() => onOpen(saved[preview.id])}>{t("Open")}</button>}
          {onUnset && <button type="button" className="secondary" disabled={disabled} onClick={onUnset}>{t("Unset Home")}</button>}
        </> : <button type="button" className="primary" disabled={disabled} onClick={() => { onUse(preview); setPreview(null); }}>{t("Use this template")}</button>}
      </div>
    </div>
    {saved[preview.id] ? <VaultDashboardPreview path={saved[preview.id]} /> : <DashboardTemplatePreview template={preview} expanded />}
  </div>;
  return <div className="dashboard-gallery">
    <div className="dashboard-gallery-toolbar"><div className="dashboard-gallery-filters" aria-label={t("Template styles")}>{categories.map((c) => <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}>{t(c)}</button>)}</div><input aria-label={t("Search dashboard templates")} placeholder={t("Search templates or designers…")} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    <div className="dashboard-gallery-grid" role="group" aria-label={t("Dashboard template")}>
      {templates.map((template) => <GlowCard key={template.id} className={`dashboard-gallery-card${selectedId === template.id || currentId === template.id ? " selected" : ""}`}>
        <div className="dashboard-gallery-picture">
          {template.thumbnailUrl ? <img className="dashboard-template-thumbnail" src={template.thumbnailUrl} alt="" width={900} height={900} loading="lazy" decoding="async" draggable={false} /> : <div className="dashboard-preview-placeholder" style={{ background: template.palette?.[2] }}>{t("Preview available on click")}</div>}
        </div>
        <h3 className="dashboard-gallery-card-name">{t(template.name)}{currentId === template.id && <span className="dashboard-current-badge">{t("Current Home")}</span>}</h3>
        <div className="dashboard-gallery-card-actions">
          <button type="button" className="secondary" aria-label={t("Show preview of {name}", { name: t(template.name) })} onClick={() => setPreview(template)}>{t("Show preview")}</button>
          {currentId !== template.id && <button type="button" className="primary" disabled={disabled} aria-pressed={selectedId === template.id} aria-label={t("Use {name}", { name: t(template.name) })} onClick={() => onUse(template)}>{selectedId === template.id ? t("Selected ✓") : t("Use template")}</button>}
        </div>
      </GlowCard>)}
      {templates.length === 0 && <p className="dashboard-gallery-empty">{t("No templates match. Try another style or search.")}</p>}
    </div>
  </div>;
}

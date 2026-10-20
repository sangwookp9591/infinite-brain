// SPDX-License-Identifier: Apache-2.0
export interface DashboardTemplate {
  id: string;
  name: string;
  author: string;
  category: string;
  palette: [string, string, string];
  description: string;
  source: string;
  previewUrl: string;
  thumbnailUrl: string;
  prompt: string;
  html?: string;
  loadHtml: () => Promise<string>;
}

const definitions: Omit<DashboardTemplate, "loadHtml">[] = [
  {
    id: "ib-daily", name: "Daily", author: "Infinite Brain", category: "Everyday",
    palette: ["#b4532a", "#2f6f62", "#f7f3ea"],
    description: "A calm daily view for today's edits, open tasks, recent notes, and a small focus timer.",
    source: "Infinite Brain original · Apache-2.0",
    previewUrl: "/dashboard-templates/ib-daily.html", thumbnailUrl: "/dashboard-thumbnails/ib-daily.webp",
    prompt: "Personalize this Daily dashboard using relevant Markdown notes from my vault and the Infinite Brain SDK. Keep each Sample badge until its data is replaced with verified vault data, preserve dark and light themes and responsive behavior, and never invent facts.",
  },
  {
    id: "ib-team-hub", name: "Team Hub", author: "Infinite Brain", category: "Everyday",
    palette: ["#3d6fd9", "#22a39a", "#eef1f6"],
    description: "A shared vault overview with activity, linked notes, folders, and changes from this week.",
    source: "Infinite Brain original · Apache-2.0",
    previewUrl: "/dashboard-templates/ib-team-hub.html", thumbnailUrl: "/dashboard-thumbnails/ib-team-hub.webp",
    prompt: "Personalize this Team Hub using relevant Markdown notes from my vault and the Infinite Brain SDK. Keep each Sample badge until its data is replaced with verified vault data, preserve dark and light themes and responsive behavior, and never invent facts.",
  },
  {
    id: "ib-projects", name: "Projects", author: "Infinite Brain", category: "Work",
    palette: ["#1f9d6b", "#f0a32b", "#f2f8f4"],
    description: "A project board grouped by status or folder, with note updates, tags, and column counts.",
    source: "Infinite Brain original · Apache-2.0",
    previewUrl: "/dashboard-templates/ib-projects.html", thumbnailUrl: "/dashboard-thumbnails/ib-projects.webp",
    prompt: "Personalize this Projects dashboard using relevant Markdown notes from my vault and the Infinite Brain SDK. Keep each Sample badge until its data is replaced with verified vault data, preserve dark and light themes and responsive behavior, and never invent facts.",
  },
  {
    id: "ib-research", name: "Research", author: "Infinite Brain", category: "Knowledge",
    palette: ["#8a5a2b", "#5c6f8f", "#f5efe4"],
    description: "A quiet research library for reading lists, highlights, sources, and backlinks.",
    source: "Infinite Brain original · Apache-2.0",
    previewUrl: "/dashboard-templates/ib-research.html", thumbnailUrl: "/dashboard-thumbnails/ib-research.webp",
    prompt: "Personalize this Research dashboard using relevant Markdown notes from my vault and the Infinite Brain SDK. Keep each Sample badge until its data is replaced with verified vault data, preserve dark and light themes and responsive behavior, and never invent facts.",
  },
  {
    id: "ib-knowledge-map", name: "Knowledge Map", author: "Infinite Brain", category: "Knowledge",
    palette: ["#00d1ff", "#ff4fd8", "#0b0f17"],
    description: "Explore vault tags, connected hubs, orphan notes, and a compact radial knowledge map.",
    source: "Infinite Brain original · Apache-2.0",
    previewUrl: "/dashboard-templates/ib-knowledge-map.html", thumbnailUrl: "/dashboard-thumbnails/ib-knowledge-map.webp",
    prompt: "Personalize this Knowledge Map using relevant Markdown notes from my vault and the Infinite Brain SDK. Keep each Sample badge until its data is replaced with verified vault data, preserve dark and light themes and responsive behavior, and never invent facts.",
  },
  {
    id: "ib-weekly-review", name: "Weekly Review", author: "Infinite Brain", category: "Everyday",
    palette: ["#7a5cd6", "#e0729b", "#f6f3fb"],
    description: "Review this week's notes, daily activity, reflection prompts, and carry-over tasks.",
    source: "Infinite Brain original · Apache-2.0",
    previewUrl: "/dashboard-templates/ib-weekly-review.html", thumbnailUrl: "/dashboard-thumbnails/ib-weekly-review.webp",
    prompt: "Personalize this Weekly Review using relevant Markdown notes from my vault and the Infinite Brain SDK. Keep each Sample badge until its data is replaced with verified vault data, preserve dark and light themes and responsive behavior, and never invent facts.",
  },
  {
    id: "ib-meetings", name: "Meetings", author: "Infinite Brain", category: "Work",
    palette: ["#c98a12", "#4b5563", "#f4f4f2"],
    description: "Find meeting notes, decisions, action items, and the next date in your vault.",
    source: "Infinite Brain original · Apache-2.0",
    previewUrl: "/dashboard-templates/ib-meetings.html", thumbnailUrl: "/dashboard-thumbnails/ib-meetings.webp",
    prompt: "Personalize this Meetings dashboard using relevant Markdown notes from my vault and the Infinite Brain SDK. Keep each Sample badge until its data is replaced with verified vault data, preserve dark and light themes and responsive behavior, and never invent facts.",
  },
  {
    id: "ib-blank", name: "Blank", author: "Infinite Brain", category: "Start",
    palette: ["#111111", "#6b7280", "#ffffff"],
    description: "A minimal starting point with three sections ready to fill from your vault.",
    source: "Infinite Brain original · Apache-2.0",
    previewUrl: "/dashboard-templates/ib-blank.html", thumbnailUrl: "/dashboard-thumbnails/ib-blank.webp",
    prompt: "Personalize this Blank dashboard using relevant Markdown notes from my vault and the Infinite Brain SDK. Keep each Sample badge until its data is replaced with verified vault data, preserve dark and light themes and responsive behavior, and never invent facts.",
  },
];

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = definitions.map((template) => ({
  ...template,
  loadHtml: async () => {
    const response = await fetch(template.previewUrl);
    if (!response.ok) throw new Error("This template is unavailable. Try another template.");
    return response.text();
  },
}));

export function dashboardPrompt(path: string, vaultPath: string, request = "Update this dashboard using my notes."): string {
  return `${request}\n\nDashboard: ${path}\nVault folder: ${vaultPath}\nInfinite Brain renders; it never generates. Read the HTML comment at the top of the file for the optional infinitebrain API. Read relevant Markdown notes or use the Infinite Brain MCP tools; keep those notes as the source of truth, without a separate JSON export. Update this HTML file via filesystem edits or MCP update_note/edit_note, preserving its identity. Only use information I can read and don't invent facts. No fetch/XHR/WebSocket; inline JS or allowed CDNs (cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com). Use /__infinitebrain/sdk.js only when live data is useful; no localStorage. Optional API: vault.info/stats; notes.search/list/read/meta/backlinks; graph.edges; tags.list; properties.keys/values; state.get/set; app.open/openExternal. List filters: folder,tag,property:{key,value},modifiedSince (Unix seconds),sort,limit. Use CSS theme variables --bg,--fg,--surface,--muted,--accent,--border. Write the page the user asked for.`;
}
export async function copyDashboardPrompt(path: string, vaultPath: string, request?: string) {
  await navigator.clipboard.writeText(dashboardPrompt(path, vaultPath, request));
}

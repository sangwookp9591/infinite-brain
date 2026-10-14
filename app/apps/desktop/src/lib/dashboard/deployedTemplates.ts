// SPDX-License-Identifier: Apache-2.0
import type { DashboardTemplate } from "./importedTemplates";

/** User-supplied deployments, bundled with fictional data and local demo actions. */
export const DEPLOYED_OS_TEMPLATES: DashboardTemplate[] = [
  {
    id: "cosmos-agentic-os",
    name: "Cosmos — Agentic OS",
    category: "Agentic OS",
    palette: ["#5ee7ff", "#a78bfa", "#020714"],
    description: "An orbital knowledge graph with search, inspectors, briefing, radar, and a demo command console. Dark and light themes.",
    source: "https://benai-cosmos.vercel.app/",
  },
  {
    id: "sales-os",
    name: "Sales OS",
    category: "Agentic OS",
    palette: ["#b4dda8", "#e8c876", "#141815"],
    description: "A sales control center with call briefs, pipeline charts, decisions, execution history, context, playbooks, and a tool stack. Dark and light themes.",
    source: "https://cockpit-nebula-h7q2k.vercel.app/",
  },
  {
    id: "marketing-os",
    name: "Marketing OS",
    category: "Agentic OS",
    palette: ["#3b82f6", "#22c55e", "#0b0c0e"],
    description: "A marketing workspace with content, calendar, campaigns, funnel, performance, audience, intelligence, team, and an animated system core. Six palettes.",
    source: "https://marketing-os-control.vercel.app/#/intel",
  },
].map((template) => ({
  ...template,
  author: "Ben AI · adapted for Baalda",
  previewUrl: `/dashboard-templates/${template.id}.html`,
  thumbnailUrl: `/dashboard-thumbnails/${template.id}.webp`,
  prompt: `Personalize ${template.name} using supported facts from my vault. Read the customization comment and sample data first. Preserve the downloaded interface, pages, themes, responsive spacing and motion controls. Replace fictional records with my workflow. Keep simulated actions labeled until deliberately connected; do not invent service connections, execute workflows or send messages from this template. Use Baalda's permission-checked dashboard API when live reads are useful. Preserve this HTML file's identity and upstream attribution and dependency notices.`,
  loadHtml: async () => {
    const response = await fetch(`/dashboard-templates/${template.id}.html`);
    if (!response.ok) throw new Error("This template is unavailable. Try another template.");
    return response.text();
  },
}));

// SPDX-License-Identifier: Apache-2.0
// Original upstream dashboards; see public/dashboard-templates/SOURCES.json for revisions and licenses.
export interface DashboardTemplate {
  id: string; name: string; category: string; palette?: readonly string[]; description: string;
  previewUrl?: string; thumbnailUrl?: string; author?: string; source?: string; html?: string; loadHtml?: () => Promise<string>; prompt?: string;
}
const definitions = [
  [
    "tabler",
    "Tabler",
    "Tabler",
    "Minimal",
    [
      "#206bc4",
      "#f6f8fb",
      "#182433"
    ],
    "Clean analytics, charts, and an activity overview"
  ],
  [
    "sneat-html-admin-template-free",
    "Sneat",
    "ThemeSelection",
    "Colorful",
    [
      "#696cff",
      "#71dd37",
      "#f5f5f9"
    ],
    "Soft violet analytics with rounded cards and sales charts"
  ],
  [
    "materio-bootstrap-html-admin-template-free",
    "Materio",
    "ThemeSelection",
    "Colorful",
    [
      "#9055fd",
      "#ffb400",
      "#f4f5fa"
    ],
    "Material cards, revenue summaries, and a colorful activity feed"
  ],
  [
    "argon-dashboard",
    "Argon",
    "Creative Tim",
    "Colorful",
    [
      "#5e72e4",
      "#2dce89",
      "#f8f9fa"
    ],
    "Blue header, floating statistics, and spacious business charts"
  ],
  [
    "material-dashboard-v3",
    "Material Dashboard",
    "Creative Tim",
    "Minimal",
    [
      "#e91e63",
      "#343a40",
      "#f0f2f5"
    ],
    "Material surfaces, bold chart panels, and compact metrics"
  ],
  [
    "soft-ui-dashboard",
    "Soft UI",
    "Creative Tim",
    "Colorful",
    [
      "#cb0c9f",
      "#17c1e8",
      "#f8f9fa"
    ],
    "Gradient accents, soft shadows, and generous rounded panels"
  ],
  [
    "black-dashboard",
    "Black Dashboard",
    "Creative Tim",
    "Dark",
    [
      "#1e1e2f",
      "#e14eca",
      "#1d8cf8"
    ],
    "Dark canvas with neon performance charts and task cards"
  ],
  [
    "paper-dashboard",
    "Paper Dashboard",
    "Creative Tim",
    "Minimal",
    [
      "#f4f3ef",
      "#ef8157",
      "#51cbce"
    ],
    "Warm paper surfaces with orange and turquoise charts"
  ],
  [
    "light-bootstrap-dashboard",
    "Light Bootstrap",
    "Creative Tim",
    "Minimal",
    [
      "#9368e9",
      "#23ccef",
      "#f7f7f8"
    ],
    "Classic clean reporting with fine borders and light charts"
  ],
  [
    "now-ui-dashboard",
    "Now UI",
    "Creative Tim & Invision",
    "Colorful",
    [
      "#f96332",
      "#2ca8ff",
      "#ebecf1"
    ],
    "Bright coral chart header and compact operational cards"
  ],
  [
    "startbootstrap-sb-admin",
    "SB Admin",
    "Start Bootstrap",
    "Minimal",
    [
      "#0d6efd",
      "#212529",
      "#ffffff"
    ],
    "Straightforward metrics, chart comparisons, and sortable data"
  ],
  [
    "startbootstrap-sb-admin-2",
    "SB Admin 2",
    "Start Bootstrap",
    "Colorful",
    [
      "#4e73df",
      "#1cc88a",
      "#f8f9fc"
    ],
    "Blue business overview with earnings charts and project progress"
  ],
  [
    "adminkit",
    "AdminKit",
    "AdminKit",
    "Minimal",
    [
      "#3b7ddd",
      "#222e3c",
      "#f5f7fb"
    ],
    "Quiet blue statistics, calendar, and project reporting"
  ],
  [
    "PurpleAdmin-Free-Admin-Template",
    "Purple Admin",
    "BootstrapDash",
    "Colorful",
    [
      "#b66dff",
      "#fe7096",
      "#f2edf3"
    ],
    "Pastel gradients, sales charts, and a colorful task overview"
  ],
  [
    "MajesticAdmin-Free-Bootstrap-Admin-Template",
    "Majestic",
    "BootstrapDash",
    "Minimal",
    [
      "#4b49ac",
      "#98bdff",
      "#f5f7ff"
    ],
    "Indigo metrics, visitors, and detailed performance tables"
  ],
  [
    "StarAdmin-Free-Bootstrap-Admin-Template",
    "Star Admin",
    "BootstrapDash",
    "Colorful",
    [
      "#2196f3",
      "#ffaf00",
      "#f3f5f7"
    ],
    "Dense operational reporting with teal and amber accents"
  ],
  [
    "corona-free-dark-bootstrap-admin-template",
    "Corona",
    "BootstrapDash",
    "Dark",
    [
      "#191c24",
      "#00d25b",
      "#0090e7"
    ],
    "High-contrast dark operations with bright charts and activity"
  ],
  [
    "AdminLTE",
    "AdminLTE",
    "Colorlib",
    "Colorful",
    [
      "#0d6efd",
      "#20c997",
      "#f4f6f9"
    ],
    "Bold colored metric tiles, reporting charts, and team activity"
  ],
  [
    "plainadmin",
    "PlainAdmin",
    "PlainAdmin",
    "Minimal",
    [
      "#365cf5",
      "#ffb800",
      "#f1f5f9"
    ],
    "Clear blue reporting, clean tables, and a calendar overview"
  ],
  [
    "mazer",
    "Mazer",
    "Ahmad Saugi",
    "Colorful",
    [
      "#435ebe",
      "#9694ff",
      "#f2f7ff"
    ],
    "Lavender profile statistics and spacious audience charts"
  ]
] as const;
export const IMPORTED_DASHBOARD_TEMPLATES: DashboardTemplate[] = definitions.map(([id, name, author, category, palette, description]) => ({
  id, name, author, category, palette, description,
  source: `Imported original · ${author}`,
  prompt: `Personalize this original ${name} dashboard from my vault. Read AGENTS.md and the relevant source notes first. Keep the original design and copyright notices, replace sample data with supported facts, remove irrelevant demo components, and connect useful controls. Do not invent metrics.`,
  previewUrl: `/dashboard-templates/${id}.html`,
  thumbnailUrl: `/dashboard-thumbnails/${id}.webp`,
  loadHtml: async () => {
    const response = await fetch(`/dashboard-templates/${id}.html`);
    if (!response.ok) throw new Error("This template is unavailable. Try another template.");
    return response.text();
  },
}));

// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Keep every user-facing identity and endpoint change in this one map.
export const BRAND = {
  from: {
    productName: "Baalda",
    bundleIdentifier: "com.baalda.context",
    deepLinkScheme: "baalda",
    devDeepLinkScheme: "baalda-dev",
    stagingDeepLinkScheme: "baalda-staging",
    dashboardProtocol: "baalda-view",
    dashboardSdkPath: "/__baalda/sdk.js",
    dashboardChannel: "baalda.dashboard.v1",
    dashboardAgentEvent: "baalda:launch-dashboard-agent",
    dashboardGlobal: "window.baalda",
    productionServerHost: "api.baalda.com",
    websiteUrl: "https://baalda.com",
    repositoryPath: "naveedharri/baalda",
  },
  productName: "Infinite Brain",
  bundleIdentifier: "com.infinitebrain.app",
  deepLinkScheme: "infinitebrain",
  devDeepLinkScheme: "infinitebrain-dev",
  stagingDeepLinkScheme: "infinitebrain-staging",
  dashboardProtocol: "infinitebrain-view",
  dashboardSdkPath: "/__infinitebrain/sdk.js",
  productionServerUrl: "http://localhost:3010",
  repositoryUrl: "https://github.com/sangwookp9591/infinite-brain",
  updaterEndpoint:
    "https://github.com/sangwookp9591/infinite-brain/releases/latest/download/latest.json",
  stagingUpdaterEndpoint:
    "https://github.com/sangwookp9591/infinite-brain/releases/download/staging/latest.json",
  targetExtensions: [
    ".css", ".example", ".html", ".js", ".json", ".md", ".mjs", ".plist", ".rs", ".toml",
    ".ts", ".tsx", ".txt", ".yml", ".yaml",
  ],
  excludedPaths: [
    ".git/", "node_modules/", "target/", "dist/", "build/", ".context/",
    "app/apps/desktop/public/dashboard-templates/", // Imported vendor assets and attribution.
    "docs/research/", "docs/FINAL-report.md", "docs/UPSTREAM-CLAUDE.md", "docs/BRANDING.md", // Historical/source records.
    "scripts/rebrand.mjs", "scripts/rebrand.test.mjs", "IMPL-REPORT-*", // Source map, fixtures, and audit reports preserve old values intentionally.
    "CHANGELOG.md", "LICENSE", "NOTICE", "TRADEMARK.md", // Rewritten or preserved separately.
  ],
};

const replacements = [
  ['?? "baalda"', '?? "infinitebrain"'],
  ["?? 'baalda'", "?? 'infinitebrain'"],
  ["DEEP_LINK_SCHEME=baalda", "DEEP_LINK_SCHEME=infinitebrain"],
  ['scheme like "baalda"', 'scheme like "infinitebrain"'],
  ["`baalda`", "`infinitebrain`"],
  ["x-baalda-origin", "x-infinitebrain-origin"],
  ["x-baalda-version", "x-infinitebrain-version"],
  ["x-baalda-cursor", "x-infinitebrain-cursor"],
  ["x-baalda-docs", "x-infinitebrain-docs"],
  ["x-baalda-bytes", "x-infinitebrain-bytes"],
  ["not-baalda", "not-infinitebrain"],
  ["X-Baalda-Cursor", "X-InfiniteBrain-Cursor"],
  ["X-Baalda-Docs", "X-InfiniteBrain-Docs"],
  ["X-Baalda-Bytes", "X-InfiniteBrain-Bytes"],
  ["Baalda's credentials", "upstream credentials"],
  [`${BRAND.from.productName} Staging`, `${BRAND.productName} Staging`],
  [BRAND.from.productName, BRAND.productName],
  ["com.baalda.context.staging", `${BRAND.bundleIdentifier}.staging`],
  [BRAND.from.bundleIdentifier, BRAND.bundleIdentifier],
  [BRAND.from.dashboardProtocol, BRAND.dashboardProtocol],
  [BRAND.from.dashboardChannel, "infinitebrain.dashboard.v1"],
  [BRAND.from.dashboardAgentEvent, "infinitebrain:launch-dashboard-agent"],
  [BRAND.from.dashboardGlobal, "window.infinitebrain"],
  ["baalda.ready", "infinitebrain.ready"],
  ["baalda.vault", "infinitebrain.vault"],
  ["baalda.notes", "infinitebrain.notes"],
  ["baalda.graph", "infinitebrain.graph"],
  ["baalda.tags", "infinitebrain.tags"],
  ["baalda.properties", "infinitebrain.properties"],
  ["baalda.state", "infinitebrain.state"],
  ["baalda.app", "infinitebrain.app"],
  ["application/vnd.baalda.bootstrap", "application/vnd.infinitebrain.bootstrap"],
  [`${BRAND.from.deepLinkScheme}://`, `${BRAND.deepLinkScheme}://`],
  ["baalda:", "infinitebrain:"],
  [BRAND.from.devDeepLinkScheme, BRAND.devDeepLinkScheme],
  [BRAND.from.stagingDeepLinkScheme, BRAND.stagingDeepLinkScheme],
  [BRAND.from.dashboardSdkPath, BRAND.dashboardSdkPath],
  ["/__baalda/", "/__infinitebrain/"],
  [`https://${BRAND.from.productionServerHost}`, BRAND.productionServerUrl],
  [`http://${BRAND.from.productionServerHost}`, BRAND.productionServerUrl],
  [BRAND.from.productionServerHost, "localhost:3010"],
  [BRAND.from.websiteUrl, BRAND.repositoryUrl],
  [`https://github.com/${BRAND.from.repositoryPath}`, BRAND.repositoryUrl],
  [`github.com/${BRAND.from.repositoryPath}`, "github.com/sangwookp9591/infinite-brain"],
  [BRAND.from.repositoryPath, "sangwookp9591/infinite-brain"],
];

export function rebrandText(input) {
  return replacements
    .sort(([a], [b]) => b.length - a.length)
    .reduce((text, [from, to]) => text.split(from).join(to), input);
}

function isExcluded(path) {
  const normalized = path.split(sep).join("/");
  return BRAND.excludedPaths.some((excluded) => {
    if (excluded.endsWith("/")) return normalized.startsWith(excluded);
    if (excluded.endsWith("*")) return normalized.startsWith(excluded.slice(0, -1));
    return normalized === excluded;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--dry-run");
  if (unknownArgs.length) {
    console.error(`Unknown argument: ${unknownArgs[0]}`);
    process.exit(2);
  }

  const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT })
    .toString("utf8")
    .split("\0")
    .filter((path) => path && !isExcluded(path) && BRAND.targetExtensions.includes(extname(path)));
  let changed = 0;
  for (const path of files) {
    const file = resolve(ROOT, path);
    const before = readFileSync(file, "utf8");
    const after = rebrandText(before);
    if (after === before) continue;
    changed++;
    console.log(`${dryRun ? "would update" : "updated"} ${path}`);
    if (!dryRun) writeFileSync(file, after);
  }
  console.log(`${dryRun ? "Would update" : "Updated"} ${changed} file(s).`);
}

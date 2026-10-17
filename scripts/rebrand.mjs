// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
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
  bundleIdentifier: "com.infinitebrain.desktop",
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
    "docs/superpowers/specs/2026-10-17-identity-redesign-directions.md", // Quotes the original redesign request verbatim.
    "scripts/rebrand.mjs", "scripts/rebrand.test.mjs", "docs/reports/", // Source map, fixtures, and audit reports preserve old values intentionally.
    "CHANGELOG.md", "LICENSE", "NOTICE", "TRADEMARK.md", // Rewritten or preserved separately.
  ],
};

// Hashes of the upstream wordmarks and platform icons; never ship them again.
export const ORIGINAL_BRAND_ASSET_HASHES = ["00bc423cdd6e8d3fd0dd5abda5b0aba7e1cbbc5aaa8d5336af9de804b096f112", "0379d808456d1196cec95b4f0f601babc32463a141b7b0756ad55a0263b5de64", "0c6074c9cb69c0fdb90c8f93c2973260fec820a13590acce6c4657a1e5b4fc60", "173082a5cc8806161fb3297ce1fa66bdc1661f7ca76288879dab761299181873", "1a69920d9217497bcf284f541ab2ff3ee3d12aa529cb55ca5a828f2ecdacab5f", "2ceae2ea0869f92c2193f21823a5b9ec249596a65a2665f4d861b820297c0218", "38f2c616aaf4430ffd6771d878b935ed2bfcbb9d2145bb489cc37678c09a6d43", "4393dc1fff0e16dd5dfb42153c068d4d9a23b70e264fbff24e0bb1bde7b33f40", "4cc6a7b7000d2b55fb1e4565ddf0f7f2e60717a98016db140a12c2fa770f272d", "4d97f84052226d860818ef01ecc87e9a9bc92fa15c1533314ce38b7b769e4663", "6f5ed3e1328f4175c1eedf66b02e260bec37db0c19774eff15840682a6b37b07", "72c060760fe155be7035d5aba2326859fb58b65ff0142d2184c3310947eb8174", "79af9186e0d05152c36b649b4d5a5a797876fa58233ef99d245fc9f43cb98156", "870ac8e02f441c5cbab8b9e928e18474c4bf9314434fdc994ca358535e682cf0", "91b2bbbb95f20f0e8684d35910851c8c59f35b1669d724b1ef892c172f01dc05", "9a8c5d2a005ca53b2ef8044016fab632f88cd51c1461c286cd24d8f371d6598e", "a96b431ea6616b1065290a8a71dae1091a5c1c7d0de99002e2ca08f5d37f0caf", "d1b7912f375a2a19dcdd4b6a37c6369f3be79896a736c2b5005f23a07af5a217", "d33c9960eed33f0cf71cab86ff43500f41094755eee233e0db2a56851244247f", "e23b8f493f69a6fbe9b304a4d4baad14ba4bfab85602c8979d7eb47dfff04829", "ee0bff0796dff1aed23f56ddbd51c7725f78797946253a4b31b554882fb20a89", "f779ae0e9a0df331ffb3aed33e3d88b87c02b0d94dbf4e18d89010edcac89600", "f92499715d0d0e93af5aa7b6a18a4275b57e25cc39548a4bbd39cca8ff659bb7"];

const replacements = [
  ['?? "baalda"', '?? "infinitebrain"'],
  ["?? 'baalda'", "?? 'infinitebrain'"],
  ["DEEP_LINK_SCHEME=baalda", "DEEP_LINK_SCHEME=infinitebrain"],
  ['scheme like "baalda"', 'scheme like "infinitebrain"'],
  ["Leave unset for `baalda`", "Leave unset for `infinitebrain`"],
  ["registers `baalda`", "registers `infinitebrain`"],
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

// Phrases that name the upstream project on purpose (fork attribution, design history).
const preservedPhrases = [
  "Baalda 0.1.83",
  "upstream Baalda",
  "Baalda/Atomize PLUS",
  "Baalda처럼",
  "Baalda에서 물려받은",
];

export function rebrandText(input) {
  const masked = preservedPhrases.reduce(
    (text, phrase, i) => text.split(phrase).join(`\u0000preserved${i}\u0000`),
    input,
  );
  const replaced = replacements
    .sort(([a], [b]) => b.length - a.length)
    .reduce((text, [from, to]) => text.split(from).join(to), masked);
  return preservedPhrases.reduce(
    (text, phrase, i) => text.split(`\u0000preserved${i}\u0000`).join(phrase),
    replaced,
  );
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
  const assets = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT }).toString("utf8").split("\0");
  for (const path of assets.filter((p) => /\.(png|jpg|ico|icns)$/.test(p))) {
    const hash = createHash("sha256").update(readFileSync(resolve(ROOT, path))).digest("hex");
    if (ORIGINAL_BRAND_ASSET_HASHES.includes(hash)) throw new Error(`Upstream brand asset remains: ${path}`);
  }
  console.log(`${dryRun ? "Would update" : "Updated"} ${changed} file(s).`);
}

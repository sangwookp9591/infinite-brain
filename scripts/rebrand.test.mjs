// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BRAND, rebrandText } from "./rebrand.mjs";

test("rebrand substitutions are idempotent and keep internal storage identity", () => {
  const input =
    'Baalda Staging com.baalda.context baalda://note baalda-view /__baalda/sdk.js https://api.baalda.com https://github.com/naveedharri/baalda X-Baalda-Cursor .context/';
  const once = rebrandText(input);
  assert.equal(rebrandText(once), once);
  assert.match(once, /Infinite Brain Staging/);
  assert.match(once, /com\.infinitebrain\.desktop/);
  assert.match(once, /infinitebrain:\/\//);
  assert.match(once, /infinitebrain-view/);
  assert.match(once, /__infinitebrain\/sdk\.js/);
  assert.match(once, /http:\/\/localhost:3010/);
  assert.match(once, /github\.com\/sangwookp9591\/infinite-brain/);
  assert.match(once, /X-InfiniteBrain-Cursor/);
  assert.match(once, /\.context\//);
  assert.equal(BRAND.deepLinkScheme, "infinitebrain");
  assert.equal(BRAND.devDeepLinkScheme, "infinitebrain-dev");
});

test("Tauri production, development, and staging configs use the fork identity", () => {
  const config = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const main = config("../app/apps/desktop/src-tauri/tauri.conf.json");
  const dev = config("../app/apps/desktop/src-tauri/tauri.dev.conf.json");
  const staging = config("../app/apps/desktop/src-tauri/tauri.staging.conf.json");
  assert.equal(main.productName, BRAND.productName);
  assert.equal(main.identifier, BRAND.bundleIdentifier);
  assert.deepEqual(main.plugins["deep-link"].desktop.schemes, [BRAND.deepLinkScheme]);
  assert.equal(main.plugins.updater.endpoints[0], BRAND.updaterEndpoint);
  assert.ok(main.plugins.updater.pubkey);
  assert.deepEqual(dev.plugins["deep-link"].desktop.schemes, [BRAND.devDeepLinkScheme]);
  assert.equal(staging.identifier, `${BRAND.bundleIdentifier}.staging`);
  assert.deepEqual(staging.plugins["deep-link"].desktop.schemes, [BRAND.stagingDeepLinkScheme]);
  assert.equal(staging.plugins.updater.endpoints[0], BRAND.stagingUpdaterEndpoint);
});

test("server scheme defaults and examples are rebranded", () => {
  assert.equal(rebrandText('optional("DEEP_LINK_SCHEME") ?? "baalda"'), 'optional("DEEP_LINK_SCHEME") ?? "infinitebrain"');
  assert.equal(rebrandText("DEEP_LINK_SCHEME=baalda"), "DEEP_LINK_SCHEME=infinitebrain");
});

test("keychain and release bundle share one service identity", () => {
  const keychain = readFileSync(new URL("../app/apps/desktop/src-tauri/src/keychain.rs", import.meta.url), "utf8");
  assert.ok(keychain.includes(`pub const SERVICE: &str = "${BRAND.bundleIdentifier}";`));
  assert.ok(!BRAND.bundleIdentifier.endsWith(".app"));
});

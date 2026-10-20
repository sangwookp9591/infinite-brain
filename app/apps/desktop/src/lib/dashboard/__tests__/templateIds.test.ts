// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { DASHBOARD_TEMPLATES } from "../templates";

// The native preview route (src-tauri/src/dashboard.rs) serves only ids on its
// allowlist; a gallery entry missing there previews as "unavailable".
it("keeps the native template allowlist in step with the gallery", () => {
  const rust = readFileSync(new URL("../../../../src-tauri/src/dashboard.rs", import.meta.url), "utf8");
  const block = /const TEMPLATE_IDS: &\[&str\] = &\[([\s\S]*?)\];/.exec(rust)![1];
  const ids = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  expect(ids).toEqual(DASHBOARD_TEMPLATES.map((t) => t.id));
});

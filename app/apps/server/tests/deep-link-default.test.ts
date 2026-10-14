// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it, vi } from "vitest";
import { APP_SCHEME } from "../../desktop/src/lib/deepLinkScheme.js";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("the server default opens the desktop production scheme", async () => {
  vi.stubEnv("DEEP_LINK_SCHEME", "");
  vi.resetModules();
  const { config } = await import("../src/config.js");
  expect(config.deepLinkScheme).toBe("infinitebrain");
  expect(config.deepLinkScheme).toBe(APP_SCHEME);
});

it("rejects an invalid deep-link scheme", async () => {
  vi.stubEnv("DEEP_LINK_SCHEME", "infinitebrain://");
  vi.resetModules();
  await expect(import("../src/config.js")).rejects.toThrow('scheme like "infinitebrain"');
});

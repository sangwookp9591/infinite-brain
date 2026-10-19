// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vitest/config";

// Design-lab-only suites; the product config only scans src/.
export default defineConfig({ test: { environment: "node", include: ["dev/design-lab/**/*.test.ts"], root: new URL("../..", import.meta.url).pathname } });

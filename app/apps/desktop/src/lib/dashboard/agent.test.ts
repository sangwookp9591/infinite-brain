// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { appendAgentLog } from "./agent";

describe("installed agent output", () => {
  it("keeps recent output within a fixed memory bound", () => {
    const log = appendAgentLog("old line\n".repeat(5000), "latest result");
    expect(log.length).toBeLessThanOrEqual(24_030);
    expect(log).toContain("Earlier output omitted");
    expect(log.endsWith("latest result")).toBe(true);
  });
  it("bounds one oversized output message", () => {
    expect(appendAgentLog("", "x".repeat(100_000)).length).toBeLessThanOrEqual(24_030);
  });
});

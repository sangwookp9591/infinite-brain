// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { effectiveUsageMode, readUsageMode } from "../usageMode";

describe("usage mode", () => {
  it("reads only the two known values", () => {
    const store = (v: string | null) => ({ getItem: () => v });
    expect(readUsageMode(store("personal"))).toBe("personal");
    expect(readUsageMode(store("team"))).toBe("team");
    expect(readUsageMode(store("solo"))).toBeNull();
    expect(readUsageMode(store(null))).toBeNull();
    expect(readUsageMode(null)).toBeNull();
  });

  it("treats blocked storage as not chosen", () => {
    expect(readUsageMode({ getItem: () => { throw new Error("blocked"); } })).toBeNull();
  });

  it("keeps every team surface until someone chooses personal", () => {
    expect(effectiveUsageMode(null)).toBe("team");
    expect(effectiveUsageMode("team")).toBe("team");
    expect(effectiveUsageMode("personal")).toBe("personal");
  });
});

// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { internetShortcut, knownFrameBlocked, readDashboardLink } from "../links";
describe("portable linked dashboards", () => {
  it("reads Windows shortcuts and text Apple weblocs", () => {
    expect(readDashboardLink(internetShortcut("https://example.com/x"), "Home.url")).toBe("https://example.com/x");
    expect(readDashboardLink('<plist><dict><key>URL</key><string>https://example.com/?a=1&amp;b=2</string></dict></plist>', "Home.webloc")).toBe("https://example.com/?a=1&b=2");
  });
  it("accepts Finder's standard plist doctype without resolving a DTD", () => {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>URL</key><string>https://example.com/dashboard?a=1&amp;b=2</string></dict></plist>`;
    expect(readDashboardLink(plist, "Finder.webloc")).toBe("https://example.com/dashboard?a=1&b=2");
    expect(() => readDashboardLink('<!ENTITY secret SYSTEM "file:///etc/passwd"><key>URL</key><string>https://example.com/&secret;</string>', "Unsafe.webloc")).toThrow("entities");
  });
  it("accepts HTTPS websites while refusing executable URLs and credentials", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "http://example.com", "https://user:pass@example.com"]) expect(() => internetShortcut(url)).toThrow();
    expect(internetShortcut("https://baalda.com")).toContain("URL=https://baalda.com/");
    expect(knownFrameBlocked("https://example.workspace.chatgpt.site")).toBe(false);
    expect(knownFrameBlocked("https://claude.ai/artifact/abc")).toBe(true);
  });
});

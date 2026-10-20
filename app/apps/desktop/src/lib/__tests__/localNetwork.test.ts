// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { isLocalNetworkHost } from "../localNetwork";
import { normalizeServerUrl, plainHttpHint } from "../auth/serverChoice";
import { DEFAULT_SERVER_URL, resolveServerUrl } from "../api";

describe("plain http on the local network only", () => {
  it("knows which hosts are this computer or the local network", () => {
    for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.20", "169.254.3.4", "studio.local", "[::1]", "fd12:3456::1", "fe80::1"]) {
      expect(isLocalNetworkHost(host), host).toBe(true);
    }
    for (const host of ["example.com", "8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.1.1", "11.0.0.1", "2001:db8::1", "local.example.com"]) {
      expect(isLocalNetworkHost(host), host).toBe(false);
    }
  });

  it("accepts a LAN server over http and refuses a public one", () => {
    expect(normalizeServerUrl("http://192.168.1.20:3010")).toBe("http://192.168.1.20:3010");
    expect(normalizeServerUrl("http://studio.local:3010/")).toBe("http://studio.local:3010");
    expect(normalizeServerUrl("http://example.com")).toBeNull();
    expect(normalizeServerUrl("example.com")).toBe("https://example.com");
    expect(plainHttpHint("http://192.168.1.20:3010")).toBeNull();
    expect(plainHttpHint("http://example.com")).toMatch(/local network/);
  });

  it("never uses a saved public http address", () => {
    expect(resolveServerUrl("http://10.1.2.3:3010")).toBe("http://10.1.2.3:3010");
    expect(resolveServerUrl("http://example.com")).toBe(DEFAULT_SERVER_URL);
  });
});

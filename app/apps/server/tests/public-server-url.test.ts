// SPDX-License-Identifier: Apache-2.0
// Pure: no database. Plain http is for this machine and the local network only.
import { describe, expect, it } from "vitest";
import { isLocalNetworkHost, parsePublicServerUrl } from "../src/config";

describe("BETTER_AUTH_URL", () => {
  it("accepts https anywhere and http on this machine or the local network", () => {
    expect(parsePublicServerUrl("https://brain.example.com")).toBe("https://brain.example.com");
    expect(parsePublicServerUrl("http://localhost:3010")).toBe("http://localhost:3010");
    expect(parsePublicServerUrl("http://192.168.1.20:3010")).toBe("http://192.168.1.20:3010");
    expect(parsePublicServerUrl("http://studio.local:3010")).toBe("http://studio.local:3010");
  });

  it("refuses plain http on the public internet and malformed origins", () => {
    expect(() => parsePublicServerUrl("http://brain.example.com")).toThrow(/local network/);
    expect(() => parsePublicServerUrl("http://8.8.8.8")).toThrow();
    expect(() => parsePublicServerUrl("https://brain.example.com/prefix")).toThrow();
    expect(() => parsePublicServerUrl("https://user:pw@brain.example.com")).toThrow();
  });

  it("matches the desktop's notion of the local network", () => {
    expect(isLocalNetworkHost("10.0.0.1")).toBe(true);
    expect(isLocalNetworkHost("172.32.0.1")).toBe(false);
    expect(isLocalNetworkHost("fd00::1")).toBe(true);
  });
});

// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { encodeOfficeInvitation, parseOfficeInvitation } from "../src/office/invitation.js";

const invitation = { serverId: "hub", invitationSecret: Buffer.alloc(32, 1).toString("base64url"),
  hubFingerprint: "a".repeat(64), hostGeneration: "1", expiresAt: "2030-01-01T00:00:00.000Z", origin: "https://192.168.1.5:3010", linkAccount: false };
describe("one-line office invitation v1", () => {
  it("roundtrips compact codes and links and fixes a Rust-compatible golden vector", () => {
    const code = encodeOfficeInvitation(invitation);
    expect(code).toBe("IB1.AQADaHViAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQGqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgAAAAAAAAABAAAAAHDb2IAAGGh0dHBzOi8vMTkyLjE2OC4xLjU6MzAxMA.6e1ef665");
    expect(code).toMatch(/^IB1\.[A-Za-z0-9_-]+\.[a-f0-9]{8}$/);
    expect(code.length).toBeLessThan(180);
    expect(parseOfficeInvitation(code, 0)).toEqual(invitation);
    expect(parseOfficeInvitation(`  infinitebrain://office/join#${code}\n`, 0)).toEqual(invitation);
    expect(encodeOfficeInvitation(parseOfficeInvitation(code, 0))).toBe(code);
    expect(parseOfficeInvitation(encodeOfficeInvitation({ ...invitation, linkAccount: true }), 0).linkAccount).toBe(true);
  });
  it("rejects checksum errors, unsupported versions, expiration and malformed input without echoing it", () => {
    const code = encodeOfficeInvitation(invitation);
    for (const malformed of [code.slice(0, -1) + (code.endsWith("0") ? "1" : "0"), code.replace("IB1", "IB2"), `${code}?secret=private`, "https://bad.example/secret", code.replace("IB1.", "IB1.=")]) {
      expect(() => parseOfficeInvitation(malformed, 0)).toThrow();
      try { parseOfficeInvitation(malformed, 0); } catch (error) { expect(String(error)).not.toContain(malformed); }
    }
    expect(() => parseOfficeInvitation(code, Date.parse(invitation.expiresAt))).toThrow();
    expect(() => encodeOfficeInvitation({ ...invitation, origin: "http://192.168.1.5" })).toThrow();
    expect(() => encodeOfficeInvitation({ ...invitation, origin: "https://user:secret@hub.local" })).toThrow();
  });
});

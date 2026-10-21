// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { challengeDigest, deviceKey, normalizeAlias, personCode, text, verifyProof, type Challenge } from "./protocol.js";

describe("office pairing protocol", () => {
  it("uses canonical length-prefixed fields and binds every identity and generation", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const key = publicKey.export({ format: "der", type: "spki" });
    const value: Challenge = { serverId: "server", organizationId: "organization", sessionId: randomUUID(), deviceId: randomUUID(),
      keyFingerprint: "fingerprint", clientNonce: "client", serverNonce: "server", audience: "audience", hostGeneration: "1",
      protocolVersion: 1, expiresAt: new Date().toISOString(), requesterUserId: "user", personId: randomUUID(), displayAlias: "민수" };
    const signature = sign(null, challengeDigest(value), privateKey).toString("base64url");
    expect(verifyProof(key, challengeDigest(value), signature)).toBe(true);
    for (const field of Object.keys(value) as (keyof Challenge)[]) {
      const modified = { ...value, [field]: field === "protocolVersion" ? 2 : `${value[field]}x` };
      expect(verifyProof(key, challengeDigest(modified), signature), field).toBe(false);
    }
    expect(challengeDigest({ ...value, serverId: "ab", organizationId: "c" })).not.toEqual(challengeDigest({ ...value, serverId: "a", organizationId: "bc" }));
    expect(deviceKey(key.toString("base64url"))).toEqual(key);
    expect(() => deviceKey(generateKeyPairSync("x25519").publicKey.export({ format: "der", type: "spki" }).toString("base64url"))).toThrow("invalid_key");
  });
  it("normalizes display graphemes and gives stable injective Crockford codes", () => {
    expect(text("  민수\n\u0000  ", 40)).toBe("민수");
    expect(text("a\u0301", 1)).toBe("á");
    expect(() => text("가".repeat(41), 40)).toThrow();
    expect(() => text(" \u0000 ", 40)).toThrow();
    expect(normalizeAlias("Straße")).toBe(normalizeAlias("STRASSE"));
    expect(normalizeAlias("ﬃſẞς")).toBe("ffisssσ");
    expect(normalizeAlias("ı")).not.toBe(normalizeAlias("I"));
    expect(normalizeAlias("Ꭰꭰ")).toBe("ᎠᎠ");
    const id = randomUUID();
    expect(personCode(id)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(personCode(id)).toBe(personCode(id.toUpperCase()));
    expect(personCode(id)).not.toBe(personCode(randomUUID()));
  });
});

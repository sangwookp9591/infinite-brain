// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { deriveSas, encodeFields, sasCommit, sasFields, digest, type SasContext } from "../src/office/protocol.js";

const context: SasContext = {
  sessionId: "00000000-0000-4000-8000-000000000001", serverId: "hub", organizationId: "org", hostGeneration: "1",
  observedFingerprint: "a".repeat(64), hubFingerprint: "a".repeat(64), clientPublicKey: "client-key", hubPublicKey: "hub-key",
};
const client = Buffer.alloc(32, 1).toString("base64url"), server = Buffer.alloc(32, 2).toString("base64url");
describe("deterministic SAS transcript", () => {
  it("binds both hub views, session, keys, roles and nonces", () => {
    const sas = deriveSas(context, client, server);
    expect(sas).toBe("041415");
    expect(sasCommit(context, client).toString("hex")).toBe("7ef25d5b95cd49cabd948cf2a2dff0b3611628b002ddeb234d6e24f61efa27af");
    for (const modified of [
      { ...context, observedFingerprint: "b".repeat(64) }, { ...context, hubFingerprint: "b".repeat(64) },
      { ...context, sessionId: "00000000-0000-4000-8000-000000000002" },
      { ...context, clientPublicKey: "other-key" }, { ...context, hubPublicKey: "other-key" },
    ]) {
      expect(deriveSas(modified, client, server)).not.toBe(sas);
      expect(sasCommit(modified, client)).not.toEqual(sasCommit(context, client));
    }
    expect(deriveSas(context, server, client)).not.toBe(sas);
    expect(sasCommit(context, server)).not.toEqual(sasCommit(context, client));
  });
  it("rejects the biased u32 tail before taking a decimal remainder", () => {
    const bytes = Buffer.alloc(32); bytes.writeUInt32BE(1794);
    const nonce = bytes.toString("base64url");
    const first = digest(Buffer.concat([encodeFields(["infinite-brain/office-sas/transcript/v1", ...sasFields(context), nonce, server]), Buffer.alloc(4)])).readUInt32BE();
    expect(first).toBe(4_294_635_096);
    expect(deriveSas(context, nonce, server)).toBe("178258");
    expect(deriveSas(context, nonce, server)).not.toBe(String(first % 1_000_000));
  });
  it("encodes boundaries unambiguously and rejects noncanonical nonces", () => {
    expect(encodeFields(["ab", "c"])).not.toEqual(encodeFields(["a", "bc"]));
    expect(() => sasCommit(context, "invalid")).toThrow();
    expect(() => deriveSas(context, client + "=", server)).toThrow();
  });
});

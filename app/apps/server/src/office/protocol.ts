// SPDX-License-Identifier: Apache-2.0
import { createHash, createPublicKey, verify } from "node:crypto";

export class PairingError extends Error {
  audited = false;
  constructor(readonly code: string, readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 503 = 400) {
    super(code);
  }
}

export const digest = (value: string | Buffer): Buffer => createHash("sha256").update(value).digest();
export const uuid = (value: unknown): string => {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new PairingError("invalid_request");
  return value.toLowerCase();
};
export function text(value: unknown, max = 160): string {
  if (typeof value !== "string" || value.length > max * 8) throw new PairingError("invalid_request");
  const normalized = value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().normalize("NFC");
  const count = [...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(normalized)].length;
  if (!count || count > max || normalized.length > max * 8) throw new PairingError("invalid_request");
  return normalized;
}
/** Default Unicode case folding (no locale-specific Turkish substitution).
 * Upper/lower expands ligatures and folds sigma; dotless I, capital sharp S,
 * and Cherokee require the exceptions in Unicode's default fold mapping.
 * Reference: https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt
 */
export const normalizeAlias = (alias: string): string => [...alias.normalize("NFC")].map((character) => {
  const code = character.codePointAt(0)!;
  if (code === 0x131) return character;
  if (code === 0x1e9e) return "ss";
  if ((code >= 0x13a0 && code <= 0x13ff) || (code >= 0xab70 && code <= 0xabbf)) return character.toUpperCase();
  // Unicode 17 mappings newer than Node 22's bundled case data.
  if (code === 0xa7ce || code === 0xa7d2 || code === 0xa7d4) return String.fromCodePoint(code + 1);
  if (code >= 0x16ea0 && code <= 0x16eb8) return String.fromCodePoint(code + 0x1b);
  return character.toUpperCase().toLowerCase();
}).join("").normalize("NFC");
export function base64(value: unknown, bytes: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new PairingError("invalid_request");
  const result = Buffer.from(value, "base64url");
  if (result.length !== bytes || result.toString("base64url") !== value) throw new PairingError("invalid_request");
  return result;
}
export function deviceKey(value: unknown): Buffer {
  const bytes = base64(value, 44);
  try {
    const key = createPublicKey({ key: bytes, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519" || !key.export({ format: "der", type: "spki" }).equals(bytes)) throw new Error();
  } catch { throw new PairingError("invalid_key"); }
  return bytes;
}

export interface Challenge {
  serverId: string; organizationId: string; sessionId: string; deviceId: string;
  keyFingerprint: string; clientNonce: string; serverNonce: string; audience: string;
  hostGeneration: string; protocolVersion: number; expiresAt: string; requesterUserId: string | null;
  personId: string; displayAlias: string;
}
/** UTF-8 fields, in this fixed order, each prefixed with its unsigned 32-bit byte length.
 * Account/person/alias are also signed so a proof cannot link a different account or profile.
 */
export function challengeDigest(value: Challenge): Buffer {
  const fields = ["infinite-brain/office-pairing/v1", value.serverId, value.organizationId,
    value.sessionId, value.deviceId, value.keyFingerprint, value.clientNonce, value.serverNonce,
    value.audience, value.hostGeneration, String(value.protocolVersion), value.expiresAt,
    value.requesterUserId ?? "", value.personId, value.displayAlias];
  const encoded = fields.map((field) => {
    const data = Buffer.from(field, "utf8");
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    return Buffer.concat([length, data]);
  });
  return digest(Buffer.concat(encoded));
}
export function verifyProof(key: Buffer, challenge: Buffer, signature: unknown): boolean {
  try { return verify(null, challenge, createPublicKey({ key, format: "der", type: "spki" }), base64(signature, 64)); }
  catch { return false; }
}
export function personCode(id: string): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let value = BigInt(`0x${id.replaceAll("-", "")}`);
  let result = "";
  for (let i = 0; i < 26; i++) { result = alphabet[Number(value & 31n)] + result; value >>= 5n; }
  return result;
}

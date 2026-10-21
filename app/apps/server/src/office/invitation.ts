// SPDX-License-Identifier: Apache-2.0
import { createHash, timingSafeEqual } from "node:crypto";
import { PairingError, base64 } from "./protocol.js";

export interface OfficeInvitation {
  serverId: string;
  invitationSecret: string;
  hubFingerprint: string;
  hostGeneration: string;
  expiresAt: string;
  /** An address hint only. TLS uses the independently delivered fingerprint. */
  origin: string;
  linkAccount: boolean;
}
const domain = "infinite-brain/office-invitation/v1\0";
const checksum = (payload: Buffer) => createHash("sha256").update(domain).update(payload).digest().subarray(0, 4);
function invalid(): never { throw new PairingError("invitation_unavailable", 410); }
function validate(value: OfficeInvitation): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value.serverId) || !/^[a-f0-9]{64}$/.test(value.hubFingerprint)
    || !/^[1-9]\d{0,14}$/.test(value.hostGeneration) || !Number.isFinite(Date.parse(value.expiresAt)) || Buffer.byteLength(value.origin) > 256) invalid();
  base64(value.invitationSecret, 32);
  if (value.origin) {
    let url: URL; try { url = new URL(value.origin); } catch { return invalid(); }
    if (url.protocol !== "https:" || url.origin !== value.origin || url.username || url.password) invalid();
  }
}

/** Compact single-line messenger code. The checksum detects typos, not forgery.
 * Never log the code or decoded object; it carries a one-use invitation secret. */
export function encodeOfficeInvitation(value: OfficeInvitation): string {
  validate(value);
  const server = Buffer.from(value.serverId), origin = Buffer.from(value.origin);
  const fixed = Buffer.alloc(18);
  fixed.writeBigUInt64BE(BigInt(value.hostGeneration), 0);
  fixed.writeBigUInt64BE(BigInt(Math.floor(Date.parse(value.expiresAt) / 1000)), 8);
  fixed.writeUInt16BE(origin.length, 16);
  const payload = Buffer.concat([Buffer.from([1, value.linkAccount ? 1 : 0, server.length]), server, base64(value.invitationSecret, 32), Buffer.from(value.hubFingerprint, "hex"), fixed, origin]);
  return `IB1.${payload.toString("base64url")}.${checksum(payload).toString("hex")}`;
}

/** Reference parser for server tests/tools; employee parsing happens in Rust. */
export function parseOfficeInvitation(input: string, now = Date.now()): OfficeInvitation {
  const code = input.trim().replace(/^infinitebrain:\/\/office\/join#/, "");
  if (code.length > 720) invalid();
  const match = /^IB1\.([A-Za-z0-9_-]+)\.([a-f0-9]{8})$/.exec(code);
  if (!match) invalid();
  const payload = Buffer.from(match[1], "base64url");
  if (payload.toString("base64url") !== match[1] || payload.length < 86 || payload[0] !== 1 || payload[1] > 1
    || !timingSafeEqual(checksum(payload), Buffer.from(match[2], "hex"))) invalid();
  const size = payload[2], offset = 3 + size;
  if (size < 1 || size > 128 || payload.length < offset + 82) invalid();
  const originSize = payload.readUInt16BE(offset + 80);
  if (payload.length !== offset + 82 + originSize) invalid();
  const expiry = Number(payload.readBigUInt64BE(offset + 72));
  if (expiry > 8_640_000_000_000) invalid();
  const value = {
    serverId: payload.subarray(3, offset).toString("utf8"),
    linkAccount: payload[1] === 1,
    invitationSecret: payload.subarray(offset, offset + 32).toString("base64url"),
    hubFingerprint: payload.subarray(offset + 32, offset + 64).toString("hex"),
    hostGeneration: String(payload.readBigUInt64BE(offset + 64)),
    expiresAt: new Date(expiry * 1000).toISOString(),
    origin: payload.subarray(offset + 82).toString("utf8"),
  };
  validate(value);
  if (expiry * 1000 <= now) throw new PairingError("expired", 410);
  return value;
}

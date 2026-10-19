// SPDX-License-Identifier: Apache-2.0
import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 5000;
const cache = new Map<string, { document: CimdDocument; expires: number }>();
export interface CimdDocument { client_id: string; client_name: string; redirect_uris: string[]; token_endpoint_auth_method?: "none" }

/** Conservative global-unicast allowlist, including IPv4-mapped IPv6 denial. */
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 88, 168].includes(b))
      || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
  }
  // Exclude mapped, transition, special-use and documentation ranges conservatively.
  return isIP(address) === 6 && /^[23]/i.test(address) && !/^200[12]:/i.test(address) && !/^3fff:/i.test(address);
}

export function validateCimd(value: unknown, clientId: string): CimdDocument {
  const doc = value as CimdDocument;
  if (!doc || doc.client_id !== clientId || typeof doc.client_name !== "string" || !doc.client_name.trim()
    || doc.client_name.length > 200 || !Array.isArray(doc.redirect_uris) || !doc.redirect_uris.length || doc.redirect_uris.length > 20
    || (doc.token_endpoint_auth_method !== undefined && doc.token_endpoint_auth_method !== "none")) throw new Error("Invalid client metadata");
  for (const uri of doc.redirect_uris) {
    if (typeof uri !== "string" || uri.includes(",")) throw new Error("Invalid redirect URI");
    const url = new URL(uri);
    if (url.username || url.password || uri.includes("#") || !(url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Unsafe redirect URI");
  }
  const metadata = value as Record<string, unknown>;
  if (metadata.grant_types !== undefined && (!Array.isArray(metadata.grant_types) || !metadata.grant_types.includes("authorization_code") || metadata.grant_types.some((g) => !["authorization_code", "refresh_token"].includes(g)))) throw new Error("Unsupported grant type");
  if (metadata.response_types !== undefined && (!Array.isArray(metadata.response_types) || !metadata.response_types.length || metadata.response_types.some((r) => r !== "code"))) throw new Error("Unsupported response type");
  return doc;
}

/** DNS is checked once and pinned into the TLS request; redirects are never followed. */
export async function fetchCimdDocument(clientId: string): Promise<CimdDocument> {
  const url = new URL(clientId);
  if (url.protocol !== "https:" || url.username || url.password || clientId.includes("#") || url.pathname === "/" || clientId.length > 2048) throw new Error("Invalid client URL");
  const cached = cache.get(clientId);
  if (cached && cached.expires > Date.now()) return cached.document;
  const allowPrivate = process.env.MCP_CIMD_ALLOW_PRIVATE_IPS === "true" && process.env.NODE_ENV !== "production";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  let activeRequest: ReturnType<typeof https.get> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const hostname = url.hostname.replace(/^\[|\]$/g, "");
        const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
        if (expired) throw new Error("Metadata timeout");
        if (!addresses.length || (!allowPrivate && addresses.some((a) => !publicAddress(a.address)))) throw new Error("Private client URL");
        const address = addresses[0];
        const result = await new Promise<{ value: unknown; cacheControl: string }>((resolve, reject) => {
          const req = https.get(url, {
            headers: { accept: "application/json" },
            agent: false,
            // Preserve URL hostname for TLS/SNI and pin the validated address for the socket.
            lookup: (_host, options, callback) => {
              if (options.all) callback(null, [{ address: address.address, family: address.family }]);
              else callback(null, address.address, address.family);
            },
          }, (res) => {
            if (res.statusCode !== 200 || !res.headers["content-type"]?.split(";")[0].trim().match(/^application\/(json|[\w.-]+\+json)$/i)) {
              res.destroy(); reject(new Error("Invalid metadata response")); return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            res.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > MAX_BYTES) { req.destroy(new Error("Metadata too large")); return; }
              chunks.push(chunk);
            });
            res.on("error", reject);
            res.on("end", () => {
              try { resolve({ value: JSON.parse(Buffer.concat(chunks).toString("utf8")), cacheControl: res.headers["cache-control"] ?? "" }); }
              catch (error) { reject(error); }
            });
          });
          activeRequest = req;
          req.on("error", reject);
        });
        const document = validateCimd(result.value, clientId);
        const age = /max-age=(\d+)/i.exec(result.cacheControl);
        const ttl = /no-store|no-cache/i.test(result.cacheControl) ? 0 : Math.min(300, age ? Number(age[1]) : 60);
        if (cache.size >= 128) cache.delete(cache.keys().next().value!);
        if (ttl > 0) cache.set(clientId, { document, expires: Date.now() + ttl * 1000 });
        return document;
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; activeRequest?.destroy(new Error("Metadata timeout")); reject(new Error("Metadata timeout")); }, TIMEOUT_MS); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** URL client IDs are materialized only after metadata and exact redirect validation. */
export async function ensureCimdClient(clientId: string, redirectUri: string): Promise<void> {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(clientId)) return; // DCR / pre-registered opaque IDs.
  const doc = await fetchCimdDocument(clientId);
  if (!doc.redirect_uris.includes(redirectUri)) throw new Error("Unregistered redirect URI");
  await pool.query(
    `INSERT INTO "oauthApplication" (id, name, "clientId", "redirectUrls", type, metadata)
     VALUES ($1, $2, $3, $4, 'public', '{"cimd":true}')
     ON CONFLICT ("clientId") DO UPDATE SET name = EXCLUDED.name, "redirectUrls" = EXCLUDED."redirectUrls", "updatedAt" = now()
     WHERE "oauthApplication".metadata::jsonb ->> 'cimd' = 'true'`,
    [randomUUID(), doc.client_name, clientId, doc.redirect_uris.join(",")],
  );
}

// SPDX-License-Identifier: Apache-2.0
import { auth } from "../auth/auth.js";
import { pool } from "../db/pool.js";
import { MCP_RESOURCE } from "./resource.js";
import { lockOAuthConnection, unlockOAuthConnection } from "./oauth.js";

const invalid = () => Response.json({ error: "invalid_grant" }, { status: 401 });

/** Provider rows default to unbound; no token is usable until this gate commits. */
export async function exchangeOAuthToken(request: Request, body: Record<string, unknown>): Promise<Response> {
  const ctx = await auth.$context;
  let source: { clientId?: string; userId?: string; resource?: string; generation?: string; requireConsent?: boolean } | undefined;
  if (body.grant_type === "refresh_token" && typeof body.refresh_token === "string") {
    source = (await pool.query('SELECT "clientId", "userId", resource, generation FROM "oauthAccessToken" WHERE "refreshToken" = $1', [body.refresh_token])).rows[0];
  } else if (body.grant_type === "authorization_code" && typeof body.code === "string") {
    const grant = await ctx.internalAdapter.findVerificationValue(body.code);
    try { source = grant ? JSON.parse(grant.value) : undefined; } catch { return invalid(); }
  }
  if (!source?.clientId || !source.userId || source.resource !== MCP_RESOURCE || !source.generation || source.requireConsent) return invalid();
  const { clientId, userId, generation } = source;
  const db = await pool.connect();
  try {
    await lockOAuthConnection(db, clientId, userId);
    const live = await db.query("SELECT 1 FROM mcp_oauth_vault WHERE client_id = $1 AND user_id = $2 AND generation = $3", [clientId, userId, generation]);
    if (!live.rowCount) return invalid();
    // Better Auth still owns PKCE, expiry, redirect and client authentication.
    const response = await auth.handler(request);
    if (!response.ok) return response;
    const token = await response.clone().json() as { access_token?: string };
    if (typeof token.access_token !== "string") return invalid();
    const bound = await db.query(
      `UPDATE "oauthAccessToken" t SET resource = $2, generation = $3
        WHERE t."accessToken" = $1 AND t."clientId" = $4 AND t."userId" = $5
          AND EXISTS (SELECT 1 FROM mcp_oauth_vault b WHERE b.client_id = $4 AND b.user_id = $5 AND b.generation = $3)`,
      [token.access_token, MCP_RESOURCE, generation, clientId, userId],
    );
    if (!bound.rowCount) {
      await db.query('DELETE FROM "oauthAccessToken" WHERE "accessToken" = $1', [token.access_token]);
      return invalid();
    }
    return response;
  } finally {
    await unlockOAuthConnection(db, clientId, userId);
    db.release();
  }
}

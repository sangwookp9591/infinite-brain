import { isTeamRole } from "../permissions/roles.js";
// SPDX-License-Identifier: Apache-2.0
import { MCP_RESOURCE } from "./resource.js";
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import { orgRole } from "../permissions/lookup.js";
import { auth } from "../auth/auth.js";
import { effectiveOAuthScopes, type McpScope } from "./scopes.js";
import type { McpAuth } from "./tokens.js";

/**
 * The OAuth half of MCP auth (migration 007 + the Better Auth `mcp` plugin).
 *
 * A minted `mcp_` token already encodes its (user, vault) scope in its DB
 * row. An OAuth access token, by contrast, only tells us WHO the caller is —
 * the vault is chosen by the user on the consent screen and recorded in
 * `mcp_oauth_vault`, keyed per
 * (client, user). This module bridges an incoming OAuth bearer to the same
 * `McpAuth` context an mcp_ token produces, so everything downstream
 * (service.ts ACL checks) is identical either way.
 */

type Queryable = Pick<pg.Pool, "query">;

/**
 * Record the vault the user granted a connector access to (upsert: a user
 * re-consenting the same client can retarget it to another vault).
 */
export async function setVaultBinding(
  clientId: string,
  userId: string,
  organizationId: string,
  db: Queryable = defaultPool,
  scopes?: McpScope[],
): Promise<string> {
  const { rows } = await db.query<{ updated_at: string }>(
    `INSERT INTO mcp_oauth_vault (client_id, user_id, organization_id, scopes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id, user_id)
       DO UPDATE SET organization_id = EXCLUDED.organization_id, scopes = EXCLUDED.scopes, generation = gen_random_uuid()::text, updated_at = clock_timestamp()
     RETURNING updated_at::text`,
    [clientId, userId, organizationId, scopes?.join(" ") ?? null],
  );
  return rows[0].updated_at;
}

/** Why an OAuth bearer did not resolve: signed in, but no vault chosen. */
export type OAuthMcpFailure = "no_vault_selected" | null;

/**
 * Resolve an incoming request carrying an OAuth `Authorization: Bearer` access
 * token to an `McpAuth`, or null if the token is missing/invalid/expired, no
 * vault can be determined, or the user is no longer a member of it
 * (membership can be revoked out from under a live token — re-checked here,
 * exactly like verifyMcpToken does for mcp_ tokens). `onFailure` learns when
 * the token itself was valid but no vault was bound, so the 401 can say so.
 */
export async function resolveOAuthMcpAuth(
  headers: Headers,
  db: Queryable = defaultPool,
  onFailure?: (reason: OAuthMcpFailure) => void,
): Promise<McpAuth | null> {
  const session = await auth.api.getMcpSession({ headers });
  if (!session?.userId || !session.clientId) return null;

  const bearer = headers.get("authorization")?.replace(/^Bearer /i, "");
  const { rows: bound } = await db.query(
    `SELECT b.organization_id, b.scopes FROM "oauthAccessToken" t JOIN mcp_oauth_vault b
       ON b.client_id = t."clientId" AND b.user_id = t."userId" AND b.generation = t.generation
      WHERE t."accessToken" = $1 AND t.resource = $2`, [bearer, MCP_RESOURCE],
  );
  const binding = bound[0] as { organization_id: string; scopes: string | null } | undefined;
  if (!binding) { onFailure?.("no_vault_selected"); return null; }
  const organizationId = binding.organization_id;

  const role = await orgRole(organizationId, session.userId, db);
  if (!isTeamRole(role)) return null;

  const scopes = effectiveOAuthScopes(session.scopes).filter((scope) =>
    effectiveOAuthScopes(binding?.scopes).includes(scope) && (scope !== "access:manage" || role === "owner" || role === "admin"));
  await db.query(
    `UPDATE mcp_oauth_vault SET last_used_at = now(), last_client = COALESCE($3, last_client)
      WHERE client_id = $1 AND user_id = $2`,
    [session.clientId, session.userId, headers.get("user-agent")?.slice(0, 200) ?? null],
  );
  const { rows: app } = await db.query<{ name: string | null }>(
    'SELECT name FROM "oauthApplication" WHERE "clientId" = $1', [session.clientId],
  );
  return { userId: session.userId, organizationId, scopes, oauthClientId: session.clientId,
    connection: { kind: "oauth", id: session.clientId, label: app[0]?.name ?? session.clientId } };
}

/** Read the pending grant from Better Auth rather than trusting query/form scopes. */
export async function getOAuthConsentGrant(code: string, clientId: string, userId: string): Promise<{
  clientId: string; userId: string; requireConsent: boolean; scope: string[];
} | null> {
  const ctx = await auth.$context;
  const grant = await ctx.internalAdapter.findVerificationValue(code);
  if (!grant || grant.expiresAt <= new Date()) return null;
  let value;
  try { value = JSON.parse(grant.value); } catch { return null; }
  if (!value || typeof value !== "object" || value.clientId !== clientId || value.userId !== userId || value.requireConsent !== true
      || !Array.isArray(value.scope) || !value.scope.every((s: unknown) => typeof s === "string")) return null;
  return value;
}

/** Better Auth 1.6 copies verification scopes into both consent and token rows. */
export async function prepareOAuthConsent(
  code: string, clientId: string, userId: string, scopes?: McpScope[],
): Promise<boolean> {
  const value = await getOAuthConsentGrant(code, clientId, userId);
  if (!value) return false;
  if (scopes) {
    const requested = value.scope.filter((s) => s.startsWith("notes:") || s.startsWith("access:"));
    if (requested.length && scopes.some((scope) => !requested.includes(scope))) return false;
    const oidc = value.scope.filter((s) => !s.startsWith("notes:") && !s.startsWith("access:"));
    const ctx = await auth.$context;
    await ctx.internalAdapter.updateVerificationByIdentifier(code, {
      value: JSON.stringify({ ...value, scope: [...oidc, ...scopes] }),
    });
  }
  return true;
}

/** Serialize the full provider issuance with consent/revoke across server processes. */
export async function lockOAuthConnection(db: Queryable, clientId: string, userId: string): Promise<void> {
  await db.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [JSON.stringify([clientId, userId])]);
}
export async function unlockOAuthConnection(db: Queryable, clientId: string, userId: string): Promise<void> {
  await db.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [JSON.stringify([clientId, userId])]);
}

export async function stampOAuthGrant(code: string, clientId: string, userId: string, db: Queryable = defaultPool): Promise<void> {
  const ctx = await auth.$context;
  const grant = await ctx.internalAdapter.findVerificationValue(code);
  const { rows } = await db.query("SELECT generation FROM mcp_oauth_vault WHERE client_id = $1 AND user_id = $2", [clientId, userId]);
  if (!grant || !rows[0]) throw new Error("Missing connection");
  const value = JSON.parse(grant.value);
  if (value.clientId !== clientId || value.userId !== userId) throw new Error("Invalid grant");
  await ctx.internalAdapter.updateVerificationByIdentifier(code, {
    value: JSON.stringify({ ...value, resource: value.resource ?? MCP_RESOURCE, generation: rows[0].generation }),
  });
}

export async function listOAuthConnections(auth: McpAuth, db: Queryable = defaultPool) {
  const { rows } = await db.query<{
    id: string; name: string; scopes: string | null; createdAt: string;
    lastUsedAt: string | null; lastClient: string | null; useCount: number;
  }>(
    `SELECT a."clientId" AS id, a.name, COALESCE(b.scopes, g.scopes) AS scopes,
            COALESCE(b.created_at, g."createdAt") AS "createdAt", b.last_used_at AS "lastUsedAt",
            b.last_client AS "lastClient", COALESCE(b.use_count, 0) AS "useCount"
       FROM "oauthApplication" a
       JOIN LATERAL (
         SELECT "scopes", "createdAt" FROM "oauthAccessToken" WHERE "clientId" = a."clientId" AND "userId" = $1
         UNION ALL
         SELECT "scopes", "createdAt" FROM "oauthConsent" WHERE "clientId" = a."clientId" AND "userId" = $1 AND "consentGiven" = true
         ORDER BY "createdAt" DESC LIMIT 1
       ) g ON true
       LEFT JOIN mcp_oauth_vault b ON b.client_id = a."clientId" AND b.user_id = $1
      WHERE b.organization_id = $2 OR (b.client_id IS NULL
        AND (SELECT count(*) FROM member WHERE "userId" = $1) = 1
        AND EXISTS (SELECT 1 FROM member WHERE "userId" = $1 AND "organizationId" = $2))
      ORDER BY "createdAt" DESC`,
    [auth.userId, auth.organizationId],
  );
  return rows.map((r) => ({ ...r, kind: "oauth" as const, scopes: effectiveOAuthScopes(r.scopes) }));
}

/** Remove access and refresh tokens, consent, and the vault binding together. */
export async function revokeOAuthConnection(userId: string, organizationId: string, clientId: string): Promise<boolean> {
  const db = await defaultPool.connect();
  try {
    await lockOAuthConnection(db, clientId, userId);
    await db.query("BEGIN");
    const connections = await listOAuthConnections({ userId, organizationId }, db);
    const found = connections.some((c) => c.id === clientId);
    if (found) {
      const { rows: grants } = await db.query<{ id: string; value: string }>(
        "SELECT id, value FROM verification WHERE position($1 in value) > 0 AND position($2 in value) > 0",
        [JSON.stringify(clientId), JSON.stringify(userId)],
      );
      const ids = grants.filter((grant) => {
        try {
          const value = JSON.parse(grant.value);
          return value?.clientId === clientId && value?.userId === userId;
        } catch { return false; }
      }).map((grant) => grant.id);
      if (ids.length) await db.query("DELETE FROM verification WHERE id = ANY($1::text[])", [ids]);
      await db.query("DELETE FROM mcp_oauth_vault WHERE client_id = $1 AND user_id = $2 AND organization_id = $3", [clientId, userId, organizationId]);
      await db.query('DELETE FROM "oauthAccessToken" WHERE "clientId" = $1 AND "userId" = $2', [clientId, userId]);
      await db.query('DELETE FROM "oauthConsent" WHERE "clientId" = $1 AND "userId" = $2', [clientId, userId]);
    }
    await db.query("COMMIT");
    return found;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { await unlockOAuthConnection(db, clientId, userId); db.release(); }
}

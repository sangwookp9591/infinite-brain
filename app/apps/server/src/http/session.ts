import { auditContext } from "../audit/log.js";
import type { Context } from "hono";
import { auth } from "../auth/auth.js";

export interface SessionInfo {
  userId: string;
  email: string;
  activeOrganizationId: string | null;
}

/**
 * Validate a Better Auth session from the request (cookie OR bearer token —
 * the bearer plugin rewrites `Authorization: Bearer <token>` into the session
 * cookie before this runs). Returns null when there is no valid session.
 */
export async function getSession(c: Context): Promise<SessionInfo | null> {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result?.user) return null;
  const context = auditContext.getStore();
  if (context) {
    context.actorUserId = result.user.id;
    context.actorKind = "user";
    context.organizationId = (result.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? undefined;
  }
  return {
    userId: result.user.id,
    email: result.user.email,
    activeOrganizationId:
      (result.session as { activeOrganizationId?: string | null } | undefined)
        ?.activeOrganizationId ?? null,
  };
}

/** Throwing guard for routes that require auth. */
export async function requireSession(c: Context): Promise<SessionInfo> {
  const session = await getSession(c);
  if (!session) {
    throw new HttpError(401, "Authentication required");
  }
  return session;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

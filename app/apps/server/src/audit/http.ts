// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { pool } from "../db/pool.js";
import { resolveResource } from "../permissions/lookup.js";
import { getSession } from "../http/session.js";
import { auditContext, recordAudit, type AuditContext } from "./log.js";

/** Server-generated request IDs; client input never selects the audit actor. */
export const auditRequests: MiddlewareHandler = async (c, next) => {
  const context: AuditContext = { requestId: randomUUID(), actorKind: "system" };
  const securityWrite = !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
    /shares|access|members|invitations|organization\/|orgs\/join|public-link|mcp/.test(c.req.path);
  const body = securityWrite ? c.req.raw.clone().json().catch(() => ({})) : Promise.resolve({});
  return auditContext.run(context, async () => {
    c.header("X-Request-Id", context.requestId);
    if (securityWrite && !c.req.path.startsWith("/api/mcp")) await getSession(c);
    await next();
    if (!securityWrite || c.res.status < 400) return;
    const input = await body as Record<string, unknown>;
    let organizationId = c.req.path.match(/\/orgs\/([^/]+)/)?.[1];
    if (organizationId === "join" || organizationId === "join-code") organizationId = undefined;
    if (!organizationId && typeof input.organizationId === "string") organizationId = input.organizationId;
    if (typeof input.resourceType === "string" && typeof input.resourceId === "string" &&
        ["vault", "folder", "file"].includes(input.resourceType)) {
      organizationId = (await resolveResource(input.resourceType as "vault" | "folder" | "file", input.resourceId))?.organizationId;
    }
    await recordAudit(pool, { organizationId, action: `${c.req.method} ${c.req.path.replace(/\/p\/[^/]+/, "/p/[link]")}`,
      targetType: "request", result: c.res.status < 500 ? "refused" : "failed",
      refs: { status: c.res.status } });
  });
};

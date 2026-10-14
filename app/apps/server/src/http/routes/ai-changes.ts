// SPDX-License-Identifier: Apache-2.0
import { Hono } from "hono";
import { AiChangeError, getAiChange, listAiChanges, revertAiChange, type AiChangeDeps } from "../../ai-changes/service.js";
import { TrashError } from "../../trash/service.js";
import { TreeOpError } from "../../registry/tree-ops.js";
import { getSession } from "../session.js";

export function createAiChangeRoutes(deps: AiChangeDeps): Hono {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof AiChangeError) return c.json({ error: error.message, code: error.code, diff: error.diff }, error.status);
    if (error instanceof TrashError) return c.json({ error: error.message, code: error.code }, error.status);
    if (error instanceof TreeOpError) return c.json({ error: error.message, code: "structure_conflict" }, 409);
    console.error("[ai-changes] request failed", error instanceof Error ? error.name : "unknown");
    return c.json({ error: "AI change request failed" }, 500);
  });
  app.get("/vaults/:vaultId/ai-changes", async (c) => {
    const session = await getSession(c);
    if (!session) return c.json({ error: "Authentication required" }, 401);
    return c.json(await listAiChanges(session.userId, c.req.param("vaultId"), {
      connection: c.req.query("connection"), doc: c.req.query("doc"),
      limit: c.req.query("limit") === undefined ? undefined : Number(c.req.query("limit")),
    }));
  });
  app.get("/ai-changes/:id", async (c) => {
    const session = await getSession(c);
    if (!session) return c.json({ error: "Authentication required" }, 401);
    return c.json(await getAiChange(session.userId, c.req.param("id")));
  });
  app.post("/ai-changes/:id/revert", async (c) => {
    const session = await getSession(c);
    if (!session) return c.json({ error: "Authentication required" }, 401);
    return c.json(await revertAiChange(session.userId, c.req.param("id"), deps));
  });
  app.post("/vaults/:vaultId/ai-changes/revert-batch", async (c) => {
    const session = await getSession(c);
    if (!session) return c.json({ error: "Authentication required" }, 401);
    const body = await c.req.json().catch(() => null) as { connectionId?: unknown; since?: unknown } | null;
    if (!body || typeof body.connectionId !== "string" || !body.connectionId ||
        typeof body.since !== "string" || !Number.isFinite(Date.parse(body.since))) {
      return c.json({ error: "connectionId and an ISO since timestamp are required" }, 400);
    }
    const listing = await listAiChanges(session.userId, c.req.param("vaultId"), {
      connection: body.connectionId, since: new Date(body.since).toISOString(), limit: 200, unreverted: true,
    });
    const results = [];
    for (const item of listing.items) {
      try { results.push(await revertAiChange(session.userId, item.id, deps)); }
      catch (error) {
        if (error instanceof AiChangeError || error instanceof TrashError || error instanceof TreeOpError) {
          results.push({ id: item.id, status: "failed", httpStatus: error instanceof TreeOpError ? 409 : error.status, code: error instanceof TreeOpError ? "structure_conflict" : error.code,
            error: error.message, diff: error instanceof AiChangeError ? error.diff : undefined });
        } else { results.push({ id: item.id, status: "failed", httpStatus: 500, code: "internal_error" }); }
      }
    }
    return c.json({ results, truncated: listing.truncated });
  });
  return app;
}

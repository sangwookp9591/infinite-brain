// SPDX-License-Identifier: Apache-2.0
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getSession } from "../session.js";
import { OfficePairing, officeHost } from "../../office/pairing.js";
import { PairingError, text } from "../../office/protocol.js";
import { recordAudit } from "../../audit/log.js";
import { pool } from "../../db/pool.js";

const messages: Record<string, string> = {
  expired: "초대가 만료됐어요. 관리자에게 새 초대를 요청해 주세요.",
  invitation_unavailable: "초대를 사용할 수 없어요. 관리자에게 새 초대를 요청해 주세요.",
  wrong_workspace: "확인한 회사 작업 공간과 연결 대상이 달라요. 관리자에게 초대가 최신인지 확인해 주세요.",
  account_required: "공유 자료를 열려면 회사에서 승인한 계정으로 연결해야 해요.",
  approval_required: "이 기기의 참여 승인을 기다리고 있어요. 관리자에게 확인해 주세요.",
  unavailable: "회사 작업 공간에 연결하지 못했어요. 관리자에게 초대 유효 여부를 확인해 달라고 해 주세요.",
  try_later: "잠시 뒤 다시 시도해 주세요. 계속되면 관리자에게 확인해 주세요.",
};

export const officePairingRoutes = new Hono();
// A process-wide ceiling complements persisted per-challenge attempts, single-use
// invitations, and per-organization queue caps. Forwarded addresses are not trusted.
let windowStart = 0, attempts = 0;
officePairingRoutes.use("/office/*", bodyLimit({ maxSize: 8192, onError: (c) => c.json({ code: "invalid_request", error: "요청이 너무 길어요. 초대 화면을 다시 열어 주세요." }, 413) }));
officePairingRoutes.use("/office/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); attempts = 0; }
  if (++attempts > 240) return c.json({ code: "try_later", error: messages.try_later }, 429);
  await next();
});
officePairingRoutes.onError(async (error, c) => {
  if (!(error instanceof PairingError)) {
    console.error("[office-pairing] request failed");
    return c.json({ code: "unavailable", error: messages.unavailable }, 503);
  }
  if (!error.audited) await recordAudit(pool, { action: "office.request", targetType: "request", result: "refused", refs: { code: error.code } });
  return c.json({ code: error.code, error: messages[error.code] ?? "요청을 확인할 수 없어요. 초대 화면을 다시 열거나 관리자에게 확인해 주세요." }, error.status);
});
async function input(c: Parameters<typeof getSession>[0]): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error();
    return body;
  } catch { throw new PairingError("invalid_request"); }
}
async function signedIn(c: Parameters<typeof getSession>[0]): Promise<string> {
  const session = await getSession(c);
  if (!session) throw new PairingError("account_required", 401);
  return session.userId;
}
const service = () => new OfficePairing(officeHost());

// Minimal pre-approval identity; no directory, account or content metadata.
officePairingRoutes.get("/office", (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  return c.json({ protocolVersion: 1, ...officeHost() });
});

officePairingRoutes.post("/office/invitations", async (c) => {
  const userId = await signedIn(c), body = await input(c);
  return c.json(await service().invite(text(body.organizationId, 128), userId), 201);
});
officePairingRoutes.post("/office/invitations/:id/cancel", async (c) => {
  return c.json(await service().cancelInvitation(c.req.param("id"), await signedIn(c)));
});
officePairingRoutes.post("/office/pairing/challenge", async (c) => {
  const session = await getSession(c);
  return c.json(await service().challenge(await input(c), session?.userId ?? null), 201);
});
officePairingRoutes.post("/office/pairing/:id/proof", async (c) => c.json(await service().proof(c.req.param("id"), await input(c))));
officePairingRoutes.post("/office/pairing/:id/request", async (c) => {
  const session = await getSession(c), body = await input(c);
  return c.json(await service().request(c.req.param("id"), body.pairingToken, session?.userId ?? null));
});
officePairingRoutes.post("/office/pairing/:id/status", async (c) => {
  return c.json(await service().status(c.req.param("id"), (await input(c)).pairingToken));
});
officePairingRoutes.post("/office/pairing/:id/cancel", async (c) => {
  return c.json(await service().cancel(c.req.param("id"), (await input(c)).pairingToken));
});
officePairingRoutes.post("/office/pairing/:id/decision", async (c) => {
  const userId = await signedIn(c), body = await input(c);
  if (!["approved", "rejected", "cancelled"].includes(String(body.decision))) throw new PairingError("invalid_request");
  const reason = body.reasonCode === undefined || body.reasonCode === null ? null : String(body.reasonCode);
  return c.json(await service().decide(c.req.param("id"), userId, body.decision as "approved" | "rejected" | "cancelled", reason));
});
officePairingRoutes.get("/office/organizations/:id/requests", async (c) => c.json({ requests: await service().queue(c.req.param("id"), await signedIn(c)) }));
officePairingRoutes.get("/office/organizations/:id/directory", async (c) => c.json({ people: await service().directory(c.req.param("id"), await signedIn(c)) }));

// SPDX-License-Identifier: Apache-2.0
import type { ApiClient } from "./api";
import type { OfficeErrorCode } from "./officeFlow";

export interface OfficeRequest {
  id: string;
  nickname: string;
  device: string;
  platform: "Windows" | "macOS";
  status: "pending" | "approved" | "rejected";
  confirmationNumber: string;
  sasMatches?: boolean;
}

export interface OfficeInvitation { invitationCode: string; expiresAt: string }

type WireRequest = { sessionId: string; displayAlias: string; deviceLabel: string; platform: string; sas: string; sasConfirmed: boolean };
const codeToFlow: Record<string, OfficeErrorCode> = {
  too_many_attempts: "too_many_attempts", expired: "approval_expired", sas_required: "sas_required",
  sas_mismatch: "sas_mismatch", invitation_unavailable: "invite_invalid", wrong_workspace: "hub_pin_mismatch",
  account_required: "identity_link_required", approval_required: "approval_rejected", conflict: "unknown",
  invalid_request: "invite_invalid", try_later: "network_blocked", unavailable: "network_blocked",
};

/** Calls the exact management routes; request bodies contain only the decision
 * confirmed by the person currently looking at the two SAS values. */
export class OfficeClient {
  constructor(private readonly api: ApiClient, private readonly organizationId: string) {}

  async createInvitation(): Promise<OfficeInvitation> {
    try {
      const result = await this.api.officeRequest<OfficeInvitation>("POST", "/api/office/invitations", { organizationId: this.organizationId, linkAccount: true });
      if (typeof result.invitationCode !== "string" || !result.invitationCode.startsWith("IB1.") || !Number.isFinite(Date.parse(result.expiresAt))) {
        throw new Error("invalid_response");
      }
      return { invitationCode: result.invitationCode, expiresAt: result.expiresAt };
    } catch (error) { throw officeError(error); }
  }

  async requests(): Promise<OfficeRequest[]> {
    try {
      const result = await this.api.officeRequest<{ requests: WireRequest[] }>("GET", `/api/office/organizations/${encodeURIComponent(this.organizationId)}/requests`);
      if (!Array.isArray(result.requests)) return [];
      return result.requests.map((r) => ({
        id: r.sessionId, nickname: r.displayAlias, device: r.deviceLabel,
        platform: r.platform.toLowerCase() === "windows" ? "Windows" : "macOS",
        status: "pending", confirmationNumber: /^\d{6}$/.test(r.sas) ? r.sas : "", sasMatches: r.sasConfirmed ? true : undefined,
      }));
    } catch (error) { throw officeError(error); }
  }

  async confirmSas(sessionId: string, matches: boolean): Promise<void> {
    try { await this.api.officeRequest("POST", `/api/office/pairing/${encodeURIComponent(sessionId)}/sas-confirm`, { matches }); }
    catch (error) { throw officeError(error); }
  }

  async decide(sessionId: string, decision: "approved" | "rejected" | "cancelled"): Promise<void> {
    try { await this.api.officeRequest("POST", `/api/office/pairing/${encodeURIComponent(sessionId)}/decision`, { decision }); }
    catch (error) { throw officeError(error); }
  }
}

/** Never expose the ApiError message/body: responses may contain server URLs or
 * request metadata. Only the bounded server error code crosses to UI state. */
function officeError(error: unknown): Error {
  const parsed = error && typeof error === "object" && "parsed" in error ? (error as { parsed?: unknown }).parsed : undefined;
  const rawCode = parsed && typeof parsed === "object" && "code" in parsed ? String((parsed as { code: unknown }).code) : "";
  const code = codeToFlow[rawCode] ?? "unknown";
  return new Error(`office:${code}`);
}


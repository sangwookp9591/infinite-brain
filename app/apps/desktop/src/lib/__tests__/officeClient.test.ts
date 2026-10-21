// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { OfficeClient } from "../officeClient";

function mockApi(result: unknown = { requests: [] }) {
  return { officeRequest: vi.fn().mockResolvedValue(result) };
}

describe("OfficeClient", () => {
  it("reports both SAS decisions to the server using the documented contracts", async () => {
    const api = mockApi({ requests: [{ sessionId: "s1", displayAlias: "민수", deviceLabel: "노트북", platform: "windows", sas: "123456", sasConfirmed: false }] });
    const client = new OfficeClient(api as never, "org / id");
    await expect(client.requests()).resolves.toEqual([{ id: "s1", nickname: "민수", device: "노트북", platform: "Windows", status: "pending", confirmationNumber: "123456", sasMatches: undefined }]);
    await client.confirmSas("s1", false);
    await client.confirmSas("s1", true);
    await client.decide("s1", "approved");
    expect(api.officeRequest).toHaveBeenNthCalledWith(1, "GET", "/api/office/organizations/org%20%2F%20id/requests");
    expect(api.officeRequest).toHaveBeenNthCalledWith(2, "POST", "/api/office/pairing/s1/sas-confirm", { matches: false });
    expect(api.officeRequest).toHaveBeenNthCalledWith(3, "POST", "/api/office/pairing/s1/sas-confirm", { matches: true });
    expect(api.officeRequest).toHaveBeenNthCalledWith(4, "POST", "/api/office/pairing/s1/decision", { decision: "approved" });
  });

  it("maps bounded server error codes and drops response text and secrets", async () => {
    const api = { officeRequest: vi.fn().mockRejectedValue({ message: "https://private-relay/key?token=secret", parsed: { code: "too_many_attempts", error: "secret invitation" } }) };
    const client = new OfficeClient(api as never, "org");
    let message = "";
    try { await client.requests(); } catch (error) { message = String(error); }
    expect(message).toBe("Error: office:too_many_attempts");
    expect(message).not.toMatch(/private-relay|secret|token|invitation/);
  });
});

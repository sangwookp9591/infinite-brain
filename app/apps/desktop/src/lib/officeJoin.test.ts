// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOfficeJoin, type OfficeJoinEvent, type OfficeJoinPorts } from "./officeJoin";
import { OfficeClient } from "./officeClient";

const id = "00000000-0000-4000-8000-000000000001";
const profile = { personId: id, displayAlias: "민수", deviceLabel: "내 컴퓨터", platform: "macos" as const };
const expiry = () => new Date(Date.now() + 86_400_000).toISOString();
const pasted = "IB1.sensitive-invitation.must-never-be-state";
function setup() {
  const events: OfficeJoinEvent[] = [];
  const stop = vi.fn().mockResolvedValue(undefined);
  const ports: OfficeJoinPorts = {
    begin: vi.fn().mockResolvedValue({ sessionId: id, sas: "123456", expiresAt: expiry(), origin: "https://192.168.1.5:3010", pairingToken: "native-secret" }),
    confirm: vi.fn().mockImplementation(async () => ({ state: "pending_approval", expiresAt: expiry() })),
    status: vi.fn().mockImplementation(async () => ({ state: "pending_approval", expiresAt: expiry() })),
    cancel: vi.fn().mockResolvedValue(undefined),
    discovery: vi.fn((update) => { update({ scanId: "scan", searching: false, candidates: [{ candidateId: id, serverId: "hub", displayName: "공유 작업 공간", trust: "untrusted", origin: "https://private", invitationSecret: "bad-extra" } as never] }); return { close: stop }; }),
    now: () => Date.now(),
  };
  return { ports, events, stop, join: createOfficeJoin((event) => events.push(event), ports) };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-21T00:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

describe("native office join orchestration", () => {
  it("connects discovery selection, native SAS, human confirmation, request and approval polling", async () => {
    const { join, ports, events, stop } = setup();
    await join.openDiscovery();
    await join.begin(pasted, profile, id);
    expect(ports.begin).toHaveBeenCalledExactlyOnceWith(pasted, profile, id);
    expect(ports.confirm).not.toHaveBeenCalled(); expect(ports.status).not.toHaveBeenCalled();
    expect(events[events.length - 1]).toEqual({ type: "SAS_RECEIVED", sas: "123456" });
    await join.confirm(true);
    expect(ports.confirm).toHaveBeenCalledExactlyOnceWith(id, true);
    expect(events[events.length - 1]).toEqual({ type: "JOIN_REQUESTED", approvalExpiresAt: Date.now() + 600_000 });
    vi.mocked(ports.status).mockResolvedValue({ state: "approved", expiresAt: expiry() });
    await vi.advanceTimersByTimeAsync(3000);
    expect(events[events.length - 1]).toEqual({ type: "APPROVAL_GRANTED" });
    await vi.advanceTimersByTimeAsync(60_000); expect(ports.status).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(events);
    for (const material of [pasted, "origin", "pairingToken", "native-secret", "invitationSecret", "https://", "192.168", "bad-extra"]) expect(serialized).not.toContain(material);
    await join.close(); expect(stop).toHaveBeenCalledTimes(1);
  });

  it("uses invite hints without discovery and sends negative SAS comparisons natively", async () => {
    const { join, ports, events } = setup();
    await join.begin(pasted, profile);
    expect(ports.discovery).not.toHaveBeenCalled(); expect(ports.begin).toHaveBeenCalledWith(pasted, profile, null);
    vi.mocked(ports.confirm).mockRejectedValue("office_sas_mismatch: private token and invite");
    await join.confirm(false);
    expect(ports.confirm).toHaveBeenCalledExactlyOnceWith(id, false);
    expect(events[events.length - 1]).toEqual({ type: "FAILED", code: "sas_mismatch" });
    await vi.advanceTimersByTimeAsync(30_000); expect(ports.status).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).not.toMatch(/private|token|invite\"/);
  });

  it.each([
    ["hub_pin_mismatch", { type: "FAILED", code: "hub_pin_mismatch" }],
    ["invite_invalid", { type: "FAILED", code: "invite_invalid" }],
    ["invite_expired", { type: "FAILED", code: "invite_expired" }],
    ["identity_link_required", { type: "FAILED", code: "identity_link_required" }],
    ["hub_approval_required", { type: "FAILED", code: "hub_approval_required" }],
    ["challenge_invalid", { type: "FAILED", code: "challenge_replayed" }],
  ])("bounds native %s errors before publishing them", async (code, expected) => {
    const { join, ports, events } = setup();
    vi.mocked(ports.begin).mockRejectedValue(new Error(`office_${code}: ${pasted} https://private token=secret`));
    await join.begin(pasted, profile, id);
    expect(events[events.length - 1]).toEqual(expected);
    expect(JSON.stringify(events)).not.toMatch(/https|private|secret|IB1/);
    expect(ports.confirm).not.toHaveBeenCalled();
  });

  it.each([
    ["approval_rejected", "APPROVAL_REJECTED"], ["approval_expired", "APPROVAL_EXPIRED"], ["request_cancelled", "APPROVAL_CANCELLED"],
  ])("stops polling on %s", async (code, event) => {
    const { join, ports, events } = setup();
    await join.begin(pasted, profile); await join.confirm(true);
    vi.mocked(ports.status).mockRejectedValue(`office_${code}: https://private token`);
    await vi.advanceTimersByTimeAsync(3000);
    expect(events[events.length - 1]).toEqual({ type: event });
    await vi.advanceTimersByTimeAsync(30_000); expect(ports.status).toHaveBeenCalledTimes(1);
    expect(ports.cancel).toHaveBeenCalledWith(id);
  });

  it("enforces the 3-second interval even for manual polls and cancels at the ten-minute ceiling", async () => {
    const { join, ports, events } = setup();
    await join.begin(pasted, profile); await join.confirm(true);
    await join.poll(); await join.poll(); expect(ports.status).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(events[events.length - 1]).toEqual({ type: "APPROVAL_EXPIRED" });
    expect(ports.status).toHaveBeenCalledTimes(199);
    expect(ports.cancel).toHaveBeenCalledExactlyOnceWith(id);
  });

  it("expires at the server deadline and never confirms stale SAS", async () => {
    const { join, ports, events } = setup();
    vi.mocked(ports.begin).mockResolvedValue({ sessionId: id, sas: "123456", expiresAt: new Date(Date.now() + 1000).toISOString() });
    await join.begin(pasted, profile); await vi.advanceTimersByTimeAsync(1000); await join.confirm(true);
    expect(ports.confirm).not.toHaveBeenCalled(); expect(events[events.length - 1]).toEqual({ type: "APPROVAL_EXPIRED" });
    const other = setup();
    await other.join.begin(pasted, profile);
    vi.mocked(other.ports.confirm).mockResolvedValue({ state: "pending_approval", expiresAt: new Date(Date.now() + 5000).toISOString() });
    await other.join.confirm(true); await vi.advanceTimersByTimeAsync(5000);
    expect(other.events[other.events.length - 1]).toEqual({ type: "APPROVAL_EXPIRED" });
  });

  it("close cancels late begin/confirmation and ignores in-flight status replies", async () => {
    const late = setup();
    let finish!: (value: Awaited<ReturnType<OfficeJoinPorts["begin"]>>) => void;
    vi.mocked(late.ports.begin).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const beginning = late.join.begin(pasted, profile); await late.join.close();
    const count = late.events.length; finish({ sessionId: id, sas: "123456", expiresAt: expiry() }); await beginning;
    expect(late.events).toHaveLength(count); expect(late.ports.cancel).toHaveBeenCalledWith(id);
    const active = setup(); await active.join.begin(pasted, profile); await active.join.confirm(true);
    let status!: (value: Awaited<ReturnType<OfficeJoinPorts["status"]>>) => void;
    vi.mocked(active.ports.status).mockReturnValue(new Promise((resolve) => { status = resolve; }));
    await vi.advanceTimersByTimeAsync(3000); await active.join.close();
    const length = active.events.length; status({ state: "approved", expiresAt: expiry() });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(active.events).toHaveLength(length); expect(active.ports.status).toHaveBeenCalledTimes(1);
  });

  it("does not forward raw API errors when administrator mismatch is recorded", async () => {
    const api = { officeRequest: vi.fn().mockRejectedValue({ parsed: { code: "sas_mismatch", error: pasted }, message: "https://private?token=secret" }) };
    const client = new OfficeClient(api as never, "org");
    await expect(client.confirmSas(id, false)).rejects.toThrow("office:sas_mismatch");
    expect(api.officeRequest).toHaveBeenCalledExactlyOnceWith("POST", `/api/office/pairing/${id}/sas-confirm`, { matches: false });
  });
});

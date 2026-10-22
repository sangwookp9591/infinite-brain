// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, type SessionInfo, type Vault } from "../api";
import { createOfficeConnection } from "../officeAdapters";
import type { OfficeJoinPorts } from "../officeJoin";

const profile = { personId: "00000000-0000-4000-8000-000000000001", displayAlias: "민수", deviceLabel: "내 컴퓨터", platform: "macos" as const };
const session: SessionInfo = { user: { id: "user", name: "민수", email: "synthetic@example.invalid" }, activeOrganizationId: "company" };
const vault = (id: string): Vault => ({ id, name: `작업 공간 ${id}`, organization_id: "company" });
function setup(vaults = [vault("one"), vault("two")], ttl = 600_000) {
  const log: string[] = [];
  const api = new ApiClient({ baseUrl: "https://previous.invalid" });
  const getSession = vi.spyOn(api, "getSession").mockResolvedValue(session);
  const listVaults = vi.spyOn(api, "listVaults").mockResolvedValue(vaults);
  let liveProvider = false, generation = 0;
  const close = vi.fn(async () => { expect(liveProvider).toBe(false); log.push("close"); });
  const openLink = vi.fn(async (_hub, client) => {
    expect(liveProvider).toBe(false);
    log.push("relay");
    client.setBaseUrl(`http://127.0.0.1/relay-${++generation}`);
    return { httpBaseUrl: client.getBaseUrl(), syncUrl: "ws", vaultSyncUrl: "ws", expiresAt: new Date(Date.now() + ttl).toISOString(), close };
  });
  const joinPorts: OfficeJoinPorts = {
    begin: vi.fn(async () => ({ sessionId: profile.personId, sas: "123456", expiresAt: new Date(Date.now() + 300_000).toISOString() })),
    confirm: vi.fn(async () => ({ state: "pending_approval" as const, expiresAt: new Date(Date.now() + 600_000).toISOString() })),
    status: vi.fn(async () => ({ state: "approved" as const, expiresAt: new Date(Date.now() + 600_000).toISOString(), origin: "https://hub.invalid", serverId: "hub" })),
    cancel: vi.fn(async () => {}), discovery: vi.fn(() => ({ close: async () => {} })), now: Date.now, openLink,
  };
  const stop = vi.fn(async () => { log.push("stop"); liveProvider = false; log.push("saved-local"); });
  let onRejected: () => void = () => {};
  const connect = vi.fn(async (_api, _session, selected, rejected, _onStorage: (shared: boolean) => void) => { log.push(`switch:${selected.id}`); onRejected = rejected; liveProvider = true; log.push("enable"); });
  const connection = createOfficeConnection(api, { stop, connect, restore: () => log.push("restore") }, joinPorts);
  async function approve() { await connection.begin("IB1.synthetic", profile); await connection.confirm(true); await vi.advanceTimersByTimeAsync(3000); }
  return { connection, approve, api, log, getSession, listVaults, stop, connect, openLink, close, joinPorts, reject: () => onRejected() };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-22T00:00:00Z")); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("approved office connection", () => {
  it.each([0, 1, 3])("lists %i allowed vaults only after approval and waits for explicit confirmation", async (count) => {
    const s = setup(Array.from({ length: count }, (_, i) => vault(String(i))));
    await s.connection.begin("IB1.synthetic", profile);
    expect(s.getSession).not.toHaveBeenCalled(); expect(s.listVaults).not.toHaveBeenCalled();
    await s.connection.confirm(true); await vi.advanceTimersByTimeAsync(3000);
    expect(s.connection.getState()).toMatchObject({ phase: "vault-selecting", vaults: Array.from({ length: count }, (_, i) => vault(String(i))) });
    expect(s.connect).not.toHaveBeenCalled();
    if (!count) expect(s.connection.getState().error).toBe("permission_missing");
    await s.connection.close();
  });
  it("keeps organization identity distinct, rechecks the selected ID and orders stop/save → switch → enable", async () => {
    const s = setup(); await s.approve(); s.log.length = 0;
    await s.connection.select("two");
    expect(s.connect).toHaveBeenCalledWith(s.api, session, vault("two"), expect.any(Function), expect.any(Function));
    expect(s.log).toEqual(["stop", "saved-local", "switch:two", "enable"]);
    expect(s.connection.getState().phase).toBe("connected");
    await s.connection.close();
    expect(s.log.slice(-4)).toEqual(["stop", "saved-local", "close", "restore"]);
  });
  it("does not enable or treat an incomplete/revoked vault listing as deletion", async () => {
    const s = setup(); await s.approve(); s.listVaults.mockResolvedValue([]);
    await s.connection.select("two");
    expect(s.connect).not.toHaveBeenCalled(); expect(s.connection.getState().error).toBe("permission_missing");
    await s.connection.close();
  });
  it("renews a short native session before expiry, retiring the provider before changing its relay URL", async () => {
    const s = setup([vault("one")], 60_000); await s.approve(); await s.connection.select("one"); s.log.length = 0;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(s.openLink).toHaveBeenCalledTimes(2);
    expect(s.log).toEqual(["stop", "saved-local", "close", "relay", "switch:one", "enable"]);
    expect(s.connection.getState().phase).toBe("connected"); await s.connection.close();
  });
  it("falls back to retry after a renewal transport failure and resumes the same selected vault", async () => {
    const s = setup([vault("one")], 60_000); await s.approve(); await s.connection.select("one");
    s.openLink.mockRejectedValueOnce(new Error("offline")); await vi.advanceTimersByTimeAsync(31_000);
    expect(s.connection.getState()).toMatchObject({ phase: "error", error: "connection_lost" });
    await vi.advanceTimersByTimeAsync(5000); expect(s.connection.getState().phase).toBe("connected");
    expect(s.connect.mock.calls[s.connect.mock.calls.length - 1]?.[2]).toEqual(vault("one")); await s.connection.close();
  });
  it("stops and closes a revoked device without seeding or deleting local data", async () => {
    const s = setup(); await s.approve(); await s.connection.select("one");
    s.openLink.mockRejectedValue(new Error("denied")); s.reject(); await vi.advanceTimersByTimeAsync(0);
    expect(s.connection.getState()).toMatchObject({ phase: "error", error: "session_revoked" });
    expect(s.close).toHaveBeenCalled(); expect(s.connect).toHaveBeenCalledTimes(1);
  });
  it("shows offline and expiry failures without claiming company storage", async () => {
    const s = setup([vault("one")], 60_000); await s.approve(); await s.connection.select("one");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    await vi.advanceTimersByTimeAsync(15_000); expect(s.connection.getState().error).toBe("connection_lost");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    s.openLink.mockRejectedValue(new Error("unavailable")); await vi.advanceTimersByTimeAsync(55_000);
    expect(s.connection.getState().error).toBe("session_expired"); await s.connection.close();
  });
  it("refuses a new hub when relay close or local persistence fails, so the old provider never sees the next URL", async () => {
    const s = setup(); await s.approve(); await s.connection.select("one");
    s.close.mockRejectedValueOnce(new Error("close failed"));
    await expect(s.connection.begin("IB1.other-hub", profile)).rejects.toThrow("close failed");
    expect(s.joinPorts.begin).toHaveBeenCalledTimes(1); expect(s.openLink).toHaveBeenCalledTimes(1);
    s.stop.mockRejectedValueOnce(new Error("disk failed"));
    await expect(s.connection.begin("IB1.other-hub", profile)).rejects.toThrow("disk failed");
    expect(s.joinPorts.begin).toHaveBeenCalledTimes(1); await s.connection.close();
  });
});

it("shows company storage only on the existing durable ACK callback, and clears it on a pending edit", async () => {
  const s = setup(); await s.approve(); await s.connection.select("one");
  expect(s.connection.getState().storage).not.toBe("company-shared");
  const onStorage = s.connect.mock.calls[0][4];
  onStorage(true); expect(s.connection.getState().storage).toBe("company-shared");
  onStorage(false); expect(s.connection.getState().storage).toBe("local-only");
  await s.connection.close();
});
it("surfaces a local-save failure during automatic renewal and never changes the relay", async () => {
  const s = setup([vault("one")], 60_000); await s.approve(); await s.connection.select("one");
  s.stop.mockRejectedValueOnce(new Error("local persistence failed")).mockRejectedValueOnce(new Error("local persistence failed"));
  await vi.advanceTimersByTimeAsync(31_000);
  expect(s.connection.getState()).toMatchObject({ phase: "error", error: "connection_lost" });
  expect(s.openLink).toHaveBeenCalledTimes(1);
  await s.connection.close();
});

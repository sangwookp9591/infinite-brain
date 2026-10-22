// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, SessionInfo } from "../lib/api";
const calls = vi.hoisted(() => [] as string[]);
const api = vi.hoisted(() => ({ setBaseUrl: vi.fn(() => calls.push("api-switch")), setToken: vi.fn() }));
vi.mock("../lib/auth/authManager", () => ({ authManager: { api, getServerUrl: () => "https://old.invalid" }, api }));
vi.mock("../lib/sync/docSession", () => ({ syncManager: { disable: () => calls.push("disable") } }));
const flush = vi.hoisted(() => vi.fn(async () => { calls.push("flush"); }));
vi.mock("../lib/bridge", () => ({ bridgeManager: { currentBridge: () => ({ flushEgest: flush, whenPersisted: async () => { calls.push("persisted"); } }) } }));
const ipcMock = vi.hoisted(() => ({
  getRecentVaults: vi.fn(async () => [{ path: "/existing" }]),
  listVaultsRootDirs: vi.fn(async () => ["/existing"]),
  peekVaultStamp: vi.fn(async (path: string) => path === "/existing" ? { organizationId: "company", serverVaultId: "chosen" } : null),
  getVaultsRoot: vi.fn(async () => "/root"),
}));
vi.mock("../lib/ipc", () => ipcMock);
import { useStore } from "../store";
const session: SessionInfo = { user: { id: "user", name: "민수", email: "synthetic@example.invalid" }, activeOrganizationId: "company" };
const selected = { id: "chosen", name: "제품 기획", organization_id: "company" };
const client = { listVaults: vi.fn(async () => [selected]), getBaseUrl: () => "http://127.0.0.1/synthetic-relay", getToken: () => "office-native" } as unknown as ApiClient;
let apply: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0;
  flush.mockImplementation(async () => { calls.push("flush"); });
  vi.mocked(client.listVaults).mockResolvedValue([selected]);
  apply = vi.fn(async () => { calls.push("folder"); });
  useStore.setState({ vault: { path: "/old", name: "old", epoch: 1 }, session: null, officeConnection: null, officeLeave: undefined, syncEnabled: true, applyVaultFolder: apply as never, enableSyncForVault: async () => { calls.push("enable"); useStore.setState({ syncEnabled: true }); } });
});
describe("office store transition", () => {
  it("stops and persists before installing the session, reuses the exact collection folder, then enables without starter seeding", async () => {
    await useStore.getState().connectOfficeVault(client, session, selected, vi.fn());
    expect(calls).toEqual(["disable", "flush", "persisted", "api-switch", "folder", "enable"]);
    expect(useStore.getState().session?.activeOrganizationId).toBe("company");
    expect(useStore.getState().officeConnection?.vaultId).toBe("chosen");
    expect(apply).toHaveBeenCalledWith("company", "/existing", { create: false, deferSync: true });
  });
  it("leaves the previous API and folder alone if local saving fails", async () => {
    flush.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(useStore.getState().connectOfficeVault(client, session, selected, vi.fn())).rejects.toThrow("disk unavailable");
    expect(api.setBaseUrl).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
  });
  it("refuses a disappeared selection without touching local folders or enabling", async () => {
    vi.mocked(client.listVaults).mockResolvedValue([]);
    await expect(useStore.getState().connectOfficeVault(client, session, selected, vi.fn())).rejects.toThrow("office:permission_missing");
    expect(api.setBaseUrl).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled(); expect(calls).not.toContain("enable");
  });
});

it("renews the same stamped vault without reopening the folder or closing the current note", async () => {
  const openNote = { id: "doc-kept", path: "기획.md", title: "기획" };
  useStore.setState({ vault: { path: "/existing", name: "제품 기획", epoch: 1 }, openNote });
  await useStore.getState().connectOfficeVault(client, session, selected, vi.fn());
  expect(apply).not.toHaveBeenCalled();
  expect(useStore.getState().openNote).toBe(openNote);
  expect(calls).toEqual(["disable", "flush", "persisted", "api-switch", "enable"]);
});

// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api";
import * as ipc from "../ipc";
import { openOfficeLink } from "../officeLink";
import { deriveWsUrl } from "../sync/syncManager";
import { deriveVaultWsUrl } from "../sync/vaultSyncEngine";
vi.mock("../ipc", () => ({ officeLinkOpen: vi.fn(), officeLinkClose: vi.fn() }));
const base = `http://127.0.0.1:4567/${"x".repeat(43)}`;
const hub = { origin: "https://hub.local:3010", serverId: "hub-1" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ipc.officeLinkOpen).mockResolvedValue({ linkId: "link-1", httpBaseUrl: base });
  vi.mocked(ipc.officeLinkClose).mockResolvedValue();
});
describe("Office pinned transport adapter", () => {
  it("injects ApiClient and both real sync URL derivations without changing bearer auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(null)));
    const api = new ApiClient({ baseUrl: hub.origin, token: "bearer-secret", fetchImpl });
    const link = await openOfficeLink(hub, api);
    expect(ipc.officeLinkOpen).toHaveBeenCalledWith(hub.origin, hub.serverId);
    expect(api.getBaseUrl()).toBe(base);
    expect(api.getToken()).toBe("bearer-secret");
    expect(deriveWsUrl(api.getBaseUrl())).toBe(link.syncUrl);
    expect(deriveVaultWsUrl(api.getBaseUrl())).toBe(link.vaultSyncUrl);
    await api.getSession();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain(`${base}/api/`);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer bearer-secret");
    await Promise.all([link.close(), link.close()]);
    expect(ipc.officeLinkClose).toHaveBeenCalledOnce();
    expect(api.getBaseUrl()).toBe(hub.origin);
  });
  it("does not overwrite a newer ApiClient destination on close", async () => {
    const api = new ApiClient({ baseUrl: hub.origin });
    const link = await openOfficeLink(hub, api);
    api.setBaseUrl("https://another.local");
    await link.close();
    expect(api.getBaseUrl()).toBe("https://another.local");
  });
  it("fails closed for pin mismatch and removes any native URL from errors", async () => {
    vi.mocked(ipc.officeLinkOpen).mockRejectedValue(`office_hub_pin_mismatch: private ${base}`);
    const api = new ApiClient({ baseUrl: hub.origin });
    await expect(openOfficeLink(hub, api)).rejects.toThrow(/^office_hub_pin_mismatch: 확인한/);
    expect(api.getBaseUrl()).toBe(hub.origin);
    vi.mocked(ipc.officeLinkOpen).mockRejectedValue(base);
    await expect(openOfficeLink(hub)).rejects.toThrow(/^office_link_unavailable: 회사/);
  });
  it.each(["https://evil.example/token", "http://localhost:4567/token", `${base}?secret=x`, "http://127.0.0.1:1234/"])("refuses invalid IPC relay URL %s", async (url) => {
    vi.mocked(ipc.officeLinkOpen).mockResolvedValue({ linkId: "invalid", httpBaseUrl: url });
    await expect(openOfficeLink(hub)).rejects.toThrow(/^office_link_invalid:/);
    expect(ipc.officeLinkClose).toHaveBeenCalledWith("invalid");
  });
  it("keeps the API on the relay if native shutdown fails and redacts the failure", async () => {
    const api = new ApiClient({ baseUrl: hub.origin });
    const link = await openOfficeLink(hub, api);
    vi.mocked(ipc.officeLinkClose).mockRejectedValue(base);
    await expect(link.close()).rejects.toThrow(/^office_link_unavailable:/);
    expect(api.getBaseUrl()).toBe(base);
    vi.mocked(ipc.officeLinkClose).mockResolvedValue();
    await link.close();
    expect(api.getBaseUrl()).toBe(hub.origin);
  });
});

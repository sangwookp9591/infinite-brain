// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc", () => ({
  officeHostStatus: vi.fn(),
  officeHostStart: vi.fn(),
}));

import type { ApiClient } from "../api";
import * as ipc from "../ipc";
import { withOfficeHostFallback } from "../officeHost";

const stopped = { available: true, phase: "stopped", endpoint: null, scope: null, port: null, lanExposed: false, certificateFingerprint: null, error: null, runId: null } as const;
const ready = { available: true, phase: "ready", endpoint: "http://127.0.0.1:4321", scope: "loopback", port: 4321, lanExposed: false, certificateFingerprint: null, error: null, runId: "run" } as const;

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getBaseUrl: () => "http://localhost:3010",
    setBaseUrl: vi.fn(),
    health: vi.fn(async () => {}),
    ...overrides,
  } as unknown as ApiClient;
}

describe("withOfficeHostFallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts the bundled host only after a local network failure and retries on the same client", async () => {
    vi.mocked(ipc.officeHostStatus).mockResolvedValueOnce(stopped);
    vi.mocked(ipc.officeHostStart).mockResolvedValueOnce(ready);
    const api = client();
    const operation = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce("signed-in");

    await expect(withOfficeHostFallback(api, operation)).resolves.toBe("signed-in");
    expect(ipc.officeHostStart).toHaveBeenCalledOnce();
    expect(api.health).toHaveBeenCalledWith(ready.endpoint);
    expect(api.setBaseUrl).toHaveBeenCalledWith(ready.endpoint);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("leaves an existing responding local host alone", async () => {
    vi.mocked(ipc.officeHostStatus).mockResolvedValueOnce(ready);
    const api = client();
    const operation = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce("signed-in");

    await expect(withOfficeHostFallback(api, operation)).resolves.toBe("signed-in");
    expect(ipc.officeHostStart).not.toHaveBeenCalled();
    expect(api.setBaseUrl).toHaveBeenCalledWith(ready.endpoint);
  });

  it("explains when the runtime is not included", async () => {
    vi.mocked(ipc.officeHostStatus).mockResolvedValueOnce({ ...stopped, available: false });
    const api = client();
    await expect(withOfficeHostFallback(api, () => Promise.reject(new TypeError("offline"))))
      .rejects.toThrow("This app can't start the team server yet.");
    expect(ipc.officeHostStart).not.toHaveBeenCalled();
  });

  it("does not start a host for server-side authentication errors or another server", async () => {
    const api = client();
    const httpError = Object.assign(new Error("invalid password"), { status: 401 });
    await expect(withOfficeHostFallback(api, () => Promise.reject(httpError))).rejects.toBe(httpError);
    const remote = client({ getBaseUrl: () => "https://notes.example.com" });
    const networkError = new TypeError("Failed to fetch");
    await expect(withOfficeHostFallback(remote, () => Promise.reject(networkError))).rejects.toBe(networkError);
    expect(ipc.officeHostStatus).not.toHaveBeenCalled();
  });
});

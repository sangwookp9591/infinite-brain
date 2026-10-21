// SPDX-License-Identifier: Apache-2.0
import { ApiError, ServerCheckError, type ApiClient } from "./api";
import * as ipc from "./ipc";

const START_FAILED = "The team server couldn't start. Try again later, or ask your team administrator for help.";
const RUNTIME_MISSING = "This app can't start the team server yet. Update the app or ask your team administrator for help.";

/** Retry an unavailable default local server against the bundled host, when present. */
export async function withOfficeHostFallback<T>(
  api: ApiClient,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isNetworkFailure(error) || !isDefaultLoopback(api.getBaseUrl())) throw error;
  }

  const status = await ipc.officeHostStatus().catch(() => null);
  if (!status?.available) throw new Error(RUNTIME_MISSING);

  let endpoint: string | null = null;
  if (status.phase === "ready") {
    endpoint = isLoopbackEndpoint(status) ? status.endpoint : null;
  } else if (status.phase === "stopped" || status.phase === "failed") {
    const started = await ipc.officeHostStart().catch(() => null);
    if (!started) throw new Error(START_FAILED);
    endpoint = await waitForReadyEndpoint(api, started);
  } else {
    endpoint = await waitForReadyEndpoint(api, status);
  }

  if (!endpoint) throw new Error(START_FAILED);
  try {
    await api.health(endpoint);
  } catch {
    throw new Error(START_FAILED);
  }

  const originalUrl = api.getBaseUrl();
  api.setBaseUrl(endpoint);
  try {
    return await operation();
  } catch (error) {
    api.setBaseUrl(originalUrl);
    throw error;
  }
}

async function waitForReadyEndpoint(
  api: ApiClient,
  initial: ipc.OfficeHostStatus,
): Promise<string | null> {
  const deadline = Date.now() + 90_000;
  let current = initial;
  while (Date.now() < deadline) {
    if (current.phase === "failed" || current.phase === "stopped") return null;
    if (current.phase === "ready" && isLoopbackEndpoint(current) && current.endpoint) {
      try {
        await api.health(current.endpoint);
        return current.endpoint;
      } catch (error) {
        if (!(error instanceof ServerCheckError) || error.kind !== "unreachable") return null;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    current = await ipc.officeHostStatus().catch(() => current);
  }
  return null;
}

function isLoopbackEndpoint(status: ipc.OfficeHostStatus): boolean {
  if (status.scope !== "loopback" || !status.endpoint) return false;
  try {
    const endpoint = new URL(status.endpoint);
    return endpoint.protocol === "http:" &&
      (endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost") &&
      endpoint.port !== "" && endpoint.pathname === "/";
  } catch {
    return false;
  }
}

function isDefaultLoopback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && parsed.port === "3010" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof ApiError) return false;
  return error instanceof TypeError ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "NetworkError"));
}

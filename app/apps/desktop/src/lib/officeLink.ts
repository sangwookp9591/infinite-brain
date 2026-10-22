// SPDX-License-Identifier: Apache-2.0
import type { ApiClient } from "./api";
import * as ipc from "./ipc";

const CONNECT_ERROR = "회사 작업 공간에 연결하지 못했어요. 초대를 다시 열거나 관리자에게 확인해 주세요.";
const PIN_ERROR = "확인한 회사 작업 공간과 연결 대상이 달라요. 관리자에게 새 초대를 요청해 주세요.";

/** This object contains process-only capabilities. Never serialize or log it.
 * Pass httpBaseUrl to ApiClient and syncUrl to HocuspocusProvider's `url`.
 * The existing sync managers also derive both URLs from api.getBaseUrl().
 * Destroy providers BEFORE calling close, including when changing workspaces.
 */
export interface OfficeLink {
  readonly httpBaseUrl: string;
  readonly syncUrl: string;
  readonly vaultSyncUrl: string;
  close(): Promise<void>;
}

/** Requires a previously approved hub pin. This never establishes trust from
 * discovery, changes a pin, or persists the local relay address in app config.
 * Keep origin/serverId as the persisted hub identity instead.
 */
export async function openOfficeLink(
  hub: { origin: string; serverId: string },
  api?: ApiClient,
): Promise<OfficeLink> {
  let endpoint: ipc.OfficeLinkEndpoint;
  try {
    endpoint = await ipc.officeLinkOpen(hub.origin, hub.serverId);
  } catch (error) {
    // Native errors can otherwise contain URLs. Only stable error codes and
    // fixed Korean copy leave this boundary; never attach the original cause.
    throw safeError(error);
  }
  let parsed: URL;
  try {
    parsed = new URL(endpoint.httpBaseUrl);
    if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !parsed.port ||
      parsed.username || parsed.password || parsed.search || parsed.hash ||
      !/^\/[A-Za-z0-9_-]{43}$/.test(parsed.pathname)) throw new Error();
  } catch {
    await ipc.officeLinkClose(endpoint.linkId).catch(() => undefined);
    throw new Error(`office_link_invalid: ${CONNECT_ERROR}`);
  }
  const httpBaseUrl = parsed.href.replace(/\/$/, "");
  const wsBaseUrl = httpBaseUrl.replace(/^http:/, "ws:");
  const originalUrl = api?.getBaseUrl();
  // A public sentinel satisfies ApiClient's signed-in guard; native relay
  // replaces it with the origin-bound office token. It is never a credential.
  const originalToken = api?.getToken();
  api?.setBaseUrl(httpBaseUrl);
  api?.setToken("office-native");
  let closing: Promise<void> | undefined;
  return {
    httpBaseUrl,
    syncUrl: `${wsBaseUrl}/sync`,
    vaultSyncUrl: `${wsBaseUrl}/vault-sync`,
    close() {
      closing ??= (async () => {
        await ipc.officeLinkClose(endpoint.linkId);
        if (api?.getBaseUrl() === httpBaseUrl && originalUrl !== undefined) { api.setBaseUrl(originalUrl); api.setToken(originalToken ?? null); }
      })().catch((error: unknown) => {
        // A transient IPC failure must leave a usable retry to stop the relay.
        closing = undefined;
        throw safeError(error);
      });
      return closing;
    },
  };
}

function safeError(error: unknown): Error {
  const code = String(error).match(/\boffice_[a-z_]+(?=:)/)?.[0];
  if (code === "office_hub_pin_mismatch") return new Error(`${code}: ${PIN_ERROR}`);
  if (code === "office_hub_approval_required") {
    return new Error(`${code}: 회사 작업 공간을 먼저 확인하고 참여를 승인해 주세요.`);
  }
  return new Error(`office_link_unavailable: ${CONNECT_ERROR}`);
}

// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import { authManager } from "../../lib/auth/authManager";
import { ApiClient } from "../../lib/api";
import { useStore } from "../../store";
import { OfficePanel } from "./OfficePanel";
import { createFakeOfficeAdapter, createOfficeAdapter, createOfficeConnection } from "../../lib/officeAdapters";

// The settings tab is only a view. Closing it must not kill the user's sync.
let active: ReturnType<typeof createOfficeConnection> | undefined;
function nativeConnection() {
  if (active) return active;
  let previous: { url: string; token: string | null; session: ReturnType<typeof useStore.getState>["session"] } | undefined;
  active = createOfficeConnection(new ApiClient(), {
    stop: () => useStore.getState().stopOfficeSync(),
    async connect(api, session, vault, onRejected, onStorage) {
      previous ??= { url: authManager.api.getBaseUrl(), token: authManager.api.getToken(), session: useStore.getState().session };
      useStore.setState({ officeLeave: () => connection.close() });
      await useStore.getState().connectOfficeVault(api, session, vault, onRejected, onStorage);
    },
    restore() {
      if (!previous) return;
      authManager.api.setBaseUrl(previous.url);
      authManager.api.setToken(previous.token);
      useStore.setState({ session: previous.session, authStatus: previous.session ? "signed-in" : "signed-out", officeConnection: null, officeLeave: undefined, syncEnabled: false });
      previous = undefined;
    },
  });
  const connection = active;
  connection.subscribe(() => {
    if (connection.getState().phase === "connected") useStore.setState({ officeLeave: () => connection.close() });
  });
  void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    await win.onCloseRequested(async (event) => {
      event.preventDefault();
      try { await connection.close(); await win.destroy(); } catch { useStore.getState().requestAccountSettings("office"); }
    });
  });
  return active;
}

export function OfficeEntry() {
  const organizationId = useStore((s) => s.session?.activeOrganizationId ?? null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const simulator = import.meta.env.DEV && window.location.pathname.startsWith("/dev/window-simulator/");
  const scenario = simulator ? new URLSearchParams(location.search).get("officeScenario") ?? "default" : "default";
  const adapter = useMemo(() => simulator ? createFakeOfficeAdapter(scenario) : createOfficeAdapter(authManager.api, organizationId ?? ""), [simulator, scenario, organizationId]);
  const connection = useMemo(() => simulator ? undefined : nativeConnection(), [simulator]);
  useEffect(() => { if (simulator) { setAvailable(true); return; } let live = true; void import("../../lib/ipc").then(({ officeHostStatus }) => officeHostStatus()).then((s) => { if (live) setAvailable(s.available); }, () => { if (live) setAvailable(false); }); return () => { live = false; }; }, [simulator]);
  if (available === null) return <p>사내 협업 기능을 확인하고 있어요.</p>;
  if (!available) return <p>이 버전에는 사내 협업 기능이 포함되지 않았어요.</p>;
  if (!organizationId) return <p>회사 계정에 연결한 뒤 사내 협업을 사용할 수 있어요.</p>;
  return <div className="office-embedded"><OfficePanel adapter={adapter} scenario={scenario} connection={connection} /></div>;
}

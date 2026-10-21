// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { authManager } from "../../lib/auth/authManager";
import { useStore } from "../../store";
import { OfficePanel } from "./OfficePanel";
import { createOfficeAdapter } from "../../lib/officeAdapters";

export function OfficeEntry() {
  const organizationId = useStore((s) => s.session?.activeOrganizationId ?? null);
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => { let live = true; void import("../../lib/ipc").then(({ officeHostStatus }) => officeHostStatus()).then((s) => { if (live) setAvailable(s.available); }, () => { if (live) setAvailable(false); }); return () => { live = false; }; }, []);
  if (available === null) return <p>사내 협업 기능을 확인하고 있어요.</p>;
  if (!available) return <p>이 버전에는 사내 협업 기능이 포함되지 않았어요.</p>;
  if (!organizationId) return <p>회사 계정에 연결한 뒤 사내 협업을 사용할 수 있어요.</p>;
  const adapter = createOfficeAdapter(authManager.api, organizationId);
  return <OfficePanel adapter={adapter} />;
}

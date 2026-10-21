// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { createFakeOfficeAdapter } from "../../lib/officeAdapters";
import { OfficePanel } from "./OfficePanel";

export function OfficePreview() {
  const [scenario] = useState(() => new URLSearchParams(window.location.search).get("officeScenario") ?? "default");
  const [adapter] = useState(() => createFakeOfficeAdapter(scenario));
  return <OfficePanel adapter={adapter} scenario={scenario} />;
}

// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { securityEventLabel } from "./SecurityHistoryTab";
it("uses everyday descriptions for security changes", () => {
  expect(securityEventLabel({ target_type: "membership" })).toBe("Vault members changed");
  expect(securityEventLabel({ target_type: "mcp_oauth_vault" })).toBe("Vault access changed");
});

// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { shareErrorMessage } from "./shareErrorMessage";

it("explains refused share targets without exposing server codes", () => {
  for (const code of ["share_target_not_member", "guest_vault_level_not_allowed", "external_sharing_blocked", "access_manager_required"]) {
    const error = Object.assign(new Error(code), { name: "ApiError", body: { error: code } });
    const message = shareErrorMessage(error);
    expect(message).not.toContain(code);
    expect(message.length).toBeGreaterThan(25);
  }
  expect(shareErrorMessage(Object.assign(new Error("share_target_not_member"), { name: "ApiError" }))).toContain("Invite them first");
  expect(shareErrorMessage(new Error("secret internal error"))).not.toContain("secret");
});

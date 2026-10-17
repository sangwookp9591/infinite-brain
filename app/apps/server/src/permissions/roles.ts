// SPDX-License-Identifier: Apache-2.0
/** Better Auth can return comma-joined role names. Unknown roles fail closed. */
function hasRole(role: string | null | undefined, allowed: readonly string[]): boolean {
  return !!role && role.split(",").some((value) => allowed.includes(value.trim()));
}
export function isManagerRole(role: string | null | undefined): boolean {
  return hasRole(role, ["owner", "admin"]);
}
export function isTeamRole(role: string | null | undefined): boolean {
  return hasRole(role, ["owner", "admin", "member"]);
}
export function isActiveRole(role: string | null | undefined): boolean {
  return hasRole(role, ["owner", "admin", "member", "guest"]);
}

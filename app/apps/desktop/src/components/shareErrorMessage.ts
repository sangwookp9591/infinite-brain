// SPDX-License-Identifier: Apache-2.0
const REFUSALS: Record<string, string> = {
  share_target_not_member: "This person hasn't joined this vault yet. Invite them first.",
  member_not_found: "This person is no longer in this vault. Invite them again to share.",
  guest_vault_level_not_allowed: "Choose individual folders or notes to share with a guest.",
  external_sharing_blocked: "This vault doesn't allow sharing with people outside your team. Ask an admin for help.",
  access_manager_required: "Ask a vault owner or admin to change this person's access.",
  "Not allowed to manage shares here": "You can no longer change sharing for this item. Ask a vault owner or admin for help.",
};

export function shareErrorMessage(cause: unknown, fallback?: string): string {
  if (cause instanceof Error && cause.name === "ApiError") {
    const body = (cause as Error & { body?: { error?: string; code?: string } }).body;
    const code = body?.error ?? body?.code ?? cause.message;
    if (REFUSALS[code]) return REFUSALS[code];
  }
  return fallback ?? "Couldn't update sharing. Check your connection and try again.";
}

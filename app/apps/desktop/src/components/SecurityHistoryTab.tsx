import { RevokeExternalAccess } from "./RevokeExternalAccess";
import { ExternalSharingSettings } from "./ExternalSharingSettings";
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { authManager } from "../lib/auth/authManager";
import type { SecurityEvent } from "../lib/api";

export function securityEventLabel(event: Pick<SecurityEvent, "target_type">): string {
  return ({ share: "Sharing changed", membership: "Vault members changed", invitation: "Invitation changed",
    public_link: "Public link changed", ai_connection: "AI connection changed", join_code: "Join code changed",
    access_settings: "Access settings changed", request: "Access change declined" } as Record<string, string>)[event.target_type] ?? "Vault access changed";
}
export function SecurityHistoryTab({ organizationId }: { organizationId: string }) {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async (cursor?: string) => {
    setBusy(true); setError("");
    try {
      const page = await authManager.api.getSecurityEvents(organizationId, cursor);
      setEvents((old) => cursor ? [...old, ...page.events] : page.events); setNext(page.nextBefore);
    } catch { setError("Couldn't load security history. Check your connection and try again."); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [organizationId]);
  return <div>
    <ExternalSharingSettings organizationId={organizationId} />
    <RevokeExternalAccess key={organizationId} organizationId={organizationId} />
    <h3>Security history</h3>
    <p>See who changed access to this vault and when.</p>
    {error && <p role="alert" className="auth-error">{error}</p>}
    {!busy && !error && events.length === 0 && <p>No security changes yet.</p>}
    <ul className="share-list">{events.map((event) => <li key={event.id}>
      <div><strong>{event.actor_name || "Unknown"}</strong><div>{securityEventLabel(event)}</div>
        <small>{new Date(event.created_at).toLocaleString()} · {event.result === "ok" ? "Completed" : event.result === "refused" ? "Declined" : "Couldn't complete"}</small></div>
    </li>)}</ul>
    {next && <button className="link-btn" disabled={busy} onClick={() => void load(next)}>Show older changes</button>}
    {error && <button className="link-btn" disabled={busy} onClick={() => void load()}>Try again</button>}
  </div>;
}

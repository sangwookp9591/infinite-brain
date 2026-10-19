import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type { AccessDefault, InviteManyResult, TeamAccessMode } from "../lib/api";
import { authManager } from "../lib/auth/authManager";
import { classifyLimitError, freeLimitOf, invitePrewarning, limitFromError, peopleLimitReason, type LimitKind } from "../lib/billing";
import { buildInviteLink } from "../lib/inviteLink";
import { isValidEmail, splitEmails } from "../lib/membersAccess";
import { useStore } from "../store";
import { useT } from "../lib/i18n";
import { AsyncButton } from "./AsyncButton";
import { LimitNudge } from "./LimitNudge";
import { PeopleLimitNotice, inviteLimitError, peopleLimitKind } from "./PeopleLimitNotice";
import { MenuSelect } from "./MenuSelect";
import { UpgradeDialog } from "./UpgradeDialog";

type InviteAccess = TeamAccessMode | "default";

const ACCESS_OPTIONS: ReadonlyArray<{ value: InviteAccess; label: string; hint?: string }> = [
  { value: "open", label: "Can edit" },
  { value: "readonly", label: "Can view" },
  { value: "private", label: "No access" },
  { value: "default", label: "Use New members default", hint: "Use the setting selected above" },
];

/** Add typed or pasted text to the chip list, de-duplicated case-insensitively. */
export function addChips(chips: readonly string[], text: string): string[] {
  const seen = new Set(chips.map((c) => c.toLowerCase()));
  const out = [...chips];
  for (const email of splitEmails(text)) {
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push(email);
  }
  return out;
}

/**
 * Invite several people at once, each with a role and an access level. One
 * request; each address reports its own outcome, using the same three
 * messages the old Members tab showed (emailed / no email server / email
 * failed, with the link to share).
 */
export function InvitePeopleDialog({ orgId, canManageBilling = false, seatAccount = null, ownerName = null, onClose, onInvited }: {
  orgId: string;
  /** The owner can add seats from the notice. */
  canManageBilling?: boolean;
  /** The account's seats, for the warning shown before anyone types (Team model only). */
  seatAccount?: Parameters<typeof invitePrewarning>[0] | null;
  /** The vault owner's name, so an admin knows whom to ask. */
  ownerName?: string | null;
  onClose: () => void;
  /** Called with the per-address results so the roster can add rows at once. */
  onInvited: (results: InviteManyResult[], sent: { role: string; access: TeamAccessMode | null }) => void;
}) {
  const tr = useT();
  const serverUrl = useStore((s) => s.serverUrl);
  const [chips, setChips] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState<"member" | "admin" | "guest">("member");
  const [guestItems, setGuestItems] = useState<Array<{ resourceType: "folder" | "file"; resourceId: string; label: string }>>([]);
  const [guestTargets, setGuestTargets] = useState<string[]>([]);
  const [guestPermission, setGuestPermission] = useState<"view" | "edit">("view");
  const [access, setAccess] = useState<InviteAccess>("default");
  const [newMemberDefault, setNewMemberDefault] = useState<AccessDefault | null>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [results, setResults] = useState<InviteManyResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<{ kind: LimitKind; limit: number | null } | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [peopleErr, setPeopleErr] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    authManager.api.getJoinCodeDetails().then((c) => { if (live) { setCode(c.code); setExpiresAt(c.expiresAt); } }).catch(() => {});
    authManager.api.getAccessDefault(orgId).then((value) => { if (live) setNewMemberDefault(value); }).catch(() => {});
    return () => { live = false; };
  }, [orgId]);

  useEffect(() => {
    if (role !== "guest") return;
    let live = true;
    void authManager.api.listVaults().then(async (vaults) => {
      const items = await Promise.all(vaults.filter((vault) => (vault.organizationId ?? vault.organization_id) === orgId).map(async (vault) => {
        const tree = await authManager.api.listAccessTree(vault.id);
        return [...tree.folders.map((folder) => ({ resourceType: "folder" as const, resourceId: folder.id, label: folder.path })),
          ...tree.notes.map((note) => ({ resourceType: "file" as const, resourceId: note.id, label: note.relPath }))];
      }));
      if (live) setGuestItems(items.flat());
    }).catch(() => { if (live) setError(tr("Couldn't load shared items. Check your connection and try again.")); });
    return () => { live = false; };
  }, [role, orgId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !upgradeOpen) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, upgradeOpen]);

  const commitDraft = () => {
    if (!draft.trim()) return;
    setChips((c) => addChips(c, draft));
    setDraft("");
  };

  const all = draft.trim() ? addChips(chips, draft) : chips;
  const invalid = all.filter((e) => !isValidEmail(e));

  const send = async () => {
    setError(null);
    setLimit(null);
    setPeopleErr(null);
    if (all.length === 0 || invalid.length > 0) return;
    setChips(all);
    setDraft("");
    try {
      const out = await authManager.api.inviteMany(orgId, {
        emails: all,
        role,
        access: role === "guest" || access === "default" ? null : access,
        ...(role === "guest" ? { targets: guestItems.filter((item) => guestTargets.includes(item.resourceId)).map(({ resourceType, resourceId }) => ({ resourceType, resourceId, permission: guestPermission })) } : {}),
      });
      setResults(out);
      setChips(out.filter((r) => r.error).map((r) => r.email));
      onInvited(out, { role, access: access === "default" ? null : access });
      void useStore.getState().refreshVault();
    } catch (e) {
      const kind = classifyLimitError(e);
      if (peopleLimitKind(e)) setPeopleErr(e);
      else if (kind) setLimit({ kind, limit: limitFromError(e) });
      else setError(e instanceof Error ? e.message : String(e));
    }
  };

  const prewarning = seatAccount ? invitePrewarning(seatAccount, ownerName, canManageBilling) : null;

  // A people limit is ONE notice, whether the whole call was refused or some
  // addresses were: the per-address rows below drop the raw code for it.
  const peopleNotice =
    peopleErr ?? results?.map((r) => (r.error ? inviteLimitError(r.error) : null)).find((x) => x != null) ?? null;

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard unavailable */ }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="modal invite-people" role="dialog" aria-modal="true" aria-label={tr("Invite people")} onClick={(e) => e.stopPropagation()}>
        <h2 className="confirm-title">{tr("Invite people")}</h2>
        <div className="invite-chips" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}>
          {chips.map((c) => (
            <span key={c} className={`invite-chip${isValidEmail(c) ? "" : " is-invalid"}`}>
              {c}
              <button type="button" aria-label={tr("Remove {email}", { email: c })} onClick={() => setChips((cs) => cs.filter((x) => x !== c))}>×</button>
            </span>
          ))}
          <input
            type="text"
            autoFocus
            value={draft}
            placeholder={chips.length ? "" : tr("Emails, separated by commas")}
            aria-label={tr("Email addresses")}
            onChange={(e) => {
              const v = e.target.value;
              if (/[\s,;]$/.test(v)) { setChips((c) => addChips(c, v)); setDraft(""); }
              else setDraft(v);
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (!/[\s,;]/.test(text)) return;
              e.preventDefault();
              setChips((c) => addChips(c, draft + text));
              setDraft("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitDraft(); }
              else if (e.key === "Backspace" && !draft && chips.length) setChips((c) => c.slice(0, -1));
            }}
            onBlur={commitDraft}
          />
        </div>
        {invalid.length > 0 && (
          <div className="auth-error">{invalid.length === 1 ? tr("“{email}” isn't an email address.", { email: invalid[0] }) : tr("{count} entries aren't email addresses.", { count: invalid.length })}</div>
        )}
        {role !== "guest" && (<div className="invite-people-fields">
          <label className="invite-field invite-field-default">
            <span className="invite-field-label">{tr("New members")}</span>
            <MenuSelect
              value={newMemberDefault?.mode ?? "private"}
              options={[{ value: "open", label: tr("Can edit") }, { value: "readonly", label: tr("Can view") }, { value: "private", label: tr("No access") }]}
              onSelect={(mode) => {
                setSavingDefault(true);
                void authManager.api.setAccessDefault(orgId, mode as TeamAccessMode)
                  .then(setNewMemberDefault)
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSavingDefault(false));
              }}
              ariaLabel={tr("New members access")}
              triggerClassName="invite-field-trigger"
              menuClassName="access-menu"
              disabled={!newMemberDefault || savingDefault}
            />
          </label>
        </div>)}
        <div className="invite-people-fields">
          <label className="invite-field">
            <span className="invite-field-label">{tr("Role")}</span>
            <MenuSelect
              value={role}
              options={[{ value: "member", label: tr("Member") }, { value: "admin", label: tr("Admin"), hint: tr("Can manage people and access") }, { value: "guest", label: tr("Guest"), hint: tr("Only selected folders and notes") }]}
              onSelect={setRole}
              ariaLabel={tr("Role")}
              triggerClassName="invite-field-trigger"
              menuClassName="access-menu"
            />
          </label>
          {role !== "guest" && (<label className="invite-field">
            <span className="invite-field-label">{tr("Access")}</span>
            <MenuSelect
              value={access}
              options={ACCESS_OPTIONS.map((o) => ({ ...o, label: tr(o.label), hint: o.hint === undefined ? undefined : tr(o.hint) }))}
              onSelect={setAccess}
              ariaLabel={tr("Access")}
              triggerClassName="invite-field-trigger"
              menuClassName="access-menu"
              disabled={role === "admin"}
            />
          </label>)}
        </div>
        {role === "guest" && <fieldset className="invite-guest-targets"><legend>{tr("Share with this guest")}</legend>
          <p>{tr("Choose folders or notes. Everything else stays private.")}</p>
          <select aria-label={tr("Guest can")} value={guestPermission} onChange={(event) => setGuestPermission(event.target.value as "view" | "edit")}><option value="view">{tr("Can view")}</option><option value="edit">{tr("Can edit")}</option></select>
          <div className="invite-guest-items">{guestItems.map((item) => <label key={item.resourceId} className="invite-guest-item"><input type="checkbox" checked={guestTargets.includes(item.resourceId)} onChange={(event) => setGuestTargets((old) => event.target.checked ? [...old, item.resourceId] : old.filter((id) => id !== item.resourceId))} /> <span>{item.label}</span></label>)}</div>
        </fieldset>}
        {code && role !== "guest" && (
          <div className="invite-people-code">
            <span className="muted">{tr("Or share the join code")}</span>
            <code className="invite-people-code-value">{code}</code>
            {expiresAt && <span className="muted">{tr("Expires {date}", { date: new Date(expiresAt).toLocaleDateString() })}</span>}
            <button type="button" className="link-btn" title={tr("The previous code will stop working")} disabled={rotating} onClick={async () => {
              setRotating(true);
              try { const next = await authManager.api.rotateJoinCode(); setCode(next.code); setExpiresAt(next.expiresAt); }
              catch { setError(tr("Couldn't create a new code. Check your connection and try again.")); }
              finally { setRotating(false); }
            }}>{tr("Create new code")}</button>
            <button type="button" className="link-btn invite-people-copy" aria-label={tr("Copy join code")} onClick={() => void copy(code)}>{tr("Copy")}</button>
          </div>
        )}
        {error && <div className="auth-error">{error}</div>}
        {prewarning && !results && peopleNotice == null && (
          <div className="limit-nudge">
            <span>{prewarning.text}</span>
            {prewarning.action === "add-seats" && (
              <button type="button" className="link-btn" onClick={() => useStore.getState().requestAccountSettings("plan")}>
                {tr("Add seats")}
              </button>
            )}
            {prewarning.action === "upgrade" && (
              <button
                type="button"
                className="link-btn"
                onClick={() => useStore.getState().requestUpgradeDialog({ reason: peopleLimitReason(seatAccount ? freeLimitOf(seatAccount) : null) })}
              >
                {tr("Upgrade →")}
              </button>
            )}
          </div>
        )}
        {peopleNotice != null && <PeopleLimitNotice error={peopleNotice} canManageBilling={canManageBilling} ownerName={ownerName} freeLimit={seatAccount ? freeLimitOf(seatAccount) : null} />}
        {limit && <LimitNudge kind={limit.kind} limit={limit.limit} onUpgrade={() => setUpgradeOpen(true)} />}
        {results?.map((r) => {
          const link = r.invitationId ? buildInviteLink(serverUrl, r.invitationId) : null;
          return (
            <div key={r.email} className={`invite-notice${r.error ? " is-warning" : ""}`}>
              {!r.invitationId ? (
                <span>{r.error && !inviteLimitError(r.error) ? tr("Couldn't invite {email} ({error}).", { email: r.email, error: r.error }) : tr("Couldn't invite {email}.", { email: r.email })}</span>
              ) : (
                <>
                  <span>
                    {r.emailed
                      ? tr("Invitation emailed to {email}. You can also share this link:", { email: r.email })
                      : r.error
                        ? tr("Invitation created, but the email to {email} couldn't be sent ({error}). Share this link instead:", { email: r.email, error: r.error })
                        : role === "guest" ? tr("This server does not send email. Send this link privately to {email}. Anyone with the link can join using that address:", { email: r.email }) : tr("Invitation created. Share this link with {email}:", { email: r.email })}
                  </span>
                  {link && (
                    <div className="invite-notice-link">
                      <code>{link}</code>
                      <button className="link-btn" aria-label={tr("Copy invitation link for {email}", { email: r.email })} onClick={() => void copy(link)}>{tr("Copy")}</button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
        <div className="confirm-actions invite-people-actions">
          <button type="button" className="ghost-pill" onClick={onClose}>{results ? tr("Done") : tr("Cancel")}</button>
          <AsyncButton
            className="primary"
            spinnerTone="on-accent"
            disabled={all.length === 0 || invalid.length > 0 || role === "guest" && guestTargets.length === 0}
            onClick={send}
          >
            {all.length >= 2 ? tr("Send invites") : tr("Send invite")}
          </AsyncButton>
        </div>
        {upgradeOpen && <UpgradeDialog onClose={() => setUpgradeOpen(false)} />}
      </div>
    </div>,
    document.body,
  );
}

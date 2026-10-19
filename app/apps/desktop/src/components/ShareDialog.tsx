import { shareErrorMessage } from "./shareErrorMessage";
import { useEffect, useState } from "react";
import { authManager } from "../lib/auth/authManager";
import {
  type Permission,
  type Share,
  sharePrincipalId,
} from "../lib/api";
import { useStore } from "../store";
import { Avatar } from "./Avatar";
import { useT } from "../lib/i18n";

export interface ShareTarget {
  resourceType: "folder" | "file";
  resourceId: string;
  title: string;
}

/**
 * Folder/file share dialog (spec 04 §3/§6): grant a member view/edit, list
 * existing shares, revoke. Folder shares are inherited by descendants per the
 * server ACL; revoke force-disconnects live sockets server-side (instant kill).
 */
export function ShareDialog({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const tr = useT();
  const members = useStore((s) => s.members);
  const session = useStore((s) => s.session);

  const [shares, setShares] = useState<Share[]>([]);
  const [principalId, setPrincipalId] = useState("");
  const [permission, setPermission] = useState<Permission>("view");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shareableMembers = members.filter((m) => m.userId !== session?.user.id);

  const load = async () => {
    try {
      const list = await authManager.api.listShares(target.resourceType, target.resourceId);
      setShares(list);
    } catch (e) {
      setError(shareErrorMessage(e));
    }
  };

  useEffect(() => {
    void load();
    if (shareableMembers.length > 0 && !principalId) {
      setPrincipalId(shareableMembers[0].userId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.resourceId]);

  const addShare = async () => {
    if (!principalId) return;
    setBusy(true);
    setError(null);
    try {
      await authManager.api.createShare({
        resourceType: target.resourceType,
        resourceId: target.resourceId,
        principalId,
        permission,
      });
      await load();
    } catch (e) {
      setError(shareErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (shareId: string) => {
    setBusy(true);
    try {
      await authManager.api.revokeShare(shareId);
      await load();
    } catch (e) {
      setError(shareErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const memberName = (userId: string) => {
    const m = members.find((mm) => mm.userId === userId);
    return m?.user?.name || m?.user?.email || userId;
  };

  // The title is bold, so split the translated sentence around the placeholder.
  const shareTitle = tr("Share {title}", { title: "\u0001" }).split("\u0001");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>
            {shareTitle[0]}<strong>{target.title}</strong>{shareTitle[1]}
            <span className="muted"> ({tr(target.resourceType)})</span>
          </span>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="share-add">
          <select value={principalId} onChange={(e) => setPrincipalId(e.target.value)}>
            {shareableMembers.length === 0 && <option value="">{tr("No other members")}</option>}
            {shareableMembers.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user?.name || m.user?.email || m.userId}
              </option>
            ))}
          </select>
          <select value={permission} onChange={(e) => setPermission(e.target.value as Permission)}>
            <option value="view">{tr("view")}</option>
            <option value="edit">{tr("edit")}</option>
          </select>
          <button
            className="primary"
            disabled={busy || !principalId}
            onClick={() => void addShare()}
          >
            {tr("Share")}
          </button>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <div className="subhead">{tr("People with access")}</div>
        {shares.length === 0 ? (
          <div className="muted">{tr("Not shared with anyone yet.")}</div>
        ) : (
          <ul className="share-list">
            {shares.map((s) => {
              const principal = sharePrincipalId(s);
              const name = memberName(principal);
              return (
                <li key={s.id}>
                  <Avatar label={name} userId={principal} />
                  <span className="member-name">{name}</span>
                  <span className="member-role">{tr(s.permission)}</span>
                  <button className="link-btn danger" onClick={() => void revoke(s.id)}>
                    {tr("Revoke")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

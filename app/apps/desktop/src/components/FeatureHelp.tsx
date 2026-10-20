// SPDX-License-Identifier: Apache-2.0
// The "?" beside a settings tab title: what the feature does, where it applies,
// and how a team uses it, in three lines plus a link to the longer guide.
// A native <details>, so it opens with the keyboard and needs no state.
import * as ipc from "../lib/ipc";
import { useT } from "../lib/i18n";
import { REPO_URL } from "../lib/starPrompt";
import type { SettingsTab } from "../lib/settingsTabs";
import "./FeatureHelp.css";

type Help = { what: string; where: string; team: string; doc: string };

/** English is the i18n key; Korean lives in lib/i18n/ko/help.ts. */
export const FEATURE_HELP: Partial<Record<SettingsTab, Help>> = {
  "smart-search": {
    what: "Finds notes with a similar meaning, not just the same words, in search (⌘F).",
    where: "Only on this computer. It downloads its model once (310 MB) and reads this computer's copy of your notes. Nothing is sent anywhere.",
    team: "Nothing is shared. Each teammate turns it on on their own computer, and it only searches notes they can already open.",
    doc: "docs/SMART-SEARCH.md",
  },
  members: {
    what: "Who is in this vault, and what each person can open: edit, view or nothing, for the whole vault or folder by folder.",
    where: "Saved on the server, so it applies to everyone in the vault on every device.",
    team: "Add people with Invite people in the vault menu, by link or join code. To share one folder or note, use Share… in the sidebar. Guests see only what is shared with them by name.",
    doc: "README.md#-working-as-a-team",
  },
  mcp: {
    what: "Lets Claude or ChatGPT search and read this vault over MCP, and edit it if you allow that.",
    where: "Each connection belongs to the person who made it, with the access chosen when connecting: read only, read and write, or read, write and delete.",
    team: "Each teammate connects their own AI. Every AI edit appears in Activity → AI changes for the whole team, with a diff and Undo.",
    doc: "README.md#-connect-your-ai",
  },
  versioning: {
    what: "A checkpoint saves every note in the vault, content and folders. One is taken automatically each day the vault changes, and the 5 most recent are kept.",
    where: "Kept on the server for the whole vault, not per person.",
    team: "Reverting rolls back every member's vault at once, live. To bring back one note, use Version history on that note instead. Owners and admins can create checkpoints.",
    doc: "README.md#-what-your-team-sees",
  },
};

export function FeatureHelp({ tab }: { tab: SettingsTab }) {
  const tr = useT();
  const help = FEATURE_HELP[tab];
  if (!help) return null;
  return (
    <details className="feature-help">
      <summary aria-label={tr("About this feature")} title={tr("About this feature")}>?</summary>
      <dl>
        <dt>{tr("What it does")}</dt>
        <dd>{tr(help.what)}</dd>
        <dt>{tr("Where it applies")}</dt>
        <dd>{tr(help.where)}</dd>
        <dt>{tr("With your team")}</dt>
        <dd>{tr(help.team)}</dd>
      </dl>
      <button type="button" className="link-btn" onClick={() => void ipc.openExternal(`${REPO_URL}/blob/main/${help.doc}`)}>
        {tr("Read the guide")}
      </button>
    </details>
  );
}

// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import type { Demo } from "./types";
import { ProgressDial } from "../../src/components/kit/ProgressDial";
import { ActivityLattice } from "../../src/components/kit/ActivityLattice";
import { SwipeRow } from "../../src/components/kit/SwipeRow";
import { GlowCard } from "../../src/components/kit/GlowCard";
import { FolderCard } from "../../src/components/kit/FolderCard";

function DialDemo() {
  const [value, setValue] = useState(42);
  return <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center" }}><ProgressDial label="Syncing" value={62} /><ProgressDial label="Reindex budget" value={value} interactive onChange={setValue} /></div>;
}
function SwipeDemo() {
  const [notes, setNotes] = useState(["Q3 research plan", "Launch checklist", "Weekly reflection"]);
  const [message, setMessage] = useState("Swipe, hover or focus a note");
  return <div style={{ width: "100%", display: "grid", gap: 8 }}>
    {notes.map(title => <SwipeRow key={title} label={title} onPrimary={() => setMessage(`Opened ${title}`)} actions={[
      { id: "archive", label: "Archive", onSelect: () => { setNotes(notes.filter(n => n !== title)); setMessage(`Archived ${title}`); } },
      { id: "trash", label: "Move to trash", destructive: true, onSelect: () => { setNotes(notes.filter(n => n !== title)); setMessage(`Moved ${title} to trash`); } },
    ]}><div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div><div style={{ fontSize: 11, marginTop: 5, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}><span>Edited 2 min ago</span><time>09:41</time></div></SwipeRow>)}
    <span role="status" style={{ fontSize: 11, color: "var(--text-secondary)" }}>{message}</span>
    {notes.length < 3 && <button type="button" onClick={() => setNotes(["Q3 research plan", "Launch checklist", "Weekly reflection"])}>Restore demo notes</button>}
  </div>;
}
function GlowDemo() {
  const [selected, setSelected] = useState("");
  return <div style={{ width: "100%", display: "grid", gap: 12 }}>{["Daily home", "Project hub"].map(title => <GlowCard key={title}><h3>{title}</h3><p>{title === "Daily home" ? "Your notes, tasks and today's focus." : "Plans, research and decisions in one place."}</p><button type="button" onClick={() => setSelected(title)}>Use template</button></GlowCard>)}<span role="status" style={{ fontSize: 11 }}>{selected && `${selected} selected`}</span></div>;
}
function FolderDemo() {
  const [selected, setSelected] = useState("");
  return <div><FolderCard label="Product team" items={[{ title: "Q3 plan" }, { title: "Launch notes" }, { title: "Research" }]} onItemClick={item => setSelected(item.title)} /><span role="status" style={{ fontSize: 11, color: "var(--text-secondary)" }}>{selected ? `Opened ${selected}` : "Open the vault to explore notes"}</span></div>;
}
export const demosB: Demo[] = [
  { id: "progress-dial", title: "Progress Dial", usage: "Sync, upload and reindex progress (P3). Arrow keys adjust the interactive dial.", render: () => <DialDemo /> },
  { id: "activity-lattice", title: "Activity Lattice", usage: "AI agent activity, sync status and dashboard agent runners (P3, P6).", render: () => <div style={{ display: "grid", gap: 24, width: "100%" }}><ActivityLattice label="Claude is reading 12 notes" /><ActivityLattice label="Synced" status="done" /><ActivityLattice label="Sync failed" status="error" /></div> },
  { id: "swipe-row", title: "Swipe Row", usage: "File tree, search results, AI changes and member rows (P3, P5). Trash is reversible.", render: () => <SwipeDemo /> },
  { id: "glow-card", title: "Glow Card", usage: "Dashboard templates, vault cards and key dialogs (P5, P6).", render: () => <GlowDemo /> },
  { id: "folder-card", title: "Folder Card", usage: "Vault picker and empty folders (P3). Click to open; Escape to close.", render: () => <FolderDemo /> },
];

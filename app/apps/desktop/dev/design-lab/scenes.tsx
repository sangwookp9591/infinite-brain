// SPDX-License-Identifier: Apache-2.0
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { SegmentedChips } from "../../src/components/kit/SegmentedChips";
import { BarSlider } from "../../src/components/kit/BarSlider";
import { SpringCheck } from "../../src/components/kit/SpringCheck";
import { SwipeRow } from "../../src/components/kit/SwipeRow";
import { ActivityLattice } from "../../src/components/kit/ActivityLattice";
import { FolderCard } from "../../src/components/kit/FolderCard";
import { GlowCard } from "../../src/components/kit/GlowCard";
import { CodeSlots } from "../../src/components/kit/CodeSlots";
import { ActivityHeatmap, type ActivityDay } from "../../src/components/kit/ActivityHeatmap";
import type { Demo } from "./types";
import { smartSearchScene } from "./smartSearchScene";

export type LabTheme = "system" | "light" | "dark";
export const ACCENTS = [
  { name: "Ink", value: null }, { name: "Blue", value: "#3b74d1" },
  { name: "Green", value: "#3f8850" }, { name: "Coral", value: "#dc6e52" },
  { name: "Violet", value: "#7f73ff" },
];
export const LabAppearanceContext = createContext<{
  theme: LabTheme; accent: string | null;
  setTheme: (value: LabTheme) => void; setAccent: (value: string | null) => void;
} | null>(null);

function SettingRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return <div className="scene-setting"><div><strong>{label}</strong><p>{hint}</p></div><div className="scene-control">{children}</div></div>;
}
function Appearance() {
  const appearance = useContext(LabAppearanceContext)!;
  const [width, setWidth] = useState(80);
  const [size, setSize] = useState(16);
  const [lines, setLines] = useState(false);
  const [properties, setProperties] = useState("visible");
  return <div className="scene-settings">
    <div className="scene-heading"><h4>Make room for your thinking.</h4><p>A calm workspace, tuned to you.</p></div>
    <SettingRow label="Theme" hint="Follow your system or choose a mood."><SegmentedChips label="Appearance theme" value={appearance.theme} onChange={value => appearance.setTheme(value as LabTheme)} items={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} /></SettingRow>
    <SettingRow label="Accent" hint="A little colour, where it matters."><div className="lab-controls">{ACCENTS.map(a => <button type="button" key={a.name} className="lab-swatch" aria-label={`Appearance accent ${a.name}`} aria-pressed={appearance.accent === a.value} data-ink={a.value === null || undefined} style={a.value ? { background: a.value } : undefined} onClick={() => appearance.setAccent(a.value)} />)}</div></SettingRow>
    <SettingRow label="Content width" hint="Keep long notes comfortable to read."><BarSlider label="Appearance content width" min={60} max={120} step={2} value={width} onChange={setWidth} formatValue={v => `${v}ch`} /></SettingRow>
    <SettingRow label="Text size" hint="Find your reading rhythm."><BarSlider label="Appearance text size" min={12} max={24} value={size} onChange={setSize} formatValue={v => `${v}px`} /></SettingRow>
    <SettingRow label="Show line numbers" hint="A quiet guide for Markdown editing."><SpringCheck label="Line numbers" checked={lines} onChange={setLines} /></SettingRow>
    <SettingRow label="Properties" hint="Choose how note metadata appears."><SegmentedChips label="Appearance properties" size="sm" value={properties} onChange={setProperties} items={[{ value: "visible", label: "Visible" }, { value: "hidden", label: "Hidden" }, { value: "source", label: "Source" }]} /></SettingRow>
  </div>;
}
const NOTES = ["Weekly planning", "Launch checklist", "Customer interviews", "Design principles", "Reading list"];
function Sidebar() {
  const [notes, setNotes] = useState(NOTES);
  const [selected, setSelected] = useState(NOTES[0]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(true);
  const [tasks, setTasks] = useState([true, false, false]);
  return <div className="scene-workspace">
    <aside className="scene-sidebar" aria-label="Example vault sidebar">
      <button type="button" className="scene-vault" onClick={() => setEditing(v => !v)}>Product team <span>⌄</span></button>
      <input className="scene-search" type="search" aria-label="Search example notes" placeholder="Search notes…" value={query} onChange={e => setQuery(e.target.value)} />
      <span className="scene-eyebrow">YOUR NOTES</span>
      <div className="scene-files">{notes.filter(n => n.toLowerCase().includes(query.toLowerCase())).map((note, i) => <SwipeRow key={note} label={note} onPrimary={() => setSelected(note)} actions={[{ id: "trash", label: "Trash", destructive: true, onSelect: () => setNotes(ns => ns.filter(n => n !== note)) }]}><span className="scene-file-name" data-selected={selected === note || undefined}>{note}</span>{i === 2 && <small className="scene-badge">AI change</small>}</SwipeRow>)}</div>
      <div className="scene-sync"><ActivityLattice label={editing ? "Claude is editing 2 notes" : "Synced"} status={editing ? "working" : "done"} /><button type="button" className="scene-text-button" onClick={() => setEditing(v => !v)}>{editing ? "Preview synced state" : "Preview AI activity"}</button></div>
    </aside>
    <div className="scene-editor"><span className="scene-eyebrow">PRODUCT TEAM / NOTES</span><h4>{selected}</h4><p>Good work starts with a little space to think. This week, we’re connecting what we learned from customers with the next version of our product.</p><p>Keep decisions close to the ideas that shaped them. Every note here is a plain Markdown file, ready for your team and your AI tools to build on together.</p><div className="scene-tasks">{["Gather interview notes", "Review the new workspace", "Share a first draft"].map((label, i) => <SpringCheck key={label} label={label} checked={tasks[i]} onChange={checked => setTasks(ts => ts.map((v, j) => j === i ? checked : v))} />)}</div></div>
  </div>;
}
function Welcome() {
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("Choose a vault to pick up where you left off.");
  return <div className="scene-welcome"><div className="scene-heading"><h4>Your ideas live here.</h4><p role="status">{notice}</p></div><div className="scene-vaults">{["Product team", "Personal", "Research"].map(label => <FolderCard key={label} label={label} items={[{ title: "Getting started", description: label }, { title: "Ideas & questions" }, { title: "Weekly notes" }]} onItemClick={item => setNotice(`${label} / ${item.title} selected — lab preview`)} />)}<GlowCard><span className="scene-create-icon" aria-hidden="true">+</span><h4>Create a vault</h4><p>A fresh space for your next idea.</p><button type="button" onClick={() => setNotice("New vault selected — lab preview")}>Create a vault</button></GlowCard></div><div className="scene-join"><div><h4>Join with a code</h4><p>Have an invitation? Bring your thinking to the team.</p></div><CodeSlots label="Join a vault with a code" value={code} onChange={setCode} onComplete={() => setNotice("Invitation code ready — lab preview; no request sent")} /></div></div>;
}
function NoteActivity() {
  const [range, setRange] = useState<"year" | "recent">("recent");
  const [selected, setSelected] = useState<string | null>(null);
  const days = useMemo(() => {
    const end = new Date(); end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end);
    if (range === "recent") start.setUTCDate(start.getUTCDate() - 364);
    else start.setUTCMonth(0, 1);
    const items: ActivityDay[] = [];
    for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
      const seed = Math.floor(t / 86_400_000);
      items.push({ date: new Date(t).toISOString().slice(0, 10), count: seed % 13 < 3 ? 0 : (seed * 17 + 11) % 9 });
    }
    return items;
  }, [range]);
  return <div className="scene-note-activity"><div className="scene-note-activity-title"><div><h4>노트 활동</h4><p>날짜를 선택하면 편집 횟수를 확인할 수 있어요.</p></div><div className="lab-controls"><button type="button" className="lab-pill" aria-pressed={range === "recent"} onClick={() => setRange("recent")}>최근 1년</button><button type="button" className="lab-pill" aria-pressed={range === "year"} onClick={() => setRange("year")}>올해</button></div></div><ActivityHeatmap days={days} label="날짜별 노트 편집 활동" period={range === "recent" ? "최근 1년" : "올해"} selectedDate={selected} onSelectDate={setSelected} actions={selected && <button type="button" className="lab-pill" onClick={() => setSelected(null)}>선택 해제</button>} />{selected && <p className="scene-note-activity-selection" role="status">선택한 날짜: {selected}</p>}</div>;
}
export const scenes: Demo[] = [
  { id: "appearance", title: "Settings · Appearance", usage: "P2, P5 · Theme, accent, reading preferences and note properties.", wide: true, render: () => <Appearance /> },
  { id: "sidebar", title: "Sidebar", usage: "P3–P6 · File rows, AI activity, sync status and Markdown tasks.", wide: true, render: () => <Sidebar /> },
  { id: "welcome", title: "Welcome / vault picker", usage: "P3, P5 · Open a vault, create a space or join your team.", wide: true, render: () => <Welcome /> },
  { id: "note-activity", title: "노트 활동 · 히트맵", usage: "날짜별 노트 편집 횟수 · 기간 전환, 날짜 선택과 범례 강조를 확인합니다.", wide: true, render: () => <NoteActivity /> },
  smartSearchScene,
];

// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import type { Demo } from "./types";
import { SegmentedChips } from "../../src/components/kit/SegmentedChips";
import { BarSlider } from "../../src/components/kit/BarSlider";
import { SpringCheck } from "../../src/components/kit/SpringCheck";
import { CodeSlots } from "../../src/components/kit/CodeSlots";
import { FuseButton } from "../../src/components/kit/FuseButton";

function ChipsDemo() {
  const [theme, setTheme] = useState("System");
  const [mode, setMode] = useState("Visible");
  return <div style={{ width: "100%" }}><p>Theme</p><SegmentedChips label="Theme" items={["System", "Light", "Dark"].map(value => ({ value, label: value }))} value={theme} onChange={setTheme} />
    <p>Note properties</p><SegmentedChips size="sm" label="Properties mode" items={["Visible", "Hidden", "Source"].map(value => ({ value, label: value }))} value={mode} onChange={setMode} /></div>;
}
function SliderDemo() {
  const [width, setWidth] = useState(80);
  const [size, setSize] = useState(16);
  return <div style={{ width: "100%" }}><p>Content width</p><BarSlider label="Content width" value={width} onChange={setWidth} min={60} max={120} formatValue={v => `${v}ch`} />
    <p>Text size</p><BarSlider label="Text size" value={size} onChange={setSize} min={12} max={24} formatValue={v => `${v}px`} /></div>;
}
function CheckDemo() {
  const [tasks, setTasks] = useState([false, true, false]);
  return <div><p>Release notes / Today</p>{["Ship the sync fix", "Review AI changes", "Invite the team"].map((label, i) => <SpringCheck key={label} label={label} checked={tasks[i]} onChange={checked => setTasks(tasks.map((old, j) => j === i ? checked : old))} />)}</div>;
}
function CodeDemo() {
  const [code, setCode] = useState("K7M");
  const [error, setError] = useState<string>();
  return <div style={{ width: "100%", display: "grid", gap: 18 }}><p>Enter your team's join code</p><CodeSlots value={code} onChange={value => { setCode(value); setError(undefined); }} onComplete={value => setError(value === "K7MPX2RA" ? undefined : "Code not found. Check your team's invitation.")} error={error} /><p>8 letters and numbers · Try K7MPX2RA</p></div>;
}
function FuseDemo() {
  const [trash, setTrash] = useState("In your vault");
  const [ai, setAi] = useState("AI summary added");
  return <div style={{ display: "grid", gap: 14 }}><p>Weekly planning.md · {trash}</p><FuseButton label="Move to trash" doneLabel="Moved to trash" onAction={() => setTrash("In trash · Undo available")} onUndo={() => setTrash("In your vault")} onCommit={() => setTrash("In trash")} />
    <p>Meeting notes.md · {ai}</p><FuseButton label="Undo AI change" doneLabel="AI change undone" onAction={() => setAi("Previous version restored")} onUndo={() => setAi("AI summary added")} onCommit={() => setAi("Previous version kept")} /></div>;
}
export const demosA: Demo[] = [
  { id: "segmented-chips", title: "Segmented chips", usage: "P2, P5 · Theme, properties mode, graph scope and sort", render: () => <ChipsDemo /> },
  { id: "bar-slider", title: "Bar slider", usage: "P2, P7 · Content width, text size and graph forces", render: () => <SliderDemo /> },
  { id: "spring-check", title: "Spring check", usage: "P4, P5 · Markdown tasks and settings checkboxes", render: () => <CheckDemo /> },
  { id: "code-slots", title: "Code slots", usage: "P3, P5 · Vault join codes and email verification", render: () => <CodeDemo /> },
  { id: "fuse-button", title: "Fuse button", usage: "P3, P4 · Reversible trash, archive and AI undo", render: () => <FuseDemo /> },
];

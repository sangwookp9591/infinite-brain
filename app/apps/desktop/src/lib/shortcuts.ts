// SPDX-License-Identifier: Apache-2.0
// Every keyboard shortcut the app answers to, for Vault settings → Keyboard
// shortcuts, written once and shown for both macOS and Windows. Keys use
// CodeMirror's names ("Mod-Shift-h"): Mod is ⌘ on macOS and Ctrl elsewhere.
// The bindings themselves live in App.tsx (window keys), lib/editor/ (the note
// keymaps) and VaultSwitcher.tsx; change a row here when you change one there.
import { platformClass } from "./platform";

export type Shortcut = {
  /** English; Korean in lib/i18n/ko/shortcuts.ts. */
  label: string;
  /** Alternatives, any of which works. */
  keys: string[];
  /** Only where Windows differs. */
  win?: string[];
};

export const SHORTCUT_GROUPS: Array<{ title: string; items: Shortcut[] }> = [
  {
    title: "App",
    items: [
      { label: "New note", keys: ["Mod-n"] },
      { label: "Close the current tab", keys: ["Mod-w"] },
      { label: "Next / previous tab", keys: ["Ctrl-Tab", "Ctrl-Shift-Tab"] },
      { label: "Search all notes", keys: ["Mod-p"] },
      { label: "Toggle the graph", keys: ["Mod-g"] },
      { label: "Home (outside a note)", keys: ["Mod-Shift-h"] },
      { label: "Switch to vault 1–9", keys: ["Mod-1–9"] },
      { label: "Save now", keys: ["Mod-s"] },
      { label: "Reload the app", keys: ["Mod-r"] },
    ],
  },
  {
    title: "Writing",
    items: [
      { label: "Line break inside the same item", keys: ["Shift-Enter"] },
      { label: "Next list item", keys: ["Enter"] },
      { label: "Indent / outdent a list item", keys: ["Tab", "Shift-Tab"] },
      { label: "Bold", keys: ["Mod-b"] },
      { label: "Italic", keys: ["Mod-i"] },
      { label: "Inline code", keys: ["Mod-e"] },
      { label: "Strikethrough", keys: ["Mod-Shift-x"] },
      { label: "Highlight", keys: ["Mod-Shift-h"] },
      { label: "Insert a link", keys: ["Mod-k"] },
      { label: "Heading level 1–6", keys: ["Mod-Alt-1–6"] },
      { label: "Tick / create a task", keys: ["Mod-l"] },
      { label: "Add a property", keys: ["Mod-;"] },
      { label: "Find in this note", keys: ["Mod-f"] },
      { label: "Select the next match", keys: ["Mod-d"] },
      { label: "Undo", keys: ["Mod-z"] },
      { label: "Redo", keys: ["Mod-Shift-z"], win: ["Mod-y", "Mod-Shift-z"] },
    ],
  },
];

export const isMac = () => platformClass() === "macos";

const MAC: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Enter: "↩", Tab: "⇥" };
const PC: Record<string, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
// Modifiers in each platform's own reading order (⌃⌥⇧⌘ on a Mac).
const MAC_ORDER = ["Ctrl", "Alt", "Shift", "Mod"];
const PC_ORDER = ["Mod", "Ctrl", "Alt", "Shift"];

/** "Mod-Shift-h" → "⇧⌘H" on a Mac, "Ctrl+Shift+H" on Windows. */
export function keyLabel(spec: string, mac = isMac()): string {
  const parts = spec.split("-");
  const key = parts.pop()!;
  const order = mac ? MAC_ORDER : PC_ORDER;
  const mods = [...new Set(parts)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const names = mac ? MAC : PC;
  const shown = [...mods, key].map((p) => names[p] ?? (p.length === 1 ? p.toUpperCase() : p));
  return shown.join(mac ? "" : "+");
}

/** The keys a pressed combination spells, in the same names as `keyLabel`.
 *  Letters and digits come from the physical key, so ⌥G or a Korean layout
 *  still reads as G. */
export function eventSpec(
  e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  mac = isMac(),
): string {
  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push("Mod");
  if (mac && e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const physical = /^(?:Key([A-Z])|Digit(\d))$/.exec(e.code);
  parts.push(physical ? (physical[1] ?? physical[2]).toLowerCase() : e.key === " " ? "Space" : e.key === "Process" ? e.code : e.key);
  return parts.join("-");
}

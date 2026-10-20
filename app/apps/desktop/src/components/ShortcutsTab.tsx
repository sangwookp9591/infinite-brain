// SPDX-License-Identifier: Apache-2.0
// Vault settings → Keyboard shortcuts: every shortcut for macOS and Windows side
// by side (this computer's column first), and a box that shows what a key press
// reaches the app as, for "the shortcut does nothing" reports. The list is
// lib/shortcuts.ts.
import { useState } from "react";
import { eventSpec, isMac, keyLabel, SHORTCUT_GROUPS, type Shortcut } from "../lib/shortcuts";
import { useT } from "../lib/i18n";
import "./ShortcutsTab.css";

function Keys({ specs, mac }: { specs: string[]; mac: boolean }) {
  return (
    <>
      {specs.map((s, i) => (
        <span key={s}>
          {i > 0 && " / "}
          <kbd className="shortcut-kbd">{keyLabel(s, mac)}</kbd>
        </span>
      ))}
    </>
  );
}

/** What a key press arrives as. Inside the box, so ⌘N here makes no note. */
function KeyCheck() {
  const tr = useT();
  const [seen, setSeen] = useState<{ spec: string; composing: boolean } | null>(null);
  return (
    <section className="io-section">
      <h3 className="io-heading">{tr("Check a shortcut")}</h3>
      <p className="io-desc">
        {tr("Click the box and press the keys. If nothing appears, another app or the system took them before Infinite Brain.")}
      </p>
      <input
        className="shortcut-check"
        aria-label={tr("Check a shortcut")}
        placeholder={tr("Press keys here")}
        onKeyDown={(e) => {
          if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
          e.stopPropagation();
          if (e.key !== "Tab" && (e.metaKey || e.ctrlKey || e.key === "Enter")) e.preventDefault();
          setSeen({ spec: eventSpec(e.nativeEvent), composing: e.nativeEvent.isComposing || e.keyCode === 229 });
        }}
      />
      {seen && (
        <p className="io-hint" role="status">
          {tr("The app received {keys}.", { keys: keyLabel(seen.spec) })}{" "}
          {seen.composing &&
            tr("It came while a Korean letter was still being composed, and a note ignores shortcuts then. Finish the letter first (a space or an arrow key), then press the shortcut.")}
        </p>
      )}
    </section>
  );
}

export function ShortcutsTab() {
  const tr = useT();
  const mac = isMac();
  // This computer's platform first, so the column people read is the one that works.
  const cols = mac ? [true, false] : [false, true];
  const keysFor = (s: Shortcut, forMac: boolean) => (!forMac && s.win) || s.keys;
  return (
    <div className="io-tab shortcuts-tab">
      <p className="io-desc">
        {tr("The same shortcuts work on Mac and Windows: ⌘ on a Mac is Ctrl on Windows, and ⌥ is Alt.")}
      </p>
      {SHORTCUT_GROUPS.map((group) => (
        <section className="io-section" key={group.title}>
          <h3 className="io-heading">{tr(group.title)}</h3>
          <table className="shortcut-table">
            <thead>
              <tr>
                <th scope="col">{tr("Action")}</th>
                {cols.map((m) => (
                  <th scope="col" key={String(m)}>{m ? "Mac" : "Windows"}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.items.map((s) => (
                <tr key={s.label}>
                  <th scope="row">{tr(s.label)}</th>
                  {cols.map((m) => (
                    <td key={String(m)} className={m === mac ? "this-computer" : undefined}>
                      <Keys specs={keysFor(s, m)} mac={m} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <KeyCheck />
    </div>
  );
}

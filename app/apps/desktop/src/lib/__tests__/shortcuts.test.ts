// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { eventSpec, keyLabel, SHORTCUT_GROUPS } from "../shortcuts";
import { ko } from "../i18n/ko";

describe("keyboard shortcut labels", () => {
  it("spells a shortcut the way each platform does", () => {
    expect(keyLabel("Mod-Shift-h", true)).toBe("⇧⌘H");
    expect(keyLabel("Mod-Shift-h", false)).toBe("Ctrl+Shift+H");
    expect(keyLabel("Shift-Enter", true)).toBe("⇧↩");
    expect(keyLabel("Shift-Enter", false)).toBe("Shift+Enter");
    expect(keyLabel("Mod-Alt-1–6", true)).toBe("⌥⌘1–6");
    expect(keyLabel("Mod-Alt-1–6", false)).toBe("Ctrl+Alt+1–6");
    // Ctrl-Tab is Ctrl on a Mac too (⌘-Tab is the app switcher).
    expect(keyLabel("Ctrl-Tab", true)).toBe("⌃⇥");
    expect(keyLabel("Mod-;", false)).toBe("Ctrl+;");
  });

  it("reads a key press back in the same names", () => {
    const press = { key: "Enter", code: "Enter", metaKey: false, ctrlKey: false, altKey: false, shiftKey: true };
    expect(eventSpec(press, true)).toBe("Shift-Enter");
    // ⌥G types ©, and a Korean layout types ㅎ: both are still the G key.
    expect(eventSpec({ ...press, key: "©", code: "KeyG", altKey: true, metaKey: true, shiftKey: false }, true)).toBe("Mod-Alt-g");
    expect(eventSpec({ ...press, key: "ㅎ", code: "KeyG", ctrlKey: true, shiftKey: false }, false)).toBe("Mod-g");
    // ⌃ on a Mac is not ⌘.
    expect(eventSpec({ ...press, key: "n", code: "KeyN", ctrlKey: true, shiftKey: false }, true)).toBe("Ctrl-n");
  });

  it("has Korean for every group and action", () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(ko[group.title], group.title).toBeTruthy();
      for (const s of group.items) expect(ko[s.label], s.label).toBeTruthy();
    }
  });
});

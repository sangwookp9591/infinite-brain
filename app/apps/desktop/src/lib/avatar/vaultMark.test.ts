// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { ITEM_COLORS } from "../appearance";
import { VAULT_ICON_NAMES } from "../vaultIcon";
import { inkOn, markContrast, vaultMarkSvg } from "./vaultMark";

describe("vaultMarkSvg", () => {
  const colors = { fill: ITEM_COLORS[0].fill, ink: ITEM_COLORS[0].value };

  it("is deterministic and id-free", () => {
    for (const icon of VAULT_ICON_NAMES) {
      const svg = vaultMarkSvg(icon, colors);
      expect(vaultMarkSvg(icon, colors)).toBe(svg);
      expect(svg).not.toMatch(/\bid=|url\(|href=/);
      expect(svg).toContain('viewBox="0 0 32 32"');
    }
  });

  it("gives every preset its own shape", () => {
    const shapes = new Set(VAULT_ICON_NAMES.map((icon) => vaultMarkSvg(icon, colors)));
    expect(shapes.size).toBe(VAULT_ICON_NAMES.length);
  });

  it("draws the None tile in currentColor with no background", () => {
    const svg = vaultMarkSvg("book", null);
    expect(svg).toContain('fill="currentColor"');
    expect(svg).not.toContain("<rect");
  });

  it("keeps the mark at 3:1 or better on every tile colour", () => {
    for (const color of ITEM_COLORS) {
      expect(markContrast(inkOn(color.fill, color.value), color.fill), color.id).toBeGreaterThanOrEqual(3);
    }
  });
});

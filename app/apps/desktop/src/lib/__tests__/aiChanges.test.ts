// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { aiConnections, aiConflictFrom, aiTextDiff, type AiChange } from "../aiChanges";

const change = (id: string, connection: string, label: string): AiChange => ({
  id, doc_id: "doc", connection_id: connection, connection_label: label, connection_kind: "token",
  op: "update", before_path: "note.md", after_path: "note.md", created_at: "2026-10-14T00:00:00Z",
  reverted_at: null, diff_summary: { beforeBytes: 1, afterBytes: 2, oversized: false },
});

describe("AI change presentation", () => {
  it("groups by stable connection id, preserving distinct connections with the same label", () => {
    expect(aiConnections([change("3", "a", "New name"), change("2", "b", "New name"), change("1", "a", "Old name")]))
      .toEqual([{ id: "a", label: "New name" }, { id: "b", label: "New name" }]);
  });
  it.each([["before\n한글 😀", "after\n한글 😁"], ["", "created"], ["same", "same"], ["<script>alert(1)</script>", "safe"]])(
    "diff reconstructs both original bodies (%s)", (before, after) => {
      const parts = aiTextDiff(before, after);
      expect(parts.filter(([op]) => op <= 0).map(([, text]) => text).join("")).toBe(before);
      expect(parts.filter(([op]) => op >= 0).map(([, text]) => text).join("")).toBe(after);
    });
  it("accepts conflict bodies only when text fields have the expected types", () => {
    expect(aiConflictFrom({ diff: { expected: "AI", current: "human", before: "old" } })).toEqual({ expected: "AI", current: "human", before: "old" });
    expect(aiConflictFrom({ diff: { expected: "AI", current: 42, before: "old" } })).toBeNull();
    expect(aiConflictFrom({ error: "forbidden" })).toBeNull();
  });
});

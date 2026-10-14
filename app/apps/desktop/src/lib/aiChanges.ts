// SPDX-License-Identifier: Apache-2.0
import DiffMatchPatch from "diff-match-patch";

export interface AiChange {
  id: string; doc_id: string; connection_id: string; connection_label: string;
  connection_kind: "oauth" | "token";
  op: "create" | "update" | "append" | "edit" | "delete" | "move";
  before_path: string; after_path: string;
  created_at: string; reverted_at: string | null;
  diff_summary: { beforeBytes: number; afterBytes: number; oversized: boolean };
}
export interface AiChangeDetail extends AiChange { before_text: string | null; after_text: string | null }
export interface AiChangeConflict {
  expected: string | null; current: string; before: string | null;
  expectedPath?: string; currentPath?: string;
}
export interface AiRevertResult {
  id: string; status: "reverted" | "already_reverted" | "failed";
  httpStatus?: number; error?: string; code?: string; diff?: AiChangeConflict;
}

export function aiConnections(items: AiChange[]) {
  const connections = new Map<string, string>();
  for (const item of items) if (!connections.has(item.connection_id)) connections.set(item.connection_id, item.connection_label);
  return [...connections].map(([id, label]) => ({ id, label }));
}

export function aiTextDiff(before: string, after: string): [number, string][] {
  const diff = new DiffMatchPatch();
  diff.Diff_Timeout = 0.2;
  const parts = diff.diff_main(before, after);
  diff.diff_cleanupSemantic(parts);
  return parts;
}

export function aiConflictFrom(body: unknown): AiChangeConflict | null {
  if (!body || typeof body !== "object" || !("diff" in body)) return null;
  const diff = body.diff;
  if (!diff || typeof diff !== "object" || !("current" in diff) || typeof diff.current !== "string" ||
      !("expected" in diff) || !(typeof diff.expected === "string" || diff.expected === null) ||
      !("before" in diff) || !(typeof diff.before === "string" || diff.before === null)) return null;
  return diff as AiChangeConflict;
}

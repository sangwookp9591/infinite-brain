// SPDX-License-Identifier: Apache-2.0
import { invoke } from "@tauri-apps/api/core";

export type DashboardNote = { id: string; path: string; title: string; mtime: number; frontmatter: string | null; tags: string[] };
export type NoteQuery = {
  folder?: string; tag?: string; property?: { key: string; value: unknown };
  modifiedSince?: number; sort?: "path" | "title" | "modified-desc" | "modified-asc";
  limit?: number; extensions?: string[];
};
export const queryNotes = (query: NoteQuery, epoch: number) => invoke<DashboardNote[]>("query_notes", { query, epoch });
export const listNotesByTag = (tag: string, epoch: number, limit = 100) => invoke<DashboardNote[]>("list_notes_by_tag", { tag, epoch, limit });
export const listNotesByProperty = (property: { key: string; value: unknown }, epoch: number, limit = 100) => invoke<DashboardNote[]>("list_notes_by_property", { property, epoch, limit });

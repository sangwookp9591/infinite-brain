-- SPDX-License-Identifier: Apache-2.0
CREATE TABLE ai_change_ledger (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  actor_user_id TEXT,
  connection_kind TEXT NOT NULL CHECK (connection_kind IN ('oauth', 'token')),
  connection_id TEXT NOT NULL,
  connection_label TEXT NOT NULL,
  tool TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('create', 'update', 'append', 'edit', 'delete', 'move')),
  before_text_hash TEXT NOT NULL,
  after_text_hash TEXT NOT NULL,
  before_text TEXT,
  after_text TEXT,
  before_path TEXT NOT NULL,
  after_path TEXT NOT NULL,
  before_title TEXT,
  after_title TEXT,
  diff_summary JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reverted_at TIMESTAMPTZ,
  reverted_by TEXT,
  CHECK (before_text IS NULL OR octet_length(before_text) <= 1048576),
  CHECK (after_text IS NULL OR octet_length(after_text) <= 1048576)
);
CREATE INDEX ai_change_ledger_vault_time ON ai_change_ledger(vault_id, created_at DESC, id DESC);
CREATE INDEX ai_change_ledger_connection ON ai_change_ledger(vault_id, connection_id, created_at DESC);
CREATE INDEX ai_change_ledger_doc ON ai_change_ledger(doc_id);

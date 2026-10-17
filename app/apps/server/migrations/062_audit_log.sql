-- SPDX-License-Identifier: Apache-2.0
-- Security events survive membership/user deletion and contain no note content.
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  organization_id TEXT,
  actor_user_id TEXT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'system', 'mcp')),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  before JSONB,
  after JSONB,
  result TEXT NOT NULL CHECK (result IN ('ok', 'refused', 'failed')),
  request_id TEXT,
  refs JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_created_idx ON audit_log (organization_id, created_at DESC, id DESC);
ALTER TABLE organization_access_settings ADD COLUMN audit_retention_days INTEGER NOT NULL DEFAULT 365
  CHECK (audit_retention_days BETWEEN 1 AND 36500);

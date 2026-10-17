-- SPDX-License-Identifier: Apache-2.0
CREATE TABLE external_revocations (
  id UUID PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','partial')),
  counts JSONB NOT NULL DEFAULT '{}',
  errors JSONB NOT NULL DEFAULT '[]',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX external_revocations_org_started ON external_revocations(organization_id,started_at DESC);

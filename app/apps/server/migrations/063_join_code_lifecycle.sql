-- SPDX-License-Identifier: Apache-2.0
ALTER TABLE org_join_codes ADD COLUMN expires_at TIMESTAMPTZ;
UPDATE org_join_codes SET expires_at = now() + interval '30 days';
ALTER TABLE org_join_codes ALTER COLUMN expires_at SET DEFAULT now() + interval '7 days';
ALTER TABLE org_join_codes ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE org_join_codes ADD COLUMN rotated_at TIMESTAMPTZ;
ALTER TABLE org_join_codes ADD COLUMN created_by TEXT REFERENCES "user" (id) ON DELETE SET NULL;
CREATE TABLE join_code_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX join_code_attempts_user_time_idx ON join_code_attempts (user_id, attempted_at DESC);

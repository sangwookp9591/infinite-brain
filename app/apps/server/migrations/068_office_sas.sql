-- SPDX-License-Identifier: Apache-2.0
-- In-flight v1 challenges cannot bypass SAS; discard them during the additive upgrade.
UPDATE pairing_session SET state='cancelled',updated_at=now()
WHERE state IN ('challenge_issued','proof_verified','pending_approval');
UPDATE person_device SET status='revoked',revoked_at=now(),updated_at=now()
WHERE id IN (SELECT device_id FROM pairing_session WHERE state='cancelled');
ALTER TABLE pairing_session
  ADD COLUMN sas_context JSONB,
  ADD COLUMN sas_commit BYTEA CHECK (sas_commit IS NULL OR octet_length(sas_commit)=32),
  ADD COLUMN sas_server_nonce TEXT,
  ADD COLUMN sas_code TEXT CHECK (sas_code IS NULL OR sas_code ~ '^[0-9]{6}$'),
  ADD COLUMN sas_phase TEXT CHECK (sas_phase IN ('prepared','committed','revealed')),
  ADD COLUMN sas_client_confirmed_at TIMESTAMPTZ,
  ADD COLUMN sas_admin_confirmed_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  ADD COLUMN sas_blocked_until TIMESTAMPTZ;
CREATE TABLE office_pairing_sas_attempt (
  key_fingerprint BYTEA PRIMARY KEY CHECK (octet_length(key_fingerprint)=32),
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 3),
  blocked_until TIMESTAMPTZ NOT NULL DEFAULT now()
);

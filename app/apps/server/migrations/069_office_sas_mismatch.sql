-- SPDX-License-Identifier: Apache-2.0
-- A reported comparison mismatch cannot become approvable after backoff expires.
ALTER TABLE pairing_session ADD COLUMN sas_mismatched_at TIMESTAMPTZ;

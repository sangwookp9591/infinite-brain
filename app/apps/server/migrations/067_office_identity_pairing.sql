-- SPDX-License-Identifier: Apache-2.0
-- Additive identity only: existing email accounts, memberships and vault ACLs stay authoritative.
CREATE TABLE person_identity (
  id UUID PRIMARY KEY,
  display_alias TEXT NOT NULL CHECK (length(display_alias) BETWEEN 1 AND 320),
  alias_normalized TEXT NOT NULL CHECK (length(alias_normalized) BETWEEN 1 AND 640),
  alias_disambiguator TEXT NOT NULL CHECK (alias_disambiguator ~ '^[0-9A-HJKMNP-TV-Z]{4,26}$'),
  linked_user_id TEXT REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ,
  UNIQUE (id, linked_user_id)
);
CREATE UNIQUE INDEX person_identity_user_idx ON person_identity(linked_user_id) WHERE linked_user_id IS NOT NULL;
CREATE INDEX person_identity_alias_idx ON person_identity(alias_normalized);

CREATE TABLE person_device (
  id UUID PRIMARY KEY,
  person_id UUID REFERENCES person_identity(id) ON DELETE RESTRICT,
  public_key BYTEA NOT NULL CHECK (octet_length(public_key) = 44),
  key_algorithm TEXT NOT NULL CHECK (key_algorithm = 'Ed25519'),
  key_fingerprint BYTEA NOT NULL UNIQUE CHECK (octet_length(key_fingerprint) = 32),
  device_label TEXT NOT NULL CHECK (length(device_label) BETWEEN 1 AND 160),
  platform TEXT NOT NULL CHECK (platform IN ('windows','macos','linux','other')),
  status TEXT NOT NULL DEFAULT 'unpaired' CHECK (status IN ('unpaired','pending','approved','rejected','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX person_device_person_idx ON person_device(person_id);

CREATE TABLE office_person_membership (
  person_id UUID NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('active','suspended','revoked')),
  approved_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, organization_id),
  FOREIGN KEY (person_id, user_id) REFERENCES person_identity(id, linked_user_id) ON DELETE RESTRICT
);

CREATE TABLE office_pairing_invitation (
  id UUID PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  secret_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(secret_hash) = 32),
  server_id TEXT NOT NULL,
  hub_fingerprint TEXT NOT NULL CHECK (hub_fingerprint ~ '^[a-f0-9]{64}$'),
  host_generation BIGINT NOT NULL CHECK (host_generation > 0),
  created_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE TABLE pairing_session (
  id UUID PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  invitation_id UUID NOT NULL UNIQUE REFERENCES office_pairing_invitation(id) ON DELETE RESTRICT,
  device_id UUID NOT NULL UNIQUE REFERENCES person_device(id) ON DELETE RESTRICT,
  person_id UUID REFERENCES person_identity(id) ON DELETE RESTRICT,
  requested_person_id UUID NOT NULL,
  requester_user_id TEXT REFERENCES "user"(id) ON DELETE RESTRICT,
  display_alias TEXT NOT NULL,
  challenge_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(challenge_hash) = 32),
  nonce_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(nonce_hash) = 32),
  server_nonce_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(server_nonce_hash) = 32),
  capability_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(capability_hash) = 32),
  server_id TEXT NOT NULL,
  protocol_version INTEGER NOT NULL CHECK (protocol_version = 1),
  audience TEXT NOT NULL,
  host_generation BIGINT NOT NULL CHECK (host_generation > 0),
  proof_expires_at TIMESTAMPTZ NOT NULL,
  proof_used_at TIMESTAMPTZ,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  state TEXT NOT NULL CHECK (state IN ('challenge_issued','proof_verified','pending_approval','approved','rejected','cancelled','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  decision_reason_code TEXT CHECK (decision_reason_code IN ('not_recognized','request_cancelled','policy','device_revoked'))
);
CREATE INDEX pairing_session_queue_idx ON pairing_session(organization_id, state, expires_at);
CREATE INDEX office_pairing_invitation_expiry_idx ON office_pairing_invitation(expires_at);

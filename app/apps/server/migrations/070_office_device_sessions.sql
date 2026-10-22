-- SPDX-License-Identifier: Apache-2.0
CREATE TABLE office_session_challenge (
 id UUID PRIMARY KEY,
 device_id UUID NOT NULL REFERENCES person_device(id) ON DELETE CASCADE,
 nonce_hash BYTEA NOT NULL CHECK(octet_length(nonce_hash)=32),
 server_id TEXT NOT NULL, host_generation BIGINT NOT NULL, audience TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX office_challenge_device ON office_session_challenge(device_id,expires_at);
CREATE TABLE office_device_session (
 id UUID PRIMARY KEY,
 device_id UUID NOT NULL REFERENCES person_device(id) ON DELETE CASCADE,
 pairing_id UUID NOT NULL REFERENCES pairing_session(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 token_hash BYTEA NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
 server_id TEXT NOT NULL, host_generation BIGINT NOT NULL, audience TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX office_session_device ON office_device_session(device_id);
-- Sessions never outlive a device/pairing. Live sockets are closed after the
-- application transaction commits via the existing authorization PubSub seam.
CREATE FUNCTION revoke_office_device_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE office_device_session SET revoked_at=COALESCE(revoked_at,now())
 WHERE device_id=NEW.id AND NEW.status<>'approved';
 RETURN NEW;
END $$;
CREATE TRIGGER office_device_session_revoke AFTER UPDATE OF status ON person_device
 FOR EACH ROW EXECUTE FUNCTION revoke_office_device_sessions();
-- PostgreSQL delivers NOTIFY only after commit. IDs are public identifiers,
-- never tokens. This also covers direct person/membership/session withdrawal.
CREATE FUNCTION notify_office_session_revoked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
  PERFORM pg_notify('office_session_revoked',NEW.id::text);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER office_session_revoked AFTER UPDATE OF revoked_at ON office_device_session
 FOR EACH ROW EXECUTE FUNCTION notify_office_session_revoked();
CREATE FUNCTION revoke_office_person_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='person_identity' THEN
  UPDATE office_device_session SET revoked_at=COALESCE(revoked_at,now())
  WHERE device_id IN (SELECT id FROM person_device WHERE person_id=NEW.id)
    AND (NEW.disabled_at IS NOT NULL OR NEW.linked_user_id IS DISTINCT FROM OLD.linked_user_id);
 ELSE
  UPDATE office_device_session SET revoked_at=COALESCE(revoked_at,now())
  WHERE organization_id=NEW.organization_id AND user_id=NEW.user_id AND NEW.status<>'active';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER office_person_sessions_revoke AFTER UPDATE OF disabled_at,linked_user_id ON person_identity
 FOR EACH ROW EXECUTE FUNCTION revoke_office_person_sessions();
CREATE TRIGGER office_membership_sessions_revoke AFTER UPDATE OF status ON office_person_membership
 FOR EACH ROW EXECUTE FUNCTION revoke_office_person_sessions();
CREATE FUNCTION revoke_office_member_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected_org TEXT; affected_user TEXT;
BEGIN
 IF TG_TABLE_NAME='member' THEN
  affected_org=OLD."organizationId"; affected_user=OLD."userId";
  IF TG_OP='UPDATE' AND NEW.role IN ('owner','admin','member') AND NEW."organizationId"=OLD."organizationId" AND NEW."userId"=OLD."userId" THEN RETURN NEW; END IF;
 ELSE affected_org=OLD.organization_id; affected_user=OLD.user_id;
 END IF;
 UPDATE office_device_session SET revoked_at=COALESCE(revoked_at,now())
 WHERE organization_id=affected_org AND user_id=affected_user;
 RETURN OLD;
END $$;
CREATE TRIGGER office_member_session_delete BEFORE DELETE ON member
 FOR EACH ROW EXECUTE FUNCTION revoke_office_member_sessions();
CREATE TRIGGER office_member_session_update AFTER UPDATE OF role,"organizationId","userId" ON member
 FOR EACH ROW EXECUTE FUNCTION revoke_office_member_sessions();
CREATE TRIGGER office_membership_session_delete BEFORE DELETE ON office_person_membership
 FOR EACH ROW EXECUTE FUNCTION revoke_office_member_sessions();

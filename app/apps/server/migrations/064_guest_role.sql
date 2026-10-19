-- SPDX-License-Identifier: Apache-2.0
-- Existing memberships/snapshots stay unchanged. Guests never receive a default.
CREATE OR REPLACE FUNCTION initialize_member_access_snapshot() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE selected_mode TEXT; selected_revision BIGINT;
BEGIN
  IF NEW.role NOT IN ('member','admin') THEN RETURN NEW; END IF;
  INSERT INTO organization_access_settings (organization_id) VALUES (NEW."organizationId") ON CONFLICT DO NOTHING;
  SELECT join_default,access_revision INTO selected_mode,selected_revision
    FROM organization_access_settings WHERE organization_id=NEW."organizationId" FOR SHARE;
  INSERT INTO member_access_snapshots (organization_id,user_id,mode,access_revision,snapshot_at)
    VALUES (NEW."organizationId",NEW."userId",selected_mode,selected_revision,NEW."createdAt") ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TABLE invitation_shares (
  invitation_id TEXT NOT NULL REFERENCES invitation (id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('folder','file')),
  resource_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('view','edit')),
  PRIMARY KEY (invitation_id,resource_type,resource_id)
);

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

-- Triggers cover Better Auth's independent pool as well as HTTP/MCP writes.
-- SET LOCAL is installed by AuditClient; missing context is a system operation.
CREATE FUNCTION record_access_mutation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  previous JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END;
  current JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END;
  item JSONB := COALESCE(current, previous);
  context JSONB := COALESCE(NULLIF(current_setting('infinite_brain.audit', true), ''), '{}')::jsonb;
  org TEXT;
  kind TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND previous = current THEN RETURN NEW; END IF;
  org := COALESCE(item->>'org_id', item->>'organization_id', item->>'organizationId');
  IF TG_TABLE_NAME = 'invitation_access' THEN
    SELECT "organizationId" INTO org FROM invitation WHERE id = item->>'invitation_id';
  END IF;
  kind := CASE WHEN TG_TABLE_NAME = 'shares' THEN 'share'
    WHEN TG_TABLE_NAME = 'member' THEN 'membership'
    WHEN TG_TABLE_NAME = 'public_links' THEN 'public_link'
    WHEN TG_TABLE_NAME IN ('mcp_tokens', 'mcp_oauth_vault') THEN 'ai_connection'
    WHEN TG_TABLE_NAME = 'org_join_codes' THEN 'join_code'
    WHEN TG_TABLE_NAME = 'organization_access_settings' THEN 'access_settings'
    ELSE 'invitation' END;
  -- Connection activity counters are not security changes.
  IF TG_TABLE_NAME IN ('mcp_tokens', 'mcp_oauth_vault') AND TG_OP = 'UPDATE'
     AND (previous - ARRAY['last_used_at','last_client','use_count']) =
         (current - ARRAY['last_used_at','last_client','use_count']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'organization_access_settings' AND TG_OP = 'UPDATE'
     AND (previous - ARRAY['access_revision','updated_at']) =
         (current - ARRAY['access_revision','updated_at']) THEN RETURN NEW; END IF;
  INSERT INTO audit_log (organization_id, actor_user_id, actor_kind, action, target_type,
    target_id, before, after, result, request_id)
  VALUES (org, context->>'actorUserId',
    CASE WHEN context->>'actorUserId' IS NULL THEN 'system'
      WHEN context->>'actorKind' = 'mcp' THEN 'mcp' ELSE 'user' END,
    kind || '.' || lower(TG_OP), kind, COALESCE(item->>'id', item->>'userId', org),
    previous - ARRAY['token','token_hash','token_prefix','code','generation'],
    current - ARRAY['token','token_hash','token_prefix','code','generation'],
    'ok', context->>'requestId');
  RETURN COALESCE(NEW, OLD);
END;
$$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['shares','member','invitation','invitation_access',
    'public_links','mcp_tokens','mcp_oauth_vault','org_join_codes','organization_access_settings'] LOOP
    EXECUTE format('CREATE TRIGGER audit_access_write AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION record_access_mutation()', t);
  END LOOP;
END $$;

-- Keep orphan grants, but make their number visible without changing old rows.
INSERT INTO audit_log (organization_id, actor_kind, action, target_type, target_id, after, result)
SELECT s.org_id, 'system', 'migration.orphan_user_shares', 'vault', s.org_id,
  jsonb_build_object('count', count(*)), 'ok'
FROM shares s WHERE principal_type = 'user' AND NOT EXISTS (
  SELECT 1 FROM member m WHERE m."organizationId" = s.org_id AND m."userId" = s.principal_id
    AND m.role IN ('owner','admin','member','guest'))
GROUP BY s.org_id;

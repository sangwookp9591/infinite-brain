-- SPDX-License-Identifier: Apache-2.0
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS scopes text NOT NULL
  DEFAULT 'notes:read notes:write notes:delete access:manage';
ALTER TABLE mcp_oauth_vault ADD COLUMN IF NOT EXISTS scopes text;
ALTER TABLE mcp_oauth_vault ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
ALTER TABLE mcp_oauth_vault ADD COLUMN IF NOT EXISTS last_client text;
ALTER TABLE mcp_oauth_vault ADD COLUMN IF NOT EXISTS use_count integer NOT NULL DEFAULT 0;

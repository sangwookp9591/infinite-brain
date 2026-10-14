-- SPDX-License-Identifier: Apache-2.0
-- Keep existing explicit grants; new token rows default to content read/write.
ALTER TABLE mcp_tokens ALTER COLUMN scopes SET DEFAULT 'notes:read notes:write';

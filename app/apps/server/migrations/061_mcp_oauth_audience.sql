-- SPDX-License-Identifier: Apache-2.0
-- Random generations prevent delete/reconnect ABA, including in-flight exchanges.
ALTER TABLE mcp_oauth_vault ADD COLUMN generation text NOT NULL DEFAULT gen_random_uuid()::text;
-- NULL legacy OAuth tokens are intentionally unusable: their audience is unknowable.
ALTER TABLE "oauthAccessToken" ADD COLUMN resource text;
ALTER TABLE "oauthAccessToken" ADD COLUMN generation text;
-- Existing manual tokens are explicitly local credentials; new ones bind the public URL.
ALTER TABLE mcp_tokens ADD COLUMN resource text;

-- SPDX-License-Identifier: Apache-2.0
ALTER TABLE organization_access_settings ADD COLUMN external_sharing TEXT NOT NULL DEFAULT 'on'
  CHECK (external_sharing IN ('off','domains','on'));
ALTER TABLE organization_access_settings ADD COLUMN external_domains TEXT[] NOT NULL DEFAULT '{}';

-- Console SQL Migration v1.13: repair runtime service-client grants for integration access.
-- Date: 2026-05-18
-- Purpose:
--   Codocs consumes OSS/GitLab/WeCom/AI integrations through Console integration-config
--   and credential-vault adapters. Existing local service clients created before v1.10/v1.11
--   may only have system_settings/workflow grants, causing bootstrap token issuance to fail
--   with insufficient_scope: integration_config:view.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `service_client_grants` (
  `service_client_id`,
  `resource_code`,
  `action`,
  `scope_json`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  'integration_config',
  'view',
  JSON_OBJECT('integrationCodes', JSON_ARRAY('gitlab.default', 'wecom.default', 'ai.default', 'oss.default')),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `app_code` IN ('aims', 'codocs')
   OR `client_code` IN ('aims', 'aims.runtime', 'codocs', 'codocs.runtime')
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

INSERT INTO `service_client_grants` (
  `service_client_id`,
  `resource_code`,
  `action`,
  `scope_json`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  'credential_vault',
  'resolve',
  JSON_OBJECT('usageTypes', JSON_ARRAY('integration'), 'integrationCodes', JSON_ARRAY('gitlab.default', 'wecom.default', 'ai.default', 'oss.default')),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `app_code` IN ('aims', 'codocs')
   OR `client_code` IN ('aims', 'aims.runtime', 'codocs', 'codocs.runtime')
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

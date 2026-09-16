-- Console SQL Seed v1.55: Codocs runtime OSS integration grants.
-- Date: 2026-07-12
-- Purpose:
--   Allow Codocs to read and write document bodies through the Console-managed
--   oss.default integration. The integrationCodes scope is mandatory and must
--   be present on both the configuration read and credential resolve grants.

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
  sc.`id`,
  'integration_config',
  'view',
  JSON_OBJECT(
    'source', 'seed:v1.55',
    'purpose', 'codocs-document-storage',
    'integrationCodes', JSON_ARRAY('oss.default')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`app_code` = 'codocs'
   OR sc.`client_code` IN ('codocs', 'codocs.runtime')
ON DUPLICATE KEY UPDATE
  `scope_json` = JSON_OBJECT(
    'source', 'seed:v1.55',
    'purpose', 'codocs-document-storage',
    'integrationCodes', JSON_ARRAY('oss.default')
  ),
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
  sc.`id`,
  'credential_vault',
  'resolve',
  JSON_OBJECT(
    'source', 'seed:v1.55',
    'purpose', 'codocs-document-storage',
    'usageTypes', JSON_ARRAY('integration'),
    'integrationCodes', JSON_ARRAY('oss.default')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`app_code` = 'codocs'
   OR sc.`client_code` IN ('codocs', 'codocs.runtime')
ON DUPLICATE KEY UPDATE
  `scope_json` = JSON_OBJECT(
    'source', 'seed:v1.55',
    'purpose', 'codocs-document-storage',
    'usageTypes', JSON_ARRAY('integration'),
    'integrationCodes', JSON_ARRAY('oss.default')
  ),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

SELECT
  sc.`client_code`,
  scg.`resource_code`,
  scg.`action`,
  scg.`scope_json`,
  scg.`status`
FROM `service_clients` sc
INNER JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE (sc.`app_code` = 'codocs' OR sc.`client_code` IN ('codocs', 'codocs.runtime'))
  AND scg.`resource_code` IN ('integration_config', 'credential_vault')
ORDER BY sc.`client_code`, scg.`resource_code`;

-- Console SQL Seed v1.28: Finance runtime OSS integration grants.
-- Date: 2026-06-19
-- Purpose:
--   Allow Finance runtime to upload invoice PDF/OFD files through the
--   Console-managed oss.default integration.
--
-- Grants:
--   audience=integration_config, scope=integration_config:view
--   audience=credential_vault, scope=credential_vault:resolve

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
    'source', 'seed:v1.28',
    'purpose', 'finance-invoice-file-upload',
    'integrationCodes', JSON_ARRAY('oss.default')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`app_code` = 'finance'
   OR sc.`client_code` IN ('finance', 'finance.runtime')
ON DUPLICATE KEY UPDATE
  `scope_json` = JSON_OBJECT(
    'source', 'seed:v1.28',
    'purpose', 'finance-invoice-file-upload',
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
    'source', 'seed:v1.28',
    'purpose', 'finance-invoice-file-upload',
    'usageTypes', JSON_ARRAY('integration'),
    'integrationCodes', JSON_ARRAY('oss.default')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`app_code` = 'finance'
   OR sc.`client_code` IN ('finance', 'finance.runtime')
ON DUPLICATE KEY UPDATE
  `scope_json` = JSON_OBJECT(
    'source', 'seed:v1.28',
    'purpose', 'finance-invoice-file-upload',
    'usageTypes', JSON_ARRAY('integration'),
    'integrationCodes', JSON_ARRAY('oss.default')
  ),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status` AS `client_status`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  MAX(scg.`resource_code` = 'integration_config' AND scg.`action` = 'view' AND scg.`status` = 'active') AS `has_integration_config_view`,
  MAX(scg.`resource_code` = 'credential_vault' AND scg.`action` = 'resolve' AND scg.`status` = 'active') AS `has_credential_vault_resolve`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` = 'finance'
   OR sc.`client_code` IN ('finance', 'finance.runtime')
GROUP BY sc.`client_code`, sc.`app_code`, sc.`status`, scc.`client_id`, scc.`status`
ORDER BY sc.`client_code`;

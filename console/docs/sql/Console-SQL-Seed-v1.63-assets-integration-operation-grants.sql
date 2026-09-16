-- Console SQL Seed v1.63: Assets integration-operation runtime grants.
-- Date: 2026-07-13
--
-- The Assets administration BFF requests exact view/replay scopes in addition
-- to its ordinary transport scope. Install both supported runtime audiences.

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
  grants.`resource_code`,
  grants.`action`,
  JSON_OBJECT(
    'source', 'seed:v1.63',
    'semanticScope', CONCAT(grants.`resource_code`, ':', grants.`action`),
    'purpose', 'assets-integration-operation-administration'
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  SELECT 'data-runtime:assets:integration_operations' AS `resource_code`, 'view' AS `action`
  UNION ALL SELECT 'data-runtime:assets:integration_operations', 'replay'
  UNION ALL SELECT 'tenant-runtime:assets:integration_operations', 'view'
  UNION ALL SELECT 'tenant-runtime:assets:integration_operations', 'replay'
) grants
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'assets' OR sc.`client_code` IN ('assets', 'assets.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

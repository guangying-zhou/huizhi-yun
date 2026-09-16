-- Console SQL Seed v1.66: Aims and Altoc integration-operation runtime grants.
-- Date: 2026-07-14
--
-- The Aims and Altoc administration BFFs first enforce tenant-global browser
-- authorization, then request short-lived view/replay scopes for data-runtime.
-- Install both supported runtime audiences without granting browser roles.

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
    'source', 'seed:v1.66',
    'semanticScope', CONCAT(grants.`resource_code`, ':', grants.`action`),
    'purpose', CONCAT(grants.`app_code`, '-integration-operation-administration')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  SELECT 'aims' AS `app_code`, 'data-runtime:aims:integration_operations' AS `resource_code`, 'view' AS `action`
  UNION ALL SELECT 'aims', 'data-runtime:aims:integration_operations', 'replay'
  UNION ALL SELECT 'aims', 'tenant-runtime:aims:integration_operations', 'view'
  UNION ALL SELECT 'aims', 'tenant-runtime:aims:integration_operations', 'replay'
  UNION ALL SELECT 'altoc', 'data-runtime:altoc:integration_operations', 'view'
  UNION ALL SELECT 'altoc', 'data-runtime:altoc:integration_operations', 'replay'
  UNION ALL SELECT 'altoc', 'tenant-runtime:altoc:integration_operations', 'view'
  UNION ALL SELECT 'altoc', 'tenant-runtime:altoc:integration_operations', 'replay'
) grants
  ON grants.`app_code` = sc.`app_code`
  OR sc.`client_code` IN (grants.`app_code`, CONCAT(grants.`app_code`, '.runtime'))
WHERE sc.`status` = 'active'
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

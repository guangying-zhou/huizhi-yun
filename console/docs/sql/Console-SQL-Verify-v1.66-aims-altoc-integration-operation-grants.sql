-- Console SQL Verify v1.66: Aims and Altoc integration-operation grants.
-- Date: 2026-07-14

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`id` AS `service_client_id`,
  sc.`app_code`,
  sc.`client_code`,
  CONCAT(g.`resource_code`, ':', g.`action`) AS `scope`,
  g.`status`,
  g.`scope_json`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND sc.`app_code` IN ('aims', 'altoc')
  AND g.`resource_code` IN (
    'data-runtime:aims:integration_operations',
    'tenant-runtime:aims:integration_operations',
    'data-runtime:altoc:integration_operations',
    'tenant-runtime:altoc:integration_operations'
  )
ORDER BY sc.`app_code`, sc.`id`, `scope`;

SELECT
  sc.`client_code`,
  COUNT(*) AS `active_integration_operation_grants`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND sc.`app_code` IN ('aims', 'altoc')
  AND g.`status` = 'active'
  AND g.`resource_code` IN (
    CONCAT('data-runtime:', sc.`app_code`, ':integration_operations'),
    CONCAT('tenant-runtime:', sc.`app_code`, ':integration_operations')
  )
GROUP BY sc.`id`, sc.`client_code`
HAVING COUNT(*) = 4;

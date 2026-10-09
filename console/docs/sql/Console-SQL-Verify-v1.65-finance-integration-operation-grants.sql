-- Console SQL Verify v1.65: Finance integration-operation runtime grants.
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
LEFT JOIN `service_client_grants` g
  ON g.`service_client_id` = sc.`id`
 AND g.`resource_code` IN (
   'data-runtime:finance:integration_operations',
   'tenant-runtime:finance:integration_operations'
 )
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'finance' OR sc.`client_code` IN ('finance', 'finance.runtime'))
ORDER BY sc.`id`, `scope`;

SELECT
  sc.`client_code`,
  COUNT(*) AS `active_integration_operation_grants`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'finance' OR sc.`client_code` IN ('finance', 'finance.runtime'))
  AND g.`status` = 'active'
  AND g.`resource_code` IN (
    'data-runtime:finance:integration_operations',
    'tenant-runtime:finance:integration_operations'
  )
GROUP BY sc.`client_code`
HAVING COUNT(*) = 4;

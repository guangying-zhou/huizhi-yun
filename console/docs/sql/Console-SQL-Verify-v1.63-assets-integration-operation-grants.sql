-- Console SQL Verify v1.63: Assets integration-operation runtime grants.
-- Date: 2026-07-13

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
   'data-runtime:assets:integration_operations',
   'tenant-runtime:assets:integration_operations'
 )
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'assets' OR sc.`client_code` IN ('assets', 'assets.runtime'))
ORDER BY sc.`id`, `scope`;

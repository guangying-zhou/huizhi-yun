-- Console SQL Verify v1.57: Aims runtime service-client grants.
-- Date: 2026-07-13
--
-- Expected: every active Aims service client has exactly four active rows:
-- data-runtime:aims read/write and tenant-runtime:aims read/write.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`id` AS `service_client_id`,
  sc.`app_code`,
  sc.`client_code`,
  sc.`current_credential_id`,
  CONCAT(g.`resource_code`, ':', g.`action`) AS `scope`,
  g.`status`,
  g.`scope_json`
FROM `service_clients` sc
LEFT JOIN `service_client_grants` g
  ON g.`service_client_id` = sc.`id`
 AND g.`resource_code` IN ('data-runtime:aims', 'tenant-runtime:aims')
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
ORDER BY sc.`id`, `scope`;

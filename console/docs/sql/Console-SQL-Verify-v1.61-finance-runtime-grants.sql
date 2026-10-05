-- Console SQL Verify v1.61: Finance tenant-runtime transport grants.
-- Date: 2026-07-13
--
-- Expected: every active Finance service client has both data-runtime and
-- tenant-runtime variants for the server-owned Finance runtime scopes.

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
 AND (
   g.`resource_code` = 'data-runtime:finance'
   OR g.`resource_code` LIKE 'data-runtime:finance:%'
   OR g.`resource_code` = 'tenant-runtime:finance'
   OR g.`resource_code` LIKE 'tenant-runtime:finance:%'
 )
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'finance' OR sc.`client_code` IN ('finance', 'finance.runtime'))
ORDER BY sc.`id`, `scope`;

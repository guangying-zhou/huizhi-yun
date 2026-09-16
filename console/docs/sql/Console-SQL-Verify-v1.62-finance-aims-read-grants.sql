-- Console SQL Verify v1.62: Finance -> Aims tenant-runtime read grants.
-- Date: 2026-07-13
--
-- Expected: every active Finance service client has active read grants for
-- data-runtime:aims and tenant-runtime:aims, and no Aims write grant is added.

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
 AND g.`resource_code` IN ('data-runtime:aims', 'tenant-runtime:aims')
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'finance' OR sc.`client_code` IN ('finance', 'finance.runtime'))
ORDER BY sc.`id`, `scope`;

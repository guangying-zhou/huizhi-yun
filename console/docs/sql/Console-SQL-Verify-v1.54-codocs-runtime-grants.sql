-- Console SQL Verify v1.54: Codocs runtime service-client grants.
-- Date: 2026-07-12
--
-- Expected: every active Codocs service client has exactly four active rows:
-- data-runtime:codocs read/write and tenant-runtime:codocs read/write.

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
 AND g.`resource_code` IN ('data-runtime:codocs', 'tenant-runtime:codocs')
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'codocs' OR sc.`client_code` IN ('codocs', 'codocs.runtime'))
ORDER BY sc.`id`, `scope`;

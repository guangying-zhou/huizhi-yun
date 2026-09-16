-- Console SQL Verify v1.92: Aims, Altoc, and Assets integration-operation worker grants.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  CONCAT(g.`resource_code`, ':', g.`action`) AS `scope`,
  g.`status`,
  JSON_UNQUOTE(JSON_EXTRACT(g.`scope_json`, '$.purpose')) AS `purpose`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND sc.`app_code` IN ('aims', 'altoc', 'assets')
  AND g.`resource_code` IN (
    'data-runtime:aims:integration_operation',
    'tenant-runtime:aims:integration_operation',
    'data-runtime:altoc:integration_operation',
    'tenant-runtime:altoc:integration_operation',
    'data-runtime:assets:integration_operation',
    'tenant-runtime:assets:integration_operation'
  )
  AND g.`action` = 'execute'
ORDER BY sc.`app_code`, sc.`client_code`, g.`resource_code`;

SELECT
  sc.`client_code`,
  COUNT(*) AS `active_worker_grants`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND sc.`app_code` IN ('aims', 'altoc', 'assets')
  AND g.`status` = 'active'
  AND g.`resource_code` IN (
    CONCAT('data-runtime:', sc.`app_code`, ':integration_operation'),
    CONCAT('tenant-runtime:', sc.`app_code`, ':integration_operation')
  )
  AND g.`action` = 'execute'
GROUP BY sc.`id`, sc.`client_code`
HAVING COUNT(*) = 2;

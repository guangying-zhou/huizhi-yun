-- Console SQL Verify v1.58: Altoc tenant-runtime grants.
-- Expected for each active Altoc runtime client:
--   88 rows total (44 semantic scopes x 2 audiences), with no inactive row.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`id` AS `service_client_id`,
  sc.`client_code`,
  sc.`app_code`,
  COUNT(*) AS `grant_count`,
  SUM(g.`status` <> 'active') AS `inactive_count`,
  SUM(g.`resource_code` = 'data-runtime:altoc' AND g.`action` = 'read') AS `data_runtime_read`,
  SUM(g.`resource_code` = 'data-runtime:altoc:dashboard' AND g.`action` = 'view') AS `data_runtime_dashboard_view`,
  SUM(g.`resource_code` = 'tenant-runtime:altoc' AND g.`action` = 'read') AS `tenant_runtime_read`,
  SUM(g.`resource_code` = 'tenant-runtime:altoc:dashboard' AND g.`action` = 'view') AS `tenant_runtime_dashboard_view`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g
  ON g.`service_client_id` = sc.`id`
 AND (
   g.`resource_code` LIKE 'data-runtime:altoc%'
   OR g.`resource_code` LIKE 'tenant-runtime:altoc%'
 )
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'altoc' OR sc.`client_code` IN ('altoc', 'altoc.runtime'))
GROUP BY sc.`id`, sc.`client_code`, sc.`app_code`
ORDER BY sc.`id`;

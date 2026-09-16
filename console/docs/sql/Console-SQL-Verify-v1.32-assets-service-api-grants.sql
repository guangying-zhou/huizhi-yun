-- Console SQL Verify v1.32: Assets service API grants.
-- Usage: run in hzy_console after Console-SQL-Seed-v1.32-assets-service-api-grants.sql.
--
-- Expected:
--   aims service client:
--     credential_status = active
--     has_assets_read = 1
--     has_assets_write = 1
--   altoc service client:
--     credential_status = active
--     has_assets_read = 1
--     has_assets_write = 1
--   finance service client:
--     credential_status = active
--     has_assets_read = 1

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status` AS `client_status`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  MAX(scg.`resource_code` = 'assets' AND scg.`action` = 'read' AND scg.`status` = 'active') AS `has_assets_read`,
  MAX(scg.`resource_code` = 'assets' AND scg.`action` = 'write' AND scg.`status` = 'active') AS `has_assets_write`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` IN ('aims', 'altoc', 'finance')
   OR sc.`client_code` IN ('aims', 'aims.runtime', 'altoc', 'altoc.runtime', 'finance', 'finance.runtime')
GROUP BY
  sc.`client_code`,
  sc.`app_code`,
  sc.`status`,
  scc.`client_id`,
  scc.`status`
ORDER BY sc.`app_code`, sc.`client_code`;

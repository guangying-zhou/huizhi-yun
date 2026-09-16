-- Console SQL Verify v1.33: Altoc -> Aims/Codocs service API grants.
-- Usage: run in hzy_console after Console-SQL-Seed-v1.33-altoc-aims-codocs-service-grants.sql.
--
-- Expected:
--   altoc service client:
--     credential_status = active
--     has_aims_read = 1
--     has_aims_write = 1
--     has_codocs_documents_write = 1

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status` AS `client_status`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  MAX(scg.`resource_code` = 'aims' AND scg.`action` = 'read' AND scg.`status` = 'active') AS `has_aims_read`,
  MAX(scg.`resource_code` = 'aims' AND scg.`action` = 'write' AND scg.`status` = 'active') AS `has_aims_write`,
  MAX(scg.`resource_code` = 'codocs:documents' AND scg.`action` = 'write' AND scg.`status` = 'active') AS `has_codocs_documents_write`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` = 'altoc'
   OR sc.`client_code` IN ('altoc', 'altoc.runtime')
GROUP BY
  sc.`client_code`,
  sc.`app_code`,
  sc.`status`,
  scc.`client_id`,
  scc.`status`
ORDER BY sc.`client_code`;

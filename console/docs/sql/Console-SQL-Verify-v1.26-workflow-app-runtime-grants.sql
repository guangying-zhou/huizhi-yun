-- Console SQL Verify v1.26: Workflow app runtime clients and grants.
-- Usage: run in hzy_console after Console-SQL-Seed-v1.26-workflow-app-runtime-grants.sql.
--
-- Expected:
--   codocs/aims/altoc/assets/finance/people each has:
--     credential_status = active
--     has_workflow_proxy = 1
--     has_action_defs_sync = 1

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  MAX(scg.`resource_code` = 'workflow' AND scg.`action` = 'proxy' AND scg.`status` = 'active') AS `has_workflow_proxy`,
  MAX(scg.`resource_code` = 'workflow:action_defs' AND scg.`action` = 'sync' AND scg.`status` = 'active') AS `has_action_defs_sync`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` IN ('codocs', 'aims', 'altoc', 'assets', 'finance', 'people')
   OR sc.`client_code` IN (
     'codocs.runtime',
     'aims.runtime',
     'altoc.runtime',
     'assets.runtime',
     'finance.runtime',
     'people.runtime'
   )
GROUP BY sc.`client_code`, sc.`app_code`, sc.`status`, scc.`client_id`, scc.`status`
ORDER BY sc.`app_code`, sc.`client_code`;

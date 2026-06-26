-- Console SQL Verify v1.31: Altoc service command callback grants.
-- Usage: run in hzy_console after Console-SQL-Seed-v1.31-altoc-service-command-grants.sql.
--
-- Expected:
--   aims service client:
--     credential_status = active
--     has_altoc_write = 1
--     has_altoc_receivable_mark_billable = 1
--     has_altoc_service_ticket_delivery_result_sync = 1
--   finance service client:
--     credential_status = active
--     has_altoc_read = 1
--     has_altoc_write = 1
--     has_altoc_contract_finance_summary_sync = 1

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status` AS `client_status`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  MAX(scg.`resource_code` = 'altoc' AND scg.`action` = 'write' AND scg.`status` = 'active') AS `has_altoc_write`,
  MAX(scg.`resource_code` = 'altoc' AND scg.`action` = 'read' AND scg.`status` = 'active') AS `has_altoc_read`,
  MAX(scg.`resource_code` = 'altoc:receivable' AND scg.`action` = 'mark-billable' AND scg.`status` = 'active') AS `has_altoc_receivable_mark_billable`,
  MAX(scg.`resource_code` = 'altoc:service_ticket:delivery-result' AND scg.`action` = 'sync' AND scg.`status` = 'active') AS `has_altoc_service_ticket_delivery_result_sync`,
  MAX(scg.`resource_code` = 'altoc:contract:finance-summary' AND scg.`action` = 'sync' AND scg.`status` = 'active') AS `has_altoc_contract_finance_summary_sync`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` IN ('aims', 'finance')
   OR sc.`client_code` IN ('aims', 'aims.runtime', 'finance', 'finance.runtime')
GROUP BY
  sc.`client_code`,
  sc.`app_code`,
  sc.`status`,
  scc.`client_id`,
  scc.`status`
ORDER BY sc.`app_code`, sc.`client_code`;

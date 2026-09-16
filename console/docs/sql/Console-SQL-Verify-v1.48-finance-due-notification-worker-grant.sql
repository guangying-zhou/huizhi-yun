-- Verification companion for Console SQL Seed v1.48.
SELECT
  sc.`client_code`,
  sc.`app_code`,
  MAX(
    scg.`resource_code` = 'data-runtime:finance:notifications_due'
    AND scg.`action` = 'execute'
    AND scg.`status` = 'active'
    AND JSON_UNQUOTE(JSON_EXTRACT(scg.`scope_json`, '$.purpose')) = 'finance-due-notification-worker'
  ) AS `has_finance_due_notification_worker_grant`
FROM `service_clients` sc
LEFT JOIN `service_client_grants` scg ON scg.`service_client_id` = sc.`id`
WHERE sc.`client_code` = 'finance.runtime'
  AND sc.`app_code` = 'finance'
GROUP BY sc.`client_code`, sc.`app_code`;

-- Console SQL Verify v1.64: People operation runtime grants.

SELECT
  sc.`client_code`,
  g.`resource_code`,
  g.`action`,
  g.`status`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'people' OR sc.`client_code` IN ('people', 'people.runtime'))
  AND g.`resource_code` IN (
    'data-runtime:people:offboarding_tasks',
    'data-runtime:people:integration_operations',
    'tenant-runtime:people:offboarding_tasks',
    'tenant-runtime:people:integration_operations'
  )
ORDER BY sc.`client_code`, g.`resource_code`, g.`action`;

SELECT
  sc.`client_code`,
  COUNT(*) AS `active_operation_grants`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'people' OR sc.`client_code` IN ('people', 'people.runtime'))
  AND g.`status` = 'active'
  AND g.`resource_code` IN (
    'data-runtime:people:offboarding_tasks',
    'data-runtime:people:integration_operations',
    'tenant-runtime:people:offboarding_tasks',
    'tenant-runtime:people:integration_operations'
  )
GROUP BY sc.`client_code`
HAVING COUNT(*) = 12;

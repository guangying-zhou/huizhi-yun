-- Console SQL Verify v1.86: People integration-operation worker grants.

SELECT
  sc.`client_code`,
  g.`resource_code`,
  g.`action`,
  g.`status`,
  JSON_UNQUOTE(JSON_EXTRACT(g.`scope_json`, '$.purpose')) AS `purpose`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'people' OR sc.`client_code` IN ('people', 'people.runtime'))
  AND g.`resource_code` IN (
    'data-runtime:people:integration_operation',
    'tenant-runtime:people:integration_operation'
  )
  AND g.`action` = 'execute'
ORDER BY sc.`client_code`, g.`resource_code`;

SELECT
  sc.`client_code`,
  COUNT(*) AS `active_worker_grants`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'people' OR sc.`client_code` IN ('people', 'people.runtime'))
  AND g.`status` = 'active'
  AND g.`resource_code` IN (
    'data-runtime:people:integration_operation',
    'tenant-runtime:people:integration_operation'
  )
  AND g.`action` = 'execute'
GROUP BY sc.`client_code`
HAVING COUNT(*) = 2;

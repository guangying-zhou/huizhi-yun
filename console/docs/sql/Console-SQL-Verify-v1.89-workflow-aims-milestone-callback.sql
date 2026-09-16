SELECT
  client.`client_code`,
  client.`app_code`,
  grant_row.`resource_code`,
  grant_row.`action`,
  grant_row.`scope_json`,
  grant_row.`status`
FROM `service_clients` client
INNER JOIN `service_client_grants` grant_row
  ON grant_row.`service_client_id` = client.`id`
WHERE client.`status` = 'active'
  AND (
    client.`app_code` = 'workflow'
    OR client.`client_code` IN ('workflow', 'workflow.runtime')
  )
  AND grant_row.`resource_code` = 'workflow'
  AND grant_row.`action` = 'callback'
ORDER BY client.`client_code`;

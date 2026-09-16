-- Console SQL Verify v1.87: project governance singleton role-holder reads.

SELECT
  client.`client_code`,
  client.`app_code`,
  client.`status` AS `client_status`,
  grant_row.`resource_code`,
  grant_row.`action`,
  grant_row.`status` AS `grant_status`,
  grant_row.`scope_json`
FROM `service_clients` client
LEFT JOIN `service_client_grants` grant_row
  ON grant_row.`service_client_id` = client.`id`
 AND grant_row.`resource_code` = 'console:authorization-role-holders'
 AND grant_row.`action` = 'read'
WHERE client.`status` = 'active'
  AND (
    client.`app_code` IN ('aims', 'workflow')
    OR client.`client_code` IN ('aims', 'aims.runtime', 'workflow', 'workflow.runtime')
  )
ORDER BY client.`client_code`;

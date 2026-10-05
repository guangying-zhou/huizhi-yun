-- Console SQL Verify v1.84: Runtime feedback setting grants.

SELECT
  service_client.`client_code`,
  service_client.`app_code`,
  service_client.`status` AS `client_status`,
  service_grant.`resource_code`,
  service_grant.`action`,
  service_grant.`status` AS `grant_status`,
  service_grant.`scope_json`
FROM `service_clients` service_client
LEFT JOIN `service_client_grants` service_grant
  ON service_grant.`service_client_id` = service_client.`id`
 AND service_grant.`resource_code` = 'system_settings'
 AND service_grant.`action` = 'view'
WHERE service_client.`status` = 'active'
  AND service_client.`app_code` IN (
    'aims',
    'altoc',
    'assets',
    'codocs',
    'finance',
    'people',
    'webdev',
    'workflow'
  )
ORDER BY service_client.`app_code`, service_client.`client_code`;

-- Expected: one active credential-backed People runtime row and has_fact_read = 1.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  client.`client_code`,
  client.`app_code`,
  client.`status` AS `client_status`,
  credential.`client_id`,
  credential.`status` AS `credential_status`,
  MAX(grant_row.`resource_code` = 'aims:project-management-facts'
      AND grant_row.`action` = 'read'
      AND grant_row.`status` = 'active') AS `has_fact_read`
FROM `service_clients` client
LEFT JOIN `service_client_credentials` credential
  ON credential.`id` = client.`current_credential_id`
LEFT JOIN `service_client_grants` grant_row
  ON grant_row.`service_client_id` = client.`id`
WHERE client.`app_code` = 'people'
  AND client.`client_code` IN ('people', 'people.runtime')
GROUP BY
  client.`client_code`,
  client.`app_code`,
  client.`status`,
  credential.`client_id`,
  credential.`status`;

-- Console SQL Verify v1.88: exact Aims runtime -> Codocs document-quality grants.
-- Expected: one active credential-backed aims.runtime row and all three flags = 1.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  client.`client_code`,
  client.`app_code`,
  client.`status` AS `client_status`,
  credential.`client_id`,
  credential.`status` AS `credential_status`,
  MAX(grant_row.`resource_code` = 'codocs:project-document:version'
      AND grant_row.`action` = 'resolve'
      AND grant_row.`status` = 'active') AS `has_version_resolve`,
  MAX(grant_row.`resource_code` = 'codocs:project-document:review-grant'
      AND grant_row.`action` = 'create'
      AND grant_row.`status` = 'active') AS `has_review_grant_create`,
  MAX(grant_row.`resource_code` = 'codocs:project-document:review-content'
      AND grant_row.`action` = 'read'
      AND grant_row.`status` = 'active') AS `has_review_content_read`
FROM `service_clients` client
LEFT JOIN `service_client_credentials` credential
  ON credential.`id` = client.`current_credential_id`
LEFT JOIN `service_client_grants` grant_row
  ON grant_row.`service_client_id` = client.`id`
WHERE client.`app_code` = 'aims'
  AND client.`client_code` = 'aims.runtime'
GROUP BY
  client.`client_code`,
  client.`app_code`,
  client.`status`,
  credential.`client_id`,
  credential.`status`;

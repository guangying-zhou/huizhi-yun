-- Console SQL Verify v1.58: audience-qualified Runtime integration grants.
-- Date: 2026-07-18
--
-- Expected: each active semantic integration/Vault grant has matching active
-- data-runtime and tenant-runtime grants with the same scope policy.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  service_client.`id` AS `service_client_id`,
  service_client.`client_code`,
  service_client.`app_code`,
  CONCAT(source_grant.`resource_code`, ':', source_grant.`action`) AS `semantic_scope`,
  qualified.`runtime_scope`,
  qualified.`status`,
  IF(qualified.`scope_json` <=> source_grant.`scope_json`, 'yes', 'no') AS `policy_matches`
FROM `service_clients` service_client
JOIN `service_client_grants` source_grant
  ON source_grant.`service_client_id` = service_client.`id`
 AND source_grant.`status` = 'active'
JOIN (
  SELECT
    grant_row.`service_client_id`,
    CONCAT(grant_row.`resource_code`, ':', grant_row.`action`) AS `runtime_scope`,
    grant_row.`resource_code`,
    grant_row.`action`,
    grant_row.`status`,
    grant_row.`scope_json`
  FROM `service_client_grants` grant_row
  WHERE grant_row.`resource_code` IN (
    'data-runtime:integration_config',
    'tenant-runtime:integration_config',
    'data-runtime:credential_vault',
    'tenant-runtime:credential_vault'
  )
) qualified
  ON qualified.`service_client_id` = source_grant.`service_client_id`
 AND qualified.`action` = source_grant.`action`
 AND qualified.`resource_code` IN (
   CONCAT('data-runtime:', source_grant.`resource_code`),
   CONCAT('tenant-runtime:', source_grant.`resource_code`)
 )
WHERE service_client.`status` = 'active'
  AND (
    (source_grant.`resource_code` = 'integration_config' AND source_grant.`action` = 'view')
    OR
    (source_grant.`resource_code` = 'credential_vault' AND source_grant.`action` = 'resolve')
  )
ORDER BY service_client.`id`, source_grant.`resource_code`, qualified.`resource_code`;

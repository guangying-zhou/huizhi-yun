-- Console SQL Seed v1.58: audience-qualified Runtime integration grants.
-- Date: 2026-07-18
--
-- Foundation requests integration and Vault capabilities from the tenant
-- Runtime with an audience-qualified scope. Keep the existing semantic grants
-- for the Console adapters, and mirror them for both supported Runtime
-- audience names so token issuance and adapter authorization remain separate.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `service_client_grants` (
  `service_client_id`,
  `resource_code`,
  `action`,
  `scope_json`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  source_grant.`service_client_id`,
  CONCAT(runtime_audience.`audience`, ':', source_grant.`resource_code`),
  source_grant.`action`,
  source_grant.`scope_json`,
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_client_grants` source_grant
JOIN `service_clients` service_client
  ON service_client.`id` = source_grant.`service_client_id`
 AND service_client.`status` = 'active'
JOIN (
  SELECT 'data-runtime' AS `audience`
  UNION ALL
  SELECT 'tenant-runtime'
) runtime_audience
WHERE source_grant.`status` = 'active'
  AND (
    (source_grant.`resource_code` = 'integration_config' AND source_grant.`action` = 'view')
    OR
    (source_grant.`resource_code` = 'credential_vault' AND source_grant.`action` = 'resolve')
  )
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

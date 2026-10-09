-- Console SQL Seed v1.92: Aims, Altoc, and Assets integration-operation worker grants.
-- Date: 2026-07-26
--
-- Scheduled workers drain caller-owned integration operations through Tenant
-- Runtime. The singular integration_operation:execute capability is distinct
-- from the plural integration_operations:view/replay administration scopes.
-- Install the exact execute grant for both supported runtime audiences.

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
  sc.`id`,
  grants.`resource_code`,
  grants.`action`,
  JSON_OBJECT(
    'source', 'seed:v1.92',
    'semanticScope', CONCAT(grants.`resource_code`, ':', grants.`action`),
    'purpose', CONCAT(grants.`app_code`, '-integration-operation-worker')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  SELECT 'aims' AS `app_code`, 'data-runtime:aims:integration_operation' AS `resource_code`, 'execute' AS `action`
  UNION ALL SELECT 'aims', 'tenant-runtime:aims:integration_operation', 'execute'
  UNION ALL SELECT 'altoc', 'data-runtime:altoc:integration_operation', 'execute'
  UNION ALL SELECT 'altoc', 'tenant-runtime:altoc:integration_operation', 'execute'
  UNION ALL SELECT 'assets', 'data-runtime:assets:integration_operation', 'execute'
  UNION ALL SELECT 'assets', 'tenant-runtime:assets:integration_operation', 'execute'
) grants
  ON grants.`app_code` = sc.`app_code`
  OR sc.`client_code` IN (grants.`app_code`, CONCAT(grants.`app_code`, '.runtime'))
WHERE sc.`status` = 'active'
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

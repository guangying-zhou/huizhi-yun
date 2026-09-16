-- Console SQL Seed v1.86: People integration-operation worker grants.
-- Date: 2026-07-24
--
-- The trusted People scheduler drains caller-owned lifecycle operations through
-- Tenant Runtime. Install the exact execute scope for both supported runtime
-- audiences; this does not grant browser access.

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
    'source', 'seed:v1.86',
    'semanticScope', CONCAT(grants.`resource_code`, ':', grants.`action`),
    'purpose', 'people-integration-operation-worker'
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  SELECT 'data-runtime:people:integration_operation' AS `resource_code`, 'execute' AS `action`
  UNION ALL SELECT 'tenant-runtime:people:integration_operation', 'execute'
) grants
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'people' OR sc.`client_code` IN ('people', 'people.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

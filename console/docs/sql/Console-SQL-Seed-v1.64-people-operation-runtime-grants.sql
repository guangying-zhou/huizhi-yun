-- Console SQL Seed v1.64: People operation runtime grants.
-- Date: 2026-07-13
--
-- People checks browser authorization in its BFF before requesting these
-- short-lived service scopes. Install both supported runtime audiences.

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
    'source', 'seed:v1.64',
    'semanticScope', CONCAT(grants.`resource_code`, ':', grants.`action`),
    'purpose', 'people-operation-administration'
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  SELECT 'data-runtime:people:offboarding_tasks' AS `resource_code`, 'view' AS `action`
  UNION ALL SELECT 'data-runtime:people:offboarding_tasks', 'admin'
  UNION ALL SELECT 'data-runtime:people:offboarding_tasks', 'confirm'
  UNION ALL SELECT 'data-runtime:people:offboarding_tasks', 'cancel'
  UNION ALL SELECT 'data-runtime:people:integration_operations', 'view'
  UNION ALL SELECT 'data-runtime:people:integration_operations', 'replay'
  UNION ALL SELECT 'tenant-runtime:people:offboarding_tasks', 'view'
  UNION ALL SELECT 'tenant-runtime:people:offboarding_tasks', 'admin'
  UNION ALL SELECT 'tenant-runtime:people:offboarding_tasks', 'confirm'
  UNION ALL SELECT 'tenant-runtime:people:offboarding_tasks', 'cancel'
  UNION ALL SELECT 'tenant-runtime:people:integration_operations', 'view'
  UNION ALL SELECT 'tenant-runtime:people:integration_operations', 'replay'
) grants
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'people' OR sc.`client_code` IN ('people', 'people.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

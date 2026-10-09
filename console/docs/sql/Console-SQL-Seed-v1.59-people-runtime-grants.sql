-- Console SQL Seed v1.59: People tenant-runtime transport grants.
-- Date: 2026-07-13
--
-- People accesses tenant data through data-runtime with short-lived Console
-- service tokens. Install both audience prefixes supported by Foundation so
-- changing the configured runtime audience cannot silently remove access.

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
    'source', 'seed:v1.59',
    'semanticScope', grants.`semantic_scope`,
    'purpose', 'people-tenant-runtime'
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  SELECT 'data-runtime:people' AS `resource_code`, 'read' AS `action`, 'people.read' AS `semantic_scope`
  UNION ALL SELECT 'data-runtime:people', 'write', 'people.write'
  UNION ALL SELECT 'tenant-runtime:people', 'read', 'people.read'
  UNION ALL SELECT 'tenant-runtime:people', 'write', 'people.write'
) grants
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'people' OR sc.`client_code` IN ('people', 'people.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

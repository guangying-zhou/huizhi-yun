-- Console SQL Seed v1.54: Codocs runtime service-client grants.
-- Date: 2026-07-12
--
-- Codocs accesses its tenant data through data-runtime with short Console
-- service tokens. Install both audience prefixes supported by Foundation so a
-- deployment cannot lose access when switching between data-runtime and the
-- legacy tenant-runtime audience name.

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
  JSON_OBJECT('source', 'seed:v1.54', 'semanticScope', grants.`semantic_scope`),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  SELECT 'data-runtime:codocs' AS `resource_code`, 'read' AS `action`, 'codocs.read' AS `semantic_scope`
  UNION ALL SELECT 'data-runtime:codocs', 'write', 'codocs.write'
  UNION ALL SELECT 'tenant-runtime:codocs', 'read', 'codocs.read'
  UNION ALL SELECT 'tenant-runtime:codocs', 'write', 'codocs.write'
) grants
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'codocs' OR sc.`client_code` IN ('codocs', 'codocs.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

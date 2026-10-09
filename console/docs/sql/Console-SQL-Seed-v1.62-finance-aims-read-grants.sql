-- Console SQL Seed v1.62: Finance -> Aims tenant-runtime read grants.
-- Date: 2026-07-13
--
-- Finance project accounting uses Aims project facts as its project master.
-- Grant only the read action for the two tenant-runtime audience prefixes
-- supported by Foundation. No Aims write capability is granted to Finance.

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
  'read',
  JSON_OBJECT(
    'source', 'seed:v1.62',
    'semanticScope', 'aims.read',
    'purpose', 'finance-project-accounting-project-master'
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  SELECT 'data-runtime:aims' AS `resource_code`
  UNION ALL SELECT 'tenant-runtime:aims'
) grants
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'finance' OR sc.`client_code` IN ('finance', 'finance.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

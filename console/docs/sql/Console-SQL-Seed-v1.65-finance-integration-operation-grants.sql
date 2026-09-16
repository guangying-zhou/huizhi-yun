-- Console SQL Seed v1.65: Finance integration-operation runtime grants.
-- Date: 2026-07-14
--
-- The Finance administration BFF checks tenant-global browser authorization
-- before requesting these short-lived view/replay scopes. Install both
-- supported runtime audiences without granting any browser role directly.

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
    'source', 'seed:v1.65',
    'semanticScope', CONCAT(grants.`resource_code`, ':', grants.`action`),
    'purpose', 'finance-integration-operation-administration'
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  SELECT 'data-runtime:finance:integration_operations' AS `resource_code`, 'view' AS `action`
  UNION ALL SELECT 'data-runtime:finance:integration_operations', 'replay'
  UNION ALL SELECT 'tenant-runtime:finance:integration_operations', 'view'
  UNION ALL SELECT 'tenant-runtime:finance:integration_operations', 'replay'
) grants
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'finance' OR sc.`client_code` IN ('finance', 'finance.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

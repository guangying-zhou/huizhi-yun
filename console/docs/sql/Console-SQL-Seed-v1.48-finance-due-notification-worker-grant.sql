-- Console SQL Seed v1.48: exact Finance scheduled due-notification worker grant.
-- This is intentionally limited to finance.runtime. It does not authorize
-- browser users or generic Finance service clients to scan or acknowledge
-- notification checkpoints.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO `service_client_grants` (
  `service_client_id`, `resource_code`, `action`, `scope_json`, `status`, `created_at`, `updated_at`
)
SELECT
  sc.`id`,
  'data-runtime:finance:notifications_due',
  'execute',
  JSON_OBJECT(
    'source', 'seed:v1.48',
    'purpose', 'finance-due-notification-worker',
    'runtimeRoutes', JSON_ARRAY(
      '/v1/finance/service/notifications:scan-due',
      '/v1/finance/service/notifications:acknowledge',
      '/v1/finance/service/notifications:acknowledge-closure'
    )
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`client_code` = 'finance.runtime'
  AND sc.`app_code` = 'finance'
  AND sc.`status` = 'active'
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;

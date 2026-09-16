-- Console SQL Seed v1.46: Finance and Assets dead-letter notification grants.
-- This grants only the notifications service capability to the two runtime
-- clients. It does not grant any browser user role or data scope.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO `service_client_grants` (
  `service_client_id`, `resource_code`, `action`, `scope_json`, `status`, `created_at`, `updated_at`
)
SELECT
  sc.`id`,
  'notifications',
  'publish',
  JSON_OBJECT(
    'source', 'seed:v1.46',
    'purpose', 'integration-operation-dead-letter-notification',
    'endpoint', '/api/v1/console/notifications/integration-operation-dead-letter'
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (
    sc.`app_code` IN ('assets', 'finance')
    OR sc.`client_code` IN ('assets', 'assets.runtime', 'finance', 'finance.runtime')
  )
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;

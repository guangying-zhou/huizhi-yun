-- Console SQL Seed v1.49: exact scheduled due-notification worker grants.
-- No credentials are created here. Operators provision the four dedicated
-- service clients separately, then may apply this repeatable authorization seed.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO `service_client_grants` (
  `service_client_id`, `resource_code`, `action`, `scope_json`, `status`, `created_at`, `updated_at`
)
SELECT sc.`id`, workers.`resource_code`, 'execute',
  JSON_OBJECT('source', 'seed:v1.49', 'purpose', workers.`purpose`, 'runtimeRoutes', workers.`runtime_routes`),
  'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  SELECT 'aims.runtime' AS `client_code`, 'aims' AS `app_code`, 'data-runtime:aims:notifications_due' AS `resource_code`, 'aims-due-notification-worker' AS `purpose`, JSON_ARRAY('/v1/aims/service/notifications:scan-due','/v1/aims/service/notifications:acknowledge','/v1/aims/service/notifications:acknowledge-closure') AS `runtime_routes`
  UNION ALL SELECT 'altoc.runtime','altoc','data-runtime:altoc:notifications_due','altoc-receivable-due-notification-worker',JSON_ARRAY('/v1/altoc/service/notifications:scan-due','/v1/altoc/service/notifications:acknowledge','/v1/altoc/service/notifications:acknowledge-closure')
  UNION ALL SELECT 'assets.runtime','assets','data-runtime:assets:notifications_due','assets-due-notification-worker',JSON_ARRAY('/v1/assets/service/notifications:scan-due','/v1/assets/service/notifications:acknowledge','/v1/assets/service/notifications:acknowledge-closure')
  UNION ALL SELECT 'people.runtime','people','data-runtime:people:notifications_due','people-offboarding-due-notification-worker',JSON_ARRAY('/v1/people/service/notifications:scan-due','/v1/people/service/notifications:acknowledge','/v1/people/service/notifications:acknowledge-closure')
) workers ON workers.`client_code` = sc.`client_code` AND workers.`app_code` = sc.`app_code`
WHERE sc.`status` = 'active'
ON DUPLICATE KEY UPDATE `scope_json` = VALUES(`scope_json`), `status` = 'active', `updated_at` = UTC_TIMESTAMP();

COMMIT;

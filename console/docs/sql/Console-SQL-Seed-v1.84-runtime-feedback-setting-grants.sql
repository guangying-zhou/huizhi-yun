-- Console SQL Seed v1.84: Runtime feedback setting grants.
-- Date: 2026-07-18
--
-- Foundation resolves `feedback.reporter.enabled` for every business app.
-- Grant active business-app Runtime identities read-only access to system
-- settings. Existing broader grants (for example Aims/Finance work calendars)
-- retain their scope metadata.

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
  service_client.`id`,
  'system_settings',
  'view',
  JSON_OBJECT(
    'source', 'seed:v1.84',
    'purposes', JSON_ARRAY('foundation-feedback-reporter'),
    'settingKeys', JSON_ARRAY('feedback.reporter.enabled')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` service_client
WHERE service_client.`status` = 'active'
  AND service_client.`app_code` IN (
    'aims',
    'altoc',
    'assets',
    'codocs',
    'finance',
    'people',
    'webdev',
    'workflow'
  )
ON DUPLICATE KEY UPDATE
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

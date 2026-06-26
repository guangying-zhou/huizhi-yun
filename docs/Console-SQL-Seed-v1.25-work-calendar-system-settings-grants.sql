-- Console SQL Seed v1.25: Work calendar system_settings service grants.
-- Date: 2026-06-17
-- Purpose:
--   Allow Aims and Finance runtime service clients to read Console Work Calendar.
--   Token contracts:
--     Aims weekly reports:
--       aud=system_settings, scope=system_settings:view
--       GET /api/v1/console/work-calendars/{calendarCode}/days?yearMonth=YYYY-MM
--       GET /api/v1/console/service/work-calendar/month?calendarCode=CN&yearMonth=YYYY-MM
--     Finance project accounting:
--       aud=system_settings, scope=system_settings:view
--       GET /api/v1/console/service/work-calendar/month?calendarCode=CN&yearMonth=YYYY-MM
--
-- Prerequisites:
--   - Aims runtime service client exists (for example from v1.7 bootstrap seed or env materialization).
--   - Finance runtime service client exists (from v1.21 people-finance runtime clients seed).

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

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
  'system_settings',
  'view',
  JSON_OBJECT(
    'source', 'seed:v1.25',
    'purposes', JSON_ARRAY('aims-weekly-report-work-calendar', 'workflow-runtime-settings'),
    'settingKeys', JSON_ARRAY('workflow.apiUrl'),
    'endpoints', JSON_ARRAY(
      '/api/v1/console/work-calendars/{calendarCode}/days?yearMonth=YYYY-MM',
      '/api/v1/console/service/work-calendar/month?calendarCode=CN&yearMonth=YYYY-MM'
    )
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

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
  'system_settings',
  'view',
  JSON_OBJECT(
    'source', 'seed:v1.25',
    'purposes', JSON_ARRAY('finance-project-accounting-work-calendar'),
    'endpoints', JSON_ARRAY(
      '/api/v1/console/service/work-calendar/month?calendarCode=CN&yearMonth=YYYY-MM'
    )
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'finance' OR sc.`client_code` IN ('finance', 'finance.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  scg.`resource_code`,
  scg.`action`,
  scg.`status`,
  scg.`scope_json`
FROM `service_clients` sc
INNER JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE (sc.`app_code` IN ('aims', 'finance') OR sc.`client_code` IN ('aims', 'aims.runtime', 'finance', 'finance.runtime'))
  AND scg.`resource_code` = 'system_settings'
  AND scg.`action` = 'view'
ORDER BY sc.`client_code`;

-- Console SQL Seed v1.24: People performance cycle -> Aims contribution read grant.
-- Date: 2026-06-17
-- Purpose:
--   Allow People runtime to read Aims project and time-entry facts when collecting
--   contribution snapshots for a project-scoped performance cycle.
--   Token contract:
--     client request scope       = aims.read
--     issued tenant-runtime scope = tenant-runtime:aims:read
--     source app                 = people

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
  'aims',
  'read',
  JSON_OBJECT(
    'source', 'seed:v1.24',
    'purpose', 'people-collect-aims-contributions',
    'endpoints', JSON_ARRAY(
      '/v1/aims/admin/projects?search=',
      '/v1/aims/projects/{projectId}/time-entries?start_date=&end_date='
    )
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'people' OR sc.`client_code` IN ('people', 'people.runtime'))
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
  scg.`status`
FROM `service_clients` sc
INNER JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE (sc.`app_code` = 'people' OR sc.`client_code` IN ('people', 'people.runtime'))
  AND scg.`resource_code` = 'aims'
ORDER BY sc.`client_code`, scg.`action`;

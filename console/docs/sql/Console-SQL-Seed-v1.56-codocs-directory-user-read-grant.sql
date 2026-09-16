-- Console SQL Seed v1.56: Codocs restricted directory read grants.
-- Date: 2026-07-12
-- Purpose:
--   Allow the Codocs document-sharing selector to read a sanitized employee
--   directory view through Console's service-only endpoint.

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
SELECT sc.`id`, grants.`resource_code`, 'read',
  JSON_OBJECT(
    'source', 'seed:v1.56',
    'purpose', grants.`purpose`,
    'endpoint', grants.`endpoint`
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
CROSS JOIN (
  SELECT 'console:directory-users' AS `resource_code`,
         'codocs-document-sharing-user-picker' AS `purpose`,
         '/api/v1/console/service/directory/users' AS `endpoint`
  UNION ALL
  SELECT 'console:directory-project-access',
         'codocs-issue-project-scope',
         '/api/v1/console/service/directory/project-access'
) grants
WHERE sc.`app_code` = 'codocs'
   OR sc.`client_code` IN ('codocs', 'codocs.runtime')
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

SELECT
  sc.`client_code`,
  sc.`app_code`,
  scg.`resource_code`,
  scg.`action`,
  scg.`scope_json`,
  scg.`status`
FROM `service_clients` sc
INNER JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE (sc.`app_code` = 'codocs' OR sc.`client_code` IN ('codocs', 'codocs.runtime'))
  AND scg.`resource_code` IN ('console:directory-users', 'console:directory-project-access')
  AND scg.`action` = 'read';

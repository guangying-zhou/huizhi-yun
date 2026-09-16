-- Console SQL Seed v1.80: Aims restricted Directory sharing read grant.
-- Date: 2026-07-16
--
-- Aims project collaboration pages need a searchable employee sharing list,
-- but project roles must not receive Console UI permissions. This service-only
-- capability lets the Aims BFF call Console's minimized sharing projection
-- after Foundation has already established the browser request context.

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
  'console:directory-users',
  'read',
  JSON_OBJECT(
    'source', 'seed:v1.80',
    'purpose', 'aims-read-restricted-directory-sharing-projection',
    'endpoint', '/api/v1/console/service/directory/users'
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

COMMIT;

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
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
  AND scg.`resource_code` = 'console:directory-users'
  AND scg.`action` = 'read';

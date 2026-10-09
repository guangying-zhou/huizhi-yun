-- Console SQL Seed v1.83: authorize fixed WeCom identity operations.
-- Date: 2026-07-17

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
  `id`,
  'integration_operations',
  'execute',
  JSON_OBJECT(
    'integrationCodes',
    JSON_ARRAY('wecom.default'),
    'operations',
    JSON_ARRAY('wecom.oauth-user', 'wecom.user-detail')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `app_code` IN ('aims', 'codocs', 'altoc', 'assets', 'workflow')
   OR `client_code` IN (
     'aims', 'aims.runtime', 'codocs', 'codocs.runtime',
     'altoc', 'altoc.runtime', 'assets', 'assets.runtime',
     'workflow', 'workflow.runtime'
   )
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

SELECT
  sc.`client_code`,
  sc.`app_code`,
  scg.`scope_json`,
  scg.`status`
FROM `service_clients` sc
INNER JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE scg.`resource_code` = 'integration_operations'
  AND scg.`action` = 'execute'
  AND JSON_CONTAINS(
    scg.`scope_json`,
    JSON_QUOTE('wecom.default'),
    '$.integrationCodes'
  );

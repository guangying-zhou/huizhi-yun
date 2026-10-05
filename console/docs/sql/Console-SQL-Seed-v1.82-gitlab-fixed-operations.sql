-- Console SQL Seed v1.82: authorize fixed GitLab operations.
-- Date: 2026-07-17
-- Apply to existing tenants after the Tenant Runtime version that implements
-- /v1/console/service/integrations/{code}/gitlab/{operation} is installed.

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
    JSON_ARRAY('gitlab.default'),
    'operations',
    JSON_ARRAY(
      'gitlab.project-info',
      'gitlab.commits',
      'gitlab.commit-diff',
      'gitlab.markdown-tree',
      'gitlab.file',
      'gitlab.commit',
      'gitlab.resolve-actions'
    )
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `app_code` IN ('aims', 'codocs')
   OR `client_code` IN ('aims', 'aims.runtime', 'codocs', 'codocs.runtime')
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
WHERE scg.`resource_code` = 'integration_operations'
  AND scg.`action` = 'execute'
  AND JSON_CONTAINS(
    scg.`scope_json`,
    JSON_QUOTE('gitlab.default'),
    '$.integrationCodes'
  );

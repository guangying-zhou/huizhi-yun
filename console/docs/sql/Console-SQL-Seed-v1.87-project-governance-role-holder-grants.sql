-- Console SQL Seed v1.87: project governance singleton role-holder reads.
-- Date: 2026-07-25
--
-- Aims resolves the current company project director and QA before sensitive
-- business commands. Workflow resolves the current project director for
-- dynamic milestone approval assignment. This grant is service-only.

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
  client.`id`,
  'console:authorization-role-holders',
  'read',
  JSON_OBJECT(
    'source', 'seed:v1.87',
    'purpose', 'resolve-project-governance-singleton-role-holders',
    'endpoint', '/api/v1/console/service/authorization/role-holders',
    'roleCodes', JSON_ARRAY('project_director', 'qa')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` client
WHERE client.`status` = 'active'
  AND (
    client.`app_code` IN ('aims', 'workflow')
    OR client.`client_code` IN ('aims', 'aims.runtime', 'workflow', 'workflow.runtime')
  )
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;

SELECT
  client.`client_code`,
  client.`app_code`,
  grant_row.`resource_code`,
  grant_row.`action`,
  grant_row.`scope_json`,
  grant_row.`status`
FROM `service_clients` client
INNER JOIN `service_client_grants` grant_row
  ON grant_row.`service_client_id` = client.`id`
WHERE client.`status` = 'active'
  AND (
    client.`app_code` IN ('aims', 'workflow')
    OR client.`client_code` IN ('aims', 'aims.runtime', 'workflow', 'workflow.runtime')
  )
  AND grant_row.`resource_code` = 'console:authorization-role-holders'
  AND grant_row.`action` = 'read'
ORDER BY client.`client_code`;

-- Console SQL Seed v1.96: Workflow restricted Directory sharing read grant.
-- Date: 2026-08-24
--
-- Workflow resolves approval assignees from the initiator's user and department
-- projection. This service-only capability does not grant Workflow operators or
-- approvers any Console UI directory permission.

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
    'source', 'seed:v1.96',
    'semanticScope', 'console:directory-users:read',
    'purpose', 'workflow-resolve-approval-assignees-from-directory',
    'audience', 'console',
    'endpoints', JSON_ARRAY('/api/v1/console/service/directory/users')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND sc.`app_code` = 'workflow'
  AND sc.`client_code` = 'workflow.runtime'
  AND sc.`current_credential_id` IS NOT NULL
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;

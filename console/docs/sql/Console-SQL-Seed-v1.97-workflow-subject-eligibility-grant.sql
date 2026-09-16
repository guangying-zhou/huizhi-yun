-- Console SQL Seed v1.97: Workflow purpose-bound subject eligibility grant.
-- Date: 2026-08-24
--
-- Restores the exact service capability used by Workflow before a delegated
-- browser actor may approve, reject, delegate, cancel, or resubmit. This seed
-- does not create or rotate credentials and grants no Console UI entitlement.

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
  'console:authorization',
  'subject-eligibility',
  JSON_OBJECT(
    'source', 'seed:v1.97',
    'semanticScope', 'console:authorization:subject-eligibility',
    'purpose', 'workflow-purpose-bound-subject-eligibility',
    'audience', 'console',
    'registeredPurposes', JSON_ARRAY(
      'task_actionable',
      'instance_actionable',
      'instance_status',
      'task_approve',
      'task_reject',
      'task_delegate',
      'instance_cancel',
      'instance_resubmit'
    ),
    'endpoints', JSON_ARRAY('/api/v1/console/service/authorization/subject-eligibility')
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

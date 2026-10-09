-- Console SQL Seed v1.89: Workflow -> Aims milestone terminal callback.

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
  'workflow',
  'callback',
  JSON_OBJECT(
    'source', 'seed:v1.89',
    'semanticScope', 'workflow:callback',
    'purpose', 'deliver-aims-milestone-completion-terminal-callback',
    'audience', 'aims',
    'endpoints', JSON_ARRAY('/api/v1/service/workflow/callback')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` client
WHERE client.`status` = 'active'
  AND (
    client.`app_code` = 'workflow'
    OR client.`client_code` IN ('workflow', 'workflow.runtime')
  )
  AND client.`current_credential_id` IS NOT NULL
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;

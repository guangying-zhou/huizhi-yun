-- Console SQL Seed v1.90: Aims runtime -> Codocs company weekly summary publish.

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
  'codocs:company-weekly-summary',
  'publish',
  JSON_OBJECT(
    'source', 'seed:v1.90',
    'semanticScope', 'codocs:company-weekly-summary:publish',
    'purpose', 'aims-runtime-publish-versioned-company-weekly-summary',
    'audience', 'codocs',
    'endpoints', JSON_ARRAY('/api/v1/service/company-weekly-summaries/{periodKey}:publish')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` client
WHERE client.`status` = 'active'
  AND client.`app_code` = 'aims'
  AND client.`client_code` = 'aims.runtime'
  AND client.`current_credential_id` IS NOT NULL
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;

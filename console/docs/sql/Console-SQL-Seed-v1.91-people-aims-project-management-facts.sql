-- Console SQL Seed v1.91: People runtime -> Aims versioned project-management facts.

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
  'aims:project-management-facts',
  'read',
  JSON_OBJECT(
    'source', 'seed:v1.91',
    'semanticScope', 'aims:project-management-facts:read',
    'purpose', 'people-runtime-read-versioned-project-management-facts',
    'audience', 'aims',
    'endpoints', JSON_ARRAY('/api/v1/service/project-management-facts')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` client
WHERE client.`status` = 'active'
  AND client.`app_code` = 'people'
  AND client.`client_code` IN ('people', 'people.runtime')
  AND client.`current_credential_id` IS NOT NULL
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;

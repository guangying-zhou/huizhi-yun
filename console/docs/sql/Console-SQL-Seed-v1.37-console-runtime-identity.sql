-- Console SQL Seed v1.37: Console local runtime service identity metadata and grants.
-- Date: 2026-07-10
--
-- This seed is intentionally secret-free. It creates/repairs the service-client
-- metadata and grants, but it MUST NOT fabricate a service_client_credentials row.
-- The Console local issuer bootstrap writes a cryptographically random secret to
-- the encrypted Vault and binds the real current credential on first use.
-- Deployment prerequisite: HZY_CONSOLE_VAULT_MASTER_KEY must be configured.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `service_clients` (
  `client_code`, `client_name`, `client_type`, `app_code`, `description`, `status`, `created_at`, `updated_at`
) VALUES (
  'console.runtime',
  'Console Runtime',
  'runtime',
  'console',
  'Console local service-token issuer identity',
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
)
ON DUPLICATE KEY UPDATE
  `client_name` = VALUES(`client_name`),
  `client_type` = VALUES(`client_type`),
  `app_code` = VALUES(`app_code`),
  `description` = VALUES(`description`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

INSERT INTO `service_client_grants` (
  `service_client_id`, `resource_code`, `action`, `scope_json`, `status`, `created_at`, `updated_at`
)
SELECT
  sc.`id`,
  grants.`resource_code`,
  grants.`action`,
  JSON_OBJECT('source', 'seed:v1.37', 'purpose', 'console-local-service-token-issuer'),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  SELECT 'data-runtime:runtime' AS `resource_code`, 'update' AS `action`
  UNION ALL SELECT 'notification-runtime', 'send'
  UNION ALL SELECT 'tenant-runtime:runtime', 'update'
  UNION ALL SELECT 'webdev:issue', 'read'
  UNION ALL SELECT 'webdev:issue', 'write'
  UNION ALL SELECT 'aims:notification-details', 'authorize'
  UNION ALL SELECT 'assets:notification-details', 'authorize'
  UNION ALL SELECT 'workflow:action_defs', 'sync'
  UNION ALL SELECT 'workflow:notification-details', 'authorize'
  UNION ALL SELECT 'workflow', 'proxy'
) grants
WHERE sc.`client_code` = 'console.runtime'
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

-- Do not insert vault material or service_client_credentials here. After Console
-- has handled one local service-token request, run the paired v1.37 verify SQL.

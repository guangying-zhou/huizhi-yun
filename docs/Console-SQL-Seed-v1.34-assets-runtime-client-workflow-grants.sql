-- Console SQL Seed v1.34: ensure Assets runtime client and Workflow grants.
-- Date: 2026-06-22
-- Purpose:
--   Repair deployments where v1.26 granted workflow scopes only to existing
--   Assets service clients. Without assets.runtime, Assets can authenticate via
--   Tenant Gateway but Console /oauth/token returns 404:
--     service client not found for app: assets

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO `service_clients` (
  `client_code`,
  `client_name`,
  `client_type`,
  `app_code`,
  `description`,
  `status`,
  `created_at`,
  `updated_at`
)
VALUES (
  'assets.runtime',
  'Assets Runtime',
  'app',
  'assets',
  'Runtime app identity for assets Workflow integration',
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

INSERT INTO `vault_secrets` (
  `secret_code`,
  `secret_ref`,
  `secret_name`,
  `secret_type`,
  `usage_type`,
  `owner_type`,
  `owner_key`,
  `storage_backend`,
  `reveal_policy`,
  `masked_preview`,
  `status`,
  `created_by`,
  `created_at`,
  `updated_at`
)
VALUES (
  'svc.assets.runtime.client_secret',
  'hzybase://vault/svc.assets.runtime.client_secret',
  'Assets Runtime Secret',
  'client_secret',
  'service',
  'service_client',
  'assets.runtime',
  'env_ref',
  'approval',
  'runtime-identity',
  'active',
  'system',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
)
ON DUPLICATE KEY UPDATE
  `secret_name` = VALUES(`secret_name`),
  `secret_type` = 'client_secret',
  `usage_type` = 'service',
  `owner_type` = 'service_client',
  `owner_key` = VALUES(`owner_key`),
  `storage_backend` = 'env_ref',
  `reveal_policy` = 'approval',
  `masked_preview` = VALUES(`masked_preview`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

INSERT INTO `vault_secret_versions` (
  `secret_id`,
  `version_no`,
  `backend_secret_ref`,
  `content_hash`,
  `encryption_scheme`,
  `status`,
  `activated_at`,
  `created_by`,
  `created_at`
)
SELECT
  vs.`id`,
  1,
  'HZY_SERVICE_CLIENT_ASSETS_SECRET',
  'sha256_runtime_identity_placeholder_assets',
  'external_ref',
  'active',
  UTC_TIMESTAMP(),
  'system',
  UTC_TIMESTAMP()
FROM `vault_secrets` vs
WHERE vs.`secret_code` = 'svc.assets.runtime.client_secret'
  AND NOT EXISTS (
    SELECT 1
    FROM `vault_secret_versions` existing
    WHERE existing.`secret_id` = vs.`id`
      AND existing.`version_no` = 1
  );

UPDATE `vault_secret_versions` vsv
INNER JOIN `vault_secrets` vs
  ON vs.`id` = vsv.`secret_id`
SET
  vsv.`backend_secret_ref` = 'HZY_SERVICE_CLIENT_ASSETS_SECRET',
  vsv.`content_hash` = 'sha256_runtime_identity_placeholder_assets',
  vsv.`encryption_scheme` = 'external_ref',
  vsv.`status` = 'active'
WHERE vs.`secret_code` = 'svc.assets.runtime.client_secret'
  AND vsv.`version_no` = 1;

UPDATE `vault_secrets` vs
INNER JOIN `vault_secret_versions` vsv
  ON vsv.`secret_id` = vs.`id`
 AND vsv.`version_no` = 1
SET
  vs.`current_version_id` = vsv.`id`,
  vs.`updated_at` = UTC_TIMESTAMP()
WHERE vs.`secret_code` = 'svc.assets.runtime.client_secret';

INSERT INTO `service_client_credentials` (
  `service_client_id`,
  `client_id`,
  `version_no`,
  `secret_id`,
  `issued_at`,
  `status`
)
SELECT
  sc.`id`,
  'assets.runtime',
  1,
  vs.`id`,
  UTC_TIMESTAMP(),
  'active'
FROM `service_clients` sc
INNER JOIN `vault_secrets` vs
  ON vs.`secret_code` = 'svc.assets.runtime.client_secret'
WHERE sc.`client_code` = 'assets.runtime'
  AND NOT EXISTS (
    SELECT 1
    FROM `service_client_credentials` existing
    WHERE existing.`service_client_id` = sc.`id`
      AND existing.`status` = 'active'
  )
ON DUPLICATE KEY UPDATE
  `service_client_id` = VALUES(`service_client_id`),
  `secret_id` = VALUES(`secret_id`),
  `status` = 'active';

UPDATE `service_clients` sc
INNER JOIN (
  SELECT `service_client_id`, MIN(`id`) AS `credential_id`
  FROM `service_client_credentials`
  WHERE `status` = 'active'
  GROUP BY `service_client_id`
) active_credential
  ON active_credential.`service_client_id` = sc.`id`
SET
  sc.`current_credential_id` = active_credential.`credential_id`,
  sc.`updated_at` = UTC_TIMESTAMP()
WHERE sc.`client_code` = 'assets.runtime';

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
  grant_scope.`resource_code`,
  grant_scope.`action`,
  grant_scope.`scope_json`,
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
INNER JOIN (
  SELECT
    'workflow' AS `resource_code`,
    'proxy' AS `action`,
    JSON_OBJECT('source', 'seed:v1.34', 'purpose', 'foundation-approval-center-proxy') AS `scope_json`
  UNION ALL
  SELECT
    'workflow:action_defs',
    'sync',
    JSON_OBJECT('source', 'seed:v1.34', 'purpose', 'approval-action-manifest-sync')
) grant_scope
WHERE sc.`client_code` = 'assets.runtime'
   OR sc.`app_code` = 'assets'
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  MAX(scg.`resource_code` = 'workflow' AND scg.`action` = 'proxy' AND scg.`status` = 'active') AS `has_workflow_proxy`,
  MAX(scg.`resource_code` = 'workflow:action_defs' AND scg.`action` = 'sync' AND scg.`status` = 'active') AS `has_action_defs_sync`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` = 'assets'
   OR sc.`client_code` IN ('assets', 'assets.runtime')
GROUP BY sc.`client_code`, sc.`app_code`, sc.`status`, scc.`client_id`, scc.`status`
ORDER BY sc.`client_code`;

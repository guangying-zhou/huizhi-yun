-- Console SQL Seed v2.0: WebDev runtime identity and tenant-runtime grants.
-- Date: 2026-08-27
--
-- Managed WebDev Workers exchange their trusted Tenant Gateway app identity
-- for a short-lived Console service token before reading or writing WebDev
-- metadata in data-runtime. The credential row below is an inactive-material
-- placeholder required by the runtime identity lookup; no usable secret is
-- stored by this seed or sent to WebDev.

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
  'webdev.runtime',
  'WebDev Runtime',
  'app',
  'webdev',
  'Runtime app identity for WebDev tenant data access',
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
  'svc.webdev.runtime.client_secret',
  'hzybase://vault/svc.webdev.runtime.client_secret',
  'WebDev Runtime Secret',
  'client_secret',
  'service',
  'service_client',
  'webdev.runtime',
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
  'HZY_SERVICE_CLIENT_WEBDEV_SECRET',
  'sha256_runtime_identity_placeholder_webdev',
  'external_ref',
  'active',
  UTC_TIMESTAMP(),
  'system',
  UTC_TIMESTAMP()
FROM `vault_secrets` vs
WHERE vs.`secret_code` = 'svc.webdev.runtime.client_secret'
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
  vsv.`backend_secret_ref` = 'HZY_SERVICE_CLIENT_WEBDEV_SECRET',
  vsv.`content_hash` = 'sha256_runtime_identity_placeholder_webdev',
  vsv.`encryption_scheme` = 'external_ref',
  vsv.`status` = 'active'
WHERE vs.`secret_code` = 'svc.webdev.runtime.client_secret'
  AND vsv.`version_no` = 1;

UPDATE `vault_secrets` vs
INNER JOIN `vault_secret_versions` vsv
  ON vsv.`secret_id` = vs.`id`
 AND vsv.`version_no` = 1
SET
  vs.`current_version_id` = vsv.`id`,
  vs.`updated_at` = UTC_TIMESTAMP()
WHERE vs.`secret_code` = 'svc.webdev.runtime.client_secret';

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
  'webdev.runtime',
  1,
  vs.`id`,
  UTC_TIMESTAMP(),
  'active'
FROM `service_clients` sc
INNER JOIN `vault_secrets` vs
  ON vs.`secret_code` = 'svc.webdev.runtime.client_secret'
WHERE sc.`client_code` = 'webdev.runtime'
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
WHERE sc.`client_code` = 'webdev.runtime';

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
  JSON_OBJECT(
    'source', 'seed:v2.0',
    'semanticScope', grant_scope.`semantic_scope`,
    'purpose', 'webdev-tenant-runtime'
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
INNER JOIN (
  SELECT 'data-runtime:webdev' AS `resource_code`, 'read' AS `action`, 'webdev.read' AS `semantic_scope`
  UNION ALL SELECT 'data-runtime:webdev', 'write', 'webdev.write'
  UNION ALL SELECT 'tenant-runtime:webdev', 'read', 'webdev.read'
  UNION ALL SELECT 'tenant-runtime:webdev', 'write', 'webdev.write'
) grant_scope
WHERE sc.`client_code` = 'webdev.runtime'
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
  SUM(scg.`resource_code` = 'data-runtime:webdev' AND scg.`action` = 'read' AND scg.`status` = 'active') AS `data_runtime_read`,
  SUM(scg.`resource_code` = 'data-runtime:webdev' AND scg.`action` = 'write' AND scg.`status` = 'active') AS `data_runtime_write`,
  SUM(scg.`resource_code` = 'tenant-runtime:webdev' AND scg.`action` = 'read' AND scg.`status` = 'active') AS `tenant_runtime_read`,
  SUM(scg.`resource_code` = 'tenant-runtime:webdev' AND scg.`action` = 'write' AND scg.`status` = 'active') AS `tenant_runtime_write`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE sc.`client_code` = 'webdev.runtime'
GROUP BY sc.`client_code`, sc.`app_code`, sc.`status`, scc.`client_id`, scc.`status`;

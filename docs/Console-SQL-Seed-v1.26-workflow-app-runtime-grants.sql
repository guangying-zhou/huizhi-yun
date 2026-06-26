-- Console SQL Seed v1.26: repair Workflow app runtime clients and grants.
-- Date: 2026-06-18
-- Purpose:
--   Some business runtime service clients were created after v1.20 installed
--   workflow:proxy grants. Those apps can open the shared Approval Center but
--   fail at /api/workflow-proxy/** with insufficient_scope: workflow:proxy.
--   Apps without a runtime service client can be hidden by optional Approval
--   Center reads returning an empty list.
--
-- This seed is intentionally idempotent:
--   1. Ensure app runtime service clients exist for apps that were introduced
--      after earlier Workflow grant seeds or are known to be missing locally.
--   2. Ensure an active placeholder credential row exists for tenant-gateway
--      runtime app identity token issuance.
--   3. Grant workflow:proxy for Approval Center reads.
--   4. Grant workflow:action_defs:sync for apps that sync approval action
--      manifests at startup or through an admin endpoint.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

CREATE TEMPORARY TABLE IF NOT EXISTS `_workflow_runtime_apps` (
  `app_code` VARCHAR(64) NOT NULL PRIMARY KEY,
  `app_name` VARCHAR(128) NOT NULL,
  `ensure_runtime_client` TINYINT(1) NOT NULL DEFAULT 0,
  `sync_action_defs` TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=MEMORY;

DELETE FROM `_workflow_runtime_apps`;

INSERT INTO `_workflow_runtime_apps` (`app_code`, `app_name`, `ensure_runtime_client`, `sync_action_defs`)
VALUES
  ('codocs', 'Codocs Runtime', 0, 1),
  ('aims', 'Aims Runtime', 0, 1),
  ('altoc', 'Altoc Runtime', 1, 1),
  ('assets', 'Assets Runtime', 1, 1),
  ('finance', 'Finance Runtime', 1, 1),
  ('people', 'People Runtime', 1, 1);

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
SELECT
  CONCAT(a.`app_code`, '.runtime'),
  a.`app_name`,
  'app',
  a.`app_code`,
  CONCAT('Runtime app identity for ', a.`app_code`, ' Workflow integration'),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `_workflow_runtime_apps` a
WHERE a.`ensure_runtime_client` = 1
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
SELECT
  CONCAT('svc.', a.`app_code`, '.runtime.client_secret'),
  CONCAT('hzybase://vault/svc.', a.`app_code`, '.runtime.client_secret'),
  CONCAT(a.`app_name`, ' Secret'),
  'client_secret',
  'service',
  'service_client',
  CONCAT(a.`app_code`, '.runtime'),
  'env_ref',
  'approval',
  'runtime-identity',
  'active',
  'system',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `_workflow_runtime_apps` a
WHERE a.`ensure_runtime_client` = 1
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
  CONCAT('HZY_SERVICE_CLIENT_', UPPER(a.`app_code`), '_SECRET'),
  CONCAT('sha256_runtime_identity_placeholder_', a.`app_code`),
  'external_ref',
  'active',
  UTC_TIMESTAMP(),
  'system',
  UTC_TIMESTAMP()
FROM `_workflow_runtime_apps` a
INNER JOIN `vault_secrets` vs
  ON vs.`secret_code` = CONCAT('svc.', a.`app_code`, '.runtime.client_secret')
WHERE a.`ensure_runtime_client` = 1
  AND NOT EXISTS (
    SELECT 1
    FROM `vault_secret_versions` existing
    WHERE existing.`secret_id` = vs.`id`
      AND existing.`version_no` = 1
  );

UPDATE `vault_secret_versions` vsv
INNER JOIN `vault_secrets` vs
  ON vs.`id` = vsv.`secret_id`
INNER JOIN `_workflow_runtime_apps` a
  ON vs.`secret_code` = CONCAT('svc.', a.`app_code`, '.runtime.client_secret')
SET
  vsv.`backend_secret_ref` = CONCAT('HZY_SERVICE_CLIENT_', UPPER(a.`app_code`), '_SECRET'),
  vsv.`content_hash` = CONCAT('sha256_runtime_identity_placeholder_', a.`app_code`),
  vsv.`encryption_scheme` = 'external_ref',
  vsv.`status` = 'active'
WHERE a.`ensure_runtime_client` = 1
  AND vsv.`version_no` = 1;

UPDATE `vault_secrets` vs
INNER JOIN `_workflow_runtime_apps` a
  ON vs.`secret_code` = CONCAT('svc.', a.`app_code`, '.runtime.client_secret')
INNER JOIN `vault_secret_versions` vsv
  ON vsv.`secret_id` = vs.`id`
 AND vsv.`version_no` = 1
SET
  vs.`current_version_id` = vsv.`id`,
  vs.`updated_at` = UTC_TIMESTAMP()
WHERE a.`ensure_runtime_client` = 1;

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
  CONCAT(a.`app_code`, '.runtime'),
  1,
  vs.`id`,
  UTC_TIMESTAMP(),
  'active'
FROM `_workflow_runtime_apps` a
INNER JOIN `service_clients` sc
  ON sc.`client_code` = CONCAT(a.`app_code`, '.runtime')
INNER JOIN `vault_secrets` vs
  ON vs.`secret_code` = CONCAT('svc.', a.`app_code`, '.runtime.client_secret')
WHERE a.`ensure_runtime_client` = 1
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
INNER JOIN `_workflow_runtime_apps` a
  ON sc.`client_code` = CONCAT(a.`app_code`, '.runtime')
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
WHERE a.`ensure_runtime_client` = 1;

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
  'workflow',
  'proxy',
  JSON_OBJECT('source', 'seed:v1.26', 'purpose', 'foundation-approval-center-proxy'),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
INNER JOIN `_workflow_runtime_apps` a
  ON sc.`app_code` = a.`app_code`
  OR sc.`client_code` IN (a.`app_code`, CONCAT(a.`app_code`, '.runtime'))
WHERE sc.`status` = 'active'
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

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
  'workflow:action_defs',
  'sync',
  JSON_OBJECT('source', 'seed:v1.26', 'purpose', 'approval-action-manifest-sync'),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
INNER JOIN `_workflow_runtime_apps` a
  ON sc.`app_code` = a.`app_code`
  OR sc.`client_code` IN (a.`app_code`, CONCAT(a.`app_code`, '.runtime'))
WHERE sc.`status` = 'active'
  AND a.`sync_action_defs` = 1
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
INNER JOIN `_workflow_runtime_apps` a
  ON sc.`app_code` = a.`app_code`
  OR sc.`client_code` IN (a.`app_code`, CONCAT(a.`app_code`, '.runtime'))
LEFT JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
GROUP BY sc.`client_code`, sc.`app_code`, sc.`status`, scc.`client_id`, scc.`status`
ORDER BY sc.`app_code`, sc.`client_code`;

DROP TEMPORARY TABLE IF EXISTS `_workflow_runtime_apps`;

-- Console SQL Seed v1.7: Aims service client and bootstrap access key.
-- Date: 2026-04-30
-- Purpose:
--   Prepare Aims for phase 3 bootstrap mode. Aims keeps only license.lic locally;
--   the license bootstrap access key is exchanged for short-lived Console service tokens.
--
-- Before applying:
--   1. Set AIMS_BOOTSTRAP_ACCESS_KEY in Console runtime env.
--   2. Set AIMS_SERVICE_CLIENT_SECRET in Console runtime env. Aims does not need this env.
--   3. Replace deployment code if the license uses a different deploymentCode.
--   4. Add top-level bootstrap info to aims/license.lic:
--      "bootstrap": {
--        "consoleUrl": "http://localhost:3000",
--        "accessKey": "<same value as AIMS_BOOTSTRAP_ACCESS_KEY>"
--      }

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @aims_app_code = 'aims' COLLATE utf8mb4_unicode_ci;
SET @aims_deployment_code = 'C000001-aims' COLLATE utf8mb4_unicode_ci;
SET @aims_client_code = 'aims.runtime' COLLATE utf8mb4_unicode_ci;
SET @aims_client_id = 'aims.runtime' COLLATE utf8mb4_unicode_ci;
SET @aims_service_secret_code = 'svc.aims.client_secret' COLLATE utf8mb4_unicode_ci;
SET @aims_service_secret_ref = 'AIMS_SERVICE_CLIENT_SECRET' COLLATE utf8mb4_unicode_ci;
SET @aims_bootstrap_secret_code = CONCAT('bootstrap.', @aims_deployment_code, '.access_key') COLLATE utf8mb4_unicode_ci;
SET @aims_bootstrap_secret_ref = 'AIMS_BOOTSTRAP_ACCESS_KEY' COLLATE utf8mb4_unicode_ci;

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
  @aims_client_code,
  'Aims Runtime',
  'app',
  @aims_app_code,
  'Aims runtime service client for Console integration/vault access',
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

SET @aims_service_client_id = (
  SELECT `id` FROM `service_clients` WHERE `client_code` = @aims_client_code
);

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
  @aims_service_secret_code,
  CONCAT('hzybase://vault/', @aims_service_secret_code),
  'Aims service client secret',
  'client_secret',
  'service',
  'service_client',
  @aims_client_code,
  'env_ref',
  'approval',
  'env_ref:AIMS****CRET',
  'active',
  'seed:v1.7',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM `vault_secrets` WHERE `secret_code` = @aims_service_secret_code
);

SET @aims_service_secret_id = (
  SELECT `id` FROM `vault_secrets` WHERE `secret_code` = @aims_service_secret_code
);

INSERT INTO `vault_secret_versions` (
  `secret_id`,
  `version_no`,
  `ciphertext_blob`,
  `backend_secret_ref`,
  `content_hash`,
  `encryption_scheme`,
  `status`,
  `activated_at`,
  `created_by`,
  `created_at`
)
SELECT
  @aims_service_secret_id,
  1,
  NULL,
  @aims_service_secret_ref,
  CONCAT('sha256_', SHA2(@aims_service_secret_ref, 256)),
  'external_ref',
  'active',
  UTC_TIMESTAMP(),
  'seed:v1.7',
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1
    FROM `vault_secret_versions`
   WHERE `secret_id` = @aims_service_secret_id
     AND `version_no` = 1
);

SET @aims_service_secret_version_id = (
  SELECT `id`
    FROM `vault_secret_versions`
   WHERE `secret_id` = @aims_service_secret_id
     AND `version_no` = 1
);

UPDATE `vault_secrets`
   SET `current_version_id` = @aims_service_secret_version_id,
       `last_rotated_at` = COALESCE(`last_rotated_at`, UTC_TIMESTAMP()),
       `updated_at` = UTC_TIMESTAMP()
 WHERE `id` = @aims_service_secret_id
   AND `current_version_id` IS NULL;

UPDATE `service_client_credentials`
   SET `status` = 'retired'
 WHERE `service_client_id` = @aims_service_client_id
   AND `client_id` <> @aims_client_id
   AND `status` = 'active';

INSERT INTO `service_client_credentials` (
  `service_client_id`,
  `client_id`,
  `version_no`,
  `secret_id`,
  `issued_at`,
  `status`
)
SELECT
  @aims_service_client_id,
  @aims_client_id,
  COALESCE((
    SELECT MAX(`version_no`) + 1
      FROM `service_client_credentials` existing_versions
     WHERE existing_versions.`service_client_id` = @aims_service_client_id
  ), 1),
  @aims_service_secret_id,
  UTC_TIMESTAMP(),
  'active'
WHERE NOT EXISTS (
  SELECT 1
    FROM `service_client_credentials`
   WHERE `client_id` = @aims_client_id
);

UPDATE `service_client_credentials`
   SET `service_client_id` = @aims_service_client_id,
       `secret_id` = @aims_service_secret_id,
       `status` = 'active'
 WHERE `client_id` = @aims_client_id;

SET @aims_credential_id = (
  SELECT `id`
    FROM `service_client_credentials`
   WHERE `client_id` = @aims_client_id
);

UPDATE `service_clients`
   SET `current_credential_id` = @aims_credential_id,
       `updated_at` = UTC_TIMESTAMP()
 WHERE `id` = @aims_service_client_id;

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
  @aims_bootstrap_secret_code,
  CONCAT('hzybase://vault/', @aims_bootstrap_secret_code),
  'Aims bootstrap access key',
  'access_key',
  'bootstrap',
  'deployment',
  @aims_deployment_code,
  'env_ref',
  'deny',
  'env_ref:AIMS****_KEY',
  'active',
  'seed:v1.7',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM `vault_secrets` WHERE `secret_code` = @aims_bootstrap_secret_code
);

SET @aims_bootstrap_secret_id = (
  SELECT `id` FROM `vault_secrets` WHERE `secret_code` = @aims_bootstrap_secret_code
);

INSERT INTO `vault_secret_versions` (
  `secret_id`,
  `version_no`,
  `ciphertext_blob`,
  `backend_secret_ref`,
  `content_hash`,
  `encryption_scheme`,
  `status`,
  `activated_at`,
  `created_by`,
  `created_at`
)
SELECT
  @aims_bootstrap_secret_id,
  1,
  NULL,
  @aims_bootstrap_secret_ref,
  CONCAT('sha256_', SHA2(@aims_bootstrap_secret_ref, 256)),
  'external_ref',
  'active',
  UTC_TIMESTAMP(),
  'seed:v1.7',
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1
    FROM `vault_secret_versions`
   WHERE `secret_id` = @aims_bootstrap_secret_id
     AND `version_no` = 1
);

SET @aims_bootstrap_secret_version_id = (
  SELECT `id`
    FROM `vault_secret_versions`
   WHERE `secret_id` = @aims_bootstrap_secret_id
     AND `version_no` = 1
);

UPDATE `vault_secrets`
   SET `current_version_id` = @aims_bootstrap_secret_version_id,
       `last_rotated_at` = COALESCE(`last_rotated_at`, UTC_TIMESTAMP()),
       `updated_at` = UTC_TIMESTAMP()
 WHERE `id` = @aims_bootstrap_secret_id
   AND `current_version_id` IS NULL;

INSERT INTO `service_client_grants` (
  `service_client_id`,
  `resource_code`,
  `action`,
  `scope_json`,
  `status`,
  `created_at`,
  `updated_at`
)
VALUES
  (
    @aims_service_client_id,
    'integration_config',
    'view',
    JSON_OBJECT('integrationCodes', JSON_ARRAY('wecom.default')),
    'active',
    UTC_TIMESTAMP(),
    UTC_TIMESTAMP()
  ),
  (
    @aims_service_client_id,
    'credential_vault',
    'resolve',
    JSON_OBJECT('usageTypes', JSON_ARRAY('integration'), 'integrationCodes', JSON_ARRAY('wecom.default')),
    'active',
    UTC_TIMESTAMP(),
    UTC_TIMESTAMP()
  ),
  (
    @aims_service_client_id,
    'system_settings',
    'view',
    JSON_OBJECT('settingKeys', JSON_ARRAY('workflow.apiUrl')),
    'active',
    UTC_TIMESTAMP(),
    UTC_TIMESTAMP()
  )
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

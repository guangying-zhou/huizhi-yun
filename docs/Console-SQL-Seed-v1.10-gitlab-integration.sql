-- Console SQL Seed v1.10: GitLab integration credential bootstrap.
-- Date: 2026-05-01
-- Purpose:
--   Register the default GitLab integration used by Foundation gitIntegration.
--   Aims/Codocs call Foundation semantic Git APIs; Foundation resolves this
--   integration and its vault secret from Console at runtime.
--
-- Before applying:
--   1. Set the real GitLab token in Console runtime env as GITLAB_BOT_TOKEN.
--   2. Replace @gitlab_base_url if the deployment uses another GitLab origin.
--   3. Ensure service clients already exist for the apps that need Git access
--      (for example aims.runtime and codocs.runtime).

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @gitlab_integration_code = 'gitlab.default' COLLATE utf8mb4_unicode_ci;
SET @gitlab_secret_code = 'integration.gitlab.default.bot_token' COLLATE utf8mb4_unicode_ci;
SET @gitlab_backend_ref = 'GITLAB_BOT_TOKEN' COLLATE utf8mb4_unicode_ci;
SET @gitlab_base_url = 'https://gitlab.wiztek.cn' COLLATE utf8mb4_unicode_ci;
SET @gitlab_default_branch = 'main' COLLATE utf8mb4_unicode_ci;

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
  @gitlab_secret_code,
  CONCAT('hzybase://vault/', @gitlab_secret_code),
  'GitLab default bot token',
  'api_token',
  'integration',
  'integration',
  @gitlab_integration_code,
  'env_ref',
  'approval',
  'env_ref:GIT****OKEN',
  'active',
  'seed:v1.10',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM `vault_secrets` WHERE `secret_code` = @gitlab_secret_code
);

SET @gitlab_secret_id = (
  SELECT `id` FROM `vault_secrets` WHERE `secret_code` = @gitlab_secret_code
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
  @gitlab_secret_id,
  1,
  NULL,
  @gitlab_backend_ref,
  CONCAT('sha256_', SHA2(@gitlab_backend_ref, 256)),
  'external_ref',
  'active',
  UTC_TIMESTAMP(),
  'seed:v1.10',
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1
    FROM `vault_secret_versions`
   WHERE `secret_id` = @gitlab_secret_id
     AND `version_no` = 1
);

SET @gitlab_secret_version_id = (
  SELECT `id`
    FROM `vault_secret_versions`
   WHERE `secret_id` = @gitlab_secret_id
     AND `version_no` = 1
);

UPDATE `vault_secrets`
   SET `current_version_id` = @gitlab_secret_version_id,
       `last_rotated_at` = COALESCE(`last_rotated_at`, UTC_TIMESTAMP()),
       `updated_at` = UTC_TIMESTAMP()
 WHERE `id` = @gitlab_secret_id
   AND `current_version_id` IS NULL;

INSERT INTO `integrations` (
  `integration_code`,
  `integration_type`,
  `integration_name`,
  `category`,
  `provider_code`,
  `base_url`,
  `config_json`,
  `connectivity_status`,
  `status`,
  `created_by`,
  `created_at`,
  `updated_at`
)
SELECT
  @gitlab_integration_code,
  'gitlab',
  'Default GitLab',
  'code_repository',
  'gitlab',
  @gitlab_base_url,
  JSON_OBJECT('defaultBranch', @gitlab_default_branch),
  'unknown',
  'active',
  'seed:v1.10',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM `integrations` WHERE `integration_code` = @gitlab_integration_code
);

SET @gitlab_integration_id = (
  SELECT `id` FROM `integrations` WHERE `integration_code` = @gitlab_integration_code
);

INSERT INTO `integration_credentials` (
  `integration_id`,
  `credential_name`,
  `credential_role`,
  `version_no`,
  `secret_id`,
  `secret_version_id`,
  `issued_at`,
  `status`
)
SELECT
  @gitlab_integration_id,
  'primary',
  'primary',
  1,
  @gitlab_secret_id,
  @gitlab_secret_version_id,
  UTC_TIMESTAMP(),
  'active'
WHERE NOT EXISTS (
  SELECT 1
    FROM `integration_credentials`
   WHERE `integration_id` = @gitlab_integration_id
     AND `version_no` = 1
);

SET @gitlab_credential_id = (
  SELECT `id`
    FROM `integration_credentials`
   WHERE `integration_id` = @gitlab_integration_id
     AND `version_no` = 1
);

UPDATE `integrations`
   SET `current_credential_id` = @gitlab_credential_id,
       `base_url` = @gitlab_base_url,
       `config_json` = JSON_OBJECT('defaultBranch', @gitlab_default_branch),
       `updated_at` = UTC_TIMESTAMP()
 WHERE `id` = @gitlab_integration_id;

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
  `id`,
  'integration_config',
  'view',
  JSON_OBJECT('integrationCodes', JSON_ARRAY(@gitlab_integration_code)),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `app_code` IN ('aims', 'codocs')
   OR `client_code` IN ('aims', 'aims.runtime', 'codocs', 'codocs.runtime')
ON DUPLICATE KEY UPDATE
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
  `id`,
  'credential_vault',
  'resolve',
  JSON_OBJECT('usageTypes', JSON_ARRAY('integration'), 'integrationCodes', JSON_ARRAY(@gitlab_integration_code)),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `app_code` IN ('aims', 'codocs')
   OR `client_code` IN ('aims', 'aims.runtime', 'codocs', 'codocs.runtime')
ON DUPLICATE KEY UPDATE
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

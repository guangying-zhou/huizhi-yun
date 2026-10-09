-- Console SQL Seed v1.11: AI Provider and OSS integration credential bootstrap.
-- Date: 2026-05-01
-- Purpose:
--   Register default AI Provider and OSS integrations used by Foundation
--   runtime integration helpers. Secrets are stored as vault env_ref entries.
--
-- Before applying:
--   1. Set AI_PROVIDER_API_KEY in Console runtime env.
--   2. Set ALIYUN_OSS_ACCESS_KEY_SECRET in Console runtime env.
--   3. Replace AI / OSS non-secret placeholders below.
--   4. Ensure service clients already exist for apps that need integration access.
--
-- Legacy Codocs OSS env mapping:
--   ALIYUN_OSS_BUCKET_NAME                  -> config.bucketName
--   ALIYUN_OSS_ENDPOINT                     -> config.endpoint
--   ALIYUN_OSS_BUCKET_DOMAIN                -> config.bucketDomain
--   ALIYUN_OSS_PROJECTS_BUCKET_NAME         -> config.projectsBucketName
--   ALIYUN_OSS_PROJECTS_ENDPOINT            -> config.projectsEndpoint
--   ALIYUN_OSS_PROJECTS_BUCKET_DOMAIN       -> config.projectsBucketDomain
--   ALIYUN_OSS_IMAGES_BUCKET_NAME           -> config.imagesBucketName
--   ALIYUN_OSS_IMAGES_ENDPOINT              -> config.imagesEndpoint
--   ALIYUN_OSS_IMAGES_BUCKET_DOMAIN         -> config.imagesBucketDomain

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @ai_integration_code = 'ai.default' COLLATE utf8mb4_unicode_ci;
SET @ai_secret_code = 'integration.ai.default.api_key' COLLATE utf8mb4_unicode_ci;
SET @ai_backend_ref = 'AI_PROVIDER_API_KEY' COLLATE utf8mb4_unicode_ci;
SET @ai_base_url = 'https://dashscope.aliyuncs.com/compatible-mode/v1' COLLATE utf8mb4_unicode_ci;
SET @ai_default_model = '' COLLATE utf8mb4_unicode_ci;
SET @ai_check_path = '/models' COLLATE utf8mb4_unicode_ci;

SET @oss_integration_code = 'oss.default' COLLATE utf8mb4_unicode_ci;
SET @oss_secret_code = 'integration.oss.default.access_key_secret' COLLATE utf8mb4_unicode_ci;
SET @oss_backend_ref = 'ALIYUN_OSS_ACCESS_KEY_SECRET' COLLATE utf8mb4_unicode_ci;
SET @oss_access_key_id = '' COLLATE utf8mb4_unicode_ci;
SET @oss_bucket_name = 'wiz-rs' COLLATE utf8mb4_unicode_ci;
SET @oss_endpoint = 'oss-cn-qingdao.aliyuncs.com' COLLATE utf8mb4_unicode_ci;
SET @oss_region = 'oss-cn-qingdao' COLLATE utf8mb4_unicode_ci;
SET @oss_bucket_domain = '' COLLATE utf8mb4_unicode_ci;
SET @oss_projects_bucket_name = @oss_bucket_name;
SET @oss_projects_endpoint = @oss_endpoint;
SET @oss_projects_bucket_domain = @oss_bucket_domain;
SET @oss_images_bucket_name = @oss_bucket_name;
SET @oss_images_endpoint = @oss_endpoint;
SET @oss_images_bucket_domain = @oss_bucket_domain;
SET @oss_recycle_days = 30;

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
  @ai_secret_code,
  CONCAT('hzybase://vault/', @ai_secret_code),
  'AI provider default API key',
  'api_key',
  'integration',
  'integration',
  @ai_integration_code,
  'env_ref',
  'approval',
  'env_ref:AI_****_KEY',
  'active',
  'seed:v1.11',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM `vault_secrets` WHERE `secret_code` = @ai_secret_code
);

SET @ai_secret_id = (
  SELECT `id` FROM `vault_secrets` WHERE `secret_code` = @ai_secret_code
);

UPDATE `vault_secrets`
   SET `secret_ref` = CONCAT('hzybase://vault/', @ai_secret_code),
       `secret_name` = 'AI provider default API key',
       `secret_type` = 'api_key',
       `usage_type` = 'integration',
       `owner_type` = 'integration',
       `owner_key` = @ai_integration_code,
       `storage_backend` = 'env_ref',
       `reveal_policy` = 'approval',
       `masked_preview` = 'env_ref:AI_****_KEY',
       `status` = 'active',
       `updated_at` = UTC_TIMESTAMP()
 WHERE `id` = @ai_secret_id;

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
  @ai_secret_id,
  1,
  NULL,
  @ai_backend_ref,
  CONCAT('sha256_', SHA2(@ai_backend_ref, 256)),
  'external_ref',
  'active',
  UTC_TIMESTAMP(),
  'seed:v1.11',
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM `vault_secret_versions` WHERE `secret_id` = @ai_secret_id AND `version_no` = 1
);

SET @ai_secret_version_id = (
  SELECT `id` FROM `vault_secret_versions` WHERE `secret_id` = @ai_secret_id AND `version_no` = 1
);

UPDATE `vault_secret_versions`
   SET `ciphertext_blob` = NULL,
       `backend_secret_ref` = @ai_backend_ref,
       `content_hash` = CONCAT('sha256_', SHA2(@ai_backend_ref, 256)),
       `encryption_scheme` = 'external_ref',
       `status` = 'active',
       `activated_at` = COALESCE(`activated_at`, UTC_TIMESTAMP())
 WHERE `id` = @ai_secret_version_id
   AND (`backend_secret_ref` <> @ai_backend_ref
        OR `backend_secret_ref` IS NULL
        OR `ciphertext_blob` IS NOT NULL
        OR `encryption_scheme` <> 'external_ref'
        OR `status` <> 'active');

UPDATE `vault_secrets`
   SET `current_version_id` = @ai_secret_version_id,
       `last_rotated_at` = COALESCE(`last_rotated_at`, UTC_TIMESTAMP()),
       `updated_at` = UTC_TIMESTAMP()
 WHERE `id` = @ai_secret_id
   AND (`current_version_id` IS NULL OR `current_version_id` <> @ai_secret_version_id);

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
  @ai_integration_code,
  'ai_provider',
  'Default AI Provider',
  'ai',
  'openai_compatible',
  @ai_base_url,
  JSON_OBJECT('defaultModel', @ai_default_model, 'checkPath', @ai_check_path),
  'unknown',
  'active',
  'seed:v1.11',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM `integrations` WHERE `integration_code` = @ai_integration_code
);

SET @ai_integration_id = (
  SELECT `id` FROM `integrations` WHERE `integration_code` = @ai_integration_code
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
  @ai_integration_id,
  'primary',
  'primary',
  1,
  @ai_secret_id,
  @ai_secret_version_id,
  UTC_TIMESTAMP(),
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `integration_credentials` WHERE `integration_id` = @ai_integration_id AND `version_no` = 1
);

SET @ai_credential_id = (
  SELECT `id` FROM `integration_credentials` WHERE `integration_id` = @ai_integration_id AND `version_no` = 1
);

UPDATE `integration_credentials`
   SET `status` = 'retired'
 WHERE `integration_id` = @ai_integration_id
   AND `id` <> @ai_credential_id
   AND `status` = 'active';

UPDATE `integration_credentials`
   SET `secret_id` = @ai_secret_id,
       `secret_version_id` = @ai_secret_version_id,
       `status` = 'active'
 WHERE `id` = @ai_credential_id;

UPDATE `integrations`
   SET `current_credential_id` = @ai_credential_id,
       `base_url` = @ai_base_url,
       `config_json` = JSON_OBJECT('defaultModel', @ai_default_model, 'checkPath', @ai_check_path),
       `status` = 'active',
       `updated_at` = UTC_TIMESTAMP()
 WHERE `id` = @ai_integration_id;

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
  @oss_secret_code,
  CONCAT('hzybase://vault/', @oss_secret_code),
  'OSS default access key secret',
  'access_key_secret',
  'integration',
  'integration',
  @oss_integration_code,
  'env_ref',
  'approval',
  'env_ref:ALIY****CRET',
  'active',
  'seed:v1.11',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM `vault_secrets` WHERE `secret_code` = @oss_secret_code
);

SET @oss_secret_id = (
  SELECT `id` FROM `vault_secrets` WHERE `secret_code` = @oss_secret_code
);

UPDATE `vault_secrets`
   SET `secret_ref` = CONCAT('hzybase://vault/', @oss_secret_code),
       `secret_name` = 'OSS default access key secret',
       `secret_type` = 'access_key_secret',
       `usage_type` = 'integration',
       `owner_type` = 'integration',
       `owner_key` = @oss_integration_code,
       `storage_backend` = 'env_ref',
       `reveal_policy` = 'approval',
       `masked_preview` = 'env_ref:ALIY****CRET',
       `status` = 'active',
       `updated_at` = UTC_TIMESTAMP()
 WHERE `id` = @oss_secret_id;

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
  @oss_secret_id,
  1,
  NULL,
  @oss_backend_ref,
  CONCAT('sha256_', SHA2(@oss_backend_ref, 256)),
  'external_ref',
  'active',
  UTC_TIMESTAMP(),
  'seed:v1.11',
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM `vault_secret_versions` WHERE `secret_id` = @oss_secret_id AND `version_no` = 1
);

SET @oss_secret_version_id = (
  SELECT `id` FROM `vault_secret_versions` WHERE `secret_id` = @oss_secret_id AND `version_no` = 1
);

UPDATE `vault_secret_versions`
   SET `ciphertext_blob` = NULL,
       `backend_secret_ref` = @oss_backend_ref,
       `content_hash` = CONCAT('sha256_', SHA2(@oss_backend_ref, 256)),
       `encryption_scheme` = 'external_ref',
       `status` = 'active',
       `activated_at` = COALESCE(`activated_at`, UTC_TIMESTAMP())
 WHERE `id` = @oss_secret_version_id
   AND (`backend_secret_ref` <> @oss_backend_ref
        OR `backend_secret_ref` IS NULL
        OR `ciphertext_blob` IS NOT NULL
        OR `encryption_scheme` <> 'external_ref'
        OR `status` <> 'active');

UPDATE `vault_secrets`
   SET `current_version_id` = @oss_secret_version_id,
       `last_rotated_at` = COALESCE(`last_rotated_at`, UTC_TIMESTAMP()),
       `updated_at` = UTC_TIMESTAMP()
 WHERE `id` = @oss_secret_id
   AND (`current_version_id` IS NULL OR `current_version_id` <> @oss_secret_version_id);

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
  @oss_integration_code,
  'oss',
  'Default OSS',
  'storage',
  'aliyun_oss',
  @oss_endpoint,
  JSON_OBJECT(
    'accessKeyId', @oss_access_key_id,
    'bucketName', @oss_bucket_name,
    'endpoint', @oss_endpoint,
    'region', @oss_region,
    'bucketDomain', @oss_bucket_domain,
    'projectsBucketName', @oss_projects_bucket_name,
    'projectsEndpoint', @oss_projects_endpoint,
    'projectsBucketDomain', @oss_projects_bucket_domain,
    'imagesBucketName', @oss_images_bucket_name,
    'imagesEndpoint', @oss_images_endpoint,
    'imagesBucketDomain', @oss_images_bucket_domain,
    'recycleDays', @oss_recycle_days
  ),
  'unknown',
  'active',
  'seed:v1.11',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM `integrations` WHERE `integration_code` = @oss_integration_code
);

SET @oss_integration_id = (
  SELECT `id` FROM `integrations` WHERE `integration_code` = @oss_integration_code
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
  @oss_integration_id,
  'primary',
  'primary',
  1,
  @oss_secret_id,
  @oss_secret_version_id,
  UTC_TIMESTAMP(),
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `integration_credentials` WHERE `integration_id` = @oss_integration_id AND `version_no` = 1
);

SET @oss_credential_id = (
  SELECT `id` FROM `integration_credentials` WHERE `integration_id` = @oss_integration_id AND `version_no` = 1
);

UPDATE `integration_credentials`
   SET `status` = 'retired'
 WHERE `integration_id` = @oss_integration_id
   AND `id` <> @oss_credential_id
   AND `status` = 'active';

UPDATE `integration_credentials`
   SET `secret_id` = @oss_secret_id,
       `secret_version_id` = @oss_secret_version_id,
       `status` = 'active'
 WHERE `id` = @oss_credential_id;

UPDATE `integrations`
   SET `current_credential_id` = @oss_credential_id,
       `base_url` = @oss_endpoint,
       `config_json` = JSON_OBJECT(
         'accessKeyId', @oss_access_key_id,
         'bucketName', @oss_bucket_name,
         'endpoint', @oss_endpoint,
         'region', @oss_region,
         'bucketDomain', @oss_bucket_domain,
         'projectsBucketName', @oss_projects_bucket_name,
         'projectsEndpoint', @oss_projects_endpoint,
         'projectsBucketDomain', @oss_projects_bucket_domain,
         'imagesBucketName', @oss_images_bucket_name,
         'imagesEndpoint', @oss_images_endpoint,
         'imagesBucketDomain', @oss_images_bucket_domain,
         'recycleDays', @oss_recycle_days
       ),
       `status` = 'active',
       `updated_at` = UTC_TIMESTAMP()
 WHERE `id` = @oss_integration_id;

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
  JSON_OBJECT('integrationCodes', JSON_ARRAY('gitlab.default', 'wecom.default', 'ai.default', 'oss.default')),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `app_code` IN ('aims', 'codocs')
   OR `client_code` IN ('aims', 'aims.runtime', 'codocs', 'codocs.runtime')
ON DUPLICATE KEY UPDATE
  `scope_json` = JSON_OBJECT('integrationCodes', JSON_ARRAY('gitlab.default', 'wecom.default', 'ai.default', 'oss.default')),
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
  JSON_OBJECT('usageTypes', JSON_ARRAY('integration'), 'integrationCodes', JSON_ARRAY('gitlab.default', 'wecom.default', 'ai.default', 'oss.default')),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `app_code` IN ('aims', 'codocs')
   OR `client_code` IN ('aims', 'aims.runtime', 'codocs', 'codocs.runtime')
ON DUPLICATE KEY UPDATE
  `scope_json` = JSON_OBJECT('usageTypes', JSON_ARRAY('integration'), 'integrationCodes', JSON_ARRAY('gitlab.default', 'wecom.default', 'ai.default', 'oss.default')),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

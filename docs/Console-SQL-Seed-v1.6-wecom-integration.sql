-- Console SQL Seed v1.6: WeCom integration credential bootstrap.
-- Date: 2026-04-30
-- Purpose:
--   Create a default enterprise WeCom integration and grant runtime service
--   clients access to read integration metadata and resolve the bound secret.
--
-- Before applying:
--   1. Set the real WeCom corpsecret in Console runtime env as WECOM_CORPSECRET.
--   2. Replace corpid / agentid below if this deployment uses another WeCom app.
--   3. Ensure runtime service clients already exist for apps that need WeCom access
--      (for example aims.runtime and codocs.runtime).

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @wecom_integration_code = 'wecom.default' COLLATE utf8mb4_unicode_ci;
SET @wecom_secret_code = 'integration.wecom.default.corpsecret' COLLATE utf8mb4_unicode_ci;
SET @wecom_backend_ref = 'WECOM_CORPSECRET' COLLATE utf8mb4_unicode_ci;
SET @wecom_corpid = 'wwe3597050c256d8e4' COLLATE utf8mb4_unicode_ci;
SET @wecom_agentid = '1000007' COLLATE utf8mb4_unicode_ci;

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
  @wecom_secret_code,
  CONCAT('hzybase://vault/', @wecom_secret_code),
  'WeCom default corpsecret',
  'oauth_secret',
  'integration',
  'integration',
  @wecom_integration_code,
  'env_ref',
  'approval',
  'env_ref:WECO****CRET',
  'active',
  'seed:v1.6',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM `vault_secrets` WHERE `secret_code` = @wecom_secret_code
);

SET @wecom_secret_id = (
  SELECT `id` FROM `vault_secrets` WHERE `secret_code` = @wecom_secret_code
);

UPDATE `vault_secrets`
   SET `secret_ref` = CONCAT('hzybase://vault/', @wecom_secret_code),
       `secret_name` = 'WeCom default corpsecret',
       `secret_type` = 'oauth_secret',
       `usage_type` = 'integration',
       `owner_type` = 'integration',
       `owner_key` = @wecom_integration_code,
       `storage_backend` = 'env_ref',
       `reveal_policy` = 'approval',
       `masked_preview` = 'env_ref:WECO****CRET',
       `status` = 'active',
       `updated_at` = UTC_TIMESTAMP()
 WHERE `id` = @wecom_secret_id;

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
  @wecom_secret_id,
  1,
  NULL,
  @wecom_backend_ref,
  CONCAT('sha256_', SHA2(@wecom_backend_ref, 256)),
  'external_ref',
  'active',
  UTC_TIMESTAMP(),
  'seed:v1.6',
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1
    FROM `vault_secret_versions`
   WHERE `secret_id` = @wecom_secret_id
     AND `version_no` = 1
);

SET @wecom_secret_version_id = (
  SELECT `id`
    FROM `vault_secret_versions`
   WHERE `secret_id` = @wecom_secret_id
     AND `version_no` = 1
);

UPDATE `vault_secret_versions`
   SET `backend_secret_ref` = @wecom_backend_ref,
       `content_hash` = CONCAT('sha256_', SHA2(@wecom_backend_ref, 256)),
       `encryption_scheme` = 'external_ref',
       `status` = 'active',
       `activated_at` = COALESCE(`activated_at`, UTC_TIMESTAMP())
 WHERE `id` = @wecom_secret_version_id
   AND (`backend_secret_ref` <> @wecom_backend_ref
        OR `backend_secret_ref` = 'WECOM_DEFAULT_CORPSECRET'
        OR `encryption_scheme` <> 'external_ref'
        OR `status` <> 'active');

UPDATE `vault_secrets`
   SET `current_version_id` = @wecom_secret_version_id,
       `last_rotated_at` = COALESCE(`last_rotated_at`, UTC_TIMESTAMP()),
       `updated_at` = UTC_TIMESTAMP()
 WHERE `id` = @wecom_secret_id
   AND (`current_version_id` IS NULL OR `current_version_id` <> @wecom_secret_version_id);

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
  @wecom_integration_code,
  'wecom',
  'Default WeCom',
  'notification',
  'wecom',
  'https://qyapi.weixin.qq.com',
  JSON_OBJECT('corpid', @wecom_corpid, 'agentid', @wecom_agentid),
  'unknown',
  'active',
  'seed:v1.6',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM `integrations` WHERE `integration_code` = @wecom_integration_code
);

SET @wecom_integration_id = (
  SELECT `id` FROM `integrations` WHERE `integration_code` = @wecom_integration_code
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
  @wecom_integration_id,
  'primary',
  'primary',
  1,
  @wecom_secret_id,
  @wecom_secret_version_id,
  UTC_TIMESTAMP(),
  'active'
WHERE NOT EXISTS (
  SELECT 1
    FROM `integration_credentials`
   WHERE `integration_id` = @wecom_integration_id
     AND `version_no` = 1
);

SET @wecom_credential_id = (
  SELECT `id`
    FROM `integration_credentials`
   WHERE `integration_id` = @wecom_integration_id
     AND `version_no` = 1
);

UPDATE `integration_credentials`
   SET `status` = 'retired'
 WHERE `integration_id` = @wecom_integration_id
   AND `id` <> @wecom_credential_id
   AND `status` = 'active';

UPDATE `integration_credentials`
   SET `secret_id` = @wecom_secret_id,
       `secret_version_id` = @wecom_secret_version_id,
       `status` = 'active'
 WHERE `id` = @wecom_credential_id;

UPDATE `integrations`
   SET `current_credential_id` = @wecom_credential_id,
       `base_url` = 'https://qyapi.weixin.qq.com',
       `config_json` = JSON_OBJECT('corpid', @wecom_corpid, 'agentid', @wecom_agentid),
       `status` = 'active',
       `updated_at` = UTC_TIMESTAMP()
 WHERE `id` = @wecom_integration_id;

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
  JSON_OBJECT('integrationCodes', JSON_ARRAY('gitlab.default', @wecom_integration_code, 'ai.default', 'oss.default')),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `app_code` IN ('aims', 'codocs')
   OR `client_code` IN ('aims', 'aims.runtime', 'codocs', 'codocs.runtime')
ON DUPLICATE KEY UPDATE
  `scope_json` = JSON_OBJECT('integrationCodes', JSON_ARRAY('gitlab.default', @wecom_integration_code, 'ai.default', 'oss.default')),
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
  JSON_OBJECT('usageTypes', JSON_ARRAY('integration'), 'integrationCodes', JSON_ARRAY('gitlab.default', @wecom_integration_code, 'ai.default', 'oss.default')),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `app_code` IN ('aims', 'codocs')
   OR `client_code` IN ('aims', 'aims.runtime', 'codocs', 'codocs.runtime')
ON DUPLICATE KEY UPDATE
  `scope_json` = JSON_OBJECT('usageTypes', JSON_ARRAY('integration'), 'integrationCodes', JSON_ARRAY('gitlab.default', @wecom_integration_code, 'ai.default', 'oss.default')),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

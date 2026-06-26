-- Console SQL Migration v1.5: bind integration credential to a vault secret version.
-- Date: 2026-04-30
-- Purpose:
--   Make integration credential rotation stable. Without secret_version_id,
--   integration_credentials only references vault_secrets and implicitly follows
--   vault current_version_id, which can bypass the integration rotate flow.

ALTER TABLE `integration_credentials`
  ADD COLUMN `secret_version_id` BIGINT UNSIGNED NULL COMMENT '绑定到具体 vault_secret_versions；为空时兼容读取 vault 当前版本' AFTER `secret_id`,
  ADD KEY `idx_integration_credentials_secret_version` (`secret_version_id`, `secret_id`),
  ADD CONSTRAINT `fk_integration_credentials_secret_version`
    FOREIGN KEY (`secret_version_id`, `secret_id`) REFERENCES `vault_secret_versions` (`id`, `secret_id`);

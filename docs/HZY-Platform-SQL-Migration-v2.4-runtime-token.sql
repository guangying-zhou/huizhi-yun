-- v2.4 runtime token migration
-- Adds tenant-level runtime credentials used by console/runtime to call platform runtime APIs.

CREATE TABLE IF NOT EXISTS `tenant_runtime_credentials` (
  `tenant_code` VARCHAR(64) NOT NULL,
  `credential_mode` VARCHAR(32) NOT NULL DEFAULT 'tenant'
    COMMENT 'tenant（当前）/ deployment（未来预留）',
  `runtime_token_hash` VARCHAR(128) NOT NULL COMMENT 'sha256(token)',
  `runtime_token_last4` VARCHAR(8) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `issued_by_account_id` BIGINT UNSIGNED NULL COMMENT '跨域→platform_accounts，无 FK',
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `rotated_at` DATETIME NULL,
  `expires_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `last_used_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_code`),
  KEY `idx_tenant_runtime_credentials_status` (`status`, `expires_at`),
  CONSTRAINT `fk_tenant_runtime_credentials_tenant`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

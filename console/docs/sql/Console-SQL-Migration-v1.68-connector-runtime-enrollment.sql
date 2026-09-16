-- Console SQL Migration v1.68: Enterprise Connector Runtime enrollment.
-- Date: 2026-07-14
-- Safe to run repeatedly. Does not create or rotate credentials.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `connector_runtime_enrollments` (
  `enrollment_id` CHAR(36) NOT NULL,
  `enrollment_token_sha256` CHAR(64) NOT NULL,
  `tenant_code` VARCHAR(100) NOT NULL,
  `deployment_code` VARCHAR(100) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'issued',
  `expires_at` DATETIME(3) NOT NULL,
  `redeemed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`enrollment_id`),
  UNIQUE KEY `uk_connector_runtime_enrollment_token` (`enrollment_token_sha256`),
  KEY `idx_connector_runtime_enrollment_binding` (`tenant_code`, `deployment_code`, `status`, `expires_at`),
  CONSTRAINT `ck_connector_runtime_enrollment_status`
    CHECK (`status` IN ('issued', 'redeemed', 'revoked', 'expired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `connector_runtime_instances` (
  `connector_id` VARCHAR(128) NOT NULL,
  `tenant_code` VARCHAR(100) NOT NULL,
  `deployment_code` VARCHAR(100) NOT NULL,
  `public_key_pem` TEXT NOT NULL,
  `capabilities_json` JSON NULL,
  `agent_version` VARCHAR(64) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `last_seen_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`connector_id`),
  UNIQUE KEY `uk_connector_runtime_binding` (`tenant_code`, `deployment_code`),
  KEY `idx_connector_runtime_status` (`status`, `last_seen_at`),
  CONSTRAINT `ck_connector_runtime_status`
    CHECK (`status` IN ('active', 'inactive', 'revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT `table_name`
FROM `information_schema`.`tables`
WHERE `table_schema` = DATABASE()
  AND `table_name` IN ('connector_runtime_enrollments', 'connector_runtime_instances')
ORDER BY `table_name`;

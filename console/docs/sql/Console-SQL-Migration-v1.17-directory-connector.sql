-- Console SQL Migration v1.17: Tenant Directory Connector enrollment and identity.
-- Date: 2026-07-12
-- Safe to run repeatedly.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Directory Connector reuses Console's reliable operation ledger. Keep this
-- migration self-contained for installations that have not yet applied the
-- broader Directory lifecycle reliability migration.
CREATE TABLE IF NOT EXISTS `integration_operation` (
  `operation_id` CHAR(36) NOT NULL,
  `operation_key` VARCHAR(191) NOT NULL,
  `tenant_code` VARCHAR(100) NOT NULL,
  `deployment_code` VARCHAR(100) NOT NULL,
  `source_app` VARCHAR(50) NOT NULL,
  `target_app` VARCHAR(50) NOT NULL,
  `operation_code` VARCHAR(191) NOT NULL,
  `required_capability` VARCHAR(191) NOT NULL,
  `source_biz_type` VARCHAR(100) NOT NULL,
  `source_biz_code` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `command_schema_version` VARCHAR(30) NOT NULL,
  `command_json` JSON NOT NULL,
  `command_sha256` CHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `fencing_token` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `locked_until` DATETIME(3) NULL,
  `target_receipt_id` CHAR(36) NULL,
  `target_biz_type` VARCHAR(100) NULL,
  `target_biz_code` VARCHAR(191) NULL,
  `response_summary_sha256` CHAR(64) NULL,
  `original_actor_uid` VARCHAR(100) NULL,
  `service_client_id` VARCHAR(100) NULL,
  `last_error_code` VARCHAR(100) NULL,
  `last_error_class` VARCHAR(50) NULL,
  `last_error_summary` VARCHAR(1000) NULL,
  `succeeded_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`operation_id`),
  UNIQUE KEY `uk_console_iop_key` (`tenant_code`, `deployment_code`, `source_app`, `operation_key`),
  KEY `idx_console_iop_due` (`status`, `next_attempt_at`, `locked_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `integration_operation_attempt` (
  `attempt_id` CHAR(36) NOT NULL,
  `operation_id` CHAR(36) NOT NULL,
  `attempt_no` INT UNSIGNED NOT NULL,
  `fencing_token` BIGINT UNSIGNED NOT NULL,
  `result_status` VARCHAR(32) NOT NULL,
  `error_code` VARCHAR(100) NULL,
  `started_at` DATETIME(3) NOT NULL,
  `finished_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`attempt_id`),
  UNIQUE KEY `uk_console_ioa_attempt` (`operation_id`, `attempt_no`),
  KEY `idx_console_ioa_status` (`result_status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `directory_connector_enrollments` (
  `enrollment_jti` CHAR(36) NOT NULL,
  `tenant_code` VARCHAR(100) NOT NULL,
  `deployment_code` VARCHAR(100) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'redeemed',
  `expires_at` DATETIME(3) NOT NULL,
  `redeemed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`enrollment_jti`),
  KEY `idx_directory_connector_enrollment_binding` (`tenant_code`, `deployment_code`, `status`),
  CONSTRAINT `ck_directory_connector_enrollment_status`
    CHECK (`status` IN ('redeemed', 'revoked', 'expired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `directory_connectors` (
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
  UNIQUE KEY `uk_directory_connector_binding` (`tenant_code`, `deployment_code`),
  KEY `idx_directory_connector_status` (`status`, `last_seen_at`),
  CONSTRAINT `ck_directory_connector_status`
    CHECK (`status` IN ('active', 'inactive', 'revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'directory_connector_enrollments' AS `table_name`, COUNT(*) AS `row_count`
FROM `directory_connector_enrollments`
UNION ALL
SELECT 'directory_connectors', COUNT(*)
FROM `directory_connectors`;

SELECT `table_name`
FROM `information_schema`.`tables`
WHERE `table_schema` = DATABASE()
  AND `table_name` IN (
    'integration_operation',
    'integration_operation_attempt',
    'directory_connector_enrollments',
    'directory_connectors'
  )
ORDER BY `table_name`;

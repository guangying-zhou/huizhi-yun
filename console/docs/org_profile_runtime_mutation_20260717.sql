-- Repeatable migration for Console org-profile writes through Tenant Runtime.
-- Adds optimistic concurrency and a transaction-local idempotency receipt.

SET @org_profile_revision_exists := (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'org_profiles'
     AND column_name = 'revision'
);
SET @org_profile_revision_ddl := IF(
  @org_profile_revision_exists = 0,
  'ALTER TABLE `org_profiles` ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `status`',
  'SELECT 1'
);
PREPARE org_profile_revision_statement FROM @org_profile_revision_ddl;
EXECUTE org_profile_revision_statement;
DEALLOCATE PREPARE org_profile_revision_statement;

CREATE TABLE IF NOT EXISTS `console_mutation_receipts` (
  `receipt_id` CHAR(36) NOT NULL,
  `tenant_code` VARCHAR(64) NOT NULL,
  `operation_code` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `idempotency_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_sha256` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `actor_type` VARCHAR(32) NOT NULL,
  `actor_id` VARCHAR(128) NULL,
  `request_id` VARCHAR(64) NULL,
  `response_http_status` SMALLINT UNSIGNED NULL,
  `result_json` JSON NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`receipt_id`),
  UNIQUE KEY `uk_console_mutation_receipt_identity`
    (`tenant_code`, `operation_code`, `idempotency_key`),
  KEY `idx_console_mutation_receipt_status_time` (`status`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

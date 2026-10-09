-- Repeatable upgrade for Console's target-owned reliable command inbox.
--
-- Older Console schemas created service_command_receipt before receipt
-- fencing, optimistic versioning and request-correlation evidence were added
-- to the shared Tenant Runtime contract. Apply this migration before enabling
-- People -> Console lifecycle commands through Data Runtime.

SET @console_receipt_schema := DATABASE();

SET @console_receipt_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = @console_receipt_schema
      AND table_name = 'service_command_receipt'
      AND column_name = 'locked_by'
  ),
  'SELECT 1',
  'ALTER TABLE `service_command_receipt` ADD COLUMN `locked_by` VARCHAR(100) NULL AFTER `status`'
);
PREPARE console_receipt_stmt FROM @console_receipt_ddl;
EXECUTE console_receipt_stmt;
DEALLOCATE PREPARE console_receipt_stmt;

SET @console_receipt_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = @console_receipt_schema
      AND table_name = 'service_command_receipt'
      AND column_name = 'locked_until'
  ),
  'SELECT 1',
  'ALTER TABLE `service_command_receipt` ADD COLUMN `locked_until` DATETIME(3) NULL AFTER `locked_by`'
);
PREPARE console_receipt_stmt FROM @console_receipt_ddl;
EXECUTE console_receipt_stmt;
DEALLOCATE PREPARE console_receipt_stmt;

SET @console_receipt_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = @console_receipt_schema
      AND table_name = 'service_command_receipt'
      AND column_name = 'fencing_token'
  ),
  'SELECT 1',
  'ALTER TABLE `service_command_receipt` ADD COLUMN `fencing_token` BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `locked_until`'
);
PREPARE console_receipt_stmt FROM @console_receipt_ddl;
EXECUTE console_receipt_stmt;
DEALLOCATE PREPARE console_receipt_stmt;

SET @console_receipt_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = @console_receipt_schema
      AND table_name = 'service_command_receipt'
      AND column_name = 'version_no'
  ),
  'SELECT 1',
  'ALTER TABLE `service_command_receipt` ADD COLUMN `version_no` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `fencing_token`'
);
PREPARE console_receipt_stmt FROM @console_receipt_ddl;
EXECUTE console_receipt_stmt;
DEALLOCATE PREPARE console_receipt_stmt;

SET @console_receipt_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = @console_receipt_schema
      AND table_name = 'service_command_receipt'
      AND column_name = 'first_request_id'
  ),
  'SELECT 1',
  'ALTER TABLE `service_command_receipt` ADD COLUMN `first_request_id` VARCHAR(100) NULL AFTER `version_no`'
);
PREPARE console_receipt_stmt FROM @console_receipt_ddl;
EXECUTE console_receipt_stmt;
DEALLOCATE PREPARE console_receipt_stmt;

SET @console_receipt_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = @console_receipt_schema
      AND table_name = 'service_command_receipt'
      AND column_name = 'last_request_id'
  ),
  'SELECT 1',
  'ALTER TABLE `service_command_receipt` ADD COLUMN `last_request_id` VARCHAR(100) NULL AFTER `first_request_id`'
);
PREPARE console_receipt_stmt FROM @console_receipt_ddl;
EXECUTE console_receipt_stmt;
DEALLOCATE PREPARE console_receipt_stmt;

SET @console_receipt_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = @console_receipt_schema
      AND table_name = 'service_command_receipt'
      AND column_name = 'correlation_id'
  ),
  'SELECT 1',
  'ALTER TABLE `service_command_receipt` ADD COLUMN `correlation_id` VARCHAR(100) NULL AFTER `last_request_id`'
);
PREPARE console_receipt_stmt FROM @console_receipt_ddl;
EXECUTE console_receipt_stmt;
DEALLOCATE PREPARE console_receipt_stmt;

SET @console_receipt_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = @console_receipt_schema
      AND table_name = 'service_command_receipt'
      AND column_name = 'original_actor_uid'
  ),
  'SELECT 1',
  'ALTER TABLE `service_command_receipt` ADD COLUMN `original_actor_uid` VARCHAR(100) NULL AFTER `correlation_id`'
);
PREPARE console_receipt_stmt FROM @console_receipt_ddl;
EXECUTE console_receipt_stmt;
DEALLOCATE PREPARE console_receipt_stmt;

ALTER TABLE `service_command_receipt`
  MODIFY COLUMN `status` VARCHAR(32) NOT NULL DEFAULT 'processing',
  MODIFY COLUMN `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  MODIFY COLUMN `last_received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  MODIFY COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

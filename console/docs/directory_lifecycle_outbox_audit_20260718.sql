-- Repeatable audit-column upgrade for the Console-owned Platform lifecycle
-- outbox. Data Runtime writes these fields atomically with People lifecycle
-- projection, so they must exist before lifecycle commands are enabled.

SET @console_lifecycle_schema := DATABASE();

SET @console_lifecycle_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = @console_lifecycle_schema
      AND table_name = 'integration_operation'
      AND column_name = 'original_request_id'
  ),
  'SELECT 1',
  'ALTER TABLE `integration_operation` ADD COLUMN `original_request_id` VARCHAR(100) NULL AFTER `response_summary_sha256`'
);
PREPARE console_lifecycle_stmt FROM @console_lifecycle_ddl;
EXECUTE console_lifecycle_stmt;
DEALLOCATE PREPARE console_lifecycle_stmt;

SET @console_lifecycle_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = @console_lifecycle_schema
      AND table_name = 'integration_operation'
      AND column_name = 'created_by'
  ),
  'SELECT 1',
  'ALTER TABLE `integration_operation` ADD COLUMN `created_by` VARCHAR(100) NULL AFTER `last_error_summary`'
);
PREPARE console_lifecycle_stmt FROM @console_lifecycle_ddl;
EXECUTE console_lifecycle_stmt;
DEALLOCATE PREPARE console_lifecycle_stmt;

SET @console_lifecycle_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = @console_lifecycle_schema
      AND table_name = 'integration_operation'
      AND column_name = 'updated_by'
  ),
  'SELECT 1',
  'ALTER TABLE `integration_operation` ADD COLUMN `updated_by` VARCHAR(100) NULL AFTER `created_by`'
);
PREPARE console_lifecycle_stmt FROM @console_lifecycle_ddl;
EXECUTE console_lifecycle_stmt;
DEALLOCATE PREPARE console_lifecycle_stmt;

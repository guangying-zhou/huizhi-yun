-- Existing deployments: split source and target deployment identity in receipts and add dead-letter notification evidence.
-- Idempotent on MySQL 8.

SET @schema_name = DATABASE();
SET @has_target_receipt = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'integration_operation'
    AND column_name = 'target_receipt_id'
);
SET @sql = IF(
  @has_target_receipt = 0,
  'ALTER TABLE integration_operation ADD COLUMN target_receipt_id CHAR(36) NULL AFTER source_biz_code',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_failure_notification_id = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'integration_operation'
    AND column_name = 'failure_notification_id'
);
SET @sql = IF(
  @has_failure_notification_id = 0,
  'ALTER TABLE integration_operation ADD COLUMN failure_notification_id VARCHAR(64) NULL AFTER failure_notified_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_failure_notification_index = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'integration_operation'
    AND index_name = 'idx_iop_failure_notification'
);
SET @sql = IF(
  @has_failure_notification_index = 0,
  'ALTER TABLE integration_operation ADD INDEX idx_iop_failure_notification (tenant_code, deployment_code, source_app, status, failure_notified_at, dead_lettered_at, operation_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


SET @has_source_deployment = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'service_command_receipt'
    AND column_name = 'source_deployment_code'
);
SET @sql = IF(
  @has_source_deployment = 0,
  'ALTER TABLE service_command_receipt ADD COLUMN source_deployment_code VARCHAR(100) NULL AFTER tenant_code',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE service_command_receipt
SET source_deployment_code = deployment_code
WHERE source_deployment_code IS NULL OR source_deployment_code = '';

ALTER TABLE service_command_receipt
  MODIFY source_deployment_code VARCHAR(100) NOT NULL COMMENT '目标 BFF 验证后的调用方部署；创建后不可修改';

SET @has_identity_sha256 = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'service_command_receipt'
    AND column_name = 'identity_sha256'
);
SET @sql = IF(
  @has_identity_sha256 = 0,
  'ALTER TABLE service_command_receipt ADD COLUMN identity_sha256 BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(CONCAT_WS(''|'', tenant_code, source_deployment_code, deployment_code, source_app, target_app, operation_code, idempotency_key), 256))) STORED AFTER idempotency_key',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_identity_index = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'service_command_receipt'
    AND index_name = 'uk_scr_identity'
);
SET @sql = IF(@has_identity_index > 0, 'ALTER TABLE service_command_receipt DROP INDEX uk_scr_identity', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_operation_index = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'service_command_receipt'
    AND index_name = 'uk_scr_operation_id'
);
SET @sql = IF(@has_operation_index > 0, 'ALTER TABLE service_command_receipt DROP INDEX uk_scr_operation_id', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE service_command_receipt
  ADD UNIQUE KEY uk_scr_identity (identity_sha256),
  ADD UNIQUE KEY uk_scr_operation_id (operation_id);

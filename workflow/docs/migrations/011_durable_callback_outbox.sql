-- 将 flow_callback_logs 升级为 Workflow 终态回调可靠 outbox。

SET @schema_name = DATABASE();

SET @has_idempotency_key = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'flow_callback_logs'
    AND COLUMN_NAME = 'idempotency_key'
);
SET @ddl = IF(
  @has_idempotency_key = 0,
  'ALTER TABLE flow_callback_logs ADD COLUMN idempotency_key VARCHAR(191) NULL AFTER payload',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_next_attempt_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'flow_callback_logs'
    AND COLUMN_NAME = 'next_attempt_at'
);
SET @ddl = IF(
  @has_next_attempt_at = 0,
  'ALTER TABLE flow_callback_logs ADD COLUMN next_attempt_at DATETIME NULL AFTER idempotency_key',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE flow_callback_logs
SET idempotency_key = CONCAT(
  'workflow:callback:', instance_id, ':', event, ':legacy:', id
)
WHERE idempotency_key IS NULL OR TRIM(idempotency_key) = '';

ALTER TABLE flow_callback_logs
  MODIFY COLUMN idempotency_key VARCHAR(191) NOT NULL;

SET @has_idempotency_index = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'flow_callback_logs'
    AND INDEX_NAME = 'uk_callback_idempotency'
);
SET @ddl = IF(
  @has_idempotency_index = 0,
  'ALTER TABLE flow_callback_logs ADD UNIQUE KEY uk_callback_idempotency (idempotency_key)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

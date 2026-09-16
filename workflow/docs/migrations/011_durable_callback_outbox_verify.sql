SELECT
  CASE WHEN COUNT(*) = 2 THEN 'PASS' ELSE 'FAIL' END AS callback_outbox_columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'flow_callback_logs'
  AND COLUMN_NAME IN ('idempotency_key', 'next_attempt_at');

SELECT
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS callback_outbox_unique_key
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'flow_callback_logs'
  AND INDEX_NAME = 'uk_callback_idempotency';

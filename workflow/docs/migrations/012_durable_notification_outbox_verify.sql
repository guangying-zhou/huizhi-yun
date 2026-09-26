SELECT
  CASE WHEN COUNT(*) = 12 THEN 'PASS' ELSE 'FAIL' END AS notification_outbox_columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'flow_notification_outbox';

SELECT
  CASE WHEN COUNT(DISTINCT INDEX_NAME) = 4 THEN 'PASS' ELSE 'FAIL' END AS notification_outbox_indexes
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'flow_notification_outbox'
  AND INDEX_NAME IN ('PRIMARY', 'uk_notification_outbox_idempotency', 'idx_notification_outbox_delivery', 'idx_notification_outbox_actionable');

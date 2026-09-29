-- Every result must be PASS; run against the target Workflow database only.
SELECT CASE WHEN COUNT(*)=4 THEN 'PASS' ELSE 'FAIL' END AS bounded_delivery_status_columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE()
  AND ((TABLE_NAME='flow_notification_outbox' AND COLUMN_NAME='delivery_status' AND COLUMN_TYPE LIKE '%abandoned%')
    OR (TABLE_NAME='flow_actionable_outbox' AND COLUMN_NAME='delivery_status' AND COLUMN_TYPE LIKE '%abandoned%')
    OR (TABLE_NAME='flow_callback_logs' AND COLUMN_NAME='status' AND COLUMN_TYPE LIKE '%abandoned%')
    OR (TABLE_NAME='flow_actionable_outbox' AND COLUMN_NAME='depends_on_notification_outbox_id' AND DATA_TYPE='bigint'));

SELECT CASE WHEN COUNT(*)=12 THEN 'PASS' ELSE 'FAIL' END AS bounded_delivery_diagnostic_columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE()
  AND TABLE_NAME IN ('flow_notification_outbox','flow_actionable_outbox','flow_callback_logs')
  AND COLUMN_NAME IN ('version_no','abandoned_at','last_error_code','last_http_status');

SELECT CASE WHEN COUNT(*)=1 THEN 'PASS' ELSE 'FAIL' END AS bounded_delivery_dependency_index
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flow_actionable_outbox'
  AND INDEX_NAME='idx_actionable_notification_dependency';

SELECT CASE WHEN COUNT(*)=1 THEN 'PASS' ELSE 'FAIL' END AS bounded_delivery_audit_table
FROM information_schema.TABLES
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flow_delivery_audit' AND TABLE_TYPE='BASE TABLE';

SELECT IF(COUNT(*) = 3, 'PASS', 'FAIL') AS result
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flow_delivery_audit'
  AND ((COLUMN_NAME = 'credential_id' AND DATA_TYPE = 'bigint' AND IS_NULLABLE = 'YES')
    OR (COLUMN_NAME = 'request_id' AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 191 AND IS_NULLABLE = 'YES')
    OR (COLUMN_NAME = 'recovery_reason' AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 200 AND IS_NULLABLE = 'YES'));

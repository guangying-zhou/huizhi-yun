-- Read-only. Three rows, each must be PASS after 20260929_backfill_schema_drift.sql.
SELECT CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS config_detail
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_physical_details' AND COLUMN_NAME = 'config_detail'
  AND DATA_TYPE = 'text' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL
  AND ORDINAL_POSITION = (SELECT ORDINAL_POSITION + 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_physical_details' AND COLUMN_NAME = 'model');

SELECT CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS artifact_type
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_documents' AND COLUMN_NAME = 'artifact_type'
  AND COLUMN_TYPE = "enum('solution','requirement','design','test_report','deployment_manual','acceptance_report','training_material','ops_knowledge','customer_environment_record')"
  AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL
  AND ORDINAL_POSITION = (SELECT ORDINAL_POSITION + 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_documents' AND COLUMN_NAME = 'document_type');

SELECT CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS source_context
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_documents' AND COLUMN_NAME = 'source_context'
  AND DATA_TYPE = 'json' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL
  AND ORDINAL_POSITION = (SELECT ORDINAL_POSITION + 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_documents' AND COLUMN_NAME = 'artifact_type');

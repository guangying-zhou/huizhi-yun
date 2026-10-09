-- Rollback for 20260929_backfill_schema_drift.sql. Only while none of the three
-- columns holds data: the precondition below selects from a non-existent table
-- (aborting before any DROP) if any row has a value in them.
SET @hzy_drift_used = (
  (SELECT COUNT(*) FROM `asset_physical_details` WHERE `config_detail` IS NOT NULL)
  + (SELECT COUNT(*) FROM `asset_documents` WHERE `artifact_type` IS NOT NULL OR `source_context` IS NOT NULL)
);
SET @hzy_drift_guard = IF(@hzy_drift_used = 0, 'SELECT 1', 'SELECT * FROM hzy_schema_drift_columns_in_use');
PREPARE hzy_drift_guard_stmt FROM @hzy_drift_guard;
EXECUTE hzy_drift_guard_stmt;
DEALLOCATE PREPARE hzy_drift_guard_stmt;

ALTER TABLE `asset_documents` DROP COLUMN `source_context`, DROP COLUMN `artifact_type`;
ALTER TABLE `asset_physical_details` DROP COLUMN `config_detail`;

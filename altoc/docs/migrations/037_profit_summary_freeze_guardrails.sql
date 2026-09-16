-- Altoc migration 037: profit summary freeze guardrails.
-- Adds close-period fields used by Goal 3 operating accounting so frozen
-- contract-line profit summaries cannot be recalculated or have allocations
-- rewritten through the runtime service API.

SET @hzy_037_has_frozen_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'contract_line_profit_summary'
    AND COLUMN_NAME = 'frozen_at'
);
SET @hzy_037_frozen_at_sql := IF(
  @hzy_037_has_frozen_at = 0,
  'ALTER TABLE contract_line_profit_summary ADD COLUMN frozen_at DATETIME DEFAULT NULL COMMENT ''财务冻结时间；冻结后禁止重算和分摊改写'' AFTER is_current',
  'SELECT ''contract_line_profit_summary.frozen_at already exists'' AS msg'
);
PREPARE stmt FROM @hzy_037_frozen_at_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @hzy_037_has_frozen_by := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'contract_line_profit_summary'
    AND COLUMN_NAME = 'frozen_by'
);
SET @hzy_037_frozen_by_sql := IF(
  @hzy_037_has_frozen_by = 0,
  'ALTER TABLE contract_line_profit_summary ADD COLUMN frozen_by VARCHAR(50) DEFAULT NULL COMMENT ''财务冻结人'' AFTER frozen_at',
  'SELECT ''contract_line_profit_summary.frozen_by already exists'' AS msg'
);
PREPARE stmt FROM @hzy_037_frozen_by_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @hzy_037_has_freeze_key := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'contract_line_profit_summary'
    AND COLUMN_NAME = 'freeze_key'
);
SET @hzy_037_freeze_key_sql := IF(
  @hzy_037_has_freeze_key = 0,
  'ALTER TABLE contract_line_profit_summary ADD COLUMN freeze_key VARCHAR(160) DEFAULT NULL COMMENT ''冻结幂等键或审批引用'' AFTER frozen_by',
  'SELECT ''contract_line_profit_summary.freeze_key already exists'' AS msg'
);
PREPARE stmt FROM @hzy_037_freeze_key_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @hzy_037_has_frozen_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'contract_line_profit_summary'
    AND INDEX_NAME = 'idx_clps_frozen'
);
SET @hzy_037_frozen_idx_sql := IF(
  @hzy_037_has_frozen_idx = 0,
  'CREATE INDEX idx_clps_frozen ON contract_line_profit_summary (contract_line_code, period_start, period_end, frozen_at)',
  'SELECT ''contract_line_profit_summary.idx_clps_frozen already exists'' AS msg'
);
PREPARE stmt FROM @hzy_037_frozen_idx_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT
  (SELECT COUNT(*) FROM contract_line_profit_summary WHERE deleted_at IS NULL AND frozen_at IS NOT NULL) AS frozen_profit_summary_count;

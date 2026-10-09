-- Persist project cost readiness and invalidate unverifiable legacy gross profit.
-- Run in hzy_finance after finance_people_cost_parameter_incremental.sql.
-- Safe to re-run. Historical rows are deliberately not inferred as ready.

USE hzy_finance;

DROP PROCEDURE IF EXISTS hzy_finance_add_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_finance_add_index_if_missing;

DELIMITER $$

CREATE PROCEDURE hzy_finance_add_column_if_missing(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_column_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = p_table_name
      AND column_name = p_column_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE \`', p_table_name, '\` ADD COLUMN ', p_column_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE hzy_finance_add_index_if_missing(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_index_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = p_table_name
      AND index_name = p_index_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE \`', p_table_name, '\` ADD ', p_index_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL hzy_finance_add_column_if_missing(
  'project_finance_summary',
  'cost_readiness_status',
  'cost_readiness_status VARCHAR(20) NOT NULL DEFAULT ''not_ready'' COMMENT ''成本就绪状态：ready/not_ready'' AFTER gross_margin_rate'
);
CALL hzy_finance_add_column_if_missing(
  'project_finance_summary',
  'cost_readiness_reasons_json',
  'cost_readiness_reasons_json JSON DEFAULT NULL COMMENT ''成本未就绪原因和同步证据'' AFTER cost_readiness_status'
);
CALL hzy_finance_add_column_if_missing(
  'project_finance_summary',
  'cost_input_hash',
  'cost_input_hash CHAR(64) DEFAULT NULL COMMENT ''规范化成本输入SHA-256'' AFTER cost_readiness_reasons_json'
);
CALL hzy_finance_add_column_if_missing(
  'project_finance_summary',
  'cost_readiness_checked_at',
  'cost_readiness_checked_at DATETIME(6) DEFAULT NULL COMMENT ''最近完整成本预检/同步时间'' AFTER cost_input_hash'
);
CALL hzy_finance_add_column_if_missing(
  'project_cost_allocation',
  'source_refs_json',
  'source_refs_json JSON DEFAULT NULL COMMENT ''分摊输入与来源快照'' AFTER rule_code'
);
CALL hzy_finance_add_index_if_missing(
  'project_finance_summary',
  'idx_project_summary_period_readiness',
  'INDEX idx_project_summary_period_readiness (period_month, cost_readiness_status)'
);

ALTER TABLE project_finance_summary
  MODIFY COLUMN gross_profit_amount DECIMAL(18,2) DEFAULT NULL COMMENT '毛利额；成本未就绪时必须为NULL';

UPDATE project_finance_summary
SET cost_readiness_status = 'not_ready',
    cost_readiness_reasons_json = COALESCE(
      cost_readiness_reasons_json,
      JSON_ARRAY(JSON_OBJECT('code', 'legacy_readiness_unverified'))
    ),
    cost_readiness_checked_at = COALESCE(cost_readiness_checked_at, CURRENT_TIMESTAMP(6)),
    gross_profit_amount = NULL,
    gross_margin_rate = NULL
WHERE cost_readiness_status <> 'ready'
   OR cost_input_hash IS NULL;

DROP PROCEDURE IF EXISTS hzy_finance_add_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_finance_add_index_if_missing;

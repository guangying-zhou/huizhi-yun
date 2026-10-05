-- ============================================================
-- Migration 023: Structured opportunity won reasons
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database.

DROP PROCEDURE IF EXISTS hzy_add_opportunity_won_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_add_opportunity_won_index_if_missing;

DELIMITER $$

CREATE PROCEDURE hzy_add_opportunity_won_column_if_missing(
  IN p_column_name VARCHAR(64),
  IN p_column_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'opportunity'
      AND column_name = p_column_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE opportunity ADD COLUMN ', p_column_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE hzy_add_opportunity_won_index_if_missing(
  IN p_index_name VARCHAR(64),
  IN p_index_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'opportunity'
      AND index_name = p_index_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE opportunity ADD ', p_index_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL hzy_add_opportunity_won_column_if_missing('won_reason_code', 'won_reason_code VARCHAR(50) DEFAULT NULL COMMENT ''结构化赢单原因编码'' AFTER won_at');
CALL hzy_add_opportunity_won_column_if_missing('won_reason', 'won_reason VARCHAR(500) DEFAULT NULL COMMENT ''赢单原因'' AFTER won_reason_code');

CALL hzy_add_opportunity_won_index_if_missing('idx_won_reason_code', 'INDEX idx_won_reason_code (won_reason_code)');

UPDATE opportunity_stage
SET required_fields_json = JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date', 'won_reason_code', 'won_reason')
WHERE code = 'won'
  AND (
    required_fields_json IS NULL
    OR JSON_LENGTH(required_fields_json) = 0
    OR JSON_CONTAINS(required_fields_json, JSON_QUOTE('amount_tax_inclusive')) = 0
    OR JSON_CONTAINS(required_fields_json, JSON_QUOTE('expected_sign_date')) = 0
    OR JSON_CONTAINS(required_fields_json, JSON_QUOTE('won_reason_code')) = 0
    OR JSON_CONTAINS(required_fields_json, JSON_QUOTE('won_reason')) = 0
  );

DROP PROCEDURE IF EXISTS hzy_add_opportunity_won_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_add_opportunity_won_index_if_missing;

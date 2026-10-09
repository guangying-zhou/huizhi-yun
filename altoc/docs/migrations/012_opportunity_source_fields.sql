-- ============================================================
-- Migration 012: Opportunity source fields
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database.

DROP PROCEDURE IF EXISTS hzy_add_opportunity_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_add_opportunity_index_if_missing;

DELIMITER $$

CREATE PROCEDURE hzy_add_opportunity_column_if_missing(
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

CREATE PROCEDURE hzy_add_opportunity_index_if_missing(
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

CALL hzy_add_opportunity_column_if_missing(
  'source_type',
  'source_type VARCHAR(50) DEFAULT NULL COMMENT ''商机来源：customer_visit/existing_customer_revisit/telemarketing/online_promotion/referral/other'' AFTER lead_id'
);
CALL hzy_add_opportunity_column_if_missing(
  'source_detail',
  'source_detail VARCHAR(500) DEFAULT NULL COMMENT ''商机来源详细说明'' AFTER source_type'
);
CALL hzy_add_opportunity_index_if_missing(
  'idx_source_type',
  'INDEX idx_source_type (source_type)'
);

DROP PROCEDURE IF EXISTS hzy_add_opportunity_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_add_opportunity_index_if_missing;

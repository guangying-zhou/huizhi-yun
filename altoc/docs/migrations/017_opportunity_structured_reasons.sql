-- ============================================================
-- Migration 017: Structured opportunity lost/pause reasons
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

CALL hzy_add_opportunity_column_if_missing('lost_reason_code', 'lost_reason_code VARCHAR(50) DEFAULT NULL COMMENT ''结构化输单原因编码'' AFTER lost_at');
CALL hzy_add_opportunity_column_if_missing('pause_reason_code', 'pause_reason_code VARCHAR(50) DEFAULT NULL COMMENT ''结构化暂停原因编码'' AFTER lost_reason');

CALL hzy_add_opportunity_index_if_missing('idx_lost_reason_code', 'INDEX idx_lost_reason_code (lost_reason_code)');
CALL hzy_add_opportunity_index_if_missing('idx_pause_reason_code', 'INDEX idx_pause_reason_code (pause_reason_code)');

DROP PROCEDURE IF EXISTS hzy_add_opportunity_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_add_opportunity_index_if_missing;

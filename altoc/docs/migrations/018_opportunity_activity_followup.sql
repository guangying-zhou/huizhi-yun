-- Migration 018: Opportunity activity follow-up timestamp
-- Keep opportunity activity side effects aligned with the tenant-runtime command.

DROP PROCEDURE IF EXISTS hzy_add_opportunity_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_add_opportunity_index_if_missing;

DELIMITER //

CREATE PROCEDURE hzy_add_opportunity_column_if_missing(
  IN p_column_name VARCHAR(64),
  IN p_column_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name = 'opportunity'
      AND column_name = p_column_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE opportunity ADD COLUMN ', p_column_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

CREATE PROCEDURE hzy_add_opportunity_index_if_missing(
  IN p_index_name VARCHAR(64),
  IN p_index_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE table_schema = DATABASE()
      AND table_name = 'opportunity'
      AND index_name = p_index_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE opportunity ADD ', p_index_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

DELIMITER ;

CALL hzy_add_opportunity_column_if_missing(
  'last_follow_up_at',
  'last_follow_up_at DATETIME DEFAULT NULL COMMENT ''最近跟进时间'' AFTER next_action_due_at'
);
CALL hzy_add_opportunity_index_if_missing(
  'idx_last_follow_up_at',
  'INDEX idx_last_follow_up_at (last_follow_up_at)'
);

DROP PROCEDURE IF EXISTS hzy_add_opportunity_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_add_opportunity_index_if_missing;

-- Add missing submission timestamp to Finance invoice requests.
-- Run in hzy_finance. Safe to re-run.

USE hzy_finance;

DROP PROCEDURE IF EXISTS hzy_add_column_if_missing;

DELIMITER $$

CREATE PROCEDURE hzy_add_column_if_missing(
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
    SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL hzy_add_column_if_missing(
  'invoice_request',
  'submitted_at',
  'submitted_at DATETIME DEFAULT NULL COMMENT ''提交时间'' AFTER requested_by'
);

DROP PROCEDURE IF EXISTS hzy_add_column_if_missing;

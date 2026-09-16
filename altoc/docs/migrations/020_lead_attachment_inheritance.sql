-- Migration 020: Lead attachment inheritance support
-- Run in hzy_altoc or the target Altoc tenant database.

DROP PROCEDURE IF EXISTS hzy_add_attachment_column_if_missing;

DELIMITER //

CREATE PROCEDURE hzy_add_attachment_column_if_missing(
  IN p_column_name VARCHAR(64),
  IN p_column_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name = 'attachment'
      AND column_name = p_column_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE attachment ADD COLUMN ', p_column_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

DELIMITER ;

CALL hzy_add_attachment_column_if_missing(
  'attachment_type',
  'attachment_type VARCHAR(30) DEFAULT ''general'' COMMENT ''附件类型：general/contract_text/contract_scan/source_evidence等'' AFTER entity_id'
);

DROP PROCEDURE IF EXISTS hzy_add_attachment_column_if_missing;

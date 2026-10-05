-- Add invoice medium and source-file metadata to Finance invoices.
-- Run in hzy_finance. Safe to re-run.

USE hzy_finance;

DROP PROCEDURE IF EXISTS hzy_add_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_add_index_if_missing;

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

CREATE PROCEDURE hzy_add_index_if_missing(
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
    SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD ', p_index_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL hzy_add_column_if_missing('finance_invoice', 'invoice_medium', 'invoice_medium VARCHAR(20) DEFAULT ''electronic'' COMMENT ''发票介质：electronic电子/paper纸质'' AFTER invoice_type');
CALL hzy_add_column_if_missing('finance_invoice', 'invoice_file_url', 'invoice_file_url VARCHAR(1000) DEFAULT NULL COMMENT ''发票文件URL，电子票为PDF/OFD，纸质票为PDF扫描件'' AFTER receiver_name');
CALL hzy_add_column_if_missing('finance_invoice', 'invoice_file_name', 'invoice_file_name VARCHAR(255) DEFAULT NULL COMMENT ''发票文件名'' AFTER invoice_file_url');
CALL hzy_add_column_if_missing('finance_invoice', 'invoice_file_mime_type', 'invoice_file_mime_type VARCHAR(100) DEFAULT NULL COMMENT ''发票文件MIME类型'' AFTER invoice_file_name');
CALL hzy_add_column_if_missing('finance_invoice', 'invoice_file_size', 'invoice_file_size BIGINT DEFAULT NULL COMMENT ''发票文件大小(字节)'' AFTER invoice_file_mime_type');
CALL hzy_add_index_if_missing('finance_invoice', 'idx_finance_invoice_medium', 'INDEX idx_finance_invoice_medium (invoice_medium)');

CALL hzy_add_column_if_missing('invoice_request', 'invoice_medium', 'invoice_medium VARCHAR(20) DEFAULT ''electronic'' COMMENT ''发票介质：electronic电子/paper纸质'' AFTER invoice_type');
CALL hzy_add_index_if_missing('invoice_request', 'idx_invoice_request_medium', 'INDEX idx_invoice_request_medium (invoice_medium)');

DROP PROCEDURE IF EXISTS hzy_add_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_add_index_if_missing;

-- ============================================================
-- Migration 033: Contract master flag
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database after 032.
--
-- Scope:
-- - mark contracts that can be selected as parent/master contracts
-- - keep existing parent_contract_id relation as the child -> master link

DELIMITER $$

CREATE PROCEDURE hzy_contract_master_flag_add_column(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table_name
      AND COLUMN_NAME = p_column_name
  ) THEN
    SET @ddl = p_ddl;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE hzy_contract_master_flag_add_index(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table_name
      AND INDEX_NAME = p_index_name
  ) THEN
    SET @ddl = p_ddl;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL hzy_contract_master_flag_add_column(
  'contract',
  'is_master_contract',
  'ALTER TABLE contract ADD COLUMN is_master_contract TINYINT NOT NULL DEFAULT 0 COMMENT ''是否可作为主合同：1是 0否'' AFTER parent_contract_id'
);

UPDATE contract
SET is_master_contract = CASE
    WHEN parent_contract_id IS NULL THEN 1
    ELSE 0
  END
WHERE deleted_at IS NULL;

CALL hzy_contract_master_flag_add_index(
  'contract',
  'idx_contract_master_candidate',
  'ALTER TABLE contract ADD INDEX idx_contract_master_candidate (is_master_contract, customer_id, direction)'
);

DROP PROCEDURE hzy_contract_master_flag_add_column;
DROP PROCEDURE hzy_contract_master_flag_add_index;

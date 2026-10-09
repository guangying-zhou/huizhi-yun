-- ============================================================
-- Migration 032: Contract project grouping metadata
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database after 031.
--
-- P1-2 scope:
-- - persist activation project plan keys on contract_project_link
-- - keep grouped contract line and obligation codes for one-contract-many-project mappings

DELIMITER $$

CREATE PROCEDURE hzy_contract_project_group_add_column(
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

CREATE PROCEDURE hzy_contract_project_group_add_index(
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

CALL hzy_contract_project_group_add_column('contract_project_link', 'plan_key', 'ALTER TABLE contract_project_link ADD COLUMN plan_key VARCHAR(100) DEFAULT NULL COMMENT ''履约启动项目计划键'' AFTER project_role');
CALL hzy_contract_project_group_add_column('contract_project_link', 'line_codes_json', 'ALTER TABLE contract_project_link ADD COLUMN line_codes_json JSON DEFAULT NULL COMMENT ''覆盖合同行编码JSON'' AFTER plan_key');
CALL hzy_contract_project_group_add_column('contract_project_link', 'obligation_codes_json', 'ALTER TABLE contract_project_link ADD COLUMN obligation_codes_json JSON DEFAULT NULL COMMENT ''覆盖履约义务编码JSON'' AFTER line_codes_json');
CALL hzy_contract_project_group_add_index('contract_project_link', 'idx_contract_project_plan', 'CREATE INDEX idx_contract_project_plan ON contract_project_link (contract_id, plan_key)');

UPDATE contract_project_link
SET plan_key = CASE
    WHEN project_role = 'maintenance' THEN 'project-maintenance'
    WHEN project_role = 'development' THEN 'project-development'
    WHEN project_role = 'implementation' THEN 'project-implementation'
    ELSE 'delivery-main'
  END
WHERE (plan_key IS NULL OR plan_key = '')
  AND deleted_at IS NULL;

DROP PROCEDURE hzy_contract_project_group_add_column;
DROP PROCEDURE hzy_contract_project_group_add_index;

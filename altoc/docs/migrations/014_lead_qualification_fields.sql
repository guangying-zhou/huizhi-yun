-- ============================================================
-- Migration 014: Lead qualification fields
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database.

DROP PROCEDURE IF EXISTS hzy_add_lead_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_add_lead_index_if_missing;

DELIMITER $$

CREATE PROCEDURE hzy_add_lead_column_if_missing(
  IN p_column_name VARCHAR(64),
  IN p_column_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'lead'
      AND column_name = p_column_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `lead` ADD COLUMN ', p_column_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE hzy_add_lead_index_if_missing(
  IN p_index_name VARCHAR(64),
  IN p_index_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'lead'
      AND index_name = p_index_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `lead` ADD ', p_index_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL hzy_add_lead_column_if_missing('need_summary', 'need_summary VARCHAR(1000) DEFAULT NULL COMMENT ''真实需求或客户问题摘要'' AFTER source_detail');
CALL hzy_add_lead_column_if_missing('project_type', 'project_type VARCHAR(30) DEFAULT NULL COMMENT ''项目类型：tob/tog/renewal/upsell/channel'' AFTER need_summary');
CALL hzy_add_lead_column_if_missing('budget_status', 'budget_status VARCHAR(30) DEFAULT NULL COMMENT ''预算状态：unknown/applying/approved/allocated'' AFTER project_type');
CALL hzy_add_lead_column_if_missing('estimated_budget', 'estimated_budget DECIMAL(18,2) DEFAULT NULL COMMENT ''初步预算'' AFTER budget_status');
CALL hzy_add_lead_column_if_missing('procurement_mode', 'procurement_mode VARCHAR(50) DEFAULT NULL COMMENT ''采购方式：direct/competitive_consultation/open_tender/framework/other'' AFTER estimated_budget');
CALL hzy_add_lead_column_if_missing('expected_procurement_date', 'expected_procurement_date DATE DEFAULT NULL COMMENT ''预计采购时间'' AFTER procurement_mode');
CALL hzy_add_lead_column_if_missing('source_evidence_url', 'source_evidence_url VARCHAR(500) DEFAULT NULL COMMENT ''来源证据链接'' AFTER expected_procurement_date');
CALL hzy_add_lead_column_if_missing('qualification_result', 'qualification_result VARCHAR(30) DEFAULT NULL COMMENT ''资格判定：passed/nurture/invalid/duplicate'' AFTER source_evidence_url');
CALL hzy_add_lead_column_if_missing('qualification_reason_code', 'qualification_reason_code VARCHAR(50) DEFAULT NULL COMMENT ''资格判定原因编码'' AFTER qualification_result');
CALL hzy_add_lead_column_if_missing('invalid_reason_code', 'invalid_reason_code VARCHAR(50) DEFAULT NULL COMMENT ''结构化无效原因编码'' AFTER last_follow_up_at');

CALL hzy_add_lead_index_if_missing('idx_qualification_result', 'INDEX idx_qualification_result (qualification_result)');
CALL hzy_add_lead_index_if_missing('idx_expected_procurement_date', 'INDEX idx_expected_procurement_date (expected_procurement_date)');
CALL hzy_add_lead_index_if_missing('idx_invalid_reason_code', 'INDEX idx_invalid_reason_code (invalid_reason_code)');

DROP PROCEDURE IF EXISTS hzy_add_lead_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_add_lead_index_if_missing;

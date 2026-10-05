-- ============================================================
-- Migration 016: Duplicate matching fields and opportunity stakeholders
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database.

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

CALL hzy_add_column_if_missing('customer', 'normalized_name', 'normalized_name VARCHAR(200) DEFAULT NULL COMMENT ''标准化客户名称，用于去重匹配'' AFTER name');
CALL hzy_add_column_if_missing('customer', 'unified_social_credit_code', 'unified_social_credit_code VARCHAR(50) DEFAULT NULL COMMENT ''统一社会信用代码'' AFTER normalized_name');
CALL hzy_add_column_if_missing('customer', 'organization_domain', 'organization_domain VARCHAR(200) DEFAULT NULL COMMENT ''组织官网/邮箱域名，用于去重匹配'' AFTER unified_social_credit_code');

UPDATE customer
SET normalized_name = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(name), ' ', ''), '　', ''), '（', '('), '）', ')'))
WHERE normalized_name IS NULL
  AND name IS NOT NULL;

CALL hzy_add_index_if_missing('customer', 'idx_normalized_name', 'INDEX idx_normalized_name (normalized_name)');
CALL hzy_add_index_if_missing('customer', 'idx_unified_social_credit_code', 'INDEX idx_unified_social_credit_code (unified_social_credit_code)');
CALL hzy_add_index_if_missing('customer', 'idx_organization_domain', 'INDEX idx_organization_domain (organization_domain)');

CALL hzy_add_column_if_missing('contact', 'normalized_mobile', 'normalized_mobile VARCHAR(30) DEFAULT NULL COMMENT ''标准化手机号，用于去重匹配'' AFTER mobile');
CALL hzy_add_column_if_missing('contact', 'normalized_email', 'normalized_email VARCHAR(100) DEFAULT NULL COMMENT ''标准化邮箱，用于去重匹配'' AFTER email');

UPDATE contact
SET normalized_mobile = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(mobile), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '')
WHERE normalized_mobile IS NULL
  AND mobile IS NOT NULL;

UPDATE contact
SET normalized_email = LOWER(TRIM(email))
WHERE normalized_email IS NULL
  AND email IS NOT NULL;

CALL hzy_add_index_if_missing('contact', 'idx_normalized_mobile', 'INDEX idx_normalized_mobile (normalized_mobile)');
CALL hzy_add_index_if_missing('contact', 'idx_normalized_email', 'INDEX idx_normalized_email (normalized_email)');

CREATE TABLE IF NOT EXISTS opportunity_contact_role (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    opportunity_id      BIGINT NOT NULL COMMENT '商机ID',
    contact_id          BIGINT NOT NULL COMMENT '联系人ID',
    role                VARCHAR(50) NOT NULL COMMENT '角色：decision_maker/economic_buyer/sponsor/procurement/technical_influencer/end_user/competitor_supporter',
    influence_level     VARCHAR(20) DEFAULT 'medium' COMMENT '影响力：high/medium/low',
    attitude            VARCHAR(20) DEFAULT 'neutral' COMMENT '态度：supportive/neutral/resistant/unknown',
    is_primary          TINYINT DEFAULT 0 COMMENT '是否主要联系人：1是 0否',
    remark              VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by          VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at          DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_opportunity_contact (opportunity_id, contact_id),
    INDEX idx_opportunity_id (opportunity_id),
    INDEX idx_contact_id (contact_id),
    INDEX idx_role (role),
    INDEX idx_is_primary (is_primary),
    CONSTRAINT fk_ocr_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunity(id) ON DELETE CASCADE,
    CONSTRAINT fk_ocr_contact FOREIGN KEY (contact_id) REFERENCES contact(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商机联系人角色表';

CALL hzy_add_column_if_missing('opportunity_stage_log', 'amount_snapshot', 'amount_snapshot DECIMAL(18,2) DEFAULT NULL COMMENT ''变更后金额快照'' AFTER change_reason');
CALL hzy_add_column_if_missing('opportunity_stage_log', 'forecast_category_snapshot', 'forecast_category_snapshot VARCHAR(20) DEFAULT NULL COMMENT ''变更后预测分类快照'' AFTER amount_snapshot');
CALL hzy_add_column_if_missing('opportunity_stage_log', 'expected_sign_date_snapshot', 'expected_sign_date_snapshot DATE DEFAULT NULL COMMENT ''变更后预计签约日期快照'' AFTER forecast_category_snapshot');
CALL hzy_add_column_if_missing('opportunity_stage_log', 'win_rate_snapshot', 'win_rate_snapshot DECIMAL(5,2) DEFAULT NULL COMMENT ''变更后赢率快照'' AFTER expected_sign_date_snapshot');
CALL hzy_add_column_if_missing('opportunity_stage_log', 'version_no', 'version_no INT DEFAULT NULL COMMENT ''变更后商机版本号'' AFTER win_rate_snapshot');

DROP PROCEDURE IF EXISTS hzy_add_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_add_index_if_missing;

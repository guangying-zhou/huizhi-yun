-- Contract lifecycle stages and structured payment terms.
-- Run in hzy_altoc.

CREATE TABLE IF NOT EXISTS contract_stage (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(30) NOT NULL,
  contract_id BIGINT NOT NULL,
  stage_type VARCHAR(30) NOT NULL,
  stage_name VARCHAR(100) NOT NULL,
  status VARCHAR(30) DEFAULT 'completed',
  stage_date DATE DEFAULT NULL,
  evidence_note VARCHAR(1000) DEFAULT NULL,
  document_uuid VARCHAR(100) DEFAULT NULL,
  document_title VARCHAR(200) DEFAULT NULL,
  handled_by VARCHAR(50) DEFAULT NULL,
  handled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_contract_stage_type (contract_id, stage_type),
  UNIQUE KEY uk_contract_stage_code (code),
  INDEX idx_contract_stage_contract (contract_id),
  INDEX idx_contract_stage_type (stage_type),
  CONSTRAINT fk_contract_stage_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同履约环节表';

DROP PROCEDURE IF EXISTS hzy_add_contract_payment_term_column;
DELIMITER //
CREATE PROCEDURE hzy_add_contract_payment_term_column(
  IN p_column_name VARCHAR(64),
  IN p_alter_sql TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contract_payment_term'
      AND COLUMN_NAME = p_column_name
  ) THEN
    SET @ddl = p_alter_sql;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//
DELIMITER ;

CALL hzy_add_contract_payment_term_column('billing_mode', 'ALTER TABLE contract_payment_term ADD COLUMN billing_mode VARCHAR(30) DEFAULT ''stage'' COMMENT ''计费模式：one_time/ratio/stage/annual'' AFTER term_type');
CALL hzy_add_contract_payment_term_column('trigger_stage_type', 'ALTER TABLE contract_payment_term ADD COLUMN trigger_stage_type VARCHAR(30) DEFAULT NULL COMMENT ''触发合同环节'' AFTER condition_desc');
CALL hzy_add_contract_payment_term_column('recurrence_interval', 'ALTER TABLE contract_payment_term ADD COLUMN recurrence_interval VARCHAR(20) DEFAULT NULL COMMENT ''周期：year/month/quarter'' AFTER expected_date');
CALL hzy_add_contract_payment_term_column('recurrence_month', 'ALTER TABLE contract_payment_term ADD COLUMN recurrence_month TINYINT DEFAULT NULL COMMENT ''年度周期支付月份'' AFTER recurrence_interval');
CALL hzy_add_contract_payment_term_column('recurrence_day', 'ALTER TABLE contract_payment_term ADD COLUMN recurrence_day TINYINT DEFAULT NULL COMMENT ''周期支付日'' AFTER recurrence_month');
CALL hzy_add_contract_payment_term_column('service_start_date', 'ALTER TABLE contract_payment_term ADD COLUMN service_start_date DATE DEFAULT NULL COMMENT ''服务期开始日期'' AFTER recurrence_day');
CALL hzy_add_contract_payment_term_column('service_end_date', 'ALTER TABLE contract_payment_term ADD COLUMN service_end_date DATE DEFAULT NULL COMMENT ''服务期结束日期'' AFTER service_start_date');

DROP PROCEDURE IF EXISTS hzy_add_contract_payment_term_column;

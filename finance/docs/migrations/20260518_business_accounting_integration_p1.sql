-- ============================================================
-- Finance migration: P1 business-accounting integration baseline
-- Date: 2026-05-18
--
-- Scope:
--   1. Add accounting objects.
--   2. Add business-type subject mappings.
--   3. Add nullable accounting dimensions to receipts, expenses and
--      unclassified income.
--   4. Align finance_migration_map with the current migration utility.
--
-- This script is idempotent and does not delete data.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS finance_add_column_if_missing $$
CREATE PROCEDURE finance_add_column_if_missing(
    IN p_table_name VARCHAR(128),
    IN p_column_name VARCHAR(128),
    IN p_column_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD COLUMN `', p_column_name, '` ', p_column_definition);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END $$

DROP PROCEDURE IF EXISTS finance_add_index_if_missing $$
CREATE PROCEDURE finance_add_index_if_missing(
    IN p_table_name VARCHAR(128),
    IN p_index_name VARCHAR(128),
    IN p_index_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD ', p_index_definition);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END $$

DELIMITER ;

START TRANSACTION;

CREATE TABLE IF NOT EXISTS finance_accounting_object (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                VARCHAR(50) NOT NULL COMMENT '核算对象编码',
    name                VARCHAR(200) NOT NULL COMMENT '核算对象名称',
    object_type         VARCHAR(50) NOT NULL COMMENT '类型：customer_project/internal_project/department/contract/customer/sales_region/opportunity/sales_campaign/employee/other',
    source_app          VARCHAR(30) DEFAULT NULL COMMENT '来源应用：finance/altoc/aims/console/migration',
    source_code         VARCHAR(50) DEFAULT NULL COMMENT '来源业务编码',
    legacy_source       VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id           VARCHAR(100) DEFAULT NULL COMMENT '迁移来源主键',
    customer_code       VARCHAR(50) DEFAULT NULL COMMENT '客户编码(Altoc)',
    contract_code       VARCHAR(50) DEFAULT NULL COMMENT '合同编码(Altoc)',
    project_code        VARCHAR(50) DEFAULT NULL COMMENT '项目编码(Aims/Console)',
    department_code     VARCHAR(50) DEFAULT NULL COMMENT '部门编码(Console Directory)',
    sales_region_code   VARCHAR(50) DEFAULT NULL COMMENT '销售区域编码',
    owner_uid           VARCHAR(50) DEFAULT NULL COMMENT '负责人UID',
    status              VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
    remark              VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_accounting_object_code (code),
    UNIQUE KEY uk_accounting_object_legacy (legacy_source, legacy_id),
    INDEX idx_accounting_object_type (object_type),
    INDEX idx_accounting_object_customer (customer_code),
    INDEX idx_accounting_object_contract (contract_code),
    INDEX idx_accounting_object_project (project_code),
    INDEX idx_accounting_object_dept (department_code),
    INDEX idx_accounting_object_region (sales_region_code),
    INDEX idx_accounting_object_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='核算对象';

CREATE TABLE IF NOT EXISTS finance_subject_mapping (
    id                          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    biz_type                    VARCHAR(50) NOT NULL COMMENT '业务类型：receipt/expense/claim/payment/no_contract_income',
    biz_subtype                 VARCHAR(50) NOT NULL DEFAULT '' COMMENT '业务子类型',
    income_type_code            VARCHAR(50) NOT NULL DEFAULT '' COMMENT '收入类型编码',
    expense_type_code           VARCHAR(50) NOT NULL DEFAULT '' COMMENT '费用类型编码',
    default_subject_code        VARCHAR(50) NOT NULL COMMENT '默认会计科目编码',
    object_strategy             VARCHAR(50) NOT NULL COMMENT '核算对象策略',
    required_dimensions_json    JSON DEFAULT NULL COMMENT '必填维度配置',
    status                      VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
    sort_no                     INT DEFAULT 0 COMMENT '排序',
    remark                      VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_subject_mapping (biz_type, biz_subtype, income_type_code, expense_type_code),
    INDEX idx_subject_mapping_subject (default_subject_code),
    INDEX idx_subject_mapping_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='业务类型到会计科目映射';

CALL finance_add_column_if_missing('finance_migration_map', 'source_snapshot_json', 'JSON DEFAULT NULL COMMENT ''源记录快照'' AFTER `source_hash`');
CALL finance_add_column_if_missing('finance_migration_map', 'transform_snapshot_json', 'JSON DEFAULT NULL COMMENT ''转换后记录快照'' AFTER `source_snapshot_json`');

CALL finance_add_column_if_missing('finance_receipt', 'receipt_source_type', 'VARCHAR(30) DEFAULT ''contract'' COMMENT ''收款来源：contract/no_contract/pre_contract/other'' AFTER `receivable_plan_code`');
CALL finance_add_column_if_missing('finance_receipt', 'accounting_object_type', 'VARCHAR(50) DEFAULT NULL COMMENT ''核算对象类型'' AFTER `receipt_source_type`');
CALL finance_add_column_if_missing('finance_receipt', 'accounting_object_code', 'VARCHAR(50) DEFAULT NULL COMMENT ''核算对象编码'' AFTER `accounting_object_type`');
CALL finance_add_index_if_missing('finance_receipt', 'idx_finance_receipt_source_type', 'INDEX idx_finance_receipt_source_type (`receipt_source_type`)');
CALL finance_add_index_if_missing('finance_receipt', 'idx_finance_receipt_accounting_object', 'INDEX idx_finance_receipt_accounting_object (`accounting_object_type`, `accounting_object_code`)');

CALL finance_add_column_if_missing('finance_expense', 'accounting_object_type', 'VARCHAR(50) DEFAULT NULL COMMENT ''核算对象类型'' AFTER `department_code`');
CALL finance_add_column_if_missing('finance_expense', 'accounting_object_code', 'VARCHAR(50) DEFAULT NULL COMMENT ''核算对象编码'' AFTER `accounting_object_type`');
CALL finance_add_column_if_missing('finance_expense', 'sales_scope_type', 'VARCHAR(30) DEFAULT NULL COMMENT ''销售费用归集范围：region/customer/opportunity/contract/sales_campaign/general'' AFTER `accounting_object_code`');
CALL finance_add_column_if_missing('finance_expense', 'sales_scope_code', 'VARCHAR(50) DEFAULT NULL COMMENT ''销售费用归集对象编码'' AFTER `sales_scope_type`');
CALL finance_add_column_if_missing('finance_expense', 'sales_region_code', 'VARCHAR(50) DEFAULT NULL COMMENT ''销售区域编码'' AFTER `sales_scope_code`');
CALL finance_add_column_if_missing('finance_expense', 'sales_owner_uid', 'VARCHAR(50) DEFAULT NULL COMMENT ''销售负责人UID'' AFTER `sales_region_code`');
CALL finance_add_index_if_missing('finance_expense', 'idx_finance_expense_accounting_object', 'INDEX idx_finance_expense_accounting_object (`accounting_object_type`, `accounting_object_code`)');
CALL finance_add_index_if_missing('finance_expense', 'idx_finance_expense_sales_scope', 'INDEX idx_finance_expense_sales_scope (`sales_scope_type`, `sales_scope_code`)');
CALL finance_add_index_if_missing('finance_expense', 'idx_finance_expense_sales_region', 'INDEX idx_finance_expense_sales_region (`sales_region_code`)');
CALL finance_add_index_if_missing('finance_expense', 'idx_finance_expense_sales_owner', 'INDEX idx_finance_expense_sales_owner (`sales_owner_uid`)');

CALL finance_add_column_if_missing('finance_unclassified_income', 'income_order_code', 'VARCHAR(50) DEFAULT NULL COMMENT ''无合同收入单号'' AFTER `code`');
CALL finance_add_column_if_missing('finance_unclassified_income', 'customer_code', 'VARCHAR(50) DEFAULT NULL COMMENT ''客户编码(Altoc)'' AFTER `project_legacy_id`');
CALL finance_add_column_if_missing('finance_unclassified_income', 'customer_name', 'VARCHAR(200) DEFAULT NULL COMMENT ''客户名称快照'' AFTER `customer_code`');
CALL finance_add_column_if_missing('finance_unclassified_income', 'receipt_source_type', 'VARCHAR(30) DEFAULT ''no_contract'' COMMENT ''收入来源：no_contract/pre_contract/other'' AFTER `customer_name`');
CALL finance_add_column_if_missing('finance_unclassified_income', 'accounting_object_type', 'VARCHAR(50) DEFAULT NULL COMMENT ''核算对象类型'' AFTER `receipt_source_type`');
CALL finance_add_column_if_missing('finance_unclassified_income', 'accounting_object_code', 'VARCHAR(50) DEFAULT NULL COMMENT ''核算对象编码'' AFTER `accounting_object_type`');
CALL finance_add_index_if_missing('finance_unclassified_income', 'uk_unclassified_income_order', 'UNIQUE KEY uk_unclassified_income_order (`income_order_code`)');
CALL finance_add_index_if_missing('finance_unclassified_income', 'idx_unclassified_income_customer', 'INDEX idx_unclassified_income_customer (`customer_code`)');
CALL finance_add_index_if_missing('finance_unclassified_income', 'idx_unclassified_income_accounting_object', 'INDEX idx_unclassified_income_accounting_object (`accounting_object_type`, `accounting_object_code`)');

INSERT INTO finance_subject_mapping (
    biz_type,
    biz_subtype,
    income_type_code,
    expense_type_code,
    default_subject_code,
    object_strategy,
    required_dimensions_json,
    sort_no,
    remark
) VALUES
('receipt', 'contract_income', '', '', '5001', 'contract_or_customer_project', JSON_ARRAY('customer_code'), 10, '合同主营收入默认映射'),
('receipt', 'no_contract_income', '', '', '5001', 'customer_project_or_customer', JSON_ARRAY('receipt_source_type', 'accounting_object_type', 'accounting_object_code'), 20, '无合同主营收入默认映射'),
('receipt', 'other_income', '', '', '5051', 'customer_or_other', JSON_ARRAY('accounting_object_type'), 30, '其他业务收入默认映射'),
('expense', 'project_purchase', '', 'project_purchase', '5401', 'customer_project', JSON_ARRAY('accounting_object_code'), 100, '项目采购默认映射'),
('expense', 'outsourcing', '', 'outsourcing', '5401', 'customer_project', JSON_ARRAY('accounting_object_code'), 110, '外协支出默认映射'),
('expense', 'travel', '', 'travel', '5602', 'department_or_customer_project', JSON_ARRAY('accounting_object_type'), 120, '差旅费默认映射'),
('expense', 'entertainment', '', 'entertainment', '5601', 'sales_scope', JSON_ARRAY('sales_scope_type', 'sales_scope_code'), 130, '业务招待费默认映射'),
('expense', 'sales_fee', '', 'sales_fee', '5601', 'sales_scope', JSON_ARRAY('sales_scope_type', 'sales_scope_code'), 140, '销售费用默认映射'),
('expense', 'bank_charge', '', 'bank_charge', '5603', 'other', JSON_ARRAY(), 150, '银行手续费默认映射'),
('expense', 'other', '', 'other', '5711', 'other', JSON_ARRAY('accounting_object_type'), 190, '其他支出默认映射')
ON DUPLICATE KEY UPDATE
    default_subject_code = VALUES(default_subject_code),
    object_strategy = VALUES(object_strategy),
    required_dimensions_json = VALUES(required_dimensions_json),
    sort_no = VALUES(sort_no),
    remark = VALUES(remark),
    status = 'active',
    updated_at = CURRENT_TIMESTAMP;

COMMIT;

DROP PROCEDURE IF EXISTS finance_add_column_if_missing;
DROP PROCEDURE IF EXISTS finance_add_index_if_missing;

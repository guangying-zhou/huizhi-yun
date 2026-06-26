-- ============================================================
-- HZY Finance Schema
-- Version: v0.1 draft
-- Database: hzy_finance
-- Scope:
--   v0.1 财务台账与核销
--   v0.2 报销/支出/付款审批
--   v0.3 项目核算与绩效金额财务口径
--
-- Boundary:
--   Finance owns invoice, receipt, reconciliation, expense, bank account,
--   project accounting and employee finance amount snapshots.
--   Cross-module references use stable business keys only. Do not create
--   foreign keys to Altoc/Aims/People/Assets databases.
-- ============================================================

CREATE DATABASE IF NOT EXISTS hzy_finance
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE hzy_finance;

SET FOREIGN_KEY_CHECKS = 0;

-- Reverse dependency order.
DROP TABLE IF EXISTS finance_audit_log;
DROP TABLE IF EXISTS finance_attachment;
DROP TABLE IF EXISTS performance_calculation_snapshot;
DROP TABLE IF EXISTS employee_finance_performance;
DROP TABLE IF EXISTS performance_rule;
DROP TABLE IF EXISTS employee_finance_contribution;
DROP TABLE IF EXISTS employee_cost_snapshot;
DROP TABLE IF EXISTS project_cost_allocation;
DROP TABLE IF EXISTS project_finance_summary;
DROP TABLE IF EXISTS approval_callback_log;
DROP TABLE IF EXISTS external_approval_instance;
DROP TABLE IF EXISTS payment_request;
DROP TABLE IF EXISTS project_expense_request_item;
DROP TABLE IF EXISTS project_expense_request;
DROP TABLE IF EXISTS expense_claim_item;
DROP TABLE IF EXISTS expense_claim;
DROP TABLE IF EXISTS finance_contract_summary;
DROP TABLE IF EXISTS finance_unclassified_income;
DROP TABLE IF EXISTS finance_reconciliation;
DROP TABLE IF EXISTS finance_receipt;
DROP TABLE IF EXISTS finance_invoice;
DROP TABLE IF EXISTS invoice_request;
DROP TABLE IF EXISTS finance_expense;
DROP TABLE IF EXISTS finance_account_balance_snapshot;
DROP TABLE IF EXISTS finance_bank_account;
DROP TABLE IF EXISTS finance_migration_map;
DROP TABLE IF EXISTS finance_subject_mapping;
DROP TABLE IF EXISTS finance_accounting_object;
DROP TABLE IF EXISTS finance_people_cost_parameter;
DROP TABLE IF EXISTS finance_subject;
DROP TABLE IF EXISTS finance_income_type;
DROP TABLE IF EXISTS finance_expense_type;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 1. 基础配置
-- ============================================================

-- ------------------------------------------------------------
-- 1.1 财务科目/经营分类
-- ------------------------------------------------------------
CREATE TABLE finance_subject (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code            VARCHAR(50) NOT NULL COMMENT '科目/分类编码',
    name            VARCHAR(100) NOT NULL COMMENT '名称',
    subject_type    VARCHAR(30) NOT NULL COMMENT '类型：asset/liability/equity/cost/profit_loss',
    parent_id       BIGINT DEFAULT NULL COMMENT '上级科目ID',
    sort_no         INT DEFAULT 0 COMMENT '排序',
    status          VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
    remark          VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_finance_subject_code (code),
    INDEX idx_finance_subject_type (subject_type),
    INDEX idx_finance_subject_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='财务科目/经营分类';

-- ------------------------------------------------------------
-- 1.2 收入类型
-- ------------------------------------------------------------
CREATE TABLE finance_income_type (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                VARCHAR(50) NOT NULL COMMENT '收入类型编码',
    name                VARCHAR(100) NOT NULL COMMENT '收入类型名称',
    default_subject_id  BIGINT DEFAULT NULL COMMENT '默认财务科目ID',
    is_contract_income  TINYINT DEFAULT 1 COMMENT '是否合同收入：1是 0否',
    status              VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
    sort_no             INT DEFAULT 0 COMMENT '排序',
    remark              VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_income_type_code (code),
    INDEX idx_income_type_subject (default_subject_id),
    CONSTRAINT fk_income_type_subject FOREIGN KEY (default_subject_id) REFERENCES finance_subject(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='收入类型';

-- ------------------------------------------------------------
-- 1.3 费用/支出类型
-- ------------------------------------------------------------
CREATE TABLE finance_expense_type (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                VARCHAR(50) NOT NULL COMMENT '费用类型编码',
    name                VARCHAR(100) NOT NULL COMMENT '费用类型名称',
    default_subject_id  BIGINT DEFAULT NULL COMMENT '默认财务科目ID',
    cost_category       VARCHAR(30) DEFAULT NULL COMMENT '成本类别：project/sales/admin/finance/hr/asset/other',
    reimbursable        TINYINT DEFAULT 1 COMMENT '是否可报销：1是 0否',
    status              VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
    sort_no             INT DEFAULT 0 COMMENT '排序',
    remark              VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_expense_type_code (code),
    INDEX idx_expense_type_subject (default_subject_id),
    INDEX idx_expense_type_cost_category (cost_category),
    CONSTRAINT fk_expense_type_subject FOREIGN KEY (default_subject_id) REFERENCES finance_subject(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='费用/支出类型';

-- ------------------------------------------------------------
-- 1.4 人力成本参数
-- ------------------------------------------------------------
CREATE TABLE finance_people_cost_parameter (
    id                          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                        VARCHAR(50) NOT NULL COMMENT '参数编码',
    name                        VARCHAR(100) NOT NULL COMMENT '参数名称',
    effective_from              DATE NOT NULL COMMENT '生效日期',
    effective_to                DATE DEFAULT NULL COMMENT '失效日期',
    base_salary                 DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '基本工资基数',
    welfare_cost_rate           DECIMAL(10,4) NOT NULL DEFAULT 0.0000 COMMENT '福利成本费率',
    management_allocation_rate  DECIMAL(10,4) NOT NULL DEFAULT 0.0000 COMMENT '管理分摊系数',
    resource_allocation_cost    DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '固定资源分摊成本',
    currency_code               VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
    status                      VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
    remark                      VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by                  VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by                  VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_people_cost_parameter_code (code),
    INDEX idx_people_cost_parameter_effective (status, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Finance 人力成本核算参数';

-- ------------------------------------------------------------
-- 1.5 核算对象
-- ------------------------------------------------------------
CREATE TABLE finance_accounting_object (
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

-- ------------------------------------------------------------
-- 1.6 业务类型到会计科目映射
-- ------------------------------------------------------------
CREATE TABLE finance_subject_mapping (
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

-- ============================================================
-- 2. v0.1 财务台账与核销
-- ============================================================

-- ------------------------------------------------------------
-- 2.1 迁移来源映射
-- ------------------------------------------------------------
CREATE TABLE finance_migration_map (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    batch_code          VARCHAR(50) NOT NULL COMMENT '迁移批次',
    source_system       VARCHAR(50) NOT NULL COMMENT '来源系统',
    source_table        VARCHAR(100) NOT NULL COMMENT '来源表名',
    source_id           VARCHAR(100) NOT NULL COMMENT '来源主键',
    target_table        VARCHAR(100) NOT NULL COMMENT '目标表名',
    target_id           BIGINT NOT NULL COMMENT '目标主键',
    source_hash         VARCHAR(64) DEFAULT NULL COMMENT '源记录摘要hash',
    source_snapshot_json JSON DEFAULT NULL COMMENT '源记录快照',
    transform_snapshot_json JSON DEFAULT NULL COMMENT '转换后记录快照',
    migrated_at         DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '迁移时间',
    note                VARCHAR(500) DEFAULT NULL COMMENT '备注',

    UNIQUE KEY uk_finance_migration_source_target (source_system, source_table, source_id, target_table),
    INDEX idx_finance_migration_target (target_table, target_id),
    INDEX idx_finance_migration_batch (batch_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='迁移来源映射';

-- ------------------------------------------------------------
-- 2.2 银行账户
-- ------------------------------------------------------------
CREATE TABLE finance_bank_account (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(50) NOT NULL COMMENT '账户编码',
    account_name            VARCHAR(200) NOT NULL COMMENT '账户名称',
    bank_name               VARCHAR(200) DEFAULT NULL COMMENT '开户行',
    account_no_masked       VARCHAR(100) DEFAULT NULL COMMENT '脱敏账号',
    account_no_secret_ref   VARCHAR(200) DEFAULT NULL COMMENT '账号密文引用(Console Vault secret_ref)',
    account_type            VARCHAR(30) DEFAULT 'bank' COMMENT '账户类型：bank/cash/third_party/internal',
    currency_code           VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
    owner_dept_code         VARCHAR(50) DEFAULT NULL COMMENT '归属部门编码',
    status                  VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive/closed',
    opened_at               DATE DEFAULT NULL COMMENT '开户日期',
    closed_at               DATE DEFAULT NULL COMMENT '销户日期',
    legacy_source           VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id               BIGINT DEFAULT NULL COMMENT '迁移来源主键',
    remark                  VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_bank_account_code (code),
    UNIQUE KEY uk_bank_account_legacy (legacy_source, legacy_id),
    INDEX idx_bank_account_status (status),
    INDEX idx_bank_account_owner_dept (owner_dept_code),
    INDEX idx_bank_account_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='银行账户';

-- ------------------------------------------------------------
-- 2.3 账户余额快照
-- ------------------------------------------------------------
CREATE TABLE finance_account_balance_snapshot (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    bank_account_id     BIGINT NOT NULL COMMENT '银行账户ID',
    snapshot_date       DATE NOT NULL COMMENT '快照日期',
    balance_amount      DECIMAL(18,2) NOT NULL COMMENT '账户余额',
    currency_code       VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
    source_type         VARCHAR(30) DEFAULT 'manual' COMMENT '来源：manual/import/api/migration',
    legacy_source       VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id           BIGINT DEFAULT NULL COMMENT '迁移来源主键',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_balance_account_date (bank_account_id, snapshot_date, source_type),
    UNIQUE KEY uk_balance_legacy (legacy_source, legacy_id),
    INDEX idx_balance_snapshot_date (snapshot_date),
    CONSTRAINT fk_balance_bank_account FOREIGN KEY (bank_account_id) REFERENCES finance_bank_account(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账户余额快照';

-- ------------------------------------------------------------
-- 2.4 开票申请
-- ------------------------------------------------------------
CREATE TABLE invoice_request (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(50) NOT NULL COMMENT '开票申请编号',
    source_app              VARCHAR(30) DEFAULT 'finance' COMMENT '来源应用：altoc/finance/assets/other',
    source_biz_type         VARCHAR(50) DEFAULT NULL COMMENT '来源业务类型',
    source_biz_code         VARCHAR(100) DEFAULT NULL COMMENT '来源业务编码',
    customer_code           VARCHAR(50) DEFAULT NULL COMMENT '客户编码(Altoc)',
    customer_name           VARCHAR(200) DEFAULT NULL COMMENT '客户名称快照',
    contract_code           VARCHAR(50) DEFAULT NULL COMMENT '合同编码(Altoc)',
    receivable_plan_code    VARCHAR(50) DEFAULT NULL COMMENT '经营回款计划编码(Altoc)',
    invoice_type            VARCHAR(30) DEFAULT NULL COMMENT '发票类型：special_vat/general_vat/electronic/other',
    invoice_medium          VARCHAR(20) DEFAULT 'electronic' COMMENT '发票介质：electronic电子/paper纸质',
    invoice_item            VARCHAR(500) DEFAULT NULL COMMENT '开票内容',
    requested_amount        DECIMAL(18,2) NOT NULL COMMENT '申请开票金额',
    tax_rate                DECIMAL(5,2) DEFAULT NULL COMMENT '税率(%)',
    taxpayer_name           VARCHAR(200) DEFAULT NULL COMMENT '购方名称',
    taxpayer_no             VARCHAR(50) DEFAULT NULL COMMENT '购方税号',
    billing_info_json       JSON DEFAULT NULL COMMENT '开票资料JSON',
    status                  VARCHAR(30) DEFAULT 'draft' COMMENT '状态：draft/pending_approval/approved/rejected/issued/canceled',
    workflow_instance_id    VARCHAR(100) DEFAULT NULL COMMENT 'Workflow审批实例ID',
    requested_by            VARCHAR(50) DEFAULT NULL COMMENT '申请人',
    submitted_at            DATETIME DEFAULT NULL COMMENT '提交时间',
    approved_at             DATETIME DEFAULT NULL COMMENT '审批通过时间',
    rejected_at             DATETIME DEFAULT NULL COMMENT '审批拒绝时间',
    reject_reason           VARCHAR(500) DEFAULT NULL COMMENT '拒绝原因',
    issued_invoice_id       BIGINT DEFAULT NULL COMMENT '生成的正式发票ID',
    remark                  VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_invoice_request_code (code),
    INDEX idx_invoice_request_contract (contract_code),
    INDEX idx_invoice_request_source (source_app, source_biz_type, source_biz_code),
    INDEX idx_invoice_request_status (status),
    INDEX idx_invoice_request_medium (invoice_medium),
    INDEX idx_invoice_request_workflow (workflow_instance_id),
    INDEX idx_invoice_request_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='开票申请';

-- ------------------------------------------------------------
-- 2.5 正式发票
-- ------------------------------------------------------------
CREATE TABLE finance_invoice (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(50) NOT NULL COMMENT '发票记录编号',
    invoice_no              VARCHAR(80) DEFAULT NULL COMMENT '发票号码',
    invoice_request_id      BIGINT DEFAULT NULL COMMENT '开票申请ID',
    customer_code           VARCHAR(50) DEFAULT NULL COMMENT '客户编码(Altoc)',
    customer_name           VARCHAR(200) DEFAULT NULL COMMENT '客户名称快照',
    contract_code           VARCHAR(50) DEFAULT NULL COMMENT '合同编码(Altoc)',
    project_code            VARCHAR(50) DEFAULT NULL COMMENT '项目编码(Aims/Console)',
    receivable_plan_code    VARCHAR(50) DEFAULT NULL COMMENT '经营回款计划编码(Altoc)',
    invoice_type            VARCHAR(30) DEFAULT NULL COMMENT '发票类型：special_vat/general_vat/electronic/other',
    invoice_medium          VARCHAR(20) DEFAULT 'electronic' COMMENT '发票介质：electronic电子/paper纸质',
    invoice_item            VARCHAR(500) DEFAULT NULL COMMENT '开票内容',
    invoice_amount          DECIMAL(18,2) NOT NULL COMMENT '开票金额',
    tax_rate                DECIMAL(5,2) DEFAULT NULL COMMENT '税率(%)',
    tax_amount              DECIMAL(18,2) DEFAULT NULL COMMENT '税额',
    amount_tax_exclusive    DECIMAL(18,2) DEFAULT NULL COMMENT '不含税金额',
    invoice_date            DATE DEFAULT NULL COMMENT '开票日期',
    status                  VARCHAR(30) DEFAULT 'issued' COMMENT '状态：draft/issued/red_reversed/canceled',
    taxpayer_name           VARCHAR(200) DEFAULT NULL COMMENT '购方名称',
    taxpayer_no             VARCHAR(50) DEFAULT NULL COMMENT '购方税号',
    receiver_name           VARCHAR(200) DEFAULT NULL COMMENT '接收方',
    invoice_file_url        VARCHAR(1000) DEFAULT NULL COMMENT '发票文件URL，电子票为PDF/OFD，纸质票为PDF扫描件',
    invoice_file_name       VARCHAR(255) DEFAULT NULL COMMENT '发票文件名',
    invoice_file_mime_type  VARCHAR(100) DEFAULT NULL COMMENT '发票文件MIME类型',
    invoice_file_size       BIGINT DEFAULT NULL COMMENT '发票文件大小(字节)',
    source_refs_json        JSON DEFAULT NULL COMMENT '来源项目/公司/档案页等引用',
    legacy_source           VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id               BIGINT DEFAULT NULL COMMENT '迁移来源主键',
    remark                  VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_finance_invoice_code (code),
    UNIQUE KEY uk_finance_invoice_legacy (legacy_source, legacy_id),
    INDEX idx_finance_invoice_no (invoice_no),
    INDEX idx_finance_invoice_request (invoice_request_id),
    INDEX idx_finance_invoice_contract (contract_code),
    INDEX idx_finance_invoice_customer (customer_code),
    INDEX idx_finance_invoice_project (project_code),
    INDEX idx_finance_invoice_medium (invoice_medium),
    INDEX idx_finance_invoice_date (invoice_date),
    INDEX idx_finance_invoice_status (status),
    INDEX idx_finance_invoice_deleted (deleted_at),
    CONSTRAINT fk_invoice_request FOREIGN KEY (invoice_request_id) REFERENCES invoice_request(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='正式发票';

-- ------------------------------------------------------------
-- 2.6 到账/收款记录
-- ------------------------------------------------------------
CREATE TABLE finance_receipt (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(50) NOT NULL COMMENT '收款记录编号',
    receipt_no              VARCHAR(80) DEFAULT NULL COMMENT '外部流水/收款编号',
    customer_code           VARCHAR(50) DEFAULT NULL COMMENT '客户编码(Altoc)',
    customer_name           VARCHAR(200) DEFAULT NULL COMMENT '客户名称快照',
    contract_code           VARCHAR(50) DEFAULT NULL COMMENT '合同编码(Altoc)',
    project_code            VARCHAR(50) DEFAULT NULL COMMENT '项目编码(Aims/Console)',
    receivable_plan_code    VARCHAR(50) DEFAULT NULL COMMENT '经营回款计划编码(Altoc)',
    receipt_source_type     VARCHAR(30) DEFAULT 'contract' COMMENT '收款来源：contract/no_contract/pre_contract/other',
    accounting_object_type  VARCHAR(50) DEFAULT NULL COMMENT '核算对象类型',
    accounting_object_code  VARCHAR(50) DEFAULT NULL COMMENT '核算对象编码',
    bank_account_id         BIGINT DEFAULT NULL COMMENT '收款账户ID',
    income_type_id          BIGINT DEFAULT NULL COMMENT '收入类型ID',
    received_amount         DECIMAL(18,2) NOT NULL COMMENT '到账金额',
    reconciled_amount       DECIMAL(18,2) DEFAULT 0.00 COMMENT '已核销金额',
    unreconciled_amount     DECIMAL(18,2) DEFAULT NULL COMMENT '未核销金额',
    received_at             DATE NOT NULL COMMENT '到账日期',
    channel                 VARCHAR(30) DEFAULT NULL COMMENT '收款渠道：cash/bank_transfer/third_party/other',
    payer_name              VARCHAR(200) DEFAULT NULL COMMENT '付款方名称',
    handler_user_id         VARCHAR(50) DEFAULT NULL COMMENT '经办人UID',
    status                  VARCHAR(30) DEFAULT 'confirmed' COMMENT '状态：draft/confirmed/partially_reconciled/reconciled/canceled',
    source_refs_json        JSON DEFAULT NULL COMMENT '来源项目/账户/对应支出等引用',
    legacy_source           VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id               BIGINT DEFAULT NULL COMMENT '迁移来源主键',
    note                    VARCHAR(500) DEFAULT NULL COMMENT '备注',
    confirmed_by            VARCHAR(50) DEFAULT NULL COMMENT '确认人',
    confirmed_at            DATETIME DEFAULT NULL COMMENT '确认时间',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_finance_receipt_code (code),
    UNIQUE KEY uk_finance_receipt_legacy (legacy_source, legacy_id),
    INDEX idx_finance_receipt_contract (contract_code),
    INDEX idx_finance_receipt_customer (customer_code),
    INDEX idx_finance_receipt_project (project_code),
    INDEX idx_finance_receipt_source_type (receipt_source_type),
    INDEX idx_finance_receipt_accounting_object (accounting_object_type, accounting_object_code),
    INDEX idx_finance_receipt_bank_account (bank_account_id),
    INDEX idx_finance_receipt_income_type (income_type_id),
    INDEX idx_finance_receipt_received_at (received_at),
    INDEX idx_finance_receipt_status (status),
    INDEX idx_finance_receipt_deleted (deleted_at),
    CONSTRAINT fk_receipt_bank_account FOREIGN KEY (bank_account_id) REFERENCES finance_bank_account(id),
    CONSTRAINT fk_receipt_income_type FOREIGN KEY (income_type_id) REFERENCES finance_income_type(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='到账/收款记录';

-- ------------------------------------------------------------
-- 2.7 收款核销
-- ------------------------------------------------------------
CREATE TABLE finance_reconciliation (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(50) NOT NULL COMMENT '核销编号',
    receipt_id              BIGINT NOT NULL COMMENT '收款记录ID',
    invoice_id              BIGINT DEFAULT NULL COMMENT '发票ID',
    customer_code           VARCHAR(50) DEFAULT NULL COMMENT '客户编码(Altoc)',
    contract_code           VARCHAR(50) DEFAULT NULL COMMENT '合同编码(Altoc)',
    project_code            VARCHAR(50) DEFAULT NULL COMMENT '项目编码(Aims/Console)',
    receivable_plan_code    VARCHAR(50) DEFAULT NULL COMMENT '经营回款计划编码(Altoc)',
    reconciled_amount       DECIMAL(18,2) NOT NULL COMMENT '本次核销金额',
    reconciled_at           DATETIME NOT NULL COMMENT '核销时间',
    reconciliation_type     VARCHAR(30) DEFAULT 'contract_receivable' COMMENT '核销类型：invoice/contract_receivable/advance/unclassified/manual',
    status                  VARCHAR(30) DEFAULT 'active' COMMENT '状态：active/reversed',
    reversed_at             DATETIME DEFAULT NULL COMMENT '反核销时间',
    reversed_by             VARCHAR(50) DEFAULT NULL COMMENT '反核销人',
    reverse_reason          VARCHAR(500) DEFAULT NULL COMMENT '反核销原因',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_reconciliation_code (code),
    INDEX idx_reconciliation_receipt (receipt_id),
    INDEX idx_reconciliation_invoice (invoice_id),
    INDEX idx_reconciliation_contract (contract_code),
    INDEX idx_reconciliation_project (project_code),
    INDEX idx_reconciliation_plan (receivable_plan_code),
    INDEX idx_reconciliation_at (reconciled_at),
    INDEX idx_reconciliation_status (status),
    CONSTRAINT fk_reconciliation_receipt FOREIGN KEY (receipt_id) REFERENCES finance_receipt(id),
    CONSTRAINT fk_reconciliation_invoice FOREIGN KEY (invoice_id) REFERENCES finance_invoice(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='收款核销';

-- ------------------------------------------------------------
-- 2.8 支出台账
-- ------------------------------------------------------------
CREATE TABLE finance_expense (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(50) NOT NULL COMMENT '支出编号',
    expense_type_id         BIGINT DEFAULT NULL COMMENT '费用/支出类型ID',
    subject_id              BIGINT DEFAULT NULL COMMENT '财务科目ID',
    expense_date            DATE NOT NULL COMMENT '支出日期',
    expense_amount          DECIMAL(18,2) NOT NULL COMMENT '支出金额',
    fee_amount              DECIMAL(18,2) DEFAULT 0.00 COMMENT '手续费',
    currency_code           VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
    bank_account_id         BIGINT DEFAULT NULL COMMENT '付款账户ID',
    project_code            VARCHAR(50) DEFAULT NULL COMMENT '项目编码(Aims/Console)',
    contract_code           VARCHAR(50) DEFAULT NULL COMMENT '合同编码(Altoc)',
    customer_code           VARCHAR(50) DEFAULT NULL COMMENT '客户编码(Altoc)',
    department_code         VARCHAR(50) DEFAULT NULL COMMENT '归属部门编码',
    accounting_object_type  VARCHAR(50) DEFAULT NULL COMMENT '核算对象类型',
    accounting_object_code  VARCHAR(50) DEFAULT NULL COMMENT '核算对象编码',
    sales_scope_type        VARCHAR(30) DEFAULT NULL COMMENT '销售费用归集范围：region/customer/opportunity/contract/sales_campaign/general',
    sales_scope_code        VARCHAR(50) DEFAULT NULL COMMENT '销售费用归集对象编码',
    sales_region_code       VARCHAR(50) DEFAULT NULL COMMENT '销售区域编码',
    sales_owner_uid         VARCHAR(50) DEFAULT NULL COMMENT '销售负责人UID',
    handler_user_id         VARCHAR(50) DEFAULT NULL COMMENT '经办人UID',
    payee_name              VARCHAR(200) DEFAULT NULL COMMENT '收款方名称',
    payee_account_masked    VARCHAR(100) DEFAULT NULL COMMENT '收款方账号脱敏值',
    payee_bank              VARCHAR(200) DEFAULT NULL COMMENT '收款方开户行',
    payment_channel         VARCHAR(30) DEFAULT NULL COMMENT '支付渠道：cash/bank_transfer/third_party/other',
    source_request_type     VARCHAR(50) DEFAULT NULL COMMENT '来源申请类型：expense_claim/project_expense/payment_request/manual/migration',
    source_request_code     VARCHAR(50) DEFAULT NULL COMMENT '来源申请编号',
    status                  VARCHAR(30) DEFAULT 'confirmed' COMMENT '状态：draft/pending_payment/paid/confirmed/canceled',
    description             VARCHAR(500) DEFAULT NULL COMMENT '事由',
    source_refs_json        JSON DEFAULT NULL COMMENT '审批/收入/旧系统等引用',
    legacy_source           VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id               BIGINT DEFAULT NULL COMMENT '迁移来源主键',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_finance_expense_code (code),
    UNIQUE KEY uk_finance_expense_legacy (legacy_source, legacy_id),
    INDEX idx_finance_expense_type (expense_type_id),
    INDEX idx_finance_expense_subject (subject_id),
    INDEX idx_finance_expense_date (expense_date),
    INDEX idx_finance_expense_project (project_code),
    INDEX idx_finance_expense_contract (contract_code),
    INDEX idx_finance_expense_department (department_code),
    INDEX idx_finance_expense_accounting_object (accounting_object_type, accounting_object_code),
    INDEX idx_finance_expense_sales_scope (sales_scope_type, sales_scope_code),
    INDEX idx_finance_expense_sales_region (sales_region_code),
    INDEX idx_finance_expense_sales_owner (sales_owner_uid),
    INDEX idx_finance_expense_handler (handler_user_id),
    INDEX idx_finance_expense_status (status),
    INDEX idx_finance_expense_deleted (deleted_at),
    CONSTRAINT fk_expense_type FOREIGN KEY (expense_type_id) REFERENCES finance_expense_type(id),
    CONSTRAINT fk_expense_subject FOREIGN KEY (subject_id) REFERENCES finance_subject(id),
    CONSTRAINT fk_expense_bank_account FOREIGN KEY (bank_account_id) REFERENCES finance_bank_account(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='支出台账';

-- ------------------------------------------------------------
-- 2.9 非合同收入待归类
-- ------------------------------------------------------------
CREATE TABLE finance_unclassified_income (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                VARCHAR(50) NOT NULL COMMENT '待归类收入编号',
    income_order_code   VARCHAR(50) DEFAULT NULL COMMENT '无合同收入单号',
    project_code        VARCHAR(50) DEFAULT NULL COMMENT '项目编码(Aims/Console)',
    project_legacy_id   BIGINT DEFAULT NULL COMMENT '源系统项目ID',
    customer_code       VARCHAR(50) DEFAULT NULL COMMENT '客户编码(Altoc)',
    customer_name       VARCHAR(200) DEFAULT NULL COMMENT '客户名称快照',
    receipt_source_type VARCHAR(30) DEFAULT 'no_contract' COMMENT '收入来源：no_contract/pre_contract/other',
    accounting_object_type VARCHAR(50) DEFAULT NULL COMMENT '核算对象类型',
    accounting_object_code VARCHAR(50) DEFAULT NULL COMMENT '核算对象编码',
    bank_account_id     BIGINT DEFAULT NULL COMMENT '收款账户ID',
    income_type_id      BIGINT DEFAULT NULL COMMENT '收入类型ID',
    received_at         DATE NOT NULL COMMENT '到账日期',
    amount              DECIMAL(18,2) NOT NULL COMMENT '金额',
    channel             VARCHAR(30) DEFAULT NULL COMMENT '收款渠道',
    payer_name          VARCHAR(200) DEFAULT NULL COMMENT '付款方名称',
    handler_user_id     VARCHAR(50) DEFAULT NULL COMMENT '经办人UID',
    description         VARCHAR(500) DEFAULT NULL COMMENT '事由',
    resolution_status   VARCHAR(30) DEFAULT 'pending' COMMENT '处理状态：pending/linked_to_contract/classified/ignored',
    linked_receipt_id   BIGINT DEFAULT NULL COMMENT '补链后的收款记录ID',
    classified_subject_id BIGINT DEFAULT NULL COMMENT '归类科目ID',
    source_refs_json    JSON DEFAULT NULL COMMENT '源系统账户/对应支出/操作员等引用',
    legacy_source       VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id           BIGINT DEFAULT NULL COMMENT '迁移来源主键',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by          VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_unclassified_income_code (code),
    UNIQUE KEY uk_unclassified_income_order (income_order_code),
    UNIQUE KEY uk_unclassified_income_legacy (legacy_source, legacy_id),
    INDEX idx_unclassified_income_customer (customer_code),
    INDEX idx_unclassified_income_project (project_code),
    INDEX idx_unclassified_income_accounting_object (accounting_object_type, accounting_object_code),
    INDEX idx_unclassified_income_account (bank_account_id),
    INDEX idx_unclassified_income_type (income_type_id),
    INDEX idx_unclassified_income_status (resolution_status),
    INDEX idx_unclassified_income_received_at (received_at),
    CONSTRAINT fk_unclassified_income_account FOREIGN KEY (bank_account_id) REFERENCES finance_bank_account(id),
    CONSTRAINT fk_unclassified_income_type FOREIGN KEY (income_type_id) REFERENCES finance_income_type(id),
    CONSTRAINT fk_unclassified_income_receipt FOREIGN KEY (linked_receipt_id) REFERENCES finance_receipt(id),
    CONSTRAINT fk_unclassified_income_subject FOREIGN KEY (classified_subject_id) REFERENCES finance_subject(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='非合同收入待归类';

-- ------------------------------------------------------------
-- 2.10 合同财务摘要投影
-- ------------------------------------------------------------
CREATE TABLE finance_contract_summary (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    contract_code           VARCHAR(50) NOT NULL COMMENT '合同编码(Altoc)',
    customer_code           VARCHAR(50) DEFAULT NULL COMMENT '客户编码(Altoc)',
    project_code            VARCHAR(50) DEFAULT NULL COMMENT '项目编码(Aims/Console)',
    contract_amount         DECIMAL(18,2) DEFAULT NULL COMMENT '合同金额快照',
    invoice_amount          DECIMAL(18,2) DEFAULT 0.00 COMMENT '累计开票金额',
    received_amount         DECIMAL(18,2) DEFAULT 0.00 COMMENT '累计到账金额',
    reconciled_amount       DECIMAL(18,2) DEFAULT 0.00 COMMENT '累计核销金额',
    unreceived_amount       DECIMAL(18,2) DEFAULT NULL COMMENT '未到账金额',
    unreconciled_amount     DECIMAL(18,2) DEFAULT NULL COMMENT '未核销金额',
    invoice_count           INT DEFAULT 0 COMMENT '发票数',
    receipt_count           INT DEFAULT 0 COMMENT '收款数',
    latest_invoice_date     DATE DEFAULT NULL COMMENT '最近开票日期',
    latest_received_at      DATE DEFAULT NULL COMMENT '最近到账日期',
    risk_status             VARCHAR(30) DEFAULT 'normal' COMMENT '风险状态：normal/overdue/disputed/bad_debt',
    synced_to_altoc_at      DATETIME DEFAULT NULL COMMENT '最近同步到Altoc时间',
    calculated_at           DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '计算时间',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_contract_summary_contract (contract_code),
    INDEX idx_contract_summary_customer (customer_code),
    INDEX idx_contract_summary_project (project_code),
    INDEX idx_contract_summary_risk (risk_status),
    INDEX idx_contract_summary_calculated (calculated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同财务摘要投影';

-- ============================================================
-- 3. v0.2 报销、支出和付款审批
-- ============================================================

-- ------------------------------------------------------------
-- 3.1 费用报销单
-- ------------------------------------------------------------
CREATE TABLE expense_claim (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(50) NOT NULL COMMENT '报销单编号',
    title                   VARCHAR(200) NOT NULL COMMENT '报销标题',
    applicant_user_id       VARCHAR(50) NOT NULL COMMENT '申请人UID',
    applicant_dept_code     VARCHAR(50) DEFAULT NULL COMMENT '申请人部门编码',
    project_code            VARCHAR(50) DEFAULT NULL COMMENT '项目编码(Aims/Console)',
    contract_code           VARCHAR(50) DEFAULT NULL COMMENT '合同编码(Altoc)',
    customer_code           VARCHAR(50) DEFAULT NULL COMMENT '客户编码(Altoc)',
    total_amount            DECIMAL(18,2) NOT NULL COMMENT '报销总额',
    approved_amount         DECIMAL(18,2) DEFAULT NULL COMMENT '审批通过金额',
    paid_amount             DECIMAL(18,2) DEFAULT 0.00 COMMENT '已支付金额',
    currency_code           VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
    cost_bearer_type        VARCHAR(30) DEFAULT NULL COMMENT '成本承担方：company/customer/project/shared',
    cost_bearer_code        VARCHAR(50) DEFAULT NULL COMMENT '成本承担方编码',
    status                  VARCHAR(30) DEFAULT 'draft' COMMENT '状态：draft/pending_approval/approved/rejected/paid/canceled',
    workflow_instance_id    VARCHAR(100) DEFAULT NULL COMMENT 'Workflow审批实例ID',
    submitted_at            DATETIME DEFAULT NULL COMMENT '提交时间',
    approved_at             DATETIME DEFAULT NULL COMMENT '审批通过时间',
    rejected_at             DATETIME DEFAULT NULL COMMENT '审批拒绝时间',
    reject_reason           VARCHAR(500) DEFAULT NULL COMMENT '拒绝原因',
    paid_at                 DATETIME DEFAULT NULL COMMENT '支付时间',
    generated_expense_id    BIGINT DEFAULT NULL COMMENT '生成的支出台账ID',
    remark                  VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_expense_claim_code (code),
    INDEX idx_expense_claim_applicant (applicant_user_id),
    INDEX idx_expense_claim_project (project_code),
    INDEX idx_expense_claim_contract (contract_code),
    INDEX idx_expense_claim_status (status),
    INDEX idx_expense_claim_workflow (workflow_instance_id),
    INDEX idx_expense_claim_deleted (deleted_at),
    CONSTRAINT fk_expense_claim_generated_expense FOREIGN KEY (generated_expense_id) REFERENCES finance_expense(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='费用报销单';

-- ------------------------------------------------------------
-- 3.2 费用报销明细
-- ------------------------------------------------------------
CREATE TABLE expense_claim_item (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    claim_id            BIGINT NOT NULL COMMENT '报销单ID',
    expense_type_id     BIGINT DEFAULT NULL COMMENT '费用类型ID',
    subject_id          BIGINT DEFAULT NULL COMMENT '财务科目ID',
    occurred_at         DATE DEFAULT NULL COMMENT '费用发生日期',
    amount              DECIMAL(18,2) NOT NULL COMMENT '金额',
    tax_amount          DECIMAL(18,2) DEFAULT NULL COMMENT '税额',
    invoice_no          VARCHAR(80) DEFAULT NULL COMMENT '票据/发票号',
    description         VARCHAR(500) DEFAULT NULL COMMENT '说明',
    sort_no             INT DEFAULT 0 COMMENT '排序',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_claim_item_claim (claim_id),
    INDEX idx_claim_item_expense_type (expense_type_id),
    INDEX idx_claim_item_subject (subject_id),
    CONSTRAINT fk_claim_item_claim FOREIGN KEY (claim_id) REFERENCES expense_claim(id) ON DELETE CASCADE,
    CONSTRAINT fk_claim_item_expense_type FOREIGN KEY (expense_type_id) REFERENCES finance_expense_type(id),
    CONSTRAINT fk_claim_item_subject FOREIGN KEY (subject_id) REFERENCES finance_subject(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='费用报销明细';

-- ------------------------------------------------------------
-- 3.3 项目支出申请
-- ------------------------------------------------------------
CREATE TABLE project_expense_request (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(50) NOT NULL COMMENT '项目支出申请编号',
    title                   VARCHAR(200) NOT NULL COMMENT '申请标题',
    applicant_user_id       VARCHAR(50) NOT NULL COMMENT '申请人UID',
    applicant_dept_code     VARCHAR(50) DEFAULT NULL COMMENT '申请人部门编码',
    project_code            VARCHAR(50) NOT NULL COMMENT '项目编码(Aims/Console)',
    contract_code           VARCHAR(50) DEFAULT NULL COMMENT '合同编码(Altoc)',
    customer_code           VARCHAR(50) DEFAULT NULL COMMENT '客户编码(Altoc)',
    supplier_code           VARCHAR(50) DEFAULT NULL COMMENT '供应商编码(Assets/Finance)',
    total_amount            DECIMAL(18,2) NOT NULL COMMENT '申请总额',
    approved_amount         DECIMAL(18,2) DEFAULT NULL COMMENT '审批通过金额',
    status                  VARCHAR(30) DEFAULT 'draft' COMMENT '状态：draft/pending_approval/approved/rejected/paid/canceled',
    workflow_instance_id    VARCHAR(100) DEFAULT NULL COMMENT 'Workflow审批实例ID',
    submitted_at            DATETIME DEFAULT NULL COMMENT '提交时间',
    approved_at             DATETIME DEFAULT NULL COMMENT '审批通过时间',
    rejected_at             DATETIME DEFAULT NULL COMMENT '审批拒绝时间',
    reject_reason           VARCHAR(500) DEFAULT NULL COMMENT '拒绝原因',
    generated_expense_id    BIGINT DEFAULT NULL COMMENT '生成的支出台账ID',
    remark                  VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_project_expense_request_code (code),
    INDEX idx_project_expense_request_project (project_code),
    INDEX idx_project_expense_request_contract (contract_code),
    INDEX idx_project_expense_request_applicant (applicant_user_id),
    INDEX idx_project_expense_request_status (status),
    INDEX idx_project_expense_request_workflow (workflow_instance_id),
    INDEX idx_project_expense_request_deleted (deleted_at),
    CONSTRAINT fk_project_expense_generated_expense FOREIGN KEY (generated_expense_id) REFERENCES finance_expense(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目支出申请';

-- ------------------------------------------------------------
-- 3.4 项目支出申请明细
-- ------------------------------------------------------------
CREATE TABLE project_expense_request_item (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    request_id          BIGINT NOT NULL COMMENT '项目支出申请ID',
    expense_type_id     BIGINT DEFAULT NULL COMMENT '费用类型ID',
    subject_id          BIGINT DEFAULT NULL COMMENT '财务科目ID',
    item_name           VARCHAR(200) NOT NULL COMMENT '支出项目名称',
    amount              DECIMAL(18,2) NOT NULL COMMENT '金额',
    quantity            DECIMAL(12,2) DEFAULT NULL COMMENT '数量',
    unit_price          DECIMAL(18,2) DEFAULT NULL COMMENT '单价',
    description         VARCHAR(500) DEFAULT NULL COMMENT '说明',
    sort_no             INT DEFAULT 0 COMMENT '排序',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_project_expense_item_request (request_id),
    INDEX idx_project_expense_item_type (expense_type_id),
    INDEX idx_project_expense_item_subject (subject_id),
    CONSTRAINT fk_project_expense_item_request FOREIGN KEY (request_id) REFERENCES project_expense_request(id) ON DELETE CASCADE,
    CONSTRAINT fk_project_expense_item_type FOREIGN KEY (expense_type_id) REFERENCES finance_expense_type(id),
    CONSTRAINT fk_project_expense_item_subject FOREIGN KEY (subject_id) REFERENCES finance_subject(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目支出申请明细';

-- ------------------------------------------------------------
-- 3.5 付款申请
-- ------------------------------------------------------------
CREATE TABLE payment_request (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(50) NOT NULL COMMENT '付款申请编号',
    title                   VARCHAR(200) NOT NULL COMMENT '申请标题',
    payment_type            VARCHAR(30) NOT NULL COMMENT '付款类型：supplier/customer_refund/loan/expense/other',
    applicant_user_id       VARCHAR(50) NOT NULL COMMENT '申请人UID',
    applicant_dept_code     VARCHAR(50) DEFAULT NULL COMMENT '申请人部门编码',
    project_code            VARCHAR(50) DEFAULT NULL COMMENT '项目编码(Aims/Console)',
    contract_code           VARCHAR(50) DEFAULT NULL COMMENT '合同编码(Altoc)',
    customer_code           VARCHAR(50) DEFAULT NULL COMMENT '客户编码(Altoc)',
    supplier_code           VARCHAR(50) DEFAULT NULL COMMENT '供应商编码',
    payee_name              VARCHAR(200) NOT NULL COMMENT '收款方名称',
    payee_account_masked    VARCHAR(100) DEFAULT NULL COMMENT '收款方账号脱敏值',
    payee_account_secret_ref VARCHAR(200) DEFAULT NULL COMMENT '收款方账号密文引用(Console Vault secret_ref)',
    payee_bank              VARCHAR(200) DEFAULT NULL COMMENT '收款方开户行',
    requested_amount        DECIMAL(18,2) NOT NULL COMMENT '申请付款金额',
    approved_amount         DECIMAL(18,2) DEFAULT NULL COMMENT '审批通过金额',
    paid_amount             DECIMAL(18,2) DEFAULT 0.00 COMMENT '已付款金额',
    planned_pay_date        DATE DEFAULT NULL COMMENT '计划付款日期',
    bank_account_id         BIGINT DEFAULT NULL COMMENT '付款账户ID',
    status                  VARCHAR(30) DEFAULT 'draft' COMMENT '状态：draft/pending_approval/approved/rejected/paid/canceled',
    workflow_instance_id    VARCHAR(100) DEFAULT NULL COMMENT 'Workflow审批实例ID',
    submitted_at            DATETIME DEFAULT NULL COMMENT '提交时间',
    approved_at             DATETIME DEFAULT NULL COMMENT '审批通过时间',
    rejected_at             DATETIME DEFAULT NULL COMMENT '审批拒绝时间',
    reject_reason           VARCHAR(500) DEFAULT NULL COMMENT '拒绝原因',
    paid_at                 DATETIME DEFAULT NULL COMMENT '付款时间',
    generated_expense_id    BIGINT DEFAULT NULL COMMENT '生成的支出台账ID',
    remark                  VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_payment_request_code (code),
    INDEX idx_payment_request_type (payment_type),
    INDEX idx_payment_request_applicant (applicant_user_id),
    INDEX idx_payment_request_project (project_code),
    INDEX idx_payment_request_contract (contract_code),
    INDEX idx_payment_request_bank_account (bank_account_id),
    INDEX idx_payment_request_status (status),
    INDEX idx_payment_request_workflow (workflow_instance_id),
    INDEX idx_payment_request_deleted (deleted_at),
    CONSTRAINT fk_payment_request_bank_account FOREIGN KEY (bank_account_id) REFERENCES finance_bank_account(id),
    CONSTRAINT fk_payment_request_generated_expense FOREIGN KEY (generated_expense_id) REFERENCES finance_expense(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='付款申请';

-- ------------------------------------------------------------
-- 3.6 外部审批实例映射
-- ------------------------------------------------------------
CREATE TABLE external_approval_instance (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    biz_type                VARCHAR(50) NOT NULL COMMENT '业务类型：invoice_request/expense_claim/project_expense_request/payment_request',
    biz_code                VARCHAR(50) NOT NULL COMMENT '业务单据编号',
    workflow_instance_id    VARCHAR(100) DEFAULT NULL COMMENT 'Workflow审批实例ID',
    external_platform       VARCHAR(30) DEFAULT NULL COMMENT '审批平台：workflow/local/wecom/dingtalk',
    external_instance_id    VARCHAR(100) DEFAULT NULL COMMENT '外部审批实例ID',
    status                  VARCHAR(30) DEFAULT 'pending' COMMENT '状态：pending/approved/rejected/canceled/failed',
    submitted_by            VARCHAR(50) DEFAULT NULL COMMENT '提交人UID',
    submitted_at            DATETIME DEFAULT NULL COMMENT '提交时间',
    completed_at            DATETIME DEFAULT NULL COMMENT '完成时间',
    last_synced_at          DATETIME DEFAULT NULL COMMENT '最近同步时间',
    error_message           VARCHAR(500) DEFAULT NULL COMMENT '错误信息',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_external_approval_biz (biz_type, biz_code),
    INDEX idx_external_approval_workflow (workflow_instance_id),
    INDEX idx_external_approval_external (external_platform, external_instance_id),
    INDEX idx_external_approval_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='外部审批实例映射';

-- ------------------------------------------------------------
-- 3.7 审批回调日志
-- ------------------------------------------------------------
CREATE TABLE approval_callback_log (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    approval_instance_id    BIGINT DEFAULT NULL COMMENT '外部审批实例映射ID',
    workflow_instance_id    VARCHAR(100) DEFAULT NULL COMMENT 'Workflow审批实例ID',
    external_platform       VARCHAR(30) DEFAULT NULL COMMENT '外部平台：wecom/dingtalk',
    event_type              VARCHAR(50) NOT NULL COMMENT '事件类型',
    request_id              VARCHAR(100) DEFAULT NULL COMMENT '回调请求ID/幂等ID',
    payload_json            JSON DEFAULT NULL COMMENT '回调载荷',
    process_status          VARCHAR(30) DEFAULT 'received' COMMENT '处理状态：received/processed/ignored/failed',
    error_message           VARCHAR(500) DEFAULT NULL COMMENT '错误信息',
    received_at             DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '接收时间',
    processed_at            DATETIME DEFAULT NULL COMMENT '处理时间',

    UNIQUE KEY uk_approval_callback_request (external_platform, request_id),
    INDEX idx_approval_callback_instance (approval_instance_id),
    INDEX idx_approval_callback_workflow (workflow_instance_id),
    INDEX idx_approval_callback_status (process_status),
    CONSTRAINT fk_approval_callback_instance FOREIGN KEY (approval_instance_id) REFERENCES external_approval_instance(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审批回调日志';

-- ============================================================
-- 4. v0.3 项目核算与绩效金额财务口径
-- ============================================================

-- ------------------------------------------------------------
-- 4.1 项目财务汇总
-- ------------------------------------------------------------
CREATE TABLE project_finance_summary (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    project_code            VARCHAR(50) NOT NULL COMMENT '项目编码(Aims/Console)',
    project_name            VARCHAR(200) DEFAULT NULL COMMENT '项目名称快照',
    customer_code           VARCHAR(50) DEFAULT NULL COMMENT '客户编码(Altoc)',
    contract_code           VARCHAR(50) DEFAULT NULL COMMENT '主合同编码(Altoc)',
    period_month            CHAR(7) NOT NULL COMMENT '期间月份YYYY-MM',
    contract_amount         DECIMAL(18,2) DEFAULT 0.00 COMMENT '合同金额',
    invoice_amount          DECIMAL(18,2) DEFAULT 0.00 COMMENT '开票金额',
    received_amount         DECIMAL(18,2) DEFAULT 0.00 COMMENT '收款金额',
    direct_expense_amount   DECIMAL(18,2) DEFAULT 0.00 COMMENT '直接支出',
    labor_cost_amount       DECIMAL(18,2) DEFAULT 0.00 COMMENT '人力成本',
    allocated_cost_amount   DECIMAL(18,2) DEFAULT 0.00 COMMENT '分摊成本',
    gross_profit_amount     DECIMAL(18,2) DEFAULT 0.00 COMMENT '毛利额',
    gross_margin_rate       DECIMAL(8,4) DEFAULT NULL COMMENT '毛利率',
    calculated_at           DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '计算时间',
    calculation_source      VARCHAR(30) DEFAULT 'system' COMMENT '计算来源：system/manual/import',
    snapshot_json           JSON DEFAULT NULL COMMENT '计算快照',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_project_summary_project_period (project_code, period_month),
    INDEX idx_project_summary_customer (customer_code),
    INDEX idx_project_summary_contract (contract_code),
    INDEX idx_project_summary_margin (gross_margin_rate),
    INDEX idx_project_summary_calculated (calculated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目财务汇总';

-- ------------------------------------------------------------
-- 4.2 项目成本分摊
-- ------------------------------------------------------------
CREATE TABLE project_cost_allocation (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                VARCHAR(50) NOT NULL COMMENT '成本分摊编号',
    project_code        VARCHAR(50) NOT NULL COMMENT '项目编码(Aims/Console)',
    period_month        CHAR(7) NOT NULL COMMENT '期间月份YYYY-MM',
    allocation_type     VARCHAR(30) NOT NULL COMMENT '分摊类型：labor/shared_expense/asset/other',
    source_table        VARCHAR(100) DEFAULT NULL COMMENT '来源表',
    source_id           BIGINT DEFAULT NULL COMMENT '来源ID',
    employee_uid        VARCHAR(50) DEFAULT NULL COMMENT '员工UID',
    amount              DECIMAL(18,2) NOT NULL COMMENT '分摊金额',
    allocation_basis    VARCHAR(100) DEFAULT NULL COMMENT '分摊依据：work_hour/ratio/manual/rule',
    basis_value         DECIMAL(18,4) DEFAULT NULL COMMENT '依据数值',
    rule_code           VARCHAR(50) DEFAULT NULL COMMENT '分摊规则编码',
    status              VARCHAR(30) DEFAULT 'active' COMMENT '状态：active/reversed',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_project_cost_allocation_code (code),
    INDEX idx_project_cost_allocation_project (project_code, period_month),
    INDEX idx_project_cost_allocation_employee (employee_uid),
    INDEX idx_project_cost_allocation_source (source_table, source_id),
    INDEX idx_project_cost_allocation_type (allocation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目成本分摊';

-- ------------------------------------------------------------
-- 4.3 员工成本快照
-- ------------------------------------------------------------
CREATE TABLE employee_cost_snapshot (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    employee_uid            VARCHAR(50) NOT NULL COMMENT '员工UID',
    employee_name           VARCHAR(100) DEFAULT NULL COMMENT '员工姓名快照',
    dept_code               VARCHAR(50) DEFAULT NULL COMMENT '部门编码',
    position_code           VARCHAR(50) DEFAULT NULL COMMENT '岗位编码',
    rank_code               VARCHAR(50) DEFAULT NULL COMMENT '职级编码',
    period_month            CHAR(7) NOT NULL COMMENT '期间月份YYYY-MM',
    standard_cost_amount    DECIMAL(18,2) DEFAULT NULL COMMENT '标准人力成本',
    actual_cost_amount      DECIMAL(18,2) DEFAULT NULL COMMENT '实际人力成本',
    cost_source             VARCHAR(30) DEFAULT 'hrm' COMMENT '成本来源：people/hrm/import/manual；hrm 为历史兼容值',
    source_refs_json        JSON DEFAULT NULL COMMENT 'People/薪酬/考勤来源引用',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_employee_cost_period (employee_uid, period_month),
    INDEX idx_employee_cost_dept (dept_code, period_month),
    INDEX idx_employee_cost_rank (rank_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工成本快照';

-- ------------------------------------------------------------
-- 4.4 员工财务贡献归因
-- ------------------------------------------------------------
CREATE TABLE employee_finance_contribution (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(50) NOT NULL COMMENT '贡献记录编号',
    employee_uid            VARCHAR(50) NOT NULL COMMENT '员工UID',
    employee_name           VARCHAR(100) DEFAULT NULL COMMENT '员工姓名快照',
    dept_code               VARCHAR(50) DEFAULT NULL COMMENT '部门编码',
    project_code            VARCHAR(50) DEFAULT NULL COMMENT '项目编码(Aims/Console)',
    contract_code           VARCHAR(50) DEFAULT NULL COMMENT '合同编码(Altoc)',
    period_month            CHAR(7) NOT NULL COMMENT '期间月份YYYY-MM',
    contribution_type       VARCHAR(30) NOT NULL COMMENT '贡献类型：sales/delivery/collection/presales/management/other',
    contribution_amount     DECIMAL(18,2) DEFAULT NULL COMMENT '贡献金额',
    contribution_ratio      DECIMAL(8,4) DEFAULT NULL COMMENT '贡献占比',
    source_type             VARCHAR(30) DEFAULT 'system' COMMENT '来源：system/import/manual/migration',
    source_refs_json        JSON DEFAULT NULL COMMENT '来源引用',
    status                  VARCHAR(30) DEFAULT 'active' COMMENT '状态：active/reversed',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_employee_contribution_code (code),
    INDEX idx_employee_contribution_employee (employee_uid, period_month),
    INDEX idx_employee_contribution_project (project_code, period_month),
    INDEX idx_employee_contribution_contract (contract_code),
    INDEX idx_employee_contribution_type (contribution_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工财务贡献归因快照';

-- ------------------------------------------------------------
-- 4.5 绩效金额/提成奖金财务规则
-- ------------------------------------------------------------
CREATE TABLE performance_rule (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                VARCHAR(50) NOT NULL COMMENT '规则编码',
    name                VARCHAR(100) NOT NULL COMMENT '规则名称',
    rule_type           VARCHAR(30) NOT NULL COMMENT '规则类型：commission/bonus/performance_score/cost_share',
    scope_type          VARCHAR(30) DEFAULT 'company' COMMENT '适用范围：company/dept/project/role/user',
    scope_code          VARCHAR(50) DEFAULT NULL COMMENT '适用范围编码',
    effective_from      DATE DEFAULT NULL COMMENT '生效开始日期',
    effective_to        DATE DEFAULT NULL COMMENT '生效结束日期',
    rule_json           JSON NOT NULL COMMENT '规则定义JSON',
    status              VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by          VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_performance_rule_code (code),
    INDEX idx_performance_rule_type (rule_type),
    INDEX idx_performance_rule_scope (scope_type, scope_code),
    INDEX idx_performance_rule_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='绩效金额/提成奖金财务规则';

-- ------------------------------------------------------------
-- 4.6 绩效金额财务口径快照
-- ------------------------------------------------------------
CREATE TABLE employee_finance_performance (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(50) NOT NULL COMMENT '绩效金额记录编号',
    employee_uid            VARCHAR(50) NOT NULL COMMENT '员工UID',
    employee_name           VARCHAR(100) DEFAULT NULL COMMENT '员工姓名快照',
    dept_code               VARCHAR(50) DEFAULT NULL COMMENT '部门编码',
    period_month            CHAR(7) NOT NULL COMMENT '期间月份YYYY-MM',
    rule_id                 BIGINT DEFAULT NULL COMMENT '绩效金额规则ID',
    performance_type        VARCHAR(30) NOT NULL COMMENT '金额类型：commission/bonus/performance_score/other',
    base_amount             DECIMAL(18,2) DEFAULT NULL COMMENT '计算基数',
    performance_amount      DECIMAL(18,2) DEFAULT NULL COMMENT '绩效金额/提成奖金金额',
    performance_score       DECIMAL(10,2) DEFAULT NULL COMMENT 'People 绩效评分输入快照',
    status                  VARCHAR(30) DEFAULT 'draft' COMMENT '状态：draft/calculated/confirmed/paid/canceled；Finance 金额处理状态，不代表 People 绩效终态',
    calculated_at           DATETIME DEFAULT NULL COMMENT '计算时间',
    confirmed_by            VARCHAR(50) DEFAULT NULL COMMENT '财务金额确认人',
    confirmed_at            DATETIME DEFAULT NULL COMMENT '财务金额确认时间',
    calculation_snapshot_json JSON DEFAULT NULL COMMENT '计算快照JSON',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_employee_performance_code (code),
    INDEX idx_employee_performance_employee (employee_uid, period_month),
    INDEX idx_employee_performance_dept (dept_code, period_month),
    INDEX idx_employee_performance_rule (rule_id),
    INDEX idx_employee_performance_type (performance_type),
    INDEX idx_employee_performance_status (status),
    CONSTRAINT fk_employee_performance_rule FOREIGN KEY (rule_id) REFERENCES performance_rule(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='绩效金额财务口径快照';

-- ------------------------------------------------------------
-- 4.7 绩效金额计算快照
-- ------------------------------------------------------------
CREATE TABLE performance_calculation_snapshot (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(50) NOT NULL COMMENT '绩效金额计算快照编号',
    period_month            CHAR(7) NOT NULL COMMENT '期间月份YYYY-MM',
    calculation_type        VARCHAR(30) NOT NULL COMMENT '计算类型：project/employee/dept/company',
    rule_id                 BIGINT DEFAULT NULL COMMENT '规则ID',
    target_type             VARCHAR(30) NOT NULL COMMENT '目标类型：project/employee/dept/company',
    target_code             VARCHAR(50) NOT NULL COMMENT '目标编码',
    input_hash              VARCHAR(64) DEFAULT NULL COMMENT '输入摘要hash',
    result_json             JSON NOT NULL COMMENT '计算结果JSON',
    calculated_by           VARCHAR(50) DEFAULT NULL COMMENT '计算人/任务',
    calculated_at           DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '计算时间',

    UNIQUE KEY uk_performance_snapshot_code (code),
    INDEX idx_performance_snapshot_period (period_month),
    INDEX idx_performance_snapshot_target (target_type, target_code),
    INDEX idx_performance_snapshot_rule (rule_id),
    CONSTRAINT fk_performance_snapshot_rule FOREIGN KEY (rule_id) REFERENCES performance_rule(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='绩效金额计算快照';

-- ============================================================
-- 5. 附件与审计
-- ============================================================

-- ------------------------------------------------------------
-- 5.1 财务附件
-- ------------------------------------------------------------
CREATE TABLE finance_attachment (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    entity_type     VARCHAR(50) NOT NULL COMMENT '实体类型',
    entity_id       BIGINT NOT NULL COMMENT '实体ID',
    file_name       VARCHAR(200) NOT NULL COMMENT '文件名',
    file_key        VARCHAR(500) NOT NULL COMMENT 'OSS文件Key',
    file_size       BIGINT DEFAULT NULL COMMENT '文件大小(字节)',
    content_type    VARCHAR(100) DEFAULT NULL COMMENT 'MIME类型',
    uploaded_by     VARCHAR(50) DEFAULT NULL COMMENT '上传人',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_finance_attachment_entity (entity_type, entity_id),
    INDEX idx_finance_attachment_uploaded_by (uploaded_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='财务附件';

-- ------------------------------------------------------------
-- 5.2 财务审计日志
-- ------------------------------------------------------------
CREATE TABLE finance_audit_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    entity_type     VARCHAR(50) NOT NULL COMMENT '实体类型',
    entity_id       BIGINT DEFAULT NULL COMMENT '实体ID',
    entity_code     VARCHAR(50) DEFAULT NULL COMMENT '实体编码',
    action          VARCHAR(50) NOT NULL COMMENT '动作：create/update/delete/approve/confirm/reconcile/reverse/export',
    old_value       JSON DEFAULT NULL COMMENT '旧值',
    new_value       JSON DEFAULT NULL COMMENT '新值',
    operator_id     VARCHAR(50) DEFAULT NULL COMMENT '操作人UID',
    operator_ip     VARCHAR(50) DEFAULT NULL COMMENT '操作IP',
    source_app      VARCHAR(30) DEFAULT 'finance' COMMENT '来源应用',
    request_id      VARCHAR(100) DEFAULT NULL COMMENT '请求ID',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_finance_audit_entity (entity_type, entity_id),
    INDEX idx_finance_audit_code (entity_type, entity_code),
    INDEX idx_finance_audit_operator (operator_id),
    INDEX idx_finance_audit_created (created_at),
    INDEX idx_finance_audit_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='财务审计日志';

-- ============================================================
-- 6. 初始字典
-- ============================================================

INSERT INTO finance_subject (code, name, subject_type, sort_no, remark) VALUES
('1001', '库存现金', 'asset', 10, '小企业会计准则附录：会计科目'),
('1002', '银行存款', 'asset', 20, '小企业会计准则附录：会计科目'),
('1012', '其他货币资金', 'asset', 30, '小企业会计准则附录：会计科目'),
('1101', '短期投资', 'asset', 40, '小企业会计准则附录：会计科目'),
('1121', '应收票据', 'asset', 50, '小企业会计准则附录：会计科目'),
('1122', '应收账款', 'asset', 60, '小企业会计准则附录：会计科目'),
('1123', '预付账款', 'asset', 70, '小企业会计准则附录：会计科目'),
('1131', '应收股利', 'asset', 80, '小企业会计准则附录：会计科目'),
('1132', '应收利息', 'asset', 90, '小企业会计准则附录：会计科目'),
('1221', '其他应收款', 'asset', 100, '小企业会计准则附录：会计科目'),
('1401', '材料采购', 'asset', 110, '小企业会计准则附录：会计科目'),
('1402', '在途物资', 'asset', 120, '小企业会计准则附录：会计科目'),
('1403', '原材料', 'asset', 130, '小企业会计准则附录：会计科目'),
('1404', '材料成本差异', 'asset', 140, '小企业会计准则附录：会计科目'),
('1405', '库存商品', 'asset', 150, '小企业会计准则附录：会计科目'),
('1407', '商品进销差价', 'asset', 160, '小企业会计准则附录：会计科目'),
('1408', '委托加工物资', 'asset', 170, '小企业会计准则附录：会计科目'),
('1411', '周转材料', 'asset', 180, '小企业会计准则附录：会计科目'),
('1421', '消耗性生物资产', 'asset', 190, '小企业会计准则附录：会计科目'),
('1501', '长期债券投资', 'asset', 200, '小企业会计准则附录：会计科目'),
('1511', '长期股权投资', 'asset', 210, '小企业会计准则附录：会计科目'),
('1601', '固定资产', 'asset', 220, '小企业会计准则附录：会计科目'),
('1602', '累计折旧', 'asset', 230, '小企业会计准则附录：会计科目'),
('1604', '在建工程', 'asset', 240, '小企业会计准则附录：会计科目'),
('1605', '工程物资', 'asset', 250, '小企业会计准则附录：会计科目'),
('1606', '固定资产清理', 'asset', 260, '小企业会计准则附录：会计科目'),
('1621', '生产性生物资产', 'asset', 270, '小企业会计准则附录：会计科目'),
('1622', '生产性生物资产累计折旧', 'asset', 280, '小企业会计准则附录：会计科目'),
('1701', '无形资产', 'asset', 290, '小企业会计准则附录：会计科目'),
('1702', '累计摊销', 'asset', 300, '小企业会计准则附录：会计科目'),
('1801', '长期待摊费用', 'asset', 310, '小企业会计准则附录：会计科目'),
('1901', '待处理财产损溢', 'asset', 320, '小企业会计准则附录：会计科目'),
('2001', '短期借款', 'liability', 330, '小企业会计准则附录：会计科目'),
('2201', '应付票据', 'liability', 340, '小企业会计准则附录：会计科目'),
('2202', '应付账款', 'liability', 350, '小企业会计准则附录：会计科目'),
('2203', '预收账款', 'liability', 360, '小企业会计准则附录：会计科目'),
('2211', '应付职工薪酬', 'liability', 370, '小企业会计准则附录：会计科目'),
('2221', '应交税费', 'liability', 380, '小企业会计准则附录：会计科目'),
('2231', '应付利息', 'liability', 390, '小企业会计准则附录：会计科目'),
('2232', '应付利润', 'liability', 400, '小企业会计准则附录：会计科目'),
('2241', '其他应付款', 'liability', 410, '小企业会计准则附录：会计科目'),
('2401', '递延收益', 'liability', 420, '小企业会计准则附录：会计科目'),
('2501', '长期借款', 'liability', 430, '小企业会计准则附录：会计科目'),
('2701', '长期应付款', 'liability', 440, '小企业会计准则附录：会计科目'),
('3001', '实收资本', 'equity', 450, '小企业会计准则附录：会计科目'),
('3002', '资本公积', 'equity', 460, '小企业会计准则附录：会计科目'),
('3101', '盈余公积', 'equity', 470, '小企业会计准则附录：会计科目'),
('3103', '本年利润', 'equity', 480, '小企业会计准则附录：会计科目'),
('3104', '利润分配', 'equity', 490, '小企业会计准则附录：会计科目'),
('4001', '生产成本', 'cost', 500, '小企业会计准则附录：会计科目'),
('4101', '制造费用', 'cost', 510, '小企业会计准则附录：会计科目'),
('4301', '研发支出', 'cost', 520, '小企业会计准则附录：会计科目'),
('4401', '工程施工', 'cost', 530, '小企业会计准则附录：会计科目'),
('4403', '机械作业', 'cost', 540, '小企业会计准则附录：会计科目'),
('5001', '主营业务收入', 'profit_loss', 550, '小企业会计准则附录：会计科目'),
('5051', '其他业务收入', 'profit_loss', 560, '小企业会计准则附录：会计科目'),
('5111', '投资收益', 'profit_loss', 570, '小企业会计准则附录：会计科目'),
('5301', '营业外收入', 'profit_loss', 580, '小企业会计准则附录：会计科目'),
('5401', '主营业务成本', 'profit_loss', 590, '小企业会计准则附录：会计科目'),
('5402', '其他业务成本', 'profit_loss', 600, '小企业会计准则附录：会计科目'),
('5403', '营业税金及附加', 'profit_loss', 610, '小企业会计准则附录：会计科目'),
('5601', '销售费用', 'profit_loss', 620, '小企业会计准则附录：会计科目'),
('5602', '管理费用', 'profit_loss', 630, '小企业会计准则附录：会计科目'),
('5603', '财务费用', 'profit_loss', 640, '小企业会计准则附录：会计科目'),
('5711', '营业外支出', 'profit_loss', 650, '小企业会计准则附录：会计科目'),
('5801', '所得税费用', 'profit_loss', 660, '小企业会计准则附录：会计科目');

INSERT INTO finance_income_type (code, name, default_subject_id, is_contract_income, sort_no) VALUES
('full_payment', '全款/一次性收入', (SELECT id FROM finance_subject WHERE code = '5001'), 1, 10),
('advance', '定金/预付款', (SELECT id FROM finance_subject WHERE code = '5001'), 1, 20),
('first_payment', '首付款', (SELECT id FROM finance_subject WHERE code = '5001'), 1, 30),
('milestone', '阶段付款', (SELECT id FROM finance_subject WHERE code = '5001'), 1, 40),
('acceptance', '验收付款', (SELECT id FROM finance_subject WHERE code = '5001'), 1, 50),
('retention', '尾款/质保金', (SELECT id FROM finance_subject WHERE code = '5001'), 1, 60),
('maintenance', '维护费', (SELECT id FROM finance_subject WHERE code = '5001'), 1, 70),
('interest', '利息收入', (SELECT id FROM finance_subject WHERE code = '5111'), 0, 80),
('subsidy', '补贴收入', (SELECT id FROM finance_subject WHERE code = '5301'), 0, 90),
('other', '其他收入', (SELECT id FROM finance_subject WHERE code = '5051'), 0, 100);

INSERT INTO finance_expense_type (code, name, default_subject_id, cost_category, reimbursable, sort_no) VALUES
('travel', '差旅费', (SELECT id FROM finance_subject WHERE code = '5602'), 'project', 1, 10),
('entertainment', '业务招待费', (SELECT id FROM finance_subject WHERE code = '5601'), 'sales', 1, 20),
('sales_fee', '销售费用', (SELECT id FROM finance_subject WHERE code = '5601'), 'sales', 1, 30),
('project_purchase', '项目采购', (SELECT id FROM finance_subject WHERE code = '5401'), 'project', 0, 40),
('outsourcing', '外协支出', (SELECT id FROM finance_subject WHERE code = '5401'), 'project', 0, 50),
('tax_fee', '税费', (SELECT id FROM finance_subject WHERE code = '5403'), 'finance', 0, 60),
('refund', '退款', (SELECT id FROM finance_subject WHERE code = '5401'), 'project', 0, 70),
('office', '办公费', (SELECT id FROM finance_subject WHERE code = '5602'), 'admin', 1, 80),
('bank_charge', '银行手续费', (SELECT id FROM finance_subject WHERE code = '5603'), 'finance', 0, 90),
('other', '其他支出', (SELECT id FROM finance_subject WHERE code = '5711'), 'other', 1, 100);

INSERT INTO finance_people_cost_parameter (
    code, name, effective_from, base_salary, welfare_cost_rate, management_allocation_rate,
    resource_allocation_cost, currency_code, status, remark
) VALUES (
    'PCP-DEFAULT-2026', '默认人力成本参数', '2026-01-01', 8000.00, 0.3000, 0.2000,
    2000.00, 'CNY', 'active', '用于 People 职级标准成本快照生成；可按有效期新增版本覆盖'
);

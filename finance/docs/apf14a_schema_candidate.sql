-- CANDIDATE ONLY. Use reviewed domaininstall plan; do not execute directly.

CREATE TABLE finance_project_cost_period (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    project_code VARCHAR(64) NOT NULL, period_month CHAR(7) NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    closed_at DATETIME(6) NULL, closed_by VARCHAR(64) NULL,
    zero_confirmed_at DATETIME(6) NULL, zero_confirmed_by VARCHAR(64) NULL,
    zero_input_sha256 CHAR(64) NULL, current_batch_code VARCHAR(64) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uk_project_cost_period (project_code,period_month),
    CHECK ((closed_at IS NULL AND closed_by IS NULL) OR (closed_at IS NOT NULL AND closed_by IS NOT NULL)),
    CHECK ((zero_confirmed_at IS NULL AND zero_confirmed_by IS NULL AND zero_input_sha256 IS NULL) OR (zero_confirmed_at IS NOT NULL AND zero_confirmed_by IS NOT NULL AND zero_input_sha256 IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE finance_project_cost_batch (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(64) NOT NULL, project_code VARCHAR(64) NOT NULL, period_month CHAR(7) NOT NULL,
    revision BIGINT UNSIGNED NOT NULL, parent_batch_code VARCHAR(64) NULL,
    input_sha256 CHAR(64) NOT NULL, formula_version VARCHAR(64) NOT NULL,
    readiness_status VARCHAR(16) NOT NULL, missing_inputs_json JSON NOT NULL,
    input_snapshot_json JSON NOT NULL, calendar_snapshot_json JSON NOT NULL,
    currency_code CHAR(3) NULL, labor_cost_amount DECIMAL(18,2) NULL,
    calculated_by VARCHAR(64) NOT NULL, receipt_key VARCHAR(191) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uk_cost_batch_code (code),
    UNIQUE KEY uk_cost_batch_revision (project_code,period_month,revision),
    UNIQUE KEY uk_cost_batch_receipt (receipt_key),
    CHECK (readiness_status IN ('ready','not_ready')),
    CHECK ((readiness_status='ready' AND labor_cost_amount IS NOT NULL AND currency_code IS NOT NULL) OR (readiness_status='not_ready' AND labor_cost_amount IS NULL)),
    CHECK (labor_cost_amount IS NULL OR labor_cost_amount>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE finance_project_cost_batch_item (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    batch_code VARCHAR(64) NOT NULL, employee_uid VARCHAR(64) NOT NULL,
    project_hours DECIMAL(18,4) NOT NULL, standard_work_hours DECIMAL(18,4) NOT NULL,
    allocation_ratio DECIMAL(18,4) NOT NULL, standard_cost_amount DECIMAL(18,2) NOT NULL,
    allocated_cost_amount DECIMAL(18,2) NOT NULL, currency_code CHAR(3) NOT NULL,
    people_snapshot_code VARCHAR(64) NULL, source_snapshot_json JSON NOT NULL,
    UNIQUE KEY uk_cost_batch_employee (batch_code,employee_uid),
    CONSTRAINT fk_cost_item_batch FOREIGN KEY (batch_code) REFERENCES finance_project_cost_batch(code) ON DELETE RESTRICT,
    CHECK (project_hours>=0 AND standard_work_hours>0 AND allocation_ratio>=0 AND standard_cost_amount>=0 AND allocated_cost_amount>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE finance_employee_cost_snapshot (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    employee_uid VARCHAR(64) NOT NULL, period_month CHAR(7) NOT NULL,
    input_sha256 CHAR(64) NOT NULL, standard_cost_amount DECIMAL(18,2) NOT NULL,
    currency_code CHAR(3) NOT NULL, people_snapshot_code VARCHAR(64) NULL,
    source_refs_json JSON NOT NULL, row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uk_employee_cost_period (employee_uid,period_month),
    CHECK (standard_cost_amount>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE finance_project_cost_allocation (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(64) NOT NULL, project_code VARCHAR(64) NOT NULL, period_month CHAR(7) NOT NULL,
    allocation_type VARCHAR(32) NOT NULL, source_table VARCHAR(100) NOT NULL,
    employee_uid VARCHAR(64) NULL, amount DECIMAL(18,2) NOT NULL,
    currency_code CHAR(3) NOT NULL, allocation_basis VARCHAR(100) NOT NULL,
    basis_value DECIMAL(18,4) NOT NULL, rule_code VARCHAR(64) NOT NULL,
    batch_code VARCHAR(64) NULL, source_refs_json JSON NOT NULL,
    status VARCHAR(16) NOT NULL, row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by VARCHAR(64) NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uk_cost_allocation_code (code),
    KEY idx_cost_allocation_project (project_code,period_month,allocation_type),
    CHECK (status IN ('active','reversed')), CHECK (amount>=0 AND basis_value>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE finance_project_summary (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    project_code VARCHAR(64) NOT NULL, period_month CHAR(7) NOT NULL,
    currency_code CHAR(3) NULL, receipt_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
    direct_expense_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
    labor_cost_amount DECIMAL(18,2) NULL, other_cost_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
    gross_profit_amount DECIMAL(18,2) NULL, gross_margin_rate DECIMAL(18,4) NULL,
    cost_readiness_status VARCHAR(16) NOT NULL DEFAULT 'not_ready',
    cost_missing_inputs_json JSON NOT NULL, cost_input_hash CHAR(64) NULL,
    current_batch_code VARCHAR(64) NULL, financial_input_sha256 CHAR(64) NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    calculated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uk_project_summary_period (project_code,period_month),
    CHECK (cost_readiness_status IN ('ready','not_ready')),
    CHECK (cost_readiness_status='ready' OR (gross_profit_amount IS NULL AND gross_margin_rate IS NULL AND labor_cost_amount IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Altoc migration 036: contract line cost allocation and profit summaries.
-- Goal 3 accounting layer. This keeps worklog facts in Aims and stores only
-- explicit allocation rules plus rebuildable operating summaries in Altoc.

CREATE TABLE IF NOT EXISTS contract_line_cost_allocation (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  tenant_id VARCHAR(64) DEFAULT NULL COMMENT '租户快照；单租户库可为空',
  contract_line_id BIGINT DEFAULT NULL COMMENT '合同行本地ID快照',
  contract_line_code VARCHAR(64) NOT NULL COMMENT '合同行编号',
  contract_code VARCHAR(64) DEFAULT NULL COMMENT '合同编号快照',
  project_code VARCHAR(64) NOT NULL COMMENT 'Aims项目编号',
  allocation_type VARCHAR(30) NOT NULL DEFAULT 'direct' COMMENT '分摊方式：direct/ratio/amount/workdays',
  allocation_ratio DECIMAL(8,4) DEFAULT NULL COMMENT '分摊比例(%)',
  allocated_amount DECIMAL(18,2) DEFAULT NULL COMMENT '固定分摊金额',
  allocated_workdays DECIMAL(10,2) DEFAULT NULL COMMENT '分摊人天',
  effective_from DATE DEFAULT NULL COMMENT '生效开始日期',
  effective_to DATE DEFAULT NULL COMMENT '生效结束日期',
  status VARCHAR(30) NOT NULL DEFAULT 'active' COMMENT '状态：active/closed',
  source_type VARCHAR(40) NOT NULL DEFAULT 'manual' COMMENT '来源：manual/contract_project_line_rel/recalculation',
  source_ref_code VARCHAR(120) DEFAULT NULL COMMENT '来源引用编码',
  snapshot_json JSON DEFAULT NULL COMMENT '创建时规则快照',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',

  UNIQUE KEY uk_clca_line_project_type_period (contract_line_code, project_code, allocation_type, effective_from, effective_to),
  INDEX idx_clca_line_code (contract_line_code, status),
  INDEX idx_clca_project (project_code, status),
  INDEX idx_clca_contract (contract_code),
  INDEX idx_clca_line_id (contract_line_id),
  INDEX idx_clca_source (source_type, source_ref_code, status),
  CONSTRAINT fk_clca_line FOREIGN KEY (contract_line_id) REFERENCES contract_line(id) ON DELETE SET NULL,
  CHECK (allocation_ratio IS NULL OR allocation_ratio >= 0),
  CHECK (allocated_amount IS NULL OR allocated_amount >= 0),
  CHECK (allocated_workdays IS NULL OR allocated_workdays > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同行成本归集分摊规则';

CREATE TABLE IF NOT EXISTS contract_line_profit_summary (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  contract_line_code VARCHAR(64) NOT NULL COMMENT '合同行编号',
  contract_code VARCHAR(64) DEFAULT NULL COMMENT '合同编号快照',
  customer_code VARCHAR(64) DEFAULT NULL COMMENT '客户编号快照',
  period_start DATE NOT NULL COMMENT '核算期间开始',
  period_end DATE NOT NULL COMMENT '核算期间结束',
  total_revenue DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '收入金额',
  total_cost DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '成本金额',
  gross_profit DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '毛利金额',
  gross_margin DECIMAL(12,6) DEFAULT NULL COMMENT '毛利率',
  project_count INT NOT NULL DEFAULT 0 COMMENT '参与项目数',
  calculation_key VARCHAR(160) NOT NULL COMMENT '幂等计算键',
  source_version VARCHAR(80) DEFAULT NULL COMMENT '来源版本或批次',
  calculated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '计算时间',
  version INT NOT NULL DEFAULT 1 COMMENT '版本号',
  is_current TINYINT NOT NULL DEFAULT 1 COMMENT '是否当前版本',
  detail_json JSON DEFAULT NULL COMMENT '可重建明细快照',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',

  UNIQUE KEY uk_clps_line_period_key (contract_line_code, period_start, period_end, calculation_key),
  INDEX idx_clps_contract (contract_code, period_start, period_end, is_current),
  INDEX idx_clps_customer (customer_code, period_start, period_end, is_current),
  INDEX idx_clps_line_current (contract_line_code, period_start, period_end, is_current)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同行毛利汇总，可重建派生数据';

CREATE TABLE IF NOT EXISTS service_cost_summary (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  service_agreement_code VARCHAR(64) NOT NULL COMMENT '服务协议编号',
  project_code VARCHAR(64) NOT NULL COMMENT 'Aims服务项目编号',
  environment_code VARCHAR(64) DEFAULT NULL COMMENT '正式环境编号过滤快照',
  period_start DATE NOT NULL COMMENT '核算期间开始',
  period_end DATE NOT NULL COMMENT '核算期间结束',
  ticket_count INT NOT NULL DEFAULT 0 COMMENT '工单数',
  sla_ticket_count INT NOT NULL DEFAULT 0 COMMENT 'SLA工单数',
  total_hours DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '服务工时',
  total_cost DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '服务成本',
  calculation_key VARCHAR(160) NOT NULL COMMENT '幂等计算键',
  calculated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '计算时间',
  version INT NOT NULL DEFAULT 1 COMMENT '版本号',
  is_current TINYINT NOT NULL DEFAULT 1 COMMENT '是否当前版本',
  detail_json JSON DEFAULT NULL COMMENT '可重建明细快照',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',

  UNIQUE KEY uk_scs_agreement_project_period_key (service_agreement_code, project_code, period_start, period_end, calculation_key),
  INDEX idx_scs_agreement (service_agreement_code, period_start, period_end, is_current),
  INDEX idx_scs_project (project_code, period_start, period_end, is_current),
  INDEX idx_scs_environment (environment_code, period_start, period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务协议成本汇总，可重建派生数据';

SET @hzy_036_has_paid_amount := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'contract_billing_schedule'
    AND COLUMN_NAME = 'paid_amount'
);
SET @hzy_036_paid_amount_sql := IF(
  @hzy_036_has_paid_amount = 0,
  'ALTER TABLE contract_billing_schedule ADD COLUMN paid_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT ''已支付/已回款金额'' AFTER amount',
  'SELECT ''contract_billing_schedule.paid_amount already exists'' AS msg'
);
PREPARE stmt FROM @hzy_036_paid_amount_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @hzy_036_has_milestone_type := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'contract_billing_schedule'
    AND COLUMN_NAME = 'milestone_type'
);
SET @hzy_036_milestone_type_sql := IF(
  @hzy_036_has_milestone_type = 0,
  'ALTER TABLE contract_billing_schedule ADD COLUMN milestone_type VARCHAR(40) DEFAULT NULL COMMENT ''收入节点类型：sign/delivery/milestone/recurring'' AFTER trigger_ref_code',
  'SELECT ''contract_billing_schedule.milestone_type already exists'' AS msg'
);
PREPARE stmt FROM @hzy_036_milestone_type_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @hzy_036_has_due_date := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'contract_billing_schedule'
    AND COLUMN_NAME = 'due_date'
);
SET @hzy_036_due_date_sql := IF(
  @hzy_036_has_due_date = 0,
  'ALTER TABLE contract_billing_schedule ADD COLUMN due_date DATE DEFAULT NULL COMMENT ''收入到期日期'' AFTER expected_date',
  'SELECT ''contract_billing_schedule.due_date already exists'' AS msg'
);
PREPARE stmt FROM @hzy_036_due_date_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE contract_billing_schedule
SET due_date = COALESCE(due_date, expected_date),
    milestone_type = COALESCE(milestone_type, trigger_type)
WHERE deleted_at IS NULL;

SELECT
  (SELECT COUNT(*) FROM contract_line_cost_allocation WHERE deleted_at IS NULL) AS cost_allocation_count,
  (SELECT COUNT(*) FROM contract_line_profit_summary WHERE deleted_at IS NULL) AS profit_summary_count,
  (SELECT COUNT(*) FROM service_cost_summary WHERE deleted_at IS NULL) AS service_cost_summary_count;

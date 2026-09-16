-- ============================================================
-- Migration 027: P0B contract obligations and billing schedules
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database after 026.
--
-- P0B scope:
-- - add contract_obligation and contract_billing_schedule
-- - generate default obligations from contract_line
-- - convert legacy contract_stage and contract_payment_term into read-compatible
--   P0B obligations and billing schedules
--
-- This migration intentionally does not create contract_project_link,
-- contract_orchestration_job, contract_orchestration_step, service_agreement,
-- or any cross-application execution object.

CREATE TABLE IF NOT EXISTS contract_obligation (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  code VARCHAR(64) NOT NULL COMMENT '履约义务编号',
  contract_id BIGINT NOT NULL COMMENT '合同ID',
  contract_line_id BIGINT DEFAULT NULL COMMENT '合同行ID',
  obligation_type VARCHAR(50) NOT NULL COMMENT '义务类型',
  name VARCHAR(200) NOT NULL COMMENT '义务名称',
  description TEXT DEFAULT NULL COMMENT '义务说明',
  fulfillment_method VARCHAR(30) DEFAULT NULL COMMENT '履约方式',
  planned_start_at DATETIME DEFAULT NULL COMMENT '计划开始时间',
  planned_due_at DATETIME DEFAULT NULL COMMENT '计划完成时间',
  actual_completed_at DATETIME DEFAULT NULL COMMENT '实际完成时间',
  submitted_at DATETIME DEFAULT NULL COMMENT '提交时间',
  accepted_at DATETIME DEFAULT NULL COMMENT '验收通过时间',
  rejected_at DATETIME DEFAULT NULL COMMENT '驳回时间',
  acceptance_required TINYINT NOT NULL DEFAULT 0 COMMENT '是否需要验收',
  acceptance_criteria VARCHAR(1000) DEFAULT NULL COMMENT '验收标准',
  status VARCHAR(30) NOT NULL DEFAULT 'not_started' COMMENT '状态：not_started/in_progress/submitted/accepted/rejected/completed/waived/blocked/cancelled',
  owner_user_id VARCHAR(50) DEFAULT NULL COMMENT '负责人',
  evidence_document_uuid VARCHAR(100) DEFAULT NULL COMMENT '证据文档UUID',
  evidence_note VARCHAR(1000) DEFAULT NULL COMMENT '证据说明',
  waiver_reason VARCHAR(500) DEFAULT NULL COMMENT '豁免原因',
  reject_reason VARCHAR(500) DEFAULT NULL COMMENT '驳回原因',
  source_type VARCHAR(50) DEFAULT NULL COMMENT '来源类型：contract_line/legacy_contract_stage/manual',
  source_ref_id BIGINT DEFAULT NULL COMMENT '来源ID',
  source_ref_code VARCHAR(100) DEFAULT NULL COMMENT '来源编码',
  sort_no INT NOT NULL DEFAULT 0 COMMENT '排序',
  version_no INT NOT NULL DEFAULT 1 COMMENT '版本号',
  snapshot_json JSON DEFAULT NULL COMMENT '来源快照',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
  UNIQUE KEY uk_contract_obligation_code (code),
  INDEX idx_contract_obligation_contract (contract_id, sort_no, id),
  INDEX idx_contract_obligation_line (contract_line_id),
  INDEX idx_contract_obligation_status (status),
  INDEX idx_contract_obligation_source (source_type, source_ref_id),
  CONSTRAINT fk_contract_obligation_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE,
  CONSTRAINT fk_contract_obligation_line FOREIGN KEY (contract_line_id) REFERENCES contract_line(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同履约义务表';

CREATE TABLE IF NOT EXISTS contract_billing_schedule (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  code VARCHAR(64) NOT NULL COMMENT '结算计划编号',
  contract_id BIGINT NOT NULL COMMENT '合同ID',
  contract_line_id BIGINT DEFAULT NULL COMMENT '合同行ID',
  obligation_id BIGINT DEFAULT NULL COMMENT '履约义务ID',
  direction VARCHAR(20) NOT NULL DEFAULT 'receivable' COMMENT '方向：receivable/payable',
  name VARCHAR(200) NOT NULL COMMENT '结算节点名称',
  trigger_type VARCHAR(50) NOT NULL COMMENT '触发类型',
  trigger_ref_code VARCHAR(100) DEFAULT NULL COMMENT '触发引用编码',
  amount DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '结算金额',
  ratio DECIMAL(8,4) DEFAULT NULL COMMENT '合同金额比例(%)',
  currency_code VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
  expected_date DATE DEFAULT NULL COMMENT '预计日期',
  recurrence_rule_json JSON DEFAULT NULL COMMENT '周期规则',
  invoice_required TINYINT NOT NULL DEFAULT 1 COMMENT '是否需要开票',
  status VARCHAR(30) NOT NULL DEFAULT 'planned' COMMENT '状态：planned/billable/invoicing/invoiced/received/paid/cancelled',
  finance_plan_code VARCHAR(100) DEFAULT NULL COMMENT '财务计划或回款计划编码',
  source_type VARCHAR(50) DEFAULT NULL COMMENT '来源类型：contract_line/legacy_payment_term/manual',
  source_ref_id BIGINT DEFAULT NULL COMMENT '来源ID',
  source_ref_code VARCHAR(100) DEFAULT NULL COMMENT '来源编码',
  snapshot_json JSON DEFAULT NULL COMMENT '来源快照',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
  UNIQUE KEY uk_contract_billing_schedule_code (code),
  INDEX idx_contract_billing_contract (contract_id, expected_date, id),
  INDEX idx_contract_billing_line (contract_line_id),
  INDEX idx_contract_billing_obligation (obligation_id),
  INDEX idx_contract_billing_status (status),
  INDEX idx_contract_billing_source (source_type, source_ref_id),
  CONSTRAINT fk_contract_billing_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE,
  CONSTRAINT fk_contract_billing_line FOREIGN KEY (contract_line_id) REFERENCES contract_line(id) ON DELETE SET NULL,
  CONSTRAINT fk_contract_billing_obligation FOREIGN KEY (obligation_id) REFERENCES contract_obligation(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同结算计划表';

-- One delivery obligation per active line.
INSERT IGNORE INTO contract_obligation (
  code, contract_id, contract_line_id, obligation_type, name, description,
  fulfillment_method, planned_start_at, planned_due_at, acceptance_required,
  acceptance_criteria, status, owner_user_id, source_type, source_ref_id,
  source_ref_code, sort_no, snapshot_json, created_by
)
SELECT
  CONCAT('OB-CL-', cl.id, '-DELIVERY'),
  cl.contract_id,
  cl.id,
  CASE
    WHEN cl.line_type IN ('maintenance_service', 'subscription', 'cloud_service') THEN 'service_delivery'
    WHEN cl.line_type IN ('custom_development', 'implementation_service') THEN 'delivery'
    WHEN cl.line_type IN ('hardware', 'third_party_product') THEN 'goods_delivery'
    ELSE 'delivery'
  END,
  CONCAT(cl.name, '交付'),
  cl.description,
  cl.fulfillment_method,
  CASE WHEN cl.service_start_date IS NULL THEN NULL ELSE CONCAT(cl.service_start_date, ' 00:00:00') END,
  CASE WHEN cl.service_end_date IS NULL THEN NULL ELSE CONCAT(cl.service_end_date, ' 23:59:59') END,
  0,
  NULL,
  'not_started',
  ct.owner_user_id,
  'contract_line',
  cl.id,
  cl.code,
  cl.sort_no * 10 + 1,
  JSON_OBJECT(
    'line_code', cl.code,
    'line_type', cl.line_type,
    'generated_by', 'migration_027',
    'policy', JSON_OBJECT(
      'project_policy', cl.project_policy,
      'asset_policy', cl.asset_policy,
      'service_policy', cl.service_policy,
      'procurement_policy', cl.procurement_policy
    )
  ),
  COALESCE(cl.created_by, ct.created_by, 'migration')
FROM contract_line cl
JOIN contract ct ON ct.id = cl.contract_id
WHERE cl.deleted_at IS NULL;

-- Add an acceptance obligation only for lines that explicitly require acceptance.
INSERT IGNORE INTO contract_obligation (
  code, contract_id, contract_line_id, obligation_type, name, description,
  fulfillment_method, planned_start_at, planned_due_at, acceptance_required,
  acceptance_criteria, status, owner_user_id, source_type, source_ref_id,
  source_ref_code, sort_no, snapshot_json, created_by
)
SELECT
  CONCAT('OB-CL-', cl.id, '-ACCEPT'),
  cl.contract_id,
  cl.id,
  'acceptance',
  CONCAT(cl.name, '验收'),
  cl.description,
  cl.fulfillment_method,
  NULL,
  CASE WHEN cl.service_end_date IS NULL THEN NULL ELSE CONCAT(cl.service_end_date, ' 23:59:59') END,
  1,
  cl.acceptance_criteria,
  'not_started',
  ct.owner_user_id,
  'contract_line',
  cl.id,
  cl.code,
  cl.sort_no * 10 + 2,
  JSON_OBJECT(
    'line_code', cl.code,
    'line_type', cl.line_type,
    'generated_by', 'migration_027',
    'acceptance_required', cl.acceptance_required
  ),
  COALESCE(cl.created_by, ct.created_by, 'migration')
FROM contract_line cl
JOIN contract ct ON ct.id = cl.contract_id
WHERE cl.deleted_at IS NULL
  AND cl.acceptance_required = 1;

-- Preserve legacy stage evidence as migrated obligations when the old table exists.
SET @hzy_has_contract_stage = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE table_schema = DATABASE()
    AND table_name = 'contract_stage'
);
SET @hzy_stage_obligation_sql = IF(
  @hzy_has_contract_stage > 0,
  'INSERT IGNORE INTO contract_obligation (
     code, contract_id, contract_line_id, obligation_type, name, description,
     fulfillment_method, planned_start_at, planned_due_at, actual_completed_at,
     submitted_at, accepted_at, acceptance_required, acceptance_criteria, status,
     owner_user_id, evidence_document_uuid, evidence_note, source_type, source_ref_id,
     source_ref_code, sort_no, snapshot_json, created_by
   )
   SELECT
     CONCAT(''OB-CS-'', cs.id),
     cs.contract_id,
     NULL,
     CASE cs.stage_type
       WHEN ''contract_signed'' THEN ''contract_effective''
       WHEN ''delivery'' THEN ''delivery''
       WHEN ''acceptance'' THEN ''acceptance''
       WHEN ''service_end'' THEN ''service_period_end''
       ELSE ''legacy_stage''
     END,
     cs.stage_name,
     cs.evidence_note,
     ''legacy_stage'',
     NULL,
     CASE WHEN cs.stage_date IS NULL THEN NULL ELSE CONCAT(cs.stage_date, '' 23:59:59'') END,
     CASE WHEN cs.stage_date IS NULL THEN NULL ELSE CONCAT(cs.stage_date, '' 23:59:59'') END,
     CASE WHEN cs.stage_date IS NULL THEN NULL ELSE CONCAT(cs.stage_date, '' 23:59:59'') END,
     CASE WHEN cs.stage_date IS NULL THEN NULL ELSE CONCAT(cs.stage_date, '' 23:59:59'') END,
     IF(cs.stage_type = ''acceptance'', 1, 0),
     NULL,
     CASE WHEN cs.status = ''completed'' THEN ''accepted'' ELSE ''not_started'' END,
     ct.owner_user_id,
     cs.document_uuid,
     cs.evidence_note,
     ''legacy_contract_stage'',
     cs.id,
     cs.code,
     9000 + cs.id,
     JSON_OBJECT(
       ''stage_type'', cs.stage_type,
       ''stage_code'', cs.code,
       ''document_title'', cs.document_title,
       ''handled_by'', cs.handled_by,
       ''handled_at'', cs.handled_at,
       ''generated_by'', ''migration_027''
     ),
     COALESCE(ct.created_by, ''migration'')
   FROM contract_stage cs
   JOIN contract ct ON ct.id = cs.contract_id',
  'SELECT ''skip contract_stage migration'' AS skipped'
);
PREPARE stmt FROM @hzy_stage_obligation_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Default billing schedule from each line. Existing legacy payment terms are converted below and may coexist.
INSERT IGNORE INTO contract_billing_schedule (
  code, contract_id, contract_line_id, obligation_id, direction, name,
  trigger_type, trigger_ref_code, amount, ratio, currency_code, expected_date,
  invoice_required, status, source_type, source_ref_id, source_ref_code,
  snapshot_json, created_by
)
SELECT
  CONCAT('BS-CL-', cl.id),
  cl.contract_id,
  cl.id,
  ob.id,
  CASE WHEN ct.direction = 'purchase' THEN 'payable' ELSE 'receivable' END,
  CONCAT(cl.name, '结算'),
  CASE WHEN cl.acceptance_required = 1 THEN 'obligation_accepted' ELSE 'obligation_completed' END,
  ob.code,
  COALESCE(cl.amount_tax_inclusive, 0),
  CASE
    WHEN COALESCE(ct.amount_tax_inclusive, 0) > 0 THEN ROUND(COALESCE(cl.amount_tax_inclusive, 0) / ct.amount_tax_inclusive * 100, 4)
    ELSE NULL
  END,
  COALESCE(cl.currency_code, ct.currency_code, 'CNY'),
  cl.service_end_date,
  1,
  'planned',
  'contract_line',
  cl.id,
  cl.code,
  JSON_OBJECT(
    'line_code', cl.code,
    'billing_method', cl.billing_method,
    'generated_by', 'migration_027'
  ),
  COALESCE(cl.created_by, ct.created_by, 'migration')
FROM contract_line cl
JOIN contract ct ON ct.id = cl.contract_id
LEFT JOIN contract_obligation ob
  ON ob.code = CASE
    WHEN cl.acceptance_required = 1 THEN CONCAT('OB-CL-', cl.id, '-ACCEPT')
    ELSE CONCAT('OB-CL-', cl.id, '-DELIVERY')
  END
WHERE cl.deleted_at IS NULL
  AND COALESCE(cl.amount_tax_inclusive, 0) > 0;

-- Convert old payment terms into business billing schedules. These schedules keep
-- their legacy source so the UI can explain migrated data during the compatibility window.
SET @hzy_has_contract_payment_term = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE table_schema = DATABASE()
    AND table_name = 'contract_payment_term'
);
SET @hzy_has_receivable_plan = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE table_schema = DATABASE()
    AND table_name = 'receivable_plan'
);
SET @hzy_has_receivable_plan_code = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'receivable_plan'
    AND column_name = 'code'
);
SET @hzy_has_receivable_plan_payment_term_id = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'receivable_plan'
    AND column_name = 'payment_term_id'
);
SET @hzy_has_receivable_plan_deleted_at = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'receivable_plan'
    AND column_name = 'deleted_at'
);
SET @hzy_join_receivable_plan = @hzy_has_receivable_plan > 0
  AND @hzy_has_receivable_plan_code > 0
  AND @hzy_has_receivable_plan_payment_term_id > 0;
SET @hzy_receivable_plan_code_expr = IF(@hzy_join_receivable_plan, 'rp.code', 'NULL');
SET @hzy_receivable_plan_join_sql = IF(
  @hzy_join_receivable_plan,
  CONCAT(
    ' LEFT JOIN receivable_plan rp ON rp.payment_term_id = cpt.id',
    IF(@hzy_has_receivable_plan_deleted_at > 0, ' AND rp.deleted_at IS NULL', '')
  ),
  ''
);
SET @hzy_payment_term_billing_sql = IF(
  @hzy_has_contract_payment_term > 0,
  CONCAT(
  'INSERT IGNORE INTO contract_billing_schedule (
     code, contract_id, contract_line_id, obligation_id, direction, name,
     trigger_type, trigger_ref_code, amount, ratio, currency_code, expected_date,
     recurrence_rule_json, invoice_required, status, finance_plan_code,
     source_type, source_ref_id, source_ref_code, snapshot_json, created_by
   )
   SELECT
     CONCAT(''BS-CPT-'', cpt.id),
     cpt.contract_id,
     NULL,
     (
       SELECT ob.id
       FROM contract_obligation ob
       WHERE ob.contract_id = cpt.contract_id
         AND ob.deleted_at IS NULL
         AND (
           (cpt.trigger_stage_type = ''contract_signed'' AND ob.obligation_type = ''contract_effective'') OR
           (cpt.trigger_stage_type = ''delivery'' AND ob.obligation_type IN (''delivery'', ''service_delivery'', ''goods_delivery'')) OR
           (cpt.trigger_stage_type = ''acceptance'' AND ob.obligation_type = ''acceptance'') OR
           (cpt.trigger_stage_type = ''service_end'' AND ob.obligation_type = ''service_period_end'')
         )
       ORDER BY ob.sort_no ASC, ob.id ASC
       LIMIT 1
     ),
     CASE WHEN ct.direction = ''purchase'' THEN ''payable'' ELSE ''receivable'' END,
     cpt.term_name,
     CASE
       WHEN cpt.trigger_stage_type = ''contract_signed'' THEN ''contract_effective''
       WHEN cpt.trigger_stage_type = ''delivery'' THEN ''obligation_completed''
       WHEN cpt.trigger_stage_type IN (''acceptance'', ''service_end'') THEN ''obligation_accepted''
       WHEN cpt.expected_date IS NOT NULL THEN ''fixed_date''
       ELSE ''manual_approval''
     END,
     cpt.trigger_stage_type,
     cpt.amount,
     cpt.ratio,
     COALESCE(ct.currency_code, ''CNY''),
     cpt.expected_date,
     CASE
       WHEN cpt.recurrence_interval IS NULL THEN NULL
       ELSE JSON_OBJECT(
         ''interval'', cpt.recurrence_interval,
         ''month'', cpt.recurrence_month,
         ''day'', cpt.recurrence_day,
         ''service_start_date'', cpt.service_start_date,
         ''service_end_date'', cpt.service_end_date
       )
     END,
     1,
     ''planned'',
     ', @hzy_receivable_plan_code_expr, ',
     ''legacy_payment_term'',
     cpt.id,
     CAST(cpt.id AS CHAR),
     JSON_OBJECT(
       ''term_type'', cpt.term_type,
       ''billing_mode'', cpt.billing_mode,
       ''condition_desc'', cpt.condition_desc,
       ''generated_by'', ''migration_027''
     ),
     COALESCE(ct.created_by, ''migration'')
   FROM contract_payment_term cpt
   JOIN contract ct ON ct.id = cpt.contract_id',
   @hzy_receivable_plan_join_sql
  ),
  'SELECT ''skip contract_payment_term migration'' AS skipped'
);
PREPARE stmt FROM @hzy_payment_term_billing_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'contract_obligation_count' AS metric, COUNT(*) AS value FROM contract_obligation;
SELECT 'contract_billing_schedule_count' AS metric, COUNT(*) AS value FROM contract_billing_schedule;

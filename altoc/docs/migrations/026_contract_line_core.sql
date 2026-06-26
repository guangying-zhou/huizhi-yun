-- ============================================================
-- Migration 026: P0A contract line core
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database.
--
-- P0A scope only:
-- - extend contract with structural fields
-- - add contract_business_template, contract_party, contract_line
-- - seed first business templates
-- - backfill legacy contracts with one historical summary line
--
-- This migration intentionally does not create contract_obligation,
-- contract_billing_schedule, contract_project_link, or orchestration tables.

DROP PROCEDURE IF EXISTS hzy_contract_line_core_add_column;
DROP PROCEDURE IF EXISTS hzy_contract_line_core_add_index;

DELIMITER //

CREATE PROCEDURE hzy_contract_line_core_add_column(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_alter_sql TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name = p_table_name
      AND column_name = p_column_name
  ) THEN
    SET @ddl = p_alter_sql;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

CREATE PROCEDURE hzy_contract_line_core_add_index(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_alter_sql TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE table_schema = DATABASE()
      AND table_name = p_table_name
      AND index_name = p_index_name
  ) THEN
    SET @ddl = p_alter_sql;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

DELIMITER ;

CALL hzy_contract_line_core_add_column('contract', 'direction', 'ALTER TABLE contract ADD COLUMN direction VARCHAR(20) NOT NULL DEFAULT ''sales'' COMMENT ''合同方向：sales/purchase'' AFTER status');
CALL hzy_contract_line_core_add_column('contract', 'primary_type', 'ALTER TABLE contract ADD COLUMN primary_type VARCHAR(50) DEFAULT ''legacy_contract'' COMMENT ''合同主类型'' AFTER direction');
CALL hzy_contract_line_core_add_column('contract', 'parent_contract_id', 'ALTER TABLE contract ADD COLUMN parent_contract_id BIGINT DEFAULT NULL COMMENT ''父合同ID'' AFTER customer_id');
CALL hzy_contract_line_core_add_column('contract', 'agreement_form', 'ALTER TABLE contract ADD COLUMN agreement_form VARCHAR(50) DEFAULT ''standard_contract'' COMMENT ''协议形式'' AFTER primary_type');
CALL hzy_contract_line_core_add_column('contract', 'template_code', 'ALTER TABLE contract ADD COLUMN template_code VARCHAR(64) DEFAULT NULL COMMENT ''创建时使用的业务模板'' AFTER agreement_form');
CALL hzy_contract_line_core_add_column('contract', 'source_type', 'ALTER TABLE contract ADD COLUMN source_type VARCHAR(50) DEFAULT NULL COMMENT ''来源类型：quotation/opportunity/manual'' AFTER template_code');
CALL hzy_contract_line_core_add_column('contract', 'source_code', 'ALTER TABLE contract ADD COLUMN source_code VARCHAR(100) DEFAULT NULL COMMENT ''来源业务编号'' AFTER source_type');
CALL hzy_contract_line_core_add_column('contract', 'lock_version', 'ALTER TABLE contract ADD COLUMN lock_version INT NOT NULL DEFAULT 0 COMMENT ''乐观锁版本'' AFTER version_no');

CALL hzy_contract_line_core_add_index('contract', 'idx_parent_contract_id', 'ALTER TABLE contract ADD INDEX idx_parent_contract_id (parent_contract_id)');
CALL hzy_contract_line_core_add_index('contract', 'idx_contract_direction', 'ALTER TABLE contract ADD INDEX idx_contract_direction (direction)');
CALL hzy_contract_line_core_add_index('contract', 'idx_contract_primary_type', 'ALTER TABLE contract ADD INDEX idx_contract_primary_type (primary_type)');
CALL hzy_contract_line_core_add_index('contract', 'idx_contract_template_code', 'ALTER TABLE contract ADD INDEX idx_contract_template_code (template_code)');
CALL hzy_contract_line_core_add_index('contract', 'idx_contract_source', 'ALTER TABLE contract ADD INDEX idx_contract_source (source_type, source_code)');

CREATE TABLE IF NOT EXISTS contract_business_template (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  code VARCHAR(64) NOT NULL COMMENT '业务模板编码',
  name VARCHAR(120) NOT NULL COMMENT '业务模板名称',
  direction VARCHAR(20) NOT NULL DEFAULT 'sales' COMMENT '合同方向：sales/purchase',
  primary_type VARCHAR(50) NOT NULL COMMENT '合同主类型',
  is_system TINYINT NOT NULL DEFAULT 1 COMMENT '是否系统预置',
  status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active/inactive',
  version_no INT NOT NULL DEFAULT 1 COMMENT '模板版本',
  template_json JSON NOT NULL COMMENT '模板快照JSON',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
  UNIQUE KEY uk_contract_business_template_code (code),
  INDEX idx_contract_template_direction (direction, primary_type),
  INDEX idx_contract_template_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同业务模板表';

CREATE TABLE IF NOT EXISTS contract_party (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  contract_id BIGINT NOT NULL COMMENT '合同ID',
  party_type VARCHAR(30) NOT NULL COMMENT '参与方类型：customer/supplier/organization/person',
  party_ref_code VARCHAR(100) DEFAULT NULL COMMENT '参与方稳定编码',
  party_name_snapshot VARCHAR(200) NOT NULL COMMENT '参与方名称快照',
  role_code VARCHAR(50) NOT NULL COMMENT '角色：buyer/seller/payer/end_customer/vendor/agent/guarantor',
  is_primary TINYINT NOT NULL DEFAULT 0 COMMENT '是否主要参与方',
  contact_name VARCHAR(100) DEFAULT NULL COMMENT '联系人',
  contact_mobile VARCHAR(50) DEFAULT NULL COMMENT '联系电话',
  contact_email VARCHAR(100) DEFAULT NULL COMMENT '联系邮箱',
  sort_no INT NOT NULL DEFAULT 0 COMMENT '排序',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
  UNIQUE KEY uk_contract_party_role_ref (contract_id, role_code, party_ref_code),
  INDEX idx_contract_party_contract (contract_id),
  INDEX idx_contract_party_role (role_code, is_primary),
  CONSTRAINT fk_contract_party_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同参与方表';

CREATE TABLE IF NOT EXISTS contract_line (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  code VARCHAR(64) NOT NULL COMMENT '合同行编号',
  contract_id BIGINT NOT NULL COMMENT '合同ID',
  line_no INT NOT NULL COMMENT '合同行号',
  line_type VARCHAR(50) NOT NULL COMMENT '合同行类型',
  name VARCHAR(200) NOT NULL COMMENT '行名称',
  description TEXT DEFAULT NULL COMMENT '行说明',
  catalog_item_id BIGINT DEFAULT NULL COMMENT '商业目录项ID',
  catalog_item_code VARCHAR(100) DEFAULT NULL COMMENT '商业目录项编码',
  product_code VARCHAR(100) DEFAULT NULL COMMENT '产品编码',
  product_version VARCHAR(100) DEFAULT NULL COMMENT '产品版本',
  product_origin VARCHAR(30) DEFAULT 'own' COMMENT '产品来源：own/third_party',
  supplier_code VARCHAR(100) DEFAULT NULL COMMENT '供应商编码',
  source_quotation_item_id BIGINT DEFAULT NULL COMMENT '来源报价明细ID',
  quantity DECIMAL(18,4) DEFAULT 1.0000 COMMENT '数量',
  unit VARCHAR(30) DEFAULT NULL COMMENT '单位',
  quantity_factors_json JSON DEFAULT NULL COMMENT '数量因子快照',
  unit_price DECIMAL(18,2) DEFAULT NULL COMMENT '单价',
  amount_tax_exclusive DECIMAL(18,2) DEFAULT NULL COMMENT '不含税金额',
  amount_tax_inclusive DECIMAL(18,2) DEFAULT NULL COMMENT '含税金额',
  tax_rate DECIMAL(5,2) DEFAULT 6.00 COMMENT '税率(%)',
  planned_cost DECIMAL(18,2) DEFAULT NULL COMMENT '计划成本',
  planned_margin DECIMAL(18,2) DEFAULT NULL COMMENT '计划毛利',
  currency_code VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
  billing_method VARCHAR(30) DEFAULT 'fixed_price' COMMENT '计费方式',
  fulfillment_method VARCHAR(30) DEFAULT 'point_in_time' COMMENT '履约方式',
  service_start_date DATE DEFAULT NULL COMMENT '服务开始日期',
  service_end_date DATE DEFAULT NULL COMMENT '服务结束日期',
  project_policy VARCHAR(30) DEFAULT 'none' COMMENT '项目策略：none/optional/required',
  project_template_code VARCHAR(100) DEFAULT NULL COMMENT '项目模板编码',
  asset_policy VARCHAR(50) DEFAULT 'none' COMMENT '资产策略',
  service_policy VARCHAR(50) DEFAULT 'none' COMMENT '服务策略',
  procurement_policy VARCHAR(30) DEFAULT 'none' COMMENT '采购策略',
  acceptance_required TINYINT NOT NULL DEFAULT 0 COMMENT '是否需要验收',
  acceptance_criteria VARCHAR(1000) DEFAULT NULL COMMENT '验收标准',
  status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active/inactive/cancelled',
  sort_no INT NOT NULL DEFAULT 0 COMMENT '排序',
  snapshot_json JSON DEFAULT NULL COMMENT '创建快照',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
  UNIQUE KEY uk_contract_line_code (code),
  UNIQUE KEY uk_contract_line_no (contract_id, line_no),
  INDEX idx_contract_line_contract (contract_id, sort_no, id),
  INDEX idx_contract_line_type (line_type),
  INDEX idx_contract_line_source_quote_item (source_quotation_item_id),
  CONSTRAINT fk_contract_line_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE,
  CONSTRAINT fk_contract_line_quote_item FOREIGN KEY (source_quotation_item_id) REFERENCES quotation_item(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同行表';

INSERT INTO contract_business_template
  (code, name, direction, primary_type, is_system, status, version_no, template_json, created_by)
VALUES
  ('sales_software_license', '软件许可销售', 'sales', 'software_license', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'own_software_license', 'billing_method', 'fixed_price', 'fulfillment_method', 'point_in_time', 'project_policy', 'none', 'asset_policy', 'create_on_delivery')), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system'),
  ('sales_saas_subscription', 'SaaS订阅', 'sales', 'saas_subscription', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'own_saas_subscription', 'billing_method', 'subscription', 'fulfillment_method', 'over_time', 'project_policy', 'none', 'asset_policy', 'planned_on_effective')), 'required_fields', JSON_ARRAY('customer_id', 'service_start_date', 'service_end_date', 'lines')), 'system'),
  ('sales_custom_development', '定制开发', 'sales', 'custom_development', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'custom_development', 'billing_method', 'milestone', 'fulfillment_method', 'over_time', 'project_policy', 'required', 'acceptance_required', true)), 'required_fields', JSON_ARRAY('customer_id', 'opportunity_id', 'lines')), 'system'),
  ('sales_implementation', '实施服务', 'sales', 'implementation_service', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'implementation', 'billing_method', 'milestone', 'fulfillment_method', 'over_time', 'project_policy', 'required', 'acceptance_required', true)), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system'),
  ('sales_maintenance', '维保/技术支持', 'sales', 'maintenance_service', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'maintenance_support', 'billing_method', 'subscription', 'fulfillment_method', 'over_time', 'service_policy', 'maintenance')), 'required_fields', JSON_ARRAY('customer_id', 'service_start_date', 'service_end_date', 'lines')), 'system'),
  ('sales_system_integration', '系统集成', 'sales', 'system_integration', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'system_integration', 'billing_method', 'milestone', 'fulfillment_method', 'over_time', 'project_policy', 'required', 'acceptance_required', true)), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system'),
  ('sales_managed_service', '托管服务', 'sales', 'managed_service', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'managed_service', 'billing_method', 'subscription', 'fulfillment_method', 'over_time', 'service_policy', 'managed_service')), 'required_fields', JSON_ARRAY('customer_id', 'service_start_date', 'service_end_date', 'lines')), 'system'),
  ('sales_third_party_resale', '第三方产品转售', 'sales', 'third_party_resale', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'third_party_software', 'billing_method', 'fixed_price', 'fulfillment_method', 'point_in_time', 'product_origin', 'third_party', 'procurement_policy', 'optional')), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system'),
  ('purchase_software_subscription', '软件/订阅采购', 'purchase', 'software_subscription_purchase', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'third_party_software', 'billing_method', 'subscription', 'fulfillment_method', 'over_time', 'product_origin', 'third_party')), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system'),
  ('purchase_hardware', '硬件设备采购', 'purchase', 'hardware_purchase', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'hardware', 'billing_method', 'fixed_price', 'fulfillment_method', 'point_in_time', 'product_origin', 'third_party')), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system'),
  ('purchase_professional_service', '外包开发/专业服务采购', 'purchase', 'professional_service_purchase', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'custom_development', 'billing_method', 'milestone', 'fulfillment_method', 'over_time', 'product_origin', 'third_party', 'acceptance_required', true)), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system'),
  ('purchase_framework', '采购框架合同', 'purchase', 'purchase_framework', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'other_fee', 'billing_method', 'value', 'fulfillment_method', 'over_time', 'product_origin', 'third_party')), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  direction = VALUES(direction),
  primary_type = VALUES(primary_type),
  is_system = VALUES(is_system),
  status = VALUES(status),
  version_no = VALUES(version_no),
  template_json = VALUES(template_json),
  updated_by = 'system',
  updated_at = CURRENT_TIMESTAMP,
  deleted_at = NULL;

UPDATE contract
SET direction = 'sales'
WHERE direction IS NULL OR direction = '';

SET @hzy_has_contract_source_type = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'source_contract_type'
);
SET @hzy_has_contract_third_party = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'is_third_party'
);
SET @hzy_has_contract_service_period = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'service_period_months'
);
SET @hzy_contract_primary_type_case = IF(
  @hzy_has_contract_source_type > 0
    OR @hzy_has_contract_third_party > 0
    OR @hzy_has_contract_service_period > 0,
  CONCAT(
    'CASE ',
    IF(@hzy_has_contract_source_type > 0, 'WHEN source_contract_type IN (''maintenance'', ''mt'', ''service'') THEN ''maintenance_service'' ', ''),
    IF(@hzy_has_contract_third_party > 0, 'WHEN is_third_party = 1 THEN ''third_party_resale'' ', ''),
    IF(@hzy_has_contract_service_period > 0, 'WHEN service_period_months IS NOT NULL AND service_period_months > 0 THEN ''maintenance_service'' ', ''),
    'ELSE ''legacy_contract'' END'
  ),
  '''legacy_contract'''
);
SET @hzy_contract_primary_type_sql = CONCAT(
  'UPDATE contract SET primary_type = ',
  @hzy_contract_primary_type_case,
  ' WHERE primary_type IS NULL OR primary_type = '''' OR primary_type = ''legacy_contract'''
);
PREPARE stmt FROM @hzy_contract_primary_type_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @hzy_has_contract_quotation_id = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'quotation_id'
);
SET @hzy_has_contract_opportunity_id = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'opportunity_id'
);
SET @hzy_has_quotation_table = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE table_schema = DATABASE()
    AND table_name = 'quotation'
);
SET @hzy_has_opportunity_table = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE table_schema = DATABASE()
    AND table_name = 'opportunity'
);
SET @hzy_has_quotation_code = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'quotation'
    AND column_name = 'code'
);
SET @hzy_has_opportunity_code = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'opportunity'
    AND column_name = 'code'
);
SET @hzy_contract_source_join_quotation = IF(
  @hzy_has_contract_quotation_id > 0 AND @hzy_has_quotation_table > 0,
  'LEFT JOIN quotation q ON q.id = ct.quotation_id ',
  ''
);
SET @hzy_contract_source_join_opportunity = IF(
  @hzy_has_contract_opportunity_id > 0 AND @hzy_has_opportunity_table > 0,
  'LEFT JOIN opportunity op ON op.id = ct.opportunity_id ',
  ''
);
SET @hzy_contract_source_type_expr = IF(
  @hzy_has_contract_quotation_id > 0 OR @hzy_has_contract_opportunity_id > 0,
  CONCAT(
    'CASE ',
    IF(@hzy_has_contract_quotation_id > 0, 'WHEN ct.quotation_id IS NOT NULL THEN ''quotation'' ', ''),
    IF(@hzy_has_contract_opportunity_id > 0, 'WHEN ct.opportunity_id IS NOT NULL THEN ''opportunity'' ', ''),
    'ELSE COALESCE(NULLIF(ct.source_type, ''''), ''manual'') END'
  ),
  'COALESCE(NULLIF(ct.source_type, ''''), ''manual'')'
);
SET @hzy_contract_source_code_expr = IF(
  (@hzy_has_contract_quotation_id > 0 AND @hzy_has_quotation_table > 0 AND @hzy_has_quotation_code > 0)
    OR (@hzy_has_contract_opportunity_id > 0 AND @hzy_has_opportunity_table > 0 AND @hzy_has_opportunity_code > 0),
  CONCAT(
    'CASE ',
    IF(@hzy_has_contract_quotation_id > 0 AND @hzy_has_quotation_table > 0 AND @hzy_has_quotation_code > 0, 'WHEN ct.quotation_id IS NOT NULL THEN q.code ', ''),
    IF(@hzy_has_contract_opportunity_id > 0 AND @hzy_has_opportunity_table > 0 AND @hzy_has_opportunity_code > 0, 'WHEN ct.opportunity_id IS NOT NULL THEN op.code ', ''),
    'ELSE COALESCE(NULLIF(ct.source_code, ''''), ct.code) END'
  ),
  'COALESCE(NULLIF(ct.source_code, ''''), ct.code)'
);
SET @hzy_contract_source_sql = CONCAT(
  'UPDATE contract ct ',
  @hzy_contract_source_join_quotation,
  @hzy_contract_source_join_opportunity,
  'SET ct.source_type = ',
  @hzy_contract_source_type_expr,
  ', ct.source_code = ',
  @hzy_contract_source_code_expr,
  ' WHERE ct.source_type IS NULL OR ct.source_type = '''' OR ct.source_code IS NULL OR ct.source_code = '''''
);
PREPARE stmt FROM @hzy_contract_source_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @hzy_has_contract_contact_id = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'contact_id'
);
SET @hzy_has_contract_created_by = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'created_by'
);
SET @hzy_has_contract_deleted_at = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'deleted_at'
);
SET @hzy_has_contact_table = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE table_schema = DATABASE()
    AND table_name = 'contact'
);
SET @hzy_has_contact_name = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contact'
    AND column_name = 'name'
);
SET @hzy_has_contact_mobile = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contact'
    AND column_name = 'mobile'
);
SET @hzy_has_contact_phone = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contact'
    AND column_name = 'phone'
);
SET @hzy_has_contact_email = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contact'
    AND column_name = 'email'
);
SET @hzy_has_customer_code = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'customer'
    AND column_name = 'code'
);
SET @hzy_has_customer_name = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'customer'
    AND column_name = 'name'
);
SET @hzy_contract_party_join_contact = IF(
  @hzy_has_contract_contact_id > 0 AND @hzy_has_contact_table > 0,
  'LEFT JOIN contact co ON co.id = ct.contact_id ',
  ''
);
SET @hzy_contract_party_contact_name_expr = IF(
  @hzy_has_contract_contact_id > 0 AND @hzy_has_contact_table > 0 AND @hzy_has_contact_name > 0,
  'co.name',
  'NULL'
);
SET @hzy_contract_party_contact_mobile_expr = CASE
  WHEN @hzy_has_contract_contact_id > 0 AND @hzy_has_contact_table > 0 AND @hzy_has_contact_mobile > 0 AND @hzy_has_contact_phone > 0
    THEN 'COALESCE(co.mobile, co.phone)'
  WHEN @hzy_has_contract_contact_id > 0 AND @hzy_has_contact_table > 0 AND @hzy_has_contact_mobile > 0
    THEN 'co.mobile'
  WHEN @hzy_has_contract_contact_id > 0 AND @hzy_has_contact_table > 0 AND @hzy_has_contact_phone > 0
    THEN 'co.phone'
  ELSE 'NULL'
END;
SET @hzy_contract_party_contact_email_expr = IF(
  @hzy_has_contract_contact_id > 0 AND @hzy_has_contact_table > 0 AND @hzy_has_contact_email > 0,
  'co.email',
  'NULL'
);
SET @hzy_contract_party_ref_expr = IF(@hzy_has_customer_code > 0, 'cu.code', 'NULL');
SET @hzy_contract_party_name_expr = IF(
  @hzy_has_customer_name > 0,
  'COALESCE(NULLIF(cu.name, ''''), CONCAT(''客户 '', ct.customer_id))',
  'CONCAT(''客户 '', ct.customer_id)'
);
SET @hzy_contract_party_created_by_expr = IF(
  @hzy_has_contract_created_by > 0,
  'COALESCE(ct.created_by, ''migration'')',
  '''migration'''
);
SET @hzy_contract_party_where_deleted = IF(
  @hzy_has_contract_deleted_at > 0,
  ' AND ct.deleted_at IS NULL',
  ''
);
SET @hzy_contract_party_sql = CONCAT(
  'INSERT IGNORE INTO contract_party (',
  'contract_id, party_type, party_ref_code, party_name_snapshot, role_code, is_primary, ',
  'contact_name, contact_mobile, contact_email, sort_no, created_by) ',
  'SELECT ',
  'ct.id, ',
  '''customer'', ',
  @hzy_contract_party_ref_expr, ', ',
  @hzy_contract_party_name_expr, ', ',
  '''buyer'', ',
  '1, ',
  @hzy_contract_party_contact_name_expr, ', ',
  @hzy_contract_party_contact_mobile_expr, ', ',
  @hzy_contract_party_contact_email_expr, ', ',
  '0, ',
  @hzy_contract_party_created_by_expr, ' ',
  'FROM contract ct ',
  'JOIN customer cu ON cu.id = ct.customer_id ',
  @hzy_contract_party_join_contact,
  'WHERE ct.customer_id IS NOT NULL',
  @hzy_contract_party_where_deleted
);
PREPARE stmt FROM @hzy_contract_party_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @hzy_has_contract_content_summary = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'content_summary'
);
SET @hzy_has_contract_service_terms = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'service_terms'
);
SET @hzy_has_contract_legacy_source = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'legacy_source'
);
SET @hzy_has_contract_legacy_id = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'legacy_id'
);
SET @hzy_has_contract_amount_tax_inclusive = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'amount_tax_inclusive'
);
SET @hzy_has_contract_amount_tax_exclusive = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'amount_tax_exclusive'
);
SET @hzy_has_contract_tax_rate = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'tax_rate'
);
SET @hzy_has_contract_currency_code = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'currency_code'
);
SET @hzy_has_contract_effective_date = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'effective_date'
);
SET @hzy_has_contract_end_date = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract'
    AND column_name = 'end_date'
);

SET @hzy_contract_legacy_description_expr = CASE
  WHEN @hzy_has_contract_content_summary > 0 AND @hzy_has_contract_service_terms > 0
    THEN 'COALESCE(NULLIF(ct.content_summary, ''''), NULLIF(ct.service_terms, ''''), ''P0A 存量合同历史汇总行'')'
  WHEN @hzy_has_contract_content_summary > 0
    THEN 'COALESCE(NULLIF(ct.content_summary, ''''), ''P0A 存量合同历史汇总行'')'
  WHEN @hzy_has_contract_service_terms > 0
    THEN 'COALESCE(NULLIF(ct.service_terms, ''''), ''P0A 存量合同历史汇总行'')'
  ELSE '''P0A 存量合同历史汇总行'''
END;
SET @hzy_contract_legacy_snapshot_args = '''source'', ''legacy_contract_summary'', ''contract_code'', ct.code';
SET @hzy_contract_legacy_snapshot_args = CONCAT(
  @hzy_contract_legacy_snapshot_args,
  IF(@hzy_has_contract_source_type > 0, ', ''source_contract_type'', ct.source_contract_type', ''),
  IF(@hzy_has_contract_legacy_source > 0, ', ''legacy_source'', ct.legacy_source', ''),
  IF(@hzy_has_contract_legacy_id > 0, ', ''legacy_id'', ct.legacy_id', ''),
  IF(@hzy_has_contract_content_summary > 0, ', ''content_summary'', ct.content_summary', ''),
  IF(@hzy_has_contract_service_terms > 0, ', ''service_terms'', ct.service_terms', '')
);
SET @hzy_contract_legacy_snapshot_expr = CONCAT('JSON_OBJECT(', @hzy_contract_legacy_snapshot_args, ')');
SET @hzy_contract_legacy_amount_inclusive_expr = IF(
  @hzy_has_contract_amount_tax_inclusive > 0,
  'COALESCE(ct.amount_tax_inclusive, 0)',
  '0'
);
SET @hzy_contract_legacy_tax_rate_expr = IF(
  @hzy_has_contract_tax_rate > 0,
  'COALESCE(ct.tax_rate, 6.00)',
  '6.00'
);
SET @hzy_contract_legacy_amount_exclusive_expr = CASE
  WHEN @hzy_has_contract_amount_tax_exclusive > 0 AND @hzy_has_contract_amount_tax_inclusive > 0 AND @hzy_has_contract_tax_rate > 0
    THEN 'COALESCE(ct.amount_tax_exclusive, ROUND(COALESCE(ct.amount_tax_inclusive, 0) / (1 + COALESCE(ct.tax_rate, 0) / 100), 2))'
  WHEN @hzy_has_contract_amount_tax_exclusive > 0
    THEN 'COALESCE(ct.amount_tax_exclusive, 0)'
  WHEN @hzy_has_contract_amount_tax_inclusive > 0 AND @hzy_has_contract_tax_rate > 0
    THEN 'ROUND(COALESCE(ct.amount_tax_inclusive, 0) / (1 + COALESCE(ct.tax_rate, 0) / 100), 2)'
  WHEN @hzy_has_contract_amount_tax_inclusive > 0
    THEN 'COALESCE(ct.amount_tax_inclusive, 0)'
  ELSE '0'
END;
SET @hzy_contract_legacy_currency_expr = IF(
  @hzy_has_contract_currency_code > 0,
  'COALESCE(NULLIF(ct.currency_code, ''''), ''CNY'')',
  '''CNY'''
);
SET @hzy_contract_legacy_effective_date_expr = IF(
  @hzy_has_contract_effective_date > 0,
  'ct.effective_date',
  'NULL'
);
SET @hzy_contract_legacy_end_date_expr = IF(
  @hzy_has_contract_end_date > 0,
  'ct.end_date',
  'NULL'
);
SET @hzy_contract_legacy_where_deleted = IF(
  @hzy_has_contract_deleted_at > 0,
  'WHERE ct.deleted_at IS NULL ',
  'WHERE 1 = 1 '
);
SET @hzy_contract_legacy_line_sql = CONCAT(
  'INSERT INTO contract_line (',
  'code, contract_id, line_no, line_type, name, description, quantity, unit, ',
  'unit_price, amount_tax_exclusive, amount_tax_inclusive, tax_rate, currency_code, ',
  'billing_method, fulfillment_method, service_start_date, service_end_date, status, ',
  'sort_no, snapshot_json, created_by) ',
  'SELECT ',
  'CONCAT(''CL-'', ct.code, ''-0001''), ',
  'ct.id, ',
  '1, ',
  '''legacy_summary'', ',
  'COALESCE(NULLIF(ct.name, ''''), CONCAT(''历史合同 '', ct.code)), ',
  @hzy_contract_legacy_description_expr, ', ',
  '1.0000, ',
  '''项'', ',
  @hzy_contract_legacy_amount_inclusive_expr, ', ',
  @hzy_contract_legacy_amount_exclusive_expr, ', ',
  @hzy_contract_legacy_amount_inclusive_expr, ', ',
  @hzy_contract_legacy_tax_rate_expr, ', ',
  @hzy_contract_legacy_currency_expr, ', ',
  '''fixed_price'', ',
  '''point_in_time'', ',
  @hzy_contract_legacy_effective_date_expr, ', ',
  @hzy_contract_legacy_end_date_expr, ', ',
  '''active'', ',
  '0, ',
  @hzy_contract_legacy_snapshot_expr, ', ',
  @hzy_contract_party_created_by_expr, ' ',
  'FROM contract ct ',
  @hzy_contract_legacy_where_deleted,
  'AND NOT EXISTS (',
  'SELECT 1 FROM contract_line cl ',
  'WHERE cl.contract_id = ct.id AND cl.deleted_at IS NULL',
  ')'
);
PREPARE stmt FROM @hzy_contract_legacy_line_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP PROCEDURE IF EXISTS hzy_contract_line_core_add_column;
DROP PROCEDURE IF EXISTS hzy_contract_line_core_add_index;

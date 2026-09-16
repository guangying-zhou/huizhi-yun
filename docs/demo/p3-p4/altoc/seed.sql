-- Execute against the configured Altoc database.
SET NAMES utf8mb4;
START TRANSACTION;

INSERT INTO customer (
  code, name, normalized_name, short_name, source_type, status,
  owner_user_id, owner_dept_code, province, city, address,
  description, credit_level, remark, created_by, updated_by, deleted_at
) VALUES (
  'DEMO-P3P4-202607-CUST', 'P3/P4 演示客户', 'p3p4-demo-customer', 'P3P4演示',
  'other', 'active', 'DEMO-P3P4-202607-EMP', 'DEMO-P3P4-202607-DEPT',
  '演示省', '演示市', 'DEMO-P3P4-202607 演示地址',
  'DEMO-P3P4-202607 服务运营闭环客户', 'A', 'DEMO-P3P4-202607',
  'demo-p3p4', 'demo-p3p4', NULL
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  normalized_name = VALUES(normalized_name),
  short_name = VALUES(short_name),
  status = 'active',
  owner_user_id = VALUES(owner_user_id),
  owner_dept_code = VALUES(owner_dept_code),
  description = VALUES(description),
  remark = VALUES(remark),
  deleted_at = NULL,
  updated_by = VALUES(updated_by);

INSERT INTO contract (
  code, contract_no, name, customer_id, is_master_contract,
  status, legal_status, fulfillment_status, financial_status, activation_status,
  direction, primary_type, agreement_form, source_type, source_code,
  sign_date, effective_date, end_date,
  amount_tax_inclusive, amount_tax_exclusive, currency_code, tax_rate,
  payment_term_summary, service_period_months, contract_period_months,
  content_summary, service_terms, owner_user_id, owner_dept_code,
  approved_at, approved_by, remark, last_status_changed_at,
  last_status_changed_by, created_by, updated_by, deleted_at
)
SELECT
  'DEMO-P3P4-202607-CT', 'DEMO-P3P4-202607-CT-NO', 'P3/P4 演示维保服务合同', c.id, 1,
  'effective', 'effective', 'in_progress', 'partially_paid', 'activated',
  'sales', 'maintenance_service', 'standard_contract', 'manual', 'DEMO-P3P4-202607-CT',
  '2026-06-20', '2026-07-01', '2027-06-30',
  120000.00, 113207.55, 'CNY', 6.00,
  '开票 100000，到账并核销 80000', 12, 12,
  'DEMO-P3P4-202607 维保服务', '5x8 SLA，含工单与远程支持',
  'DEMO-P3P4-202607-EMP', 'DEMO-P3P4-202607-DEPT',
  '2026-06-20 12:00:00', 'DEMO-P3P4-202607-EMP', 'DEMO-P3P4-202607',
  '2026-07-01 09:00:00', 'DEMO-P3P4-202607-EMP', 'demo-p3p4', 'demo-p3p4', NULL
FROM customer c
WHERE c.code = 'DEMO-P3P4-202607-CUST'
ON DUPLICATE KEY UPDATE
  customer_id = VALUES(customer_id),
  contract_no = VALUES(contract_no),
  name = VALUES(name),
  status = VALUES(status),
  legal_status = VALUES(legal_status),
  fulfillment_status = VALUES(fulfillment_status),
  financial_status = VALUES(financial_status),
  activation_status = VALUES(activation_status),
  effective_date = VALUES(effective_date),
  end_date = VALUES(end_date),
  amount_tax_inclusive = VALUES(amount_tax_inclusive),
  amount_tax_exclusive = VALUES(amount_tax_exclusive),
  owner_user_id = VALUES(owner_user_id),
  owner_dept_code = VALUES(owner_dept_code),
  remark = VALUES(remark),
  deleted_at = NULL,
  updated_by = VALUES(updated_by);

INSERT INTO contract_line (
  code, contract_id, line_no, line_type, name, description,
  product_code, product_version, product_origin, quantity, unit,
  unit_price, amount_tax_exclusive, amount_tax_inclusive, tax_rate,
  planned_cost, planned_margin, currency_code,
  billing_method, fulfillment_method, service_start_date, service_end_date,
  project_policy, asset_policy, service_policy, acceptance_required,
  acceptance_criteria, status, sort_no, snapshot_json,
  created_by, updated_by, deleted_at
)
SELECT
  'DEMO-P3P4-202607-CTL', ct.id, 1, 'maintenance_service',
  'P3/P4 演示年度维保服务', 'DEMO-P3P4-202607 合同行',
  'DEMO-P3P4-202607-PRODUCT', '2026.07', 'own', 1.0000, 'year',
  120000.00, 113207.55, 120000.00, 6.00, 30000.00, 90000.00, 'CNY',
  'fixed_price', 'over_time', '2026-07-01', '2027-06-30',
  'required', 'customer_delivery_asset', 'service_agreement', 1,
  '服务协议生效、交付资产在线、SLA 可用', 'active', 1,
  JSON_OBJECT('demoKey', 'DEMO-P3P4-202607-CTL'),
  'demo-p3p4', 'demo-p3p4', NULL
FROM contract ct
WHERE ct.code = 'DEMO-P3P4-202607-CT'
ON DUPLICATE KEY UPDATE
  contract_id = VALUES(contract_id),
  line_no = VALUES(line_no),
  line_type = VALUES(line_type),
  name = VALUES(name),
  product_code = VALUES(product_code),
  product_version = VALUES(product_version),
  amount_tax_inclusive = VALUES(amount_tax_inclusive),
  amount_tax_exclusive = VALUES(amount_tax_exclusive),
  service_start_date = VALUES(service_start_date),
  service_end_date = VALUES(service_end_date),
  project_policy = VALUES(project_policy),
  asset_policy = VALUES(asset_policy),
  service_policy = VALUES(service_policy),
  status = 'active',
  snapshot_json = VALUES(snapshot_json),
  deleted_at = NULL,
  updated_by = VALUES(updated_by);

INSERT INTO maintenance_contract (
  code, customer_id, contract_id, delivery_code, project_code,
  product_code, product_version, name, service_level,
  service_start_date, service_end_date, amount, currency_code,
  status, owner_user_id, renewal_remind_at,
  source_app, source_biz_type, source_biz_id,
  remark, created_by, updated_by, deleted_at
)
SELECT
  'DEMO-P3P4-202607-MC', c.id, ct.id, 'DEMO-P3P4-202607-DLV',
  'DEMO-P3P4-202607-PROJ', 'DEMO-P3P4-202607-PRODUCT', '2026.07',
  'P3/P4 演示年度维保', 'premium', '2026-07-01', '2027-06-30',
  120000.00, 'CNY', 'active', 'DEMO-P3P4-202607-EMP', '2027-04-01',
  'altoc', 'contract', 'DEMO-P3P4-202607-CT', 'DEMO-P3P4-202607',
  'demo-p3p4', 'demo-p3p4', NULL
FROM customer c
INNER JOIN contract ct ON ct.customer_id = c.id AND ct.code = 'DEMO-P3P4-202607-CT'
WHERE c.code = 'DEMO-P3P4-202607-CUST'
ON DUPLICATE KEY UPDATE
  customer_id = VALUES(customer_id),
  contract_id = VALUES(contract_id),
  delivery_code = VALUES(delivery_code),
  project_code = VALUES(project_code),
  product_code = VALUES(product_code),
  product_version = VALUES(product_version),
  name = VALUES(name),
  service_level = VALUES(service_level),
  service_start_date = VALUES(service_start_date),
  service_end_date = VALUES(service_end_date),
  amount = VALUES(amount),
  status = 'active',
  renewal_remind_at = VALUES(renewal_remind_at),
  remark = VALUES(remark),
  deleted_at = NULL,
  updated_by = VALUES(updated_by);

INSERT INTO service_agreement (
  code, contract_id, contract_line_id, customer_code, name, service_level,
  service_start_date, service_end_date, service_window, billing_mode,
  renewal_policy, response_minutes, resolution_minutes,
  included_quota, quota_unit, consumed_quota, renewal_remind_at,
  status, owner_user_id, maintenance_contract_id,
  created_by, updated_by, deleted_at
)
SELECT
  'DEMO-P3P4-202607-SA', ct.id, cl.id, 'DEMO-P3P4-202607-CUST',
  'P3/P4 演示服务协议', 'premium', '2026-07-01', '2027-06-30',
  '5x8', 'included', 'annual_renewal', 60, 480,
  100.00, 'hour', 8.00, '2027-04-01', 'active',
  'DEMO-P3P4-202607-EMP', mc.id, 'demo-p3p4', 'demo-p3p4', NULL
FROM contract ct
INNER JOIN contract_line cl ON cl.contract_id = ct.id AND cl.code = 'DEMO-P3P4-202607-CTL'
INNER JOIN maintenance_contract mc ON mc.contract_id = ct.id AND mc.code = 'DEMO-P3P4-202607-MC'
WHERE ct.code = 'DEMO-P3P4-202607-CT'
ON DUPLICATE KEY UPDATE
  contract_id = VALUES(contract_id),
  contract_line_id = VALUES(contract_line_id),
  customer_code = VALUES(customer_code),
  name = VALUES(name),
  service_level = VALUES(service_level),
  service_start_date = VALUES(service_start_date),
  service_end_date = VALUES(service_end_date),
  service_window = VALUES(service_window),
  response_minutes = VALUES(response_minutes),
  resolution_minutes = VALUES(resolution_minutes),
  included_quota = VALUES(included_quota),
  consumed_quota = VALUES(consumed_quota),
  status = 'active',
  owner_user_id = VALUES(owner_user_id),
  maintenance_contract_id = VALUES(maintenance_contract_id),
  deleted_at = NULL,
  updated_by = VALUES(updated_by);

INSERT INTO service_agreement_coverage (
  coverage_code, service_agreement_id, target_type,
  delivery_asset_code, environment_code,
  resolution_status, coverage_status, coverage_scope,
  product_scope_json, effective_from, effective_to,
  included, source_type, created_by, updated_by, deleted_at
)
SELECT
  'DEMO-P3P4-202607-COV', sa.id, 'delivery_asset_environment',
  'DEMO-P3P4-202607-CDA', 'DEMO-P3P4-202607-ENV',
  'resolved', 'active', 'production_support',
  JSON_OBJECT('productCode', 'DEMO-P3P4-202607-PRODUCT', 'demoKey', 'DEMO-P3P4-202607-COV'),
  '2026-07-01', '2027-06-30', 1, 'manual', 'demo-p3p4', 'demo-p3p4', NULL
FROM service_agreement sa
WHERE sa.code = 'DEMO-P3P4-202607-SA'
ON DUPLICATE KEY UPDATE
  service_agreement_id = VALUES(service_agreement_id),
  target_type = VALUES(target_type),
  delivery_asset_code = VALUES(delivery_asset_code),
  environment_code = VALUES(environment_code),
  resolution_status = 'resolved',
  coverage_status = 'active',
  coverage_scope = VALUES(coverage_scope),
  product_scope_json = VALUES(product_scope_json),
  effective_from = VALUES(effective_from),
  effective_to = VALUES(effective_to),
  deleted_at = NULL,
  updated_by = VALUES(updated_by);

INSERT INTO service_agreement_project_rel (
  service_agreement_id, project_code, project_role, is_default,
  effective_from, effective_to, status, source_type,
  created_by, updated_by, deleted_at
)
SELECT sa.id, 'DEMO-P3P4-202607-PROJ', 'maintenance', 1,
       '2026-07-01', '2027-06-30', 'active', 'manual',
       'demo-p3p4', 'demo-p3p4', NULL
FROM service_agreement sa
WHERE sa.code = 'DEMO-P3P4-202607-SA'
ON DUPLICATE KEY UPDATE
  is_default = 1,
  effective_from = VALUES(effective_from),
  effective_to = VALUES(effective_to),
  status = 'active',
  source_type = VALUES(source_type),
  deleted_at = NULL,
  updated_by = VALUES(updated_by);

INSERT INTO service_entitlement (
  code, maintenance_contract_id, service_agreement_id,
  entitlement_type, name, service_window, priority,
  response_minutes, resolution_minutes, included_quota, quota_unit,
  billing_mode, status, remark, created_by, updated_by
)
SELECT
  'DEMO-P3P4-202607-SE', mc.id, sa.id, 'sla', 'P3/P4 演示高优先级 SLA',
  '5x8', 'high', 60, 480, 100.00, 'hour', 'included', 'active',
  'DEMO-P3P4-202607', 'demo-p3p4', 'demo-p3p4'
FROM maintenance_contract mc
INNER JOIN service_agreement sa ON sa.maintenance_contract_id = mc.id
WHERE mc.code = 'DEMO-P3P4-202607-MC' AND sa.code = 'DEMO-P3P4-202607-SA'
ON DUPLICATE KEY UPDATE
  maintenance_contract_id = VALUES(maintenance_contract_id),
  service_agreement_id = VALUES(service_agreement_id),
  name = VALUES(name),
  response_minutes = VALUES(response_minutes),
  resolution_minutes = VALUES(resolution_minutes),
  included_quota = VALUES(included_quota),
  status = 'active',
  remark = VALUES(remark),
  updated_by = VALUES(updated_by);

INSERT INTO service_ticket (
  code, customer_id, maintenance_contract_id, contract_id,
  service_agreement_id, service_agreement_code,
  delivery_code, delivery_asset_code, project_code,
  product_code, product_version, environment_code,
  ticket_type, title, description, priority, status,
  sla_status, entitlement_status, quota_consumed,
  reported_by_contact, reported_by_email, owner_user_id, handler_user_id,
  response_due_at, resolution_due_at,
  source_app, source_biz_type, source_biz_id,
  created_by, updated_by, deleted_at
)
SELECT
  'DEMO-P3P4-202607-ST', c.id, mc.id, ct.id, sa.id, sa.code,
  'DEMO-P3P4-202607-DLV', 'DEMO-P3P4-202607-CDA', 'DEMO-P3P4-202607-PROJ',
  'DEMO-P3P4-202607-PRODUCT', '2026.07', 'DEMO-P3P4-202607-ENV',
  'incident', 'DEMO-P3P4-202607 演示服务工单',
  '客户生产环境出现演示告警，需要回流 Aims 执行并回写结果。',
  'high', 'open', 'on_track', 'in_service', 0.00,
  '演示联系人', 'demo-p3p4@example.invalid',
  'DEMO-P3P4-202607-EMP', 'DEMO-P3P4-202607-EMP',
  '2026-07-21 10:00:00', '2026-07-21 17:00:00',
  'altoc', 'demo_seed', 'DEMO-P3P4-202607-ST',
  'demo-p3p4', 'demo-p3p4', NULL
FROM customer c
INNER JOIN contract ct ON ct.customer_id = c.id AND ct.code = 'DEMO-P3P4-202607-CT'
INNER JOIN maintenance_contract mc ON mc.customer_id = c.id AND mc.code = 'DEMO-P3P4-202607-MC'
INNER JOIN service_agreement sa ON sa.contract_id = ct.id AND sa.code = 'DEMO-P3P4-202607-SA'
WHERE c.code = 'DEMO-P3P4-202607-CUST'
ON DUPLICATE KEY UPDATE
  customer_id = VALUES(customer_id),
  maintenance_contract_id = VALUES(maintenance_contract_id),
  contract_id = VALUES(contract_id),
  service_agreement_id = VALUES(service_agreement_id),
  service_agreement_code = VALUES(service_agreement_code),
  delivery_code = VALUES(delivery_code),
  delivery_asset_code = VALUES(delivery_asset_code),
  project_code = VALUES(project_code),
  product_code = VALUES(product_code),
  product_version = VALUES(product_version),
  environment_code = VALUES(environment_code),
  ticket_type = VALUES(ticket_type),
  title = VALUES(title),
  description = VALUES(description),
  priority = VALUES(priority),
  sla_status = VALUES(sla_status),
  entitlement_status = VALUES(entitlement_status),
  response_due_at = VALUES(response_due_at),
  resolution_due_at = VALUES(resolution_due_at),
  source_app = VALUES(source_app),
  source_biz_type = VALUES(source_biz_type),
  source_biz_id = VALUES(source_biz_id),
  deleted_at = NULL,
  updated_by = VALUES(updated_by);

INSERT INTO renewal_opportunity (
  code, customer_id, maintenance_contract_id, contract_id, source_ticket_id,
  name, renewal_type, expected_amount, expected_sign_date,
  stage, status, owner_user_id, risk_level, reason,
  next_action, next_action_due_at, created_by, updated_by, deleted_at
)
SELECT
  'DEMO-P3P4-202607-RO', c.id, mc.id, ct.id, st.id,
  'P3/P4 演示年度维保续约', 'maintenance', 120000.00, '2027-05-31',
  'identified', 'open', 'DEMO-P3P4-202607-EMP', 'low',
  'DEMO-P3P4-202607 服务周期续约', '2027-04-01 前完成续约沟通',
  '2027-04-01 09:00:00', 'demo-p3p4', 'demo-p3p4', NULL
FROM customer c
INNER JOIN contract ct ON ct.customer_id = c.id AND ct.code = 'DEMO-P3P4-202607-CT'
INNER JOIN maintenance_contract mc ON mc.customer_id = c.id AND mc.code = 'DEMO-P3P4-202607-MC'
INNER JOIN service_ticket st ON st.customer_id = c.id AND st.code = 'DEMO-P3P4-202607-ST'
WHERE c.code = 'DEMO-P3P4-202607-CUST'
ON DUPLICATE KEY UPDATE
  customer_id = VALUES(customer_id),
  maintenance_contract_id = VALUES(maintenance_contract_id),
  contract_id = VALUES(contract_id),
  source_ticket_id = VALUES(source_ticket_id),
  name = VALUES(name),
  expected_amount = VALUES(expected_amount),
  expected_sign_date = VALUES(expected_sign_date),
  stage = VALUES(stage),
  status = 'open',
  reason = VALUES(reason),
  next_action = VALUES(next_action),
  next_action_due_at = VALUES(next_action_due_at),
  deleted_at = NULL,
  updated_by = VALUES(updated_by);

COMMIT;

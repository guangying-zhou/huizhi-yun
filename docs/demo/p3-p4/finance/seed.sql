-- Execute against the configured Finance database.
SET NAMES utf8mb4;
START TRANSACTION;

-- The maintenance code is required by the runtime summary classifier. Create it only
-- when absent; on duplicate, preserve the tenant's existing configuration unchanged.
INSERT INTO finance_income_type (
  code, name, default_subject_id, is_contract_income, status, sort_no, remark
)
SELECT 'maintenance', '维保服务收入', NULL, 1, 'active', 9900,
       'DEMO-P3P4-202607-SEED-OWNED'
WHERE NOT EXISTS (
  SELECT 1 FROM finance_income_type WHERE code = 'maintenance'
);

INSERT INTO finance_people_cost_parameter (
  code, name, effective_from, effective_to,
  base_salary, welfare_cost_rate, management_allocation_rate,
  resource_allocation_cost, currency_code, status, remark,
  created_by, updated_by
) VALUES (
  'DEMO-P3P4-202607-PARAM', 'P3/P4 演示人力成本参数', '2026-01-01', NULL,
  10000.00, 0.2000, 0.1000, 1000.00, 'CNY', 'active',
  'DEMO-P3P4-202607 参数，与 People 职级设置组合用于 API 重算',
  'demo-p3p4', 'demo-p3p4'
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  effective_from = VALUES(effective_from),
  effective_to = VALUES(effective_to),
  base_salary = VALUES(base_salary),
  welfare_cost_rate = VALUES(welfare_cost_rate),
  management_allocation_rate = VALUES(management_allocation_rate),
  resource_allocation_cost = VALUES(resource_allocation_cost),
  currency_code = VALUES(currency_code),
  status = 'active',
  remark = VALUES(remark),
  updated_by = VALUES(updated_by);

INSERT INTO finance_invoice (
  code, invoice_no, customer_code, customer_name, contract_code, project_code,
  receivable_plan_code, invoice_type, invoice_medium, invoice_item,
  invoice_amount, tax_rate, tax_amount, amount_tax_exclusive,
  invoice_date, status, taxpayer_name, source_refs_json,
  remark, created_by, updated_by, deleted_at
) VALUES (
  'DEMO-P3P4-202607-INV', 'DEMO-P3P4-202607-INV-NO',
  'DEMO-P3P4-202607-CUST', 'P3/P4 演示客户',
  'DEMO-P3P4-202607-CT', 'DEMO-P3P4-202607-PROJ',
  'DEMO-P3P4-202607-RP', 'electronic', 'electronic', '维保服务费',
  100000.00, 6.00, 5660.38, 94339.62,
  '2026-07-10', 'issued', 'P3/P4 演示客户',
  JSON_OBJECT('demoKey', 'DEMO-P3P4-202607-INV'),
  'DEMO-P3P4-202607', 'demo-p3p4', 'demo-p3p4', NULL
)
ON DUPLICATE KEY UPDATE
  invoice_no = VALUES(invoice_no),
  customer_code = VALUES(customer_code),
  customer_name = VALUES(customer_name),
  contract_code = VALUES(contract_code),
  project_code = VALUES(project_code),
  receivable_plan_code = VALUES(receivable_plan_code),
  invoice_amount = VALUES(invoice_amount),
  invoice_date = VALUES(invoice_date),
  status = VALUES(status),
  source_refs_json = VALUES(source_refs_json),
  remark = VALUES(remark),
  deleted_at = NULL,
  updated_by = VALUES(updated_by);

-- Same-customer non-maintenance canary. The maintenance summary must exclude this
-- row even though customer_code and period are identical to the maintenance fact.
INSERT INTO finance_invoice (
  code, invoice_no, customer_code, customer_name, contract_code, project_code,
  receivable_plan_code, invoice_type, invoice_medium, invoice_item,
  invoice_amount, tax_rate, tax_amount, amount_tax_exclusive,
  invoice_date, status, taxpayer_name, source_refs_json,
  remark, created_by, updated_by, deleted_at
) VALUES (
  'DEMO-P3P4-202607-NONMAINT-INV', 'DEMO-P3P4-202607-NONMAINT-INV-NO',
  'DEMO-P3P4-202607-CUST', 'P3/P4 演示客户',
  'DEMO-P3P4-202607-NONMAINT-CT', 'DEMO-P3P4-202607-NONMAINT-PROJ',
  'DEMO-P3P4-202607-NONMAINT-RP', 'electronic', 'electronic', '非维保项目收入负样本',
  900000.00, 6.00, 50943.40, 849056.60,
  '2026-07-11', 'issued', 'P3/P4 演示客户',
  JSON_OBJECT('demoKey', 'DEMO-P3P4-202607-NONMAINT-INV'),
  'DEMO-P3P4-202607-NONMAINT-CANARY', 'demo-p3p4', 'demo-p3p4', NULL
)
ON DUPLICATE KEY UPDATE
  customer_code = VALUES(customer_code),
  contract_code = VALUES(contract_code),
  project_code = VALUES(project_code),
  invoice_amount = VALUES(invoice_amount),
  invoice_date = VALUES(invoice_date),
  status = VALUES(status),
  source_refs_json = VALUES(source_refs_json),
  remark = VALUES(remark),
  deleted_at = NULL,
  updated_by = VALUES(updated_by);

INSERT INTO finance_receipt (
  code, receipt_no, customer_code, customer_name, contract_code, project_code,
  receivable_plan_code, receipt_source_type, accounting_object_type,
  accounting_object_code, income_type_id,
  received_amount, reconciled_amount, unreconciled_amount, received_at,
  channel, payer_name, handler_user_id, status, source_refs_json,
  note, confirmed_by, confirmed_at, created_by, updated_by, deleted_at
)
SELECT
  'DEMO-P3P4-202607-REC', 'DEMO-P3P4-202607-REC-NO',
  'DEMO-P3P4-202607-CUST', 'P3/P4 演示客户',
  'DEMO-P3P4-202607-CT', 'DEMO-P3P4-202607-PROJ',
  'DEMO-P3P4-202607-RP', 'contract', 'contract', 'DEMO-P3P4-202607-CT', it.id,
  80000.00, 80000.00, 0.00, '2026-07-18',
  'bank_transfer', 'P3/P4 演示客户', 'DEMO-P3P4-202607-EMP', 'reconciled',
  JSON_OBJECT('demoKey', 'DEMO-P3P4-202607-REC'),
  'DEMO-P3P4-202607', 'DEMO-P3P4-202607-EMP', '2026-07-18 12:00:00',
  'demo-p3p4', 'demo-p3p4', NULL
FROM finance_income_type it
WHERE it.code = 'maintenance'
ON DUPLICATE KEY UPDATE
  receipt_no = VALUES(receipt_no),
  customer_code = VALUES(customer_code),
  customer_name = VALUES(customer_name),
  contract_code = VALUES(contract_code),
  project_code = VALUES(project_code),
  receivable_plan_code = VALUES(receivable_plan_code),
  income_type_id = VALUES(income_type_id),
  received_amount = VALUES(received_amount),
  reconciled_amount = VALUES(reconciled_amount),
  unreconciled_amount = VALUES(unreconciled_amount),
  received_at = VALUES(received_at),
  status = VALUES(status),
  source_refs_json = VALUES(source_refs_json),
  note = VALUES(note),
  deleted_at = NULL,
  updated_by = VALUES(updated_by);

INSERT INTO finance_reconciliation (
  code, receipt_id, invoice_id, customer_code, contract_code, project_code,
  receivable_plan_code, reconciled_amount, reconciled_at,
  reconciliation_type, status, created_by
)
SELECT
  'DEMO-P3P4-202607-RECON', r.id, i.id,
  'DEMO-P3P4-202607-CUST', 'DEMO-P3P4-202607-CT', 'DEMO-P3P4-202607-PROJ',
  'DEMO-P3P4-202607-RP', 80000.00, '2026-07-18 12:05:00',
  'contract_receivable', 'active', 'demo-p3p4'
FROM finance_receipt r
INNER JOIN finance_invoice i ON i.code = 'DEMO-P3P4-202607-INV'
WHERE r.code = 'DEMO-P3P4-202607-REC'
ON DUPLICATE KEY UPDATE
  receipt_id = VALUES(receipt_id),
  invoice_id = VALUES(invoice_id),
  customer_code = VALUES(customer_code),
  contract_code = VALUES(contract_code),
  project_code = VALUES(project_code),
  receivable_plan_code = VALUES(receivable_plan_code),
  reconciled_amount = VALUES(reconciled_amount),
  reconciled_at = VALUES(reconciled_at),
  status = 'active';

COMMIT;

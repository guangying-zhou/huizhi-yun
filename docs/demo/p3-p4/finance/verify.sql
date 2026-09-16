-- Execute against the configured Finance database.
SET NAMES utf8mb4;

SELECT 'precondition' AS phase, 'finance.people_cost_parameter' AS check_code,
       IF(COUNT(*) = 1, 'PASS', 'FAIL') AS status,
       '1 active effective parameter' AS expected, CAST(COUNT(*) AS CHAR) AS actual,
       COALESCE(MAX(CONCAT(code, '|', base_salary, '|', welfare_cost_rate, '|', management_allocation_rate)), 'missing') AS evidence
FROM finance_people_cost_parameter
WHERE code = 'DEMO-P3P4-202607-PARAM' AND status = 'active'
  AND effective_from <= '2026-07-31' AND (effective_to IS NULL OR effective_to >= '2026-07-01')
UNION ALL
SELECT 'precondition', 'finance.maintenance_invoice', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 issued invoice / 100000.00', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(code, '|', invoice_amount, '|', status)), 'missing')
FROM finance_invoice
WHERE code = 'DEMO-P3P4-202607-INV' AND invoice_amount = 100000.00
  AND status = 'issued' AND deleted_at IS NULL
UNION ALL
SELECT 'precondition', 'finance.nonmaintenance_canary', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 same-customer non-maintenance invoice / 900000.00', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(code, '|', customer_code, '|', contract_code, '|', project_code, '|', invoice_amount)), 'missing')
FROM finance_invoice
WHERE code = 'DEMO-P3P4-202607-NONMAINT-INV'
  AND customer_code = 'DEMO-P3P4-202607-CUST'
  AND contract_code = 'DEMO-P3P4-202607-NONMAINT-CT'
  AND project_code = 'DEMO-P3P4-202607-NONMAINT-PROJ'
  AND invoice_amount = 900000.00 AND status = 'issued' AND deleted_at IS NULL
UNION ALL
SELECT 'precondition', 'finance.maintenance_receipt', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 maintenance receipt / 80000.00', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(r.code, '|', r.received_amount, '|', it.code, '|', r.status)), 'missing')
FROM finance_receipt r
INNER JOIN finance_income_type it ON it.id = r.income_type_id
WHERE r.code = 'DEMO-P3P4-202607-REC' AND r.received_amount = 80000.00
  AND it.code = 'maintenance' AND r.deleted_at IS NULL
UNION ALL
SELECT 'precondition', 'finance.reconciliation', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 active reconciliation / 80000.00', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(code, '|', reconciled_amount, '|', status)), 'missing')
FROM finance_reconciliation
WHERE code = 'DEMO-P3P4-202607-RECON' AND reconciled_amount = 80000.00 AND status = 'active'
UNION ALL
SELECT 'e2e_result', 'finance.employee_cost_snapshot',
       IF(COUNT(*) = 1 AND MAX(standard_cost_amount) = 26080.00, 'PASS', 'FAIL'),
       '1 employee cost snapshot / 26080.00', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(employee_uid, '|', standard_cost_amount, '|', cost_source)),
                'run Finance sync-people-costs API')
FROM employee_cost_snapshot
WHERE employee_uid = 'DEMO-P3P4-202607-EMP' AND period_month = '2026-07'
  AND cost_source = 'people_standard_cost'
UNION ALL
SELECT 'e2e_result', 'finance.people_labor_allocation', IF(COUNT(*) = 1 AND COALESCE(SUM(amount), 0) > 0, 'PASS', 'FAIL'),
       '1 active managed labor allocation with positive amount',
       CONCAT(COUNT(*), ' rows/', COALESCE(CAST(SUM(amount) AS CHAR), '0')),
       COALESCE(MAX(CONCAT(code, '|', employee_uid, '|', allocation_basis, '|', rule_code)),
                'run Finance sync-people-costs API')
FROM project_cost_allocation
WHERE project_code = 'DEMO-P3P4-202607-PROJ' AND period_month = '2026-07'
  AND allocation_type = 'labor' AND employee_uid = 'DEMO-P3P4-202607-EMP' AND status = 'active'
  AND source_table = 'aims_time_entries_people_standard_cost_work_calendar'
  AND rule_code = 'std_labor_calendar_hours_v1'
UNION ALL
SELECT 'e2e_result', 'finance.project_summary',
       IF(COUNT(*) = 1 AND COALESCE(MAX(labor_cost_amount), 0) > 0
          AND MAX(cost_readiness_status) = 'ready'
          AND MAX(cost_input_hash) IS NOT NULL
          AND MAX(gross_profit_amount) IS NOT NULL, 'PASS', 'FAIL'),
       '1 ready project summary with input hash and complete gross profit', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(project_code, '|labor=', labor_cost_amount, '|gross=', gross_profit_amount,
                           '|ready=', cost_readiness_status, '|hash=', LEFT(cost_input_hash, 12))),
                'run Finance project accounting recalculation')
FROM project_finance_summary
WHERE project_code = 'DEMO-P3P4-202607-PROJ' AND period_month = '2026-07';

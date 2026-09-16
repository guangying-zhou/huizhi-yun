-- Execute against the configured Finance database.
SET NAMES utf8mb4;
START TRANSACTION;

DELETE FROM project_cost_allocation
WHERE project_code = 'DEMO-P3P4-202607-PROJ'
  AND period_month = '2026-07'
  AND (employee_uid = 'DEMO-P3P4-202607-EMP'
       OR code LIKE 'DEMO-P3P4-202607-%');

DELETE FROM project_finance_summary
WHERE project_code = 'DEMO-P3P4-202607-PROJ' AND period_month = '2026-07';

DELETE FROM employee_cost_snapshot
WHERE employee_uid = 'DEMO-P3P4-202607-EMP' AND period_month = '2026-07';

DELETE FROM finance_reconciliation
WHERE code = 'DEMO-P3P4-202607-RECON'
   OR (project_code = 'DEMO-P3P4-202607-PROJ'
       AND receivable_plan_code = 'DEMO-P3P4-202607-RP');

DELETE FROM finance_receipt
WHERE code = 'DEMO-P3P4-202607-REC';

DELETE FROM finance_invoice
WHERE code IN ('DEMO-P3P4-202607-INV', 'DEMO-P3P4-202607-NONMAINT-INV');

DELETE FROM finance_people_cost_parameter
WHERE code = 'DEMO-P3P4-202607-PARAM';

DELETE FROM finance_income_type
WHERE code = 'maintenance'
  AND remark = 'DEMO-P3P4-202607-SEED-OWNED'
  AND NOT EXISTS (
    SELECT 1 FROM finance_receipt r
    WHERE r.income_type_id = finance_income_type.id
  );

COMMIT;

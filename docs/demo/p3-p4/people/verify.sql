-- Execute against the configured People database.
SET NAMES utf8mb4;

SELECT 'precondition' AS phase, 'people.employee' AS check_code,
       IF(COUNT(*) = 1, 'PASS', 'FAIL') AS status,
       '1 active employee' AS expected, CAST(COUNT(*) AS CHAR) AS actual,
       COALESCE(MAX(CONCAT(employee_uid, '|', employment_status, '|', dept_code, '|', rank_code)), 'missing') AS evidence
FROM people_employees
WHERE employee_uid = 'DEMO-P3P4-202607-EMP' AND archived_at IS NULL AND employment_status = 'active'
UNION ALL
SELECT 'precondition', 'people.assignment', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 approved current assignment', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(assignment_code, '|', approval_status, '|', position_code)), 'missing')
FROM people_assignments
WHERE assignment_code = 'DEMO-P3P4-202607-ASN' AND effective_to IS NULL AND approval_status = 'approved'
UNION ALL
SELECT 'precondition', 'people.rank_and_rate', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 enabled P6 rate at 20000.00', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(rate_code, '|', rank_code, '|', monthly_standard_cost)), 'missing')
FROM people_standard_cost_rates
WHERE rate_code = 'DEMO-P3P4-202607-RATE' AND rank_code = 'DEMO-P3P4-202607-P6'
  AND enabled = 1 AND monthly_standard_cost = 20000.00
UNION ALL
SELECT 'precondition', 'people.cost_snapshot', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '2026-07 standard=20000 actual=20500 with frozen assignment/rank', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(snapshot_code, '|', standard_cost, '|', actual_cost, '|', assignment_code, '|', rank_code_snapshot)), 'missing')
FROM people_cost_snapshots
WHERE employee_uid = 'DEMO-P3P4-202607-EMP' AND period_month = '2026-07'
  AND standard_cost = 20000.00 AND actual_cost = 20500.00
  AND assignment_code = 'DEMO-P3P4-202607-ASN'
  AND dept_code_snapshot = 'DEMO-P3P4-202607-DEPT'
  AND position_code_snapshot = 'DEMO-P3P4-202607-POS'
  AND rank_code_snapshot = 'DEMO-P3P4-202607-P6'
UNION ALL
SELECT 'precondition', 'people.performance_cycle', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 project cycle in collecting/confirmed/closed', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(cycle_code, '|', project_code, '|', status)), 'missing')
FROM people_performance_cycles
WHERE cycle_code = 'DEMO-P3P4-202607-CYCLE'
  AND project_code = 'DEMO-P3P4-202607-PROJ'
  AND status IN ('collecting', 'confirmed', 'closed')
UNION ALL
SELECT 'e2e_result', 'people.aims_contribution_sync', IF(COUNT(*) >= 1, 'PASS', 'FAIL'),
       '>=1 Aims contribution totaling 80.00 hours',
       CONCAT(COUNT(*), ' rows/', COALESCE(CAST(SUM(work_hours) AS CHAR), '0'), ' hours'),
       COALESCE(MAX(CONCAT(contribution_code, '|', source_app, '|', source_biz_type)), 'run Aims contribution sync API')
FROM people_contribution_snapshots
WHERE cycle_code = 'DEMO-P3P4-202607-CYCLE'
  AND employee_uid = 'DEMO-P3P4-202607-EMP'
  AND project_code = 'DEMO-P3P4-202607-PROJ'
  AND source_app = 'aims'
HAVING COALESCE(SUM(work_hours), 0) = 80.00;

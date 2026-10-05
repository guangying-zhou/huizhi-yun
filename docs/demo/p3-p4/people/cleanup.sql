-- Execute against the configured People database.
SET NAMES utf8mb4;
START TRANSACTION;

DELETE FROM people_documents
WHERE document_code = 'DEMO-P3P4-202607-PDOC'
   OR (document_uuid = 'd3a4c000-2026-4701-8000-000000000001'
       AND document_title LIKE 'P3/P4 演示%');

DELETE FROM people_contribution_snapshots
WHERE cycle_code = 'DEMO-P3P4-202607-CYCLE'
   OR contribution_code LIKE 'DEMO-P3P4-202607-%';

DELETE FROM people_performance_cycles
WHERE cycle_code = 'DEMO-P3P4-202607-CYCLE';

DELETE FROM people_cost_snapshots
WHERE snapshot_code = 'DEMO-P3P4-202607-COST'
   OR (employee_uid = 'DEMO-P3P4-202607-EMP' AND period_month = '2026-07');

DELETE FROM people_assignments
WHERE assignment_code = 'DEMO-P3P4-202607-ASN'
   OR employee_uid = 'DEMO-P3P4-202607-EMP';

DELETE FROM people_employees
WHERE employee_uid = 'DEMO-P3P4-202607-EMP';

DELETE FROM people_standard_cost_rates
WHERE rate_code = 'DEMO-P3P4-202607-RATE';

DELETE FROM people_ranks
WHERE rank_code = 'DEMO-P3P4-202607-P6';

DELETE FROM people_positions
WHERE position_code = 'DEMO-P3P4-202607-POS';

COMMIT;

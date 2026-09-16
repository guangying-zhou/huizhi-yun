-- Execute against the configured Aims database.
SET NAMES utf8mb4;

SELECT 'precondition' AS phase, 'aims.project' AS check_code,
       IF(COUNT(*) = 1, 'PASS', 'FAIL') AS status,
       '1 active maintenance project' AS expected, CAST(COUNT(*) AS CHAR) AS actual,
       COALESCE(MAX(CONCAT(project_code, '|', lifecycle_status, '|', customer_code, '|', contract_code)), 'missing') AS evidence
FROM aims_projects
WHERE project_code = 'DEMO-P3P4-202607-PROJ'
  AND lifecycle_status = 'active' AND category = 'maintenance'
UNION ALL
SELECT 'precondition', 'aims.project_member', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 active manager', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(m.uid, '|', m.role, '|', m.status)), 'missing')
FROM aims_project_members m
INNER JOIN aims_projects p ON p.id = m.project_id
WHERE p.project_code = 'DEMO-P3P4-202607-PROJ'
  AND m.uid = 'DEMO-P3P4-202607-EMP' AND m.role = 'manager' AND m.status = 'active'
UNION ALL
SELECT 'precondition', 'aims.project_task', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 Aims source task / 80.00 estimated hours', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(w.item_key, '|', w.status, '|', CAST(w.estimated_hours AS CHAR))), 'missing')
FROM work_items w
INNER JOIN aims_projects p ON p.id = w.project_id
WHERE p.project_code = 'DEMO-P3P4-202607-PROJ'
  AND w.template_key = 'DEMO-P3P4-202607-G23-TASK'
  AND w.type = 'task' AND w.assignee_uid = 'DEMO-P3P4-202607-EMP'
  AND w.estimated_hours = 80.00
UNION ALL
SELECT 'precondition', 'aims.time_entries',
       IF(COUNT(*) = 10 AND COALESCE(SUM(te.hours), 0) = 80.00
          AND COUNT(DISTINCT te.work_item_id) = 1, 'PASS', 'FAIL'),
       '10 rows / 80.00 hours / 1 source task',
       CONCAT(COUNT(*), ' rows/', COALESCE(CAST(SUM(te.hours) AS CHAR), '0'), ' hours'),
       CONCAT(COALESCE(MIN(te.entry_date), 'missing'), '|', COALESCE(MAX(te.entry_date), 'missing'))
FROM time_entries te
INNER JOIN aims_projects p ON p.id = te.project_id
WHERE p.project_code = 'DEMO-P3P4-202607-PROJ'
  AND te.uid = 'DEMO-P3P4-202607-EMP'
  AND te.work_item_id = (
    SELECT w.id FROM work_items w
    WHERE w.project_id = p.id AND w.template_key = 'DEMO-P3P4-202607-G23-TASK'
    LIMIT 1
  )
  AND te.description LIKE 'DEMO-P3P4-202607-TIME-%'
UNION ALL
SELECT 'e2e_result', 'aims.altoc_ticket_work_item', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 work item linked to Altoc ticket', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(w.item_key, '|', w.status, '|', ext.source_ticket_code)),
                'run Altoc -> Aims work-item API')
FROM work_items w
INNER JOIN aims_projects p ON p.id = w.project_id
INNER JOIN work_item_service_ext ext ON ext.work_item_id = w.id AND ext.project_id = p.id
WHERE p.project_code = 'DEMO-P3P4-202607-PROJ'
  AND w.template_key = 'altoc:service_ticket:DEMO-P3P4-202607-ST'
  AND ext.source_ticket_code = 'DEMO-P3P4-202607-ST';

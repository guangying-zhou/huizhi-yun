-- Execute against the configured Aims database.
SET NAMES utf8mb4;
START TRANSACTION;

INSERT INTO aims_projects (
  project_code, name, short_name, internal_code, description,
  category, methodology, lifecycle_status, dept_code, leader_uid,
  security_level, confidentiality_level, start_date, end_date,
  customer_code, customer_name, contract_code, approval_status,
  module_config, created_by
) VALUES (
  'DEMO-P3P4-202607-PROJ', 'P3/P4 跨模块演示维保项目', 'P3P4演示',
  'DEMO-P3P4-202607', 'DEMO-P3P4-202607 项目工时、贡献同步与服务工单回流源事实',
  'maintenance', 'PIVR', 'active', 'DEMO-P3P4-202607-DEPT', 'DEMO-P3P4-202607-EMP',
  'project_team', 'L1', '2026-07-01', '2027-06-30',
  'DEMO-P3P4-202607-CUST', 'P3/P4 演示客户', 'DEMO-P3P4-202607-CT',
  'approved', JSON_OBJECT('serviceOps', TRUE, 'demoKey', 'DEMO-P3P4-202607-PROJ'),
  'DEMO-P3P4-202607-EMP'
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  short_name = VALUES(short_name),
  description = VALUES(description),
  category = VALUES(category),
  methodology = VALUES(methodology),
  lifecycle_status = 'active',
  dept_code = VALUES(dept_code),
  leader_uid = VALUES(leader_uid),
  customer_code = VALUES(customer_code),
  customer_name = VALUES(customer_name),
  contract_code = VALUES(contract_code),
  module_config = VALUES(module_config);

INSERT INTO aims_project_members (project_id, uid, role, status, joined_at)
SELECT id, 'DEMO-P3P4-202607-EMP', 'manager', 'active', '2026-07-01 09:00:00'
FROM aims_projects
WHERE project_code = 'DEMO-P3P4-202607-PROJ'
ON DUPLICATE KEY UPDATE role = 'manager', status = 'active';

-- G2-3 source fixture: this task is an Aims input fact, not an API-derived Altoc work item.
INSERT INTO milestones (
  project_id, name, description, mode, start_date, end_date,
  status, template_key, sort_order, created_by
)
SELECT id, '2026-07 人力成本闭环验收', 'DEMO-P3P4-202607-G23-MILESTONE',
       'periodic', '2026-07-01', '2026-07-31', 'active',
       'DEMO-P3P4-202607-G23-MILESTONE', 9900, 'demo-p3p4'
FROM aims_projects
WHERE project_code = 'DEMO-P3P4-202607-PROJ'
  AND NOT EXISTS (
    SELECT 1 FROM milestones existing
    WHERE existing.project_id = aims_projects.id
      AND existing.template_key = 'DEMO-P3P4-202607-G23-MILESTONE'
  );

INSERT INTO project_counters (project_id, counter)
SELECT id, 1
FROM aims_projects
WHERE project_code = 'DEMO-P3P4-202607-PROJ'
ON DUPLICATE KEY UPDATE counter = GREATEST(counter, 1);

INSERT INTO work_items (
  project_id, milestone_id, item_number, item_key, tier, type,
  title, description, start_date, status, priority, weight,
  assignee_uid, reporter_uid, due_date, estimated_hours,
  approval_status, review_level, required, template_key
)
SELECT p.id, m.id, 1, 'DEMO-P3P4-202607-G23-TASK', 'matter', 'task',
       '完成 2026-07 项目交付工时', 'DEMO-P3P4-202607-G23-TASK',
       '2026-07-01', 'completed', 'P1', 1,
       'DEMO-P3P4-202607-EMP', 'DEMO-P3P4-202607-EMP', '2026-07-31', 80.00,
       'not_required', 0, 1, 'DEMO-P3P4-202607-G23-TASK'
FROM aims_projects p
INNER JOIN milestones m
  ON m.project_id = p.id
 AND m.template_key = 'DEMO-P3P4-202607-G23-MILESTONE'
WHERE p.project_code = 'DEMO-P3P4-202607-PROJ'
  AND NOT EXISTS (
    SELECT 1 FROM work_items existing
    WHERE existing.project_id = p.id
      AND existing.template_key = 'DEMO-P3P4-202607-G23-TASK'
  );

UPDATE time_entries te
INNER JOIN aims_projects p ON p.id = te.project_id
SET te.uid = 'DEMO-P3P4-202607-EMP',
    te.hours = 8.00,
    te.work_item_id = (
      SELECT w.id FROM work_items w
      WHERE w.project_id = p.id
        AND w.template_key = 'DEMO-P3P4-202607-G23-TASK'
      LIMIT 1
    ),
    te.weekly_report_id = NULL
WHERE p.project_code = 'DEMO-P3P4-202607-PROJ'
  AND te.description LIKE 'DEMO-P3P4-202607-TIME-%';

INSERT INTO time_entries (
  project_id, work_item_id, weekly_report_id, uid, entry_date, hours, description
)
SELECT p.id, w.id, NULL, 'DEMO-P3P4-202607-EMP', d.entry_date, 8.00, d.description
FROM aims_projects p
INNER JOIN work_items w
  ON w.project_id = p.id
 AND w.template_key = 'DEMO-P3P4-202607-G23-TASK'
INNER JOIN (
  SELECT DATE('2026-07-01') AS entry_date, 'DEMO-P3P4-202607-TIME-01' AS description
  UNION ALL SELECT DATE('2026-07-02'), 'DEMO-P3P4-202607-TIME-02'
  UNION ALL SELECT DATE('2026-07-03'), 'DEMO-P3P4-202607-TIME-03'
  UNION ALL SELECT DATE('2026-07-06'), 'DEMO-P3P4-202607-TIME-04'
  UNION ALL SELECT DATE('2026-07-07'), 'DEMO-P3P4-202607-TIME-05'
  UNION ALL SELECT DATE('2026-07-08'), 'DEMO-P3P4-202607-TIME-06'
  UNION ALL SELECT DATE('2026-07-09'), 'DEMO-P3P4-202607-TIME-07'
  UNION ALL SELECT DATE('2026-07-10'), 'DEMO-P3P4-202607-TIME-08'
  UNION ALL SELECT DATE('2026-07-13'), 'DEMO-P3P4-202607-TIME-09'
  UNION ALL SELECT DATE('2026-07-14'), 'DEMO-P3P4-202607-TIME-10'
) d
WHERE p.project_code = 'DEMO-P3P4-202607-PROJ'
  AND NOT EXISTS (
    SELECT 1
    FROM time_entries existing
    WHERE existing.project_id = p.id
      AND existing.description = d.description
  );

COMMIT;

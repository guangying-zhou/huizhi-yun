-- Execute against the configured People database.
SET NAMES utf8mb4;
START TRANSACTION;

INSERT INTO people_positions (
  position_code, position_name, job_family, description, enabled, sort_order, created_by, updated_by
) VALUES (
  'DEMO-P3P4-202607-POS', 'P3/P4 演示交付工程师', '交付',
  'DEMO-P3P4-202607 演示岗位', 1, 9900, 'demo-p3p4', 'demo-p3p4'
)
ON DUPLICATE KEY UPDATE
  position_name = VALUES(position_name),
  job_family = VALUES(job_family),
  description = VALUES(description),
  enabled = 1,
  updated_by = VALUES(updated_by);

INSERT INTO people_ranks (
  rank_code, rank_name, rank_series, rank_level, description, enabled, sort_order, created_by, updated_by
) VALUES (
  'DEMO-P3P4-202607-P6', 'P3/P4 演示专业 P6', 'P', 6,
  'DEMO-P3P4-202607 演示职级', 1, 9900, 'demo-p3p4', 'demo-p3p4'
)
ON DUPLICATE KEY UPDATE
  rank_name = VALUES(rank_name),
  rank_series = VALUES(rank_series),
  rank_level = VALUES(rank_level),
  description = VALUES(description),
  enabled = 1,
  updated_by = VALUES(updated_by);

INSERT INTO people_standard_cost_rates (
  rate_code, rate_name, position_code, position_name, rank_code, rank_name,
  rank_series, rank_level, rank_salary, performance_salary_min, performance_salary_max,
  employment_type, effective_from, currency, monthly_standard_cost,
  source_app, source_biz_type, source_biz_id, source_refs,
  enabled, sort_order, remarks, created_by, updated_by
) VALUES (
  'DEMO-P3P4-202607-RATE', 'P3/P4 演示 P6 标准成本',
  NULL, NULL,
  'DEMO-P3P4-202607-P6', 'P3/P4 演示专业 P6',
  'P', 6, 6000.00, 2000.00, 4000.00,
  'full_time', '2026-01-01', 'CNY', 20000.00,
  'people', 'demo_seed', 'DEMO-P3P4-202607-RATE',
  JSON_OBJECT('demoKey', 'DEMO-P3P4-202607-RATE'),
  1, 9900, 'DEMO-P3P4-202607 演示规则', 'demo-p3p4', 'demo-p3p4'
)
ON DUPLICATE KEY UPDATE
  rate_name = VALUES(rate_name),
  position_code = VALUES(position_code),
  position_name = VALUES(position_name),
  rank_code = VALUES(rank_code),
  rank_name = VALUES(rank_name),
  rank_salary = VALUES(rank_salary),
  performance_salary_min = VALUES(performance_salary_min),
  performance_salary_max = VALUES(performance_salary_max),
  monthly_standard_cost = VALUES(monthly_standard_cost),
  source_refs = VALUES(source_refs),
  enabled = 1,
  updated_by = VALUES(updated_by);

INSERT INTO people_employees (
  employee_uid, employee_no, display_name, initials, login_name,
  employment_status, employment_type, dept_code, dept_name,
  position_code, position_name, rank_code, rank_name, manager_uid,
  onboard_date, work_location, cost_center_code, monthly_standard_cost,
  metadata, created_by, updated_by, archived_at
) VALUES (
  'DEMO-P3P4-202607-EMP', 'DEMO-P3P4-202607-ENO', '演示交付工程师', '演',
  'demo-p3p4-202607', 'active', 'full_time',
  'DEMO-P3P4-202607-DEPT', 'P3/P4 演示交付部',
  'DEMO-P3P4-202607-POS', 'P3/P4 演示交付工程师',
  'DEMO-P3P4-202607-P6', 'P3/P4 演示专业 P6', NULL,
  '2026-01-02', '演示环境', 'DEMO-P3P4-202607-CC', 20000.00,
  JSON_OBJECT('demoKey', 'DEMO-P3P4-202607-EMP'),
  'demo-p3p4', 'demo-p3p4', NULL
)
ON DUPLICATE KEY UPDATE
  employee_no = VALUES(employee_no),
  display_name = VALUES(display_name),
  employment_status = 'active',
  employment_type = VALUES(employment_type),
  dept_code = VALUES(dept_code),
  dept_name = VALUES(dept_name),
  position_code = VALUES(position_code),
  position_name = VALUES(position_name),
  rank_code = VALUES(rank_code),
  rank_name = VALUES(rank_name),
  cost_center_code = VALUES(cost_center_code),
  monthly_standard_cost = VALUES(monthly_standard_cost),
  metadata = VALUES(metadata),
  archived_at = NULL,
  updated_by = VALUES(updated_by);

INSERT INTO people_assignments (
  assignment_code, employee_uid, change_type, effective_from, effective_to,
  dept_code, dept_name, position_code, position_name, rank_code, rank_name,
  approval_status, source_app, source_biz_type, source_biz_id,
  remarks, created_by, updated_by
) VALUES (
  'DEMO-P3P4-202607-ASN', 'DEMO-P3P4-202607-EMP', 'onboard', '2026-01-02', NULL,
  'DEMO-P3P4-202607-DEPT', 'P3/P4 演示交付部',
  'DEMO-P3P4-202607-POS', 'P3/P4 演示交付工程师',
  'DEMO-P3P4-202607-P6', 'P3/P4 演示专业 P6',
  'approved', 'people', 'demo_seed', 'DEMO-P3P4-202607-ASN',
  'DEMO-P3P4-202607 当前任职', 'demo-p3p4', 'demo-p3p4'
)
ON DUPLICATE KEY UPDATE
  employee_uid = VALUES(employee_uid),
  effective_from = VALUES(effective_from),
  effective_to = NULL,
  dept_code = VALUES(dept_code),
  dept_name = VALUES(dept_name),
  position_code = VALUES(position_code),
  position_name = VALUES(position_name),
  rank_code = VALUES(rank_code),
  rank_name = VALUES(rank_name),
  approval_status = 'approved',
  remarks = VALUES(remarks),
  updated_by = VALUES(updated_by);

INSERT INTO people_cost_snapshots (
  snapshot_code, employee_uid, period_month, standard_cost, actual_cost,
  currency, cost_source, cost_basis, standard_rate_code,
  assignment_code, dept_code_snapshot, dept_name_snapshot,
  position_code_snapshot, position_name_snapshot, rank_code_snapshot, rank_name_snapshot,
  source_app, source_biz_type, source_biz_id, source_refs,
  confirmed_at, created_by, updated_by
) VALUES (
  'DEMO-P3P4-202607-COST', 'DEMO-P3P4-202607-EMP', '2026-07',
  20000.00, 20500.00, 'CNY', 'import', 'actual', 'DEMO-P3P4-202607-RATE',
  'DEMO-P3P4-202607-ASN', 'DEMO-P3P4-202607-DEPT', 'P3/P4 演示交付部',
  'DEMO-P3P4-202607-POS', 'P3/P4 演示交付工程师',
  'DEMO-P3P4-202607-P6', 'P3/P4 演示专业 P6',
  'people', 'demo_history', 'DEMO-P3P4-202607-COST',
  JSON_OBJECT(
    'financeParameterCode', 'DEMO-P3P4-202607-PARAM',
    'assignment', JSON_OBJECT(
      'assignment_code', 'DEMO-P3P4-202607-ASN',
      'effective_from', '2026-01-02',
      'effective_to', NULL,
      'dept_code', 'DEMO-P3P4-202607-DEPT',
      'position_code', 'DEMO-P3P4-202607-POS',
      'rank_code', 'DEMO-P3P4-202607-P6'
    )
  ),
  '2026-07-31 18:00:00', 'demo-p3p4', 'demo-p3p4'
)
ON DUPLICATE KEY UPDATE
  snapshot_code = VALUES(snapshot_code),
  standard_cost = VALUES(standard_cost),
  actual_cost = VALUES(actual_cost),
  cost_source = VALUES(cost_source),
  cost_basis = VALUES(cost_basis),
  standard_rate_code = VALUES(standard_rate_code),
  assignment_code = VALUES(assignment_code),
  dept_code_snapshot = VALUES(dept_code_snapshot),
  dept_name_snapshot = VALUES(dept_name_snapshot),
  position_code_snapshot = VALUES(position_code_snapshot),
  position_name_snapshot = VALUES(position_name_snapshot),
  rank_code_snapshot = VALUES(rank_code_snapshot),
  rank_name_snapshot = VALUES(rank_name_snapshot),
  source_refs = VALUES(source_refs),
  confirmed_at = VALUES(confirmed_at),
  updated_by = VALUES(updated_by);

INSERT INTO people_performance_cycles (
  cycle_code, cycle_name, cycle_type, scope_type, project_code,
  period_start, period_end, status, created_by, updated_by
) VALUES (
  'DEMO-P3P4-202607-CYCLE', 'P3/P4 2026-07 项目绩效周期',
  'month', 'project', 'DEMO-P3P4-202607-PROJ',
  '2026-07-01', '2026-07-31', 'collecting', 'demo-p3p4', 'demo-p3p4'
)
ON DUPLICATE KEY UPDATE
  cycle_name = VALUES(cycle_name),
  project_code = VALUES(project_code),
  period_start = VALUES(period_start),
  period_end = VALUES(period_end),
  status = CASE
    WHEN people_performance_cycles.status IN ('confirmed', 'closed') THEN people_performance_cycles.status
    ELSE 'collecting'
  END,
  updated_by = VALUES(updated_by);

INSERT INTO people_documents (
  document_code, employee_uid, cycle_code, project_code,
  document_uuid, document_title, document_type,
  source_app, source_biz_type, source_biz_id, tags, created_by
) VALUES (
  'DEMO-P3P4-202607-PDOC', 'DEMO-P3P4-202607-EMP',
  'DEMO-P3P4-202607-CYCLE', 'DEMO-P3P4-202607-PROJ',
  'd3a4c000-2026-4701-8000-000000000001', 'P3/P4 演示运维知识与复盘', 'ops_knowledge',
  'codocs', 'document', 'd3a4c000-2026-4701-8000-000000000001',
  JSON_ARRAY('DEMO-P3P4-202607', 'ops'), 'demo-p3p4'
)
ON DUPLICATE KEY UPDATE
  employee_uid = VALUES(employee_uid),
  cycle_code = VALUES(cycle_code),
  project_code = VALUES(project_code),
  document_uuid = VALUES(document_uuid),
  document_title = VALUES(document_title),
  document_type = VALUES(document_type),
  tags = VALUES(tags);

COMMIT;

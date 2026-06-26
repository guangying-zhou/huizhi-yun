-- ============================================
-- People MVP - optional demo seed
-- 执行说明:
-- 1. 仅用于本地演示/原型体验，不用于生产租户初始化
-- 2. 先执行 people_schema.sql，再按需执行本文件
-- ============================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

USE `hzy_people`;

INSERT INTO `people_standard_cost_rates` (
  `rate_code`, `rate_name`, `rank_code`, `rank_name`, `rank_series`, `rank_level`,
  `rank_salary`, `performance_salary_min`, `performance_salary_max`,
  `effective_from`, `currency`, `monthly_standard_cost`, `source_app`, `source_biz_type`, `source_biz_id`, `sort_order`
)
VALUES
  ('SCR-P7-2026', '专业 P7 职级设置', 'P7', '专业 P7', 'P', 7, 12000.00, 7000.00, 13000.00, '2026-01-01', 'CNY', 48800.00, 'people', 'rank_standard', '2026', 170),
  ('SCR-P6-2026', '专业 P6 职级设置', 'P6', '专业 P6', 'P', 6, 9000.00, 5000.00, 9000.00, '2026-01-01', 'CNY', 39440.00, 'people', 'rank_standard', '2026', 160)
ON DUPLICATE KEY UPDATE `monthly_standard_cost` = VALUES(`monthly_standard_cost`), `enabled` = 1;

INSERT INTO `people_employees` (
  `employee_uid`, `employee_no`, `display_name`, `initials`, `login_name`, `employment_status`, `employment_type`,
  `dept_code`, `dept_name`, `position_code`, `position_name`, `rank_code`, `rank_name`, `manager_uid`,
  `onboard_date`, `cost_center_code`, `monthly_standard_cost`
)
VALUES
  ('g.zhao', 'E0001', '赵宇航', '宇航', 'g.zhao', 'active', 'full_time', 'rd', '研发部', 'architect', '架构师', 'P7', '专业 P7', NULL, '2021-03-01', 'RD', 48800.00),
  ('l.xiao', 'E0002', '林晓', '林晓', 'l.xiao', 'active', 'full_time', 'rd', '研发部', 'frontend_engineer', '前端工程师', 'P6', '专业 P6', 'g.zhao', '2022-06-15', 'RD', 39440.00)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `employment_status` = VALUES(`employment_status`),
  `dept_name` = VALUES(`dept_name`),
  `position_name` = VALUES(`position_name`),
  `rank_code` = VALUES(`rank_code`),
  `monthly_standard_cost` = VALUES(`monthly_standard_cost`);

INSERT INTO `people_assignments` (
  `assignment_code`, `employee_uid`, `change_type`, `effective_from`, `effective_to`,
  `dept_code`, `dept_name`, `position_code`, `position_name`, `rank_code`, `rank_name`, `manager_uid`, `approval_status`, `source_app`, `source_biz_type`, `source_biz_id`
)
VALUES
  ('ASN-20210301-GZ', 'g.zhao', 'onboard', '2021-03-01', NULL, 'rd', '研发部', 'architect', '架构师', 'P7', '专业 P7', NULL, 'approved', 'people', 'manual', 'init'),
  ('ASN-20220615-LX', 'l.xiao', 'onboard', '2022-06-15', '2023-07-01', 'rd', '研发部', 'frontend_engineer', '前端工程师', 'P5', '专业 P5', 'g.zhao', 'approved', 'people', 'manual', 'init'),
  ('ASN-20230701-LX', 'l.xiao', 'rank_change', '2023-07-01', NULL, 'rd', '研发部', 'frontend_engineer', '前端工程师', 'P6', '专业 P6', 'g.zhao', 'approved', 'workflow', 'instance', 'WF-2307-018')
ON DUPLICATE KEY UPDATE `effective_to` = VALUES(`effective_to`), `rank_code` = VALUES(`rank_code`), `approval_status` = VALUES(`approval_status`);

INSERT INTO `people_cost_snapshots` (
  `snapshot_code`, `employee_uid`, `period_month`, `standard_cost`, `actual_cost`, `cost_source`, `cost_basis`, `standard_rate_code`,
  `source_app`, `source_biz_type`, `source_biz_id`
)
VALUES
  ('COST-202606-GZ', 'g.zhao', '2026-06', 48800.00, 48800.00, 'standard_rate', 'standard', 'SCR-P7-2026', 'people', 'rank_standard_cost', 'SCR-P7-2026'),
  ('COST-202606-LX', 'l.xiao', '2026-06', 39440.00, 39440.00, 'standard_rate', 'standard', 'SCR-P6-2026', 'people', 'rank_standard_cost', 'SCR-P6-2026')
ON DUPLICATE KEY UPDATE
  `standard_cost` = VALUES(`standard_cost`),
  `actual_cost` = VALUES(`actual_cost`),
  `cost_source` = VALUES(`cost_source`),
  `cost_basis` = VALUES(`cost_basis`),
  `standard_rate_code` = VALUES(`standard_rate_code`);

INSERT INTO `people_performance_cycles` (`cycle_code`, `cycle_name`, `cycle_type`, `scope_type`, `project_code`, `period_start`, `period_end`, `status`)
VALUES
  ('PC-2026Q2', '2026 年第二季度绩效', 'quarter', 'project', NULL, '2026-04-01', '2026-06-30', 'collecting'),
  ('PC-ACME-DLV', '某制造 ERP 交付项目绩效', 'project', 'project', 'PRJ-ACME-DLV', '2025-09-01', '2026-03-31', 'closed')
ON DUPLICATE KEY UPDATE `cycle_name` = VALUES(`cycle_name`), `status` = VALUES(`status`);

INSERT INTO `people_contribution_snapshots` (
  `contribution_code`, `cycle_code`, `employee_uid`, `project_code`, `role_code`, `work_hours`, `contribution_score`, `source_app`, `source_biz_type`, `source_biz_id`, `source_refs`
)
VALUES
  ('CONTR-2026Q2-GZ-FIN', 'PC-2026Q2', 'g.zhao', 'PRJ-FIN', '研发', 60.00, 92.00, 'aims', 'task', 'PRJ-FIN', JSON_OBJECT('tasks', JSON_ARRAY('TASK-1001', 'TASK-1002'))),
  ('CONTR-2026Q2-GZ-WF', 'PC-2026Q2', 'g.zhao', 'PRJ-WF', '研发', 48.00, 88.00, 'aims', 'task', 'PRJ-WF', JSON_OBJECT('tasks', JSON_ARRAY('TASK-2001'))),
  ('CONTR-2026Q2-LX-FIN', 'PC-2026Q2', 'l.xiao', 'PRJ-FIN', '研发', 152.00, 88.00, 'aims', 'worklog', 'PRJ-FIN', JSON_OBJECT('worklogs', JSON_ARRAY('WL-3001'))),
  ('CONTR-2026Q2-LX-CODOCS', 'PC-2026Q2', 'l.xiao', 'PRJ-CODOCS', '研发', 88.00, 80.00, 'aims', 'task', 'PRJ-CODOCS', JSON_OBJECT('tasks', JSON_ARRAY('TASK-3001')))
ON DUPLICATE KEY UPDATE `work_hours` = VALUES(`work_hours`), `contribution_score` = VALUES(`contribution_score`), `source_refs` = VALUES(`source_refs`);

INSERT INTO `people_documents` (`document_code`, `employee_uid`, `cycle_code`, `project_code`, `document_uuid`, `document_title`, `document_type`, `source_app`, `source_biz_type`, `source_biz_id`)
VALUES
  ('PDOC-LX-POSITION', 'l.xiao', NULL, NULL, 'doc-3f9a-b21', '前端工程师岗位说明书', 'position_spec', 'codocs', 'position', 'frontend_engineer'),
  ('PDOC-LX-PC2026Q1', 'l.xiao', 'PC-2026Q2', NULL, 'doc-7c12-e08', '2026 Q1 绩效说明', 'performance_note', 'codocs', 'cycle', 'PC-2026Q2')
ON DUPLICATE KEY UPDATE `document_title` = VALUES(`document_title`), `document_type` = VALUES(`document_type`);

SET FOREIGN_KEY_CHECKS = 1;

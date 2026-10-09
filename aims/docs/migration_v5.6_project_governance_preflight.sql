-- v5.6 项目治理迁移前只读检查（不写数据）

SELECT
  VERSION() AS mysql_version,
  DATABASE() AS database_name,
  UTC_TIMESTAMP(6) AS checked_at;

SELECT
  COUNT(*) AS projects_without_manager
FROM `aims_projects`
WHERE `leader_uid` IS NULL OR TRIM(`leader_uid`) = '';

SELECT
  `id`,
  `project_code`,
  `name`,
  `lifecycle_status`,
  `created_by`
FROM `aims_projects`
WHERE `leader_uid` IS NULL OR TRIM(`leader_uid`) = ''
ORDER BY `id`;

SELECT
  `project_id`,
  `report_year`,
  `report_week`,
  COUNT(*) AS duplicate_count
FROM `project_weekly_reports`
GROUP BY `project_id`, `report_year`, `report_week`
HAVING COUNT(*) > 1;

SELECT
  `workflow_instance_id`,
  COUNT(*) AS duplicate_count
FROM `approval_records`
WHERE `workflow_instance_id` IS NOT NULL
  AND TRIM(`workflow_instance_id`) <> ''
GROUP BY `workflow_instance_id`
HAVING COUNT(*) > 1;

SELECT
  `status`,
  COUNT(*) AS report_count
FROM `project_weekly_reports`
GROUP BY `status`
ORDER BY `status`;


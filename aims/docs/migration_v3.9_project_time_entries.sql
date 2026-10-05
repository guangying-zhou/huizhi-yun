-- v3.9 项目级工时填报
-- 目标：
--   1. time_entries 支持直接挂 project_id，用于统计个人在项目中的贡献时长。
--   2. work_item_id 改为可空，保留任务执行页已有工作项级工时。

SET @has_project_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'time_entries'
    AND COLUMN_NAME = 'project_id'
);

SET @sql := IF(
  @has_project_id = 0,
  'ALTER TABLE `time_entries`
     ADD COLUMN `project_id` BIGINT UNSIGNED NULL COMMENT ''Aims项目ID，用于项目级贡献工时统计'' AFTER `id`,
     ADD KEY `idx_project_date` (`project_id`, `entry_date`)',
  'SELECT ''time_entries.project_id already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `time_entries` t
JOIN `work_items` w ON w.id = t.work_item_id
SET t.project_id = w.project_id
WHERE t.project_id IS NULL;

ALTER TABLE `time_entries`
  MODIFY COLUMN `project_id` BIGINT UNSIGNED NOT NULL COMMENT 'Aims项目ID，用于项目级贡献工时统计',
  MODIFY COLUMN `work_item_id` BIGINT UNSIGNED NULL COMMENT '可选工作项ID；任务执行工时保留该关联，项目日历填报为空';

SET @has_fk_time_project := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'time_entries'
    AND CONSTRAINT_NAME = 'fk_time_project'
);

SET @sql := IF(
  @has_fk_time_project = 0,
  'ALTER TABLE `time_entries`
     ADD CONSTRAINT `fk_time_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE',
  'SELECT ''time_entries.fk_time_project already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

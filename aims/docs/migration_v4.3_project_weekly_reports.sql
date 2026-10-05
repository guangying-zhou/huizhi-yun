-- v4.3 项目周报
-- 目标：
--   1. 项目经理按周填报项目主要工作、整体进展。
--   2. 按项目成员批量记录本周投入比例和项目经理认定工时。
--   3. 成员每日工时仍由成员自行填报，周报不再生成 time_entries。

CREATE TABLE IF NOT EXISTS `project_weekly_reports` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT '项目ID',
  `report_year` SMALLINT UNSIGNED NOT NULL COMMENT 'ISO周所属年份',
  `report_week` TINYINT UNSIGNED NOT NULL COMMENT 'ISO周序号(1-53)',
  `week_start` DATE NOT NULL COMMENT '周一',
  `week_end` DATE NOT NULL COMMENT '周日',
  `main_work` TEXT DEFAULT NULL COMMENT '本周主要工作',
  `overall_progress` TEXT DEFAULT NULL COMMENT '整体进展',
  `status` ENUM('draft','submitted') NOT NULL DEFAULT 'draft' COMMENT '周报状态',
  `created_by` VARCHAR(64) NOT NULL COMMENT '创建人uid',
  `updated_by` VARCHAR(64) DEFAULT NULL COMMENT '最后更新人uid',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_week` (`project_id`, `report_year`, `report_week`),
  KEY `idx_project_week_start` (`project_id`, `week_start`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_weekly_report_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目周报';

CREATE TABLE IF NOT EXISTS `project_weekly_report_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_id` BIGINT UNSIGNED NOT NULL COMMENT '项目周报ID',
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT '项目ID(冗余便于查询)',
  `uid` VARCHAR(64) NOT NULL COMMENT '成员UID',
  `allocation_percent` DECIMAL(5,2) NOT NULL DEFAULT 100.00 COMMENT '投入比例，100表示满投入',
  `hours` DECIMAL(6,2) NOT NULL DEFAULT 40.00 COMMENT '项目经理认定的本周投入工时',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_report_uid` (`report_id`, `uid`),
  KEY `idx_project_uid` (`project_id`, `uid`),
  CONSTRAINT `fk_weekly_entry_report` FOREIGN KEY (`report_id`) REFERENCES `project_weekly_reports` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_weekly_entry_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目周报成员投入';

SET @has_weekly_report_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'time_entries'
    AND COLUMN_NAME = 'weekly_report_id'
);

SET @sql := IF(
  @has_weekly_report_id = 0,
  'ALTER TABLE `time_entries`
     ADD COLUMN `weekly_report_id` BIGINT UNSIGNED NULL COMMENT ''历史周报生成记录关联；兼容字段，新逻辑不再写入'' AFTER `work_item_id`,
     ADD KEY `idx_weekly_report` (`weekly_report_id`)',
  'SELECT ''time_entries.weekly_report_id already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_fk_time_weekly_report := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'time_entries'
    AND CONSTRAINT_NAME = 'fk_time_weekly_report'
);

SET @sql := IF(
  @has_fk_time_weekly_report = 0,
  'ALTER TABLE `time_entries`
     ADD CONSTRAINT `fk_time_weekly_report` FOREIGN KEY (`weekly_report_id`) REFERENCES `project_weekly_reports` (`id`) ON DELETE CASCADE',
  'SELECT ''time_entries.fk_time_weekly_report already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

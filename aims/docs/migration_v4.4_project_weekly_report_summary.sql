-- v4.4 项目周报汇总与工作项明细
-- 目标：
--   1. 周报主表保存项目汇总导出所需的管理字段快照。
--   2. 新增周报工作项明细，支持项目经理手工填报，并为后续从项目日历/任务自动生成预留 source_type。
--   3. 成员每日工时仍由成员自行填报；项目经理认定工时继续保存在 project_weekly_report_entries。

DELIMITER $$

DROP PROCEDURE IF EXISTS `aims_add_weekly_report_column`$$
CREATE PROCEDURE `aims_add_weekly_report_column`(
  IN column_name VARCHAR(64),
  IN column_definition TEXT
)
BEGIN
  SET @column_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'project_weekly_reports'
      AND COLUMN_NAME = column_name
  );

  IF @column_exists = 0 THEN
    SET @sql := CONCAT('ALTER TABLE `project_weekly_reports` ADD COLUMN ', column_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL `aims_add_weekly_report_column`('department_name', '`department_name` VARCHAR(100) DEFAULT NULL COMMENT ''周报汇总口径：隶属部门/小组名称快照'' AFTER `overall_progress`');
CALL `aims_add_weekly_report_column`('project_type_name', '`project_type_name` VARCHAR(100) DEFAULT NULL COMMENT ''周报汇总口径：项目类型快照'' AFTER `department_name`');
CALL `aims_add_weekly_report_column`('project_manager_name', '`project_manager_name` VARCHAR(100) DEFAULT NULL COMMENT ''周报汇总口径：项目经理展示名快照'' AFTER `project_type_name`');
CALL `aims_add_weekly_report_column`('initiation_status', '`initiation_status` VARCHAR(100) DEFAULT NULL COMMENT ''周报汇总口径：立项情况'' AFTER `project_manager_name`');
CALL `aims_add_weekly_report_column`('current_stage', '`current_stage` VARCHAR(100) DEFAULT NULL COMMENT ''周报汇总口径：当前阶段'' AFTER `initiation_status`');
CALL `aims_add_weekly_report_column`('progress_status', '`progress_status` VARCHAR(100) DEFAULT NULL COMMENT ''周报汇总口径：进度情况'' AFTER `current_stage`');
CALL `aims_add_weekly_report_column`('completion_percent', '`completion_percent` DECIMAL(5,2) DEFAULT NULL COMMENT ''周报汇总口径：总体完成进度百分比'' AFTER `progress_status`');
CALL `aims_add_weekly_report_column`('contract_status', '`contract_status` VARCHAR(200) DEFAULT NULL COMMENT ''周报汇总口径：合同状态'' AFTER `completion_percent`');
CALL `aims_add_weekly_report_column`('contract_amount', '`contract_amount` DECIMAL(14,2) DEFAULT NULL COMMENT ''周报汇总口径：合同额'' AFTER `contract_status`');
CALL `aims_add_weekly_report_column`('payment_status', '`payment_status` VARCHAR(200) DEFAULT NULL COMMENT ''周报汇总口径：回款情况'' AFTER `contract_amount`');
CALL `aims_add_weekly_report_column`('cumulative_labor_cost', '`cumulative_labor_cost` DECIMAL(14,2) DEFAULT NULL COMMENT ''周报汇总口径：累计人力成本'' AFTER `payment_status`');
CALL `aims_add_weekly_report_column`('major_risks', '`major_risks` TEXT DEFAULT NULL COMMENT ''周报汇总口径：重大问题和风险'' AFTER `cumulative_labor_cost`');
CALL `aims_add_weekly_report_column`('coordination_needs', '`coordination_needs` TEXT DEFAULT NULL COMMENT ''周报汇总口径：待协调资源'' AFTER `major_risks`');
CALL `aims_add_weekly_report_column`('remarks', '`remarks` TEXT DEFAULT NULL COMMENT ''周报汇总口径：备注'' AFTER `coordination_needs`');

DROP PROCEDURE IF EXISTS `aims_add_weekly_report_column`;

CREATE TABLE IF NOT EXISTS `project_weekly_report_work_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_id` BIGINT UNSIGNED NOT NULL COMMENT '项目周报ID',
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT '项目ID(冗余便于查询)',
  `plan_type` VARCHAR(32) NOT NULL DEFAULT 'this_week' COMMENT '工作/计划类型：this_week=本周工作,next_week=下周计划',
  `source_type` VARCHAR(32) NOT NULL DEFAULT 'manual' COMMENT '来源：manual=手工,calendar=项目日历,task=项目任务',
  `work_item_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联工作项ID，自动生成时使用',
  `module_name` VARCHAR(200) DEFAULT NULL COMMENT '模块名称',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序号',
  `task_summary` TEXT NOT NULL COMMENT '任务简述',
  `owner_uid` VARCHAR(64) DEFAULT NULL COMMENT '责任人UID',
  `owner_name` VARCHAR(100) DEFAULT NULL COMMENT '责任人展示名快照',
  `completion_percent` DECIMAL(5,2) DEFAULT NULL COMMENT '完成度百分比',
  `incomplete_reason` TEXT DEFAULT NULL COMMENT '未完成情况说明',
  `workload_days` DECIMAL(6,2) DEFAULT NULL COMMENT '工作量（人日）',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_report_sort` (`report_id`, `sort_order`, `id`),
  KEY `idx_project_plan` (`project_id`, `plan_type`),
  KEY `idx_owner_uid` (`owner_uid`),
  KEY `idx_work_item_id` (`work_item_id`),
  CONSTRAINT `fk_weekly_work_item_report` FOREIGN KEY (`report_id`) REFERENCES `project_weekly_reports` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_weekly_work_item_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_weekly_work_item_work_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目周报工作项明细';

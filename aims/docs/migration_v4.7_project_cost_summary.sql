-- Aims migration v4.7: project cost summary for Goal 3 accounting.
-- Worklog facts remain in time_entries. This table stores rebuildable project
-- cost summaries for a period after Finance/People standard costs are supplied.

CREATE TABLE IF NOT EXISTS `project_cost_summary` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_code` VARCHAR(64) NOT NULL COMMENT 'Aims项目编号',
  `period_start` DATE NOT NULL COMMENT '核算期间开始',
  `period_end` DATE NOT NULL COMMENT '核算期间结束',
  `total_worklogs` INT NOT NULL DEFAULT 0 COMMENT '工时记录数',
  `total_hours` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '总工时',
  `labor_cost` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '人力成本',
  `outsourced_cost` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '外包成本',
  `other_cost` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '其他成本',
  `total_cost` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '总成本',
  `calculation_key` VARCHAR(160) NOT NULL COMMENT '幂等计算键',
  `source_version` VARCHAR(80) DEFAULT NULL COMMENT '人员/财务成本版本',
  `calculated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '计算时间',
  `version` INT NOT NULL DEFAULT 1 COMMENT '版本号',
  `is_current` TINYINT NOT NULL DEFAULT 1 COMMENT '是否当前版本',
  `detail_json` JSON DEFAULT NULL COMMENT '按人员/成本源聚合快照',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_cost_period_key` (`project_code`, `period_start`, `period_end`, `calculation_key`),
  KEY `idx_project_cost_current` (`project_code`, `period_start`, `period_end`, `is_current`),
  KEY `idx_project_cost_period` (`period_start`, `period_end`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='项目成本汇总，可按时间窗口重算';

SELECT COUNT(*) AS project_cost_summary_count
FROM `project_cost_summary`
WHERE `deleted_at` IS NULL;

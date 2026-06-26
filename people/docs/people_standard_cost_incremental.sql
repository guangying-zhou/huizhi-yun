-- ============================================
-- People standard cost incremental migration
-- 适用场景：已执行旧版 people_schema.sql 的租户库，补齐岗位/职级标准成本体系
-- 执行说明：
-- 1. 连接客户侧 People 数据库后执行本文件
-- 2. 不需要删除数据库或重建已有 People 表
-- 3. 若已手工创建同名列，可跳过对应 ALTER 段
-- ============================================
SET NAMES utf8mb4;
USE `hzy_people`;

CREATE TABLE IF NOT EXISTS `people_standard_cost_rates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rate_code` VARCHAR(64) NOT NULL COMMENT '标准成本规则编码',
  `rate_name` VARCHAR(120) NOT NULL COMMENT '规则名称',
  `position_code` VARCHAR(64) DEFAULT NULL COMMENT '适用岗位编码；为空表示不限定岗位',
  `position_name` VARCHAR(100) DEFAULT NULL,
  `rank_code` VARCHAR(32) DEFAULT NULL COMMENT '适用职级编码；为空表示不限定职级',
  `rank_name` VARCHAR(100) DEFAULT NULL,
  `rank_series` ENUM('M', 'P') NOT NULL DEFAULT 'P' COMMENT '职级序列：M 管理序列，P 专业序列',
  `rank_level` INT NOT NULL DEFAULT 0 COMMENT '职级层级',
  `rank_salary` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '职级工资',
  `performance_salary_min` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '绩效工资下限',
  `performance_salary_max` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '绩效工资上限',
  `employment_type` ENUM('full_time', 'part_time', 'outsourced', 'intern', 'agent') DEFAULT NULL COMMENT '适用用工类型；为空表示不限定',
  `cost_center_code` VARCHAR(64) DEFAULT NULL COMMENT '适用成本中心；为空表示不限定',
  `effective_from` DATE NOT NULL COMMENT '生效日期',
  `effective_to` DATE DEFAULT NULL COMMENT '失效日期',
  `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
  `direct_labor_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '直接人工月成本',
  `benefit_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '社保福利等月成本',
  `management_allocation_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '管理分摊月成本',
  `resource_allocation_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '办公、设备、资源等月分摊成本',
  `other_allocation_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '其他月分摊成本',
  `monthly_standard_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '项目核算使用的月标准成本，原则上包含直接人工和各项分摊',
  `source_app` VARCHAR(64) DEFAULT NULL,
  `source_biz_type` VARCHAR(64) DEFAULT NULL,
  `source_biz_id` VARCHAR(128) DEFAULT NULL,
  `source_refs` JSON DEFAULT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `remarks` VARCHAR(500) DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_standard_cost_rate_code` (`rate_code`),
  KEY `idx_people_standard_cost_lookup` (`enabled`, `position_code`, `rank_code`, `employment_type`, `cost_center_code`, `effective_from`, `effective_to`),
  KEY `idx_people_standard_cost_rank_series` (`rank_series`, `rank_level`, `enabled`),
  KEY `idx_people_standard_cost_position_rank` (`position_code`, `rank_code`, `enabled`),
  KEY `idx_people_standard_cost_source` (`source_app`, `source_biz_type`, `source_biz_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 岗位/职级标准成本规则';

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `people_standard_cost_rates` ADD COLUMN `rank_series` ENUM(''M'', ''P'') NOT NULL DEFAULT ''P'' COMMENT ''职级序列：M 管理序列，P 专业序列'' AFTER `rank_name`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_standard_cost_rates'
    AND COLUMN_NAME = 'rank_series'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `people_standard_cost_rates` ADD COLUMN `rank_level` INT NOT NULL DEFAULT 0 COMMENT ''职级层级'' AFTER `rank_series`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_standard_cost_rates'
    AND COLUMN_NAME = 'rank_level'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `people_standard_cost_rates` ADD COLUMN `rank_salary` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT ''职级工资'' AFTER `rank_level`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_standard_cost_rates'
    AND COLUMN_NAME = 'rank_salary'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `people_standard_cost_rates` ADD COLUMN `performance_salary_min` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT ''绩效工资下限'' AFTER `rank_salary`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_standard_cost_rates'
    AND COLUMN_NAME = 'performance_salary_min'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `people_standard_cost_rates` ADD COLUMN `performance_salary_max` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT ''绩效工资上限'' AFTER `performance_salary_min`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_standard_cost_rates'
    AND COLUMN_NAME = 'performance_salary_max'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `people_standard_cost_rates` ADD KEY `idx_people_standard_cost_rank_series` (`rank_series`, `rank_level`, `enabled`)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_standard_cost_rates'
    AND INDEX_NAME = 'idx_people_standard_cost_rank_series'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE `people_cost_snapshots`
  MODIFY COLUMN `cost_source` ENUM('standard_rate', 'employee_standard', 'assignment', 'finance_adjustment', 'import', 'manual') NOT NULL DEFAULT 'standard_rate';

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `people_cost_snapshots` ADD COLUMN `cost_basis` ENUM(''standard'', ''actual'', ''manual_adjusted'') NOT NULL DEFAULT ''standard'' COMMENT ''本快照用于核算的成本口径'' AFTER `cost_source`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_cost_snapshots'
    AND COLUMN_NAME = 'cost_basis'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `people_cost_snapshots` ADD COLUMN `standard_rate_code` VARCHAR(64) DEFAULT NULL COMMENT ''生成快照时匹配的标准成本规则'' AFTER `cost_basis`',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_cost_snapshots'
    AND COLUMN_NAME = 'standard_rate_code'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `people_cost_snapshots` ADD KEY `idx_people_cost_basis` (`cost_basis`, `standard_rate_code`)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_cost_snapshots'
    AND INDEX_NAME = 'idx_people_cost_basis'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO `people_ranks` (`rank_code`, `rank_name`, `rank_level`, `sort_order`)
VALUES
  ('M1', '管理 M1', 101, 10),
  ('M2', '管理 M2', 102, 20),
  ('M3', '管理 M3', 103, 30),
  ('M4', '管理 M4', 104, 40),
  ('M5', '管理 M5', 105, 50),
  ('P1', '专业 P1', 1, 110),
  ('P2', '专业 P2', 2, 120),
  ('P3', '专业 P3', 3, 130),
  ('P4', '专业 P4', 4, 140),
  ('P5', '专业 P5', 5, 150),
  ('P6', '专业 P6', 6, 160),
  ('P7', '专业 P7', 7, 170),
  ('P8', '专业 P8', 8, 180),
  ('P9', '专业 P9', 9, 190),
  ('P10', '专业 P10', 10, 200)
ON DUPLICATE KEY UPDATE
  `rank_name` = VALUES(`rank_name`),
  `rank_level` = VALUES(`rank_level`),
  `sort_order` = VALUES(`sort_order`);

UPDATE `people_standard_cost_rates`
SET `enabled` = 0,
    `remarks` = COALESCE(`remarks`, '历史岗位标准成本示例已被 M/P 职级设置取代')
WHERE `source_biz_type` = 'baseline'
  AND `position_code` IS NOT NULL
  AND `position_code` <> '';

INSERT INTO `people_standard_cost_rates` (
  `rate_code`, `rate_name`, `rank_code`, `rank_name`, `rank_series`, `rank_level`,
  `rank_salary`, `performance_salary_min`, `performance_salary_max`,
  `effective_from`, `currency`, `monthly_standard_cost`, `source_app`, `source_biz_type`, `source_biz_id`, `sort_order`
)
VALUES
  ('SCR-M1-2026', '管理 M1 职级设置', 'M1', '管理 M1', 'M', 1, 7000.00, 4000.00, 8000.00, '2026-01-01', 'CNY', 34760.00, 'people', 'rank_standard', '2026', 10),
  ('SCR-M2-2026', '管理 M2 职级设置', 'M2', '管理 M2', 'M', 2, 10000.00, 6000.00, 10000.00, '2026-01-01', 'CNY', 42560.00, 'people', 'rank_standard', '2026', 20),
  ('SCR-M3-2026', '管理 M3 职级设置', 'M3', '管理 M3', 'M', 3, 14000.00, 8000.00, 14000.00, '2026-01-01', 'CNY', 53480.00, 'people', 'rank_standard', '2026', 30),
  ('SCR-M4-2026', '管理 M4 职级设置', 'M4', '管理 M4', 'M', 4, 18000.00, 12000.00, 18000.00, '2026-01-01', 'CNY', 65960.00, 'people', 'rank_standard', '2026', 40),
  ('SCR-M5-2026', '管理 M5 职级设置', 'M5', '管理 M5', 'M', 5, 24000.00, 16000.00, 24000.00, '2026-01-01', 'CNY', 83120.00, 'people', 'rank_standard', '2026', 50),
  ('SCR-P1-2026', '专业 P1 职级设置', 'P1', '专业 P1', 'P', 1, 1000.00, 0.00, 2000.00, '2026-01-01', 'CNY', 17600.00, 'people', 'rank_standard', '2026', 110),
  ('SCR-P2-2026', '专业 P2 职级设置', 'P2', '专业 P2', 'P', 2, 2500.00, 1000.00, 3000.00, '2026-01-01', 'CNY', 21500.00, 'people', 'rank_standard', '2026', 120),
  ('SCR-P3-2026', '专业 P3 职级设置', 'P3', '专业 P3', 'P', 3, 4000.00, 2000.00, 5000.00, '2026-01-01', 'CNY', 26180.00, 'people', 'rank_standard', '2026', 130),
  ('SCR-P4-2026', '专业 P4 职级设置', 'P4', '专业 P4', 'P', 4, 6000.00, 3000.00, 7000.00, '2026-01-01', 'CNY', 31640.00, 'people', 'rank_standard', '2026', 140),
  ('SCR-P5-2026', '专业 P5 职级设置', 'P5', '专业 P5', 'P', 5, 7500.00, 4000.00, 8000.00, '2026-01-01', 'CNY', 35540.00, 'people', 'rank_standard', '2026', 150),
  ('SCR-P6-2026', '专业 P6 职级设置', 'P6', '专业 P6', 'P', 6, 9000.00, 5000.00, 9000.00, '2026-01-01', 'CNY', 39440.00, 'people', 'rank_standard', '2026', 160),
  ('SCR-P7-2026', '专业 P7 职级设置', 'P7', '专业 P7', 'P', 7, 12000.00, 7000.00, 13000.00, '2026-01-01', 'CNY', 48800.00, 'people', 'rank_standard', '2026', 170),
  ('SCR-P8-2026', '专业 P8 职级设置', 'P8', '专业 P8', 'P', 8, 16000.00, 10000.00, 16000.00, '2026-01-01', 'CNY', 59720.00, 'people', 'rank_standard', '2026', 180),
  ('SCR-P9-2026', '专业 P9 职级设置', 'P9', '专业 P9', 'P', 9, 21000.00, 14000.00, 22000.00, '2026-01-01', 'CNY', 75320.00, 'people', 'rank_standard', '2026', 190),
  ('SCR-P10-2026', '专业 P10 职级设置', 'P10', '专业 P10', 'P', 10, 28000.00, 18000.00, 30000.00, '2026-01-01', 'CNY', 95600.00, 'people', 'rank_standard', '2026', 200)
ON DUPLICATE KEY UPDATE
  `rate_name` = VALUES(`rate_name`),
  `rank_name` = VALUES(`rank_name`),
  `rank_series` = VALUES(`rank_series`),
  `rank_level` = VALUES(`rank_level`),
  `rank_salary` = VALUES(`rank_salary`),
  `performance_salary_min` = VALUES(`performance_salary_min`),
  `performance_salary_max` = VALUES(`performance_salary_max`),
  `monthly_standard_cost` = VALUES(`monthly_standard_cost`),
  `enabled` = 1;

-- ============================================
-- People MVP - 人员事实、任职、岗位/职级标准成本与项目贡献绩效
-- 数据库名: hzy_people
-- 执行说明:
-- 1. 创建或选择客户侧 People 数据库后执行本文件
-- 2. data-runtime 需启用 HZY_PEOPLE_AGENT_ENABLED=true
-- 3. People 只保存人员运营事实和跨模块稳定键，不复制 Aims/Codocs/Finance 源数据
-- ============================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `hzy_people` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `hzy_people`;

CREATE TABLE IF NOT EXISTS `people_positions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `position_code` VARCHAR(64) NOT NULL COMMENT '岗位编码',
  `position_name` VARCHAR(100) NOT NULL COMMENT '岗位名称',
  `job_family` VARCHAR(64) DEFAULT NULL COMMENT '岗位族，如研发/交付/销售/财务',
  `description` VARCHAR(255) DEFAULT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_position_code` (`position_code`),
  KEY `idx_people_position_family` (`job_family`, `enabled`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 岗位字典';

CREATE TABLE IF NOT EXISTS `people_ranks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rank_code` VARCHAR(32) NOT NULL COMMENT '职级编码，如 P6/P7',
  `rank_name` VARCHAR(100) NOT NULL COMMENT '职级名称',
  `rank_level` INT NOT NULL DEFAULT 0 COMMENT '职级排序层级',
  `description` VARCHAR(255) DEFAULT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_rank_code` (`rank_code`),
  KEY `idx_people_rank_level` (`rank_level`, `enabled`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 职级字典';

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
  `direct_labor_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '历史兼容：直接人工月成本',
  `benefit_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '历史兼容：社保福利等月成本',
  `management_allocation_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '历史兼容：管理分摊月成本',
  `resource_allocation_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '历史兼容：办公、设备、资源等月分摊成本',
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

CREATE TABLE IF NOT EXISTS `people_employees` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `employee_uid` VARCHAR(64) NOT NULL COMMENT 'Console Directory uid 或可映射稳定 UID',
  `employee_no` VARCHAR(64) NOT NULL COMMENT '工号',
  `display_name` VARCHAR(100) NOT NULL COMMENT '姓名',
  `initials` VARCHAR(16) DEFAULT NULL,
  `login_name` VARCHAR(100) DEFAULT NULL,
  `employment_status` ENUM('active', 'leaving', 'left', 'inactive') NOT NULL DEFAULT 'active',
  `employment_type` ENUM('full_time', 'part_time', 'outsourced', 'intern', 'agent') NOT NULL DEFAULT 'full_time',
  `dept_code` VARCHAR(64) DEFAULT NULL COMMENT 'Console dept_code',
  `dept_name` VARCHAR(100) DEFAULT NULL,
  `position_code` VARCHAR(64) DEFAULT NULL,
  `position_name` VARCHAR(100) DEFAULT NULL,
  `rank_code` VARCHAR(32) DEFAULT NULL,
  `rank_name` VARCHAR(100) DEFAULT NULL,
  `manager_uid` VARCHAR(64) DEFAULT NULL,
  `onboard_date` DATE DEFAULT NULL,
  `leave_date` DATE DEFAULT NULL,
  `work_location` VARCHAR(100) DEFAULT NULL,
  `cost_center_code` VARCHAR(64) DEFAULT NULL,
  `monthly_standard_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '当前月标准成本冗余值，通常由标准成本规则生成',
  `metadata` JSON DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `archived_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_employee_uid` (`employee_uid`),
  UNIQUE KEY `uk_people_employee_no` (`employee_no`),
  KEY `idx_people_employee_status` (`employment_status`),
  KEY `idx_people_employee_dept` (`dept_code`),
  KEY `idx_people_employee_position` (`position_code`),
  KEY `idx_people_employee_rank` (`rank_code`),
  KEY `idx_people_employee_manager` (`manager_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 员工最小事实';

CREATE TABLE IF NOT EXISTS `people_assignments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `assignment_code` VARCHAR(64) NOT NULL,
  `employee_uid` VARCHAR(64) NOT NULL,
  `change_type` ENUM('onboard', 'transfer', 'rank_change', 'leave') NOT NULL,
  `effective_from` DATE NOT NULL,
  `effective_to` DATE DEFAULT NULL,
  `dept_code` VARCHAR(64) DEFAULT NULL,
  `dept_name` VARCHAR(100) DEFAULT NULL,
  `position_code` VARCHAR(64) DEFAULT NULL,
  `position_name` VARCHAR(100) DEFAULT NULL,
  `rank_code` VARCHAR(32) DEFAULT NULL,
  `rank_name` VARCHAR(100) DEFAULT NULL,
  `manager_uid` VARCHAR(64) DEFAULT NULL,
  `workflow_instance_id` VARCHAR(128) DEFAULT NULL,
  `approval_status` ENUM('none', 'draft', 'pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'none',
  `source_app` VARCHAR(64) DEFAULT NULL,
  `source_biz_type` VARCHAR(64) DEFAULT NULL,
  `source_biz_id` VARCHAR(128) DEFAULT NULL,
  `remarks` VARCHAR(500) DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_assignment_code` (`assignment_code`),
  KEY `idx_people_assignment_employee` (`employee_uid`, `effective_from`),
  KEY `idx_people_assignment_current` (`employee_uid`, `effective_to`),
  KEY `idx_people_assignment_workflow` (`workflow_instance_id`),
  KEY `idx_people_assignment_source` (`source_app`, `source_biz_type`, `source_biz_id`),
  CONSTRAINT `fk_people_assignment_employee` FOREIGN KEY (`employee_uid`) REFERENCES `people_employees` (`employee_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 任职快照与入转调离记录';

CREATE TABLE IF NOT EXISTS `people_cost_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `snapshot_code` VARCHAR(64) NOT NULL,
  `employee_uid` VARCHAR(64) NOT NULL,
  `period_month` CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  `standard_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `actual_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
  `cost_source` ENUM('standard_rate', 'employee_standard', 'assignment', 'finance_adjustment', 'import', 'manual') NOT NULL DEFAULT 'standard_rate',
  `cost_basis` ENUM('standard', 'actual', 'manual_adjusted') NOT NULL DEFAULT 'standard' COMMENT '本快照用于核算的成本口径',
  `standard_rate_code` VARCHAR(64) DEFAULT NULL COMMENT '生成快照时匹配的标准成本规则',
  `source_app` VARCHAR(64) DEFAULT NULL,
  `source_biz_type` VARCHAR(64) DEFAULT NULL,
  `source_biz_id` VARCHAR(128) DEFAULT NULL,
  `source_refs` JSON DEFAULT NULL,
  `confirmed_at` DATETIME DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_cost_employee_month` (`employee_uid`, `period_month`),
  UNIQUE KEY `uk_people_cost_snapshot_code` (`snapshot_code`),
  KEY `idx_people_cost_month` (`period_month`),
  KEY `idx_people_cost_basis` (`cost_basis`, `standard_rate_code`),
  KEY `idx_people_cost_source` (`source_app`, `source_biz_type`, `source_biz_id`),
  CONSTRAINT `fk_people_cost_employee` FOREIGN KEY (`employee_uid`) REFERENCES `people_employees` (`employee_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 月度成本快照';

CREATE TABLE IF NOT EXISTS `people_performance_cycles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cycle_code` VARCHAR(64) NOT NULL,
  `cycle_name` VARCHAR(120) NOT NULL,
  `cycle_type` ENUM('month', 'quarter', 'project', 'annual') NOT NULL DEFAULT 'quarter',
  `scope_type` ENUM('org', 'team', 'project') NOT NULL DEFAULT 'project',
  `project_code` VARCHAR(191) DEFAULT NULL COMMENT 'Aims/Console project_code',
  `period_start` DATE NOT NULL,
  `period_end` DATE NOT NULL,
  `status` ENUM('draft', 'collecting', 'calculating', 'confirmed', 'closed', 'cancelled') NOT NULL DEFAULT 'draft',
  `workflow_instance_id` VARCHAR(128) DEFAULT NULL,
  `confirmed_at` DATETIME DEFAULT NULL,
  `closed_at` DATETIME DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_cycle_code` (`cycle_code`),
  KEY `idx_people_cycle_project` (`project_code`),
  KEY `idx_people_cycle_status` (`status`, `period_end`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 绩效周期';

CREATE TABLE IF NOT EXISTS `people_contribution_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contribution_code` VARCHAR(64) NOT NULL,
  `cycle_code` VARCHAR(64) NOT NULL,
  `employee_uid` VARCHAR(64) NOT NULL,
  `project_code` VARCHAR(191) DEFAULT NULL,
  `role_code` VARCHAR(64) DEFAULT NULL,
  `work_hours` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `contribution_score` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `source_app` VARCHAR(64) NOT NULL DEFAULT 'aims',
  `source_biz_type` VARCHAR(64) NOT NULL DEFAULT '',
  `source_biz_id` VARCHAR(128) NOT NULL DEFAULT '',
  `source_refs` JSON DEFAULT NULL,
  `captured_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `confirmed_at` DATETIME DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_contribution_code` (`contribution_code`),
  UNIQUE KEY `uk_people_contribution_source` (`cycle_code`, `employee_uid`, `source_app`, `source_biz_type`, `source_biz_id`),
  KEY `idx_people_contribution_cycle` (`cycle_code`),
  KEY `idx_people_contribution_employee` (`employee_uid`),
  KEY `idx_people_contribution_project` (`project_code`),
  CONSTRAINT `fk_people_contribution_cycle` FOREIGN KEY (`cycle_code`) REFERENCES `people_performance_cycles` (`cycle_code`),
  CONSTRAINT `fk_people_contribution_employee` FOREIGN KEY (`employee_uid`) REFERENCES `people_employees` (`employee_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 项目贡献快照';

CREATE TABLE IF NOT EXISTS `people_documents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `document_code` VARCHAR(64) NOT NULL,
  `employee_uid` VARCHAR(64) DEFAULT NULL,
  `cycle_code` VARCHAR(64) DEFAULT NULL,
  `project_code` VARCHAR(191) DEFAULT NULL,
  `document_uuid` VARCHAR(128) NOT NULL COMMENT 'Codocs uuid',
  `document_title` VARCHAR(255) DEFAULT NULL,
  `document_type` VARCHAR(64) NOT NULL DEFAULT 'reference',
  `source_app` VARCHAR(64) NOT NULL DEFAULT 'codocs',
  `source_biz_type` VARCHAR(64) DEFAULT NULL,
  `source_biz_id` VARCHAR(128) DEFAULT NULL,
  `tags` JSON DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_document_code` (`document_code`),
  UNIQUE KEY `uk_people_document_ref` (`document_uuid`, `employee_uid`, `cycle_code`, `project_code`),
  KEY `idx_people_document_employee` (`employee_uid`),
  KEY `idx_people_document_cycle` (`cycle_code`),
  KEY `idx_people_document_project` (`project_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 文档引用';

INSERT INTO `people_positions` (`position_code`, `position_name`, `job_family`, `description`, `sort_order`)
VALUES
  ('architect', '架构师', '研发', '系统架构与技术方案负责人', 10),
  ('frontend_engineer', '前端工程师', '研发', '前端产品研发与交付', 20),
  ('delivery_pm', '交付项目经理', '交付', '客户交付项目管理', 30)
ON DUPLICATE KEY UPDATE `position_name` = VALUES(`position_name`), `job_family` = VALUES(`job_family`), `description` = VALUES(`description`);

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
ON DUPLICATE KEY UPDATE `rank_name` = VALUES(`rank_name`), `rank_level` = VALUES(`rank_level`);

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

SET FOREIGN_KEY_CHECKS = 1;

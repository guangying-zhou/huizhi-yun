-- ============================================================
-- Aims 数据库变更脚本 v1.2
-- 基线: aims_schema.sql 初版 (2026-03-21)
-- 目标: aims_schema.sql 当前版 (2026-03-26)
-- 数据库: hzy_aims
--
-- 变更内容:
--   1. 新增 project_portfolios 表（项目集）
--   2. aims_projects 新增字段: portfolio_id, domain_code, customer_code,
--      module_config, opp_id, contract_id
--   3. milestones 新增字段: mode, pivr_stage, payment_term_id,
--      deliverables, recurrence_rule
--   4. work_items 新增字段: milestone_id(NOT NULL), weight
--   5. workflow_transitions 扩展 entity_type 枚举 + 里程碑种子数据
--   6. user_favorite_projects 表（如已存在则跳过）
--
-- 注意:
--   - work_items.milestone_id 为 NOT NULL，执行前必须确保
--     已有 milestones 数据，或库中无 work_items 数据
--   - 建议先备份再执行
-- ============================================================

USE `hzy_aims`;

-- ============================================================
-- 1. 新增 project_portfolios 表
-- ============================================================
CREATE TABLE IF NOT EXISTS `project_portfolios` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(200) NOT NULL COMMENT '项目集名称',
  `description` TEXT DEFAULT NULL COMMENT '项目集描述',
  `domain_code` VARCHAR(50) DEFAULT NULL COMMENT '业务领域(关联Account business_domains)',
  `owner_uid` VARCHAR(64) DEFAULT NULL COMMENT '项目集负责人(关联Account)',
  `dept_code` VARCHAR(50) DEFAULT NULL COMMENT '所属部门(关联Account)',
  `is_product_line` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否为产品线(1=产品线, 新建子项目自动归类为产品研发)',
  `status` ENUM('active','archived') NOT NULL DEFAULT 'active' COMMENT '项目集状态',
  `created_by` VARCHAR(64) NOT NULL COMMENT '创建人uid',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_domain_code` (`domain_code`),
  KEY `idx_owner_uid` (`owner_uid`),
  KEY `idx_dept_code` (`dept_code`),
  KEY `idx_is_product_line` (`is_product_line`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目集(项目组合管理)';

-- ============================================================
-- 2. aims_projects 新增字段
-- ============================================================

-- 2.1 项目集关联
ALTER TABLE `aims_projects`
  ADD COLUMN `portfolio_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属项目集' AFTER `lifecycle_status`,
  ADD COLUMN `domain_code` VARCHAR(50) DEFAULT NULL COMMENT '业务领域(关联Account business_domains)' AFTER `portfolio_id`,
  ADD KEY `idx_portfolio` (`portfolio_id`),
  ADD KEY `idx_domain_code` (`domain_code`),
  ADD CONSTRAINT `fk_project_portfolio` FOREIGN KEY (`portfolio_id`) REFERENCES `project_portfolios` (`id`) ON DELETE SET NULL;

-- 2.2 客户编码（Altoc 提供）
ALTER TABLE `aims_projects`
  ADD COLUMN `customer_code` VARCHAR(100) DEFAULT NULL COMMENT '客户编码(关联Altoc customer.code)' AFTER `end_date`,
  ADD KEY `idx_customer_code` (`customer_code`);

-- 2.3 模块开关
ALTER TABLE `aims_projects`
  ADD COLUMN `module_config` JSON DEFAULT NULL COMMENT '模块开关(milestones_enabled/process_audit_enabled等)' AFTER `workflow_instance_id`;

-- 2.4 Altoc 经营侧桥接字段（逻辑关联，非外键）
ALTER TABLE `aims_projects`
  ADD COLUMN `opp_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联Altoc商机ID(逻辑关联, 非外键)' AFTER `end_date`,
  ADD COLUMN `contract_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联Altoc合同ID(逻辑关联, 非外键)' AFTER `opp_id`,
  ADD KEY `idx_opp_id` (`opp_id`),
  ADD KEY `idx_contract_id` (`contract_id`);

-- ============================================================
-- 3. milestones 新增字段
-- ============================================================

-- 3.1 里程碑模式
ALTER TABLE `milestones`
  ADD COLUMN `mode` ENUM('strong_constraint','rolling_plan','periodic') NOT NULL DEFAULT 'rolling_plan' COMMENT '里程碑模式' AFTER `description`,
  ADD KEY `idx_project_mode` (`project_id`, `mode`);

-- 3.2 PIVR 阶段标签（仅交付/定制类项目使用）
ALTER TABLE `milestones`
  ADD COLUMN `pivr_stage` ENUM('P','I','V','R') DEFAULT NULL COMMENT 'PIVR阶段标签(仅交付/定制类项目, NULL=不适用)' AFTER `status`;

-- 3.3 Altoc 回款条款关联（逻辑关联，非外键）
ALTER TABLE `milestones`
  ADD COLUMN `payment_term_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联Altoc contract_payment_term.id(逻辑关联, 非外键)' AFTER `pivr_stage`;

-- 3.4 交付物检查清单 + 周期规则
ALTER TABLE `milestones`
  ADD COLUMN `deliverables` JSON DEFAULT NULL COMMENT '交付物检查清单(强约束模式), [{name,required,completed}]' AFTER `payment_term_id`,
  ADD COLUMN `recurrence_rule` VARCHAR(100) DEFAULT NULL COMMENT '周期规则(periodic模式, 如 monthly/weekly/quarterly)' AFTER `deliverables`;

-- ============================================================
-- 4. work_items 新增字段
-- ============================================================

-- 4.1 权重字段
ALTER TABLE `work_items`
  ADD COLUMN `weight` SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '权重(用于里程碑进度Roll-up计算)' AFTER `severity`;

-- 4.2 里程碑关联（NOT NULL — 需先确保有里程碑数据）
-- 步骤: 先加 nullable 列 → 回填数据 → 再改为 NOT NULL

-- 步骤 a: 加 nullable 列
ALTER TABLE `work_items`
  ADD COLUMN `milestone_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属里程碑(必填, 工作项一级容器)' AFTER `project_id`,
  ADD KEY `idx_milestone` (`milestone_id`);

-- 步骤 b: 回填数据（将已有工作项关联到对应项目的第一个里程碑）
-- !! 根据实际情况调整回填逻辑 !!
UPDATE `work_items` wi
  JOIN (
    SELECT project_id, MIN(id) AS first_milestone_id
    FROM `milestones`
    GROUP BY project_id
  ) m ON m.project_id = wi.project_id
SET wi.milestone_id = m.first_milestone_id
WHERE wi.milestone_id IS NULL;

-- 步骤 c: 如果还有孤儿工作项（项目没有里程碑），为其创建默认里程碑
-- 检查是否有未回填的工作项:
-- SELECT DISTINCT project_id FROM work_items WHERE milestone_id IS NULL;
-- 如有，手动为这些项目创建里程碑后再执行步骤 d

-- 步骤 d: 改为 NOT NULL + 加外键
ALTER TABLE `work_items`
  MODIFY COLUMN `milestone_id` BIGINT UNSIGNED NOT NULL COMMENT '所属里程碑(必填, 工作项一级容器)',
  ADD CONSTRAINT `fk_item_milestone` FOREIGN KEY (`milestone_id`) REFERENCES `milestones` (`id`) ON DELETE RESTRICT;

-- ============================================================
-- 5. workflow_transitions 扩展 entity_type
-- ============================================================

-- MySQL 的 ENUM 修改需要重新定义完整值域
ALTER TABLE `workflow_transitions`
  MODIFY COLUMN `entity_type` ENUM('project','milestone','requirement','task','bug') NOT NULL;

-- 插入里程碑状态转换规则（忽略已存在的记录）
INSERT IGNORE INTO `workflow_transitions` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`) VALUES
(NULL, 'milestone', 'planning', 'active', 'start'),
(NULL, 'milestone', 'active', 'completed', 'complete'),
(NULL, 'milestone', 'completed', 'active', 'reopen');

-- ============================================================
-- 6. user_favorite_projects 表（如未建）
-- ============================================================
CREATE TABLE IF NOT EXISTS `user_favorite_projects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` VARCHAR(64) NOT NULL COMMENT '用户UID',
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT '项目ID',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_uid_project` (`uid`, `project_id`),
  KEY `idx_uid` (`uid`),
  CONSTRAINT `fk_fav_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户常用项目';

-- ============================================================
-- 完成
-- ============================================================
-- 验证:
--   SELECT COUNT(*) FROM work_items WHERE milestone_id IS NULL;
--   -- 应返回 0
--
--   SHOW COLUMNS FROM aims_projects LIKE 'opp_id';
--   SHOW COLUMNS FROM milestones LIKE 'pivr_stage';

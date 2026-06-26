-- ============================================================
-- Aims (汇智云·项目) 数据库 Schema
-- 数据库名: hzy_aims
-- 创建日期: 2026-03-21
-- 更新日期: 2026-06-26
-- 说明:
--   1. Aims 项目是独立业务实体，不是 Account 项目的扩展
--   2. 与 Account 的 GitLab 仓库通过 aims_project_repos 表 N:M 关联
--   3. project_code 兼作工作项编号前缀(如 HZY-123)和 Git 提交关联
--   4. 所有表通过 project_id 关联 aims_projects.id
--   5. 三层驱动架构: 里程碑(计划层) → 目标/工作项(目标层) → 任务(执行层)
--   6. 里程碑是工作项的一级容器(milestone_id 必填)
-- ============================================================

CREATE DATABASE IF NOT EXISTS `hzy_aims` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `hzy_aims`;

-- ============================================================
-- 1. 项目集表 (项目组合管理)
-- ============================================================
CREATE TABLE IF NOT EXISTS `project_portfolios` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL COMMENT '项目集编码(全局唯一大写短码, 如 ZHZW)',
  `name` VARCHAR(200) NOT NULL COMMENT '项目集名称',
  `description` TEXT DEFAULT NULL COMMENT '项目集描述',
  `domain_code` VARCHAR(50) DEFAULT NULL COMMENT '业务领域(关联Account business_domains)',
  `owner_uid` VARCHAR(64) DEFAULT NULL COMMENT '项目集负责人(关联Account)',
  `dept_code` VARCHAR(50) DEFAULT NULL COMMENT '所属部门(关联Account)',
  `git_group` VARCHAR(200) DEFAULT NULL COMMENT 'GitLab群组路径(如 myorg/frontend)',
  `is_product_line` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否为产品线(1=产品线, 新建子项目自动归类为产品研发)',
  `display_order` INT NOT NULL DEFAULT 0 COMMENT '显示顺序(由小到大排序)',
  `status` ENUM('active','archived') NOT NULL DEFAULT 'active' COMMENT '项目集状态',
  `created_by` VARCHAR(64) NOT NULL COMMENT '创建人uid',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_portfolio_code` (`code`),
  KEY `idx_domain_code` (`domain_code`),
  KEY `idx_owner_uid` (`owner_uid`),
  KEY `idx_dept_code` (`dept_code`),
  KEY `idx_is_product_line` (`is_product_line`),
  KEY `idx_display_order` (`display_order`, `id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目集(项目组合管理)';

-- ============================================================
-- 1.1 项目模板集与版本表
-- ============================================================
CREATE TABLE IF NOT EXISTS `project_template_sets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(100) NOT NULL COMMENT '模板集编码(同分类内可读短码)',
  `name` VARCHAR(200) NOT NULL COMMENT '模板集名称',
  `category` ENUM('product_dev','custom_dev','delivery','maintenance','sales','presales','improvement','compliance') NOT NULL COMMENT '适用项目分类',
  `description` TEXT DEFAULT NULL COMMENT '模板集说明',
  `is_system` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否系统内置模板集',
  `created_by` VARCHAR(64) NOT NULL COMMENT '创建人uid',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_template_set_code` (`code`),
  KEY `idx_project_template_set_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目模板集';

CREATE TABLE IF NOT EXISTS `project_template_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `template_set_id` BIGINT UNSIGNED NOT NULL COMMENT '所属模板集',
  `version_no` INT UNSIGNED NOT NULL COMMENT '版本序号(模板集内递增)',
  `version_label` VARCHAR(100) NOT NULL COMMENT '版本标签(如 v1 / 2026Q2)',
  `status` ENUM('draft','published','archived') NOT NULL DEFAULT 'draft' COMMENT '版本状态',
  `notes` TEXT DEFAULT NULL COMMENT '版本说明',
  `definition_json` JSON NOT NULL COMMENT '模板定义快照(JSON, 含里程碑/工作项/交付物要求)',
  `published_at` DATETIME DEFAULT NULL COMMENT '发布时间',
  `published_by` VARCHAR(64) DEFAULT NULL COMMENT '发布人uid',
  `archived_at` DATETIME DEFAULT NULL COMMENT '归档时间',
  `archived_by` VARCHAR(64) DEFAULT NULL COMMENT '归档人uid',
  `created_by` VARCHAR(64) NOT NULL COMMENT '创建人uid',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_template_version` (`template_set_id`, `version_no`),
  KEY `idx_project_template_version_status` (`status`),
  CONSTRAINT `fk_project_template_version_set` FOREIGN KEY (`template_set_id`) REFERENCES `project_template_sets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目模板版本';

-- ============================================================
-- 2. 项目主表
-- ============================================================
-- 项目分类:
--   技术类(MVP): product_dev, custom_dev, delivery, maintenance
--   经营类(预留): sales, presales
--   管理类(预留): improvement, compliance
--
-- 生命周期状态流转:
--   draft → approval_pending → active ⇄ paused → completed → archived
CREATE TABLE IF NOT EXISTS `aims_projects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_code` VARCHAR(50) NOT NULL COMMENT '项目编码(全局唯一大写短码, 兼作工作项编号前缀, 如 HZY)',
  `name` VARCHAR(200) NOT NULL COMMENT '项目名称',
  `short_name` VARCHAR(50) NOT NULL COMMENT '项目简称(如 汇智云)',
  `internal_code` VARCHAR(50) DEFAULT NULL COMMENT '内部代号(如 Project-X)',
  `description` TEXT DEFAULT NULL COMMENT '项目描述',
  `category` ENUM('product_dev','custom_dev','delivery','maintenance','sales','presales','improvement','compliance') NOT NULL DEFAULT 'product_dev' COMMENT '项目分类',
  `methodology` ENUM('PIVR','agile','waterfall','kanban','hybrid') NOT NULL DEFAULT 'PIVR' COMMENT '管理方法论(统一为PIVR, 预留敏捷/瀑布/看板等)',
  `lifecycle_status` ENUM('draft','approval_pending','active','paused','completed','archived') NOT NULL DEFAULT 'draft' COMMENT '项目业务状态',
  `portfolio_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属项目集',
  `domain_code` VARCHAR(50) DEFAULT NULL COMMENT '业务领域(关联Account business_domains)',
  `dept_code` VARCHAR(50) DEFAULT NULL COMMENT '所属部门(关联Account)',
  `leader_uid` VARCHAR(64) DEFAULT NULL COMMENT '项目负责人(关联Account)',
  `security_level` ENUM('company','department','project_team','whitelist') NOT NULL DEFAULT 'company' COMMENT '项目可见范围: company=公司范围可见, department=所属部门可见, project_team=项目组可见, whitelist=白名单可见',
  `access_whitelist` JSON DEFAULT NULL COMMENT '项目访问白名单UID数组，仅 security_level=whitelist 时用于额外授权',
  `start_date` DATE DEFAULT NULL COMMENT '计划开始日期',
  `end_date` DATE DEFAULT NULL COMMENT '计划结束日期',
  `opp_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联Altoc商机ID(逻辑关联, 非外键)',
  `contract_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联Altoc合同ID(逻辑关联, 非外键)',
  `customer_code` VARCHAR(100) DEFAULT NULL COMMENT '客户编码(关联Altoc customer.code)',
  `customer_name` VARCHAR(200) DEFAULT NULL COMMENT '客户名称',
  `contract_code` VARCHAR(100) DEFAULT NULL COMMENT '关联合同编号(关联Altoc contract.code)',
  `approval_status` ENUM('not_required','pending','approved','rejected') NOT NULL DEFAULT 'not_required' COMMENT '审批状态(预留Workflow)',
  `workflow_instance_id` VARCHAR(128) DEFAULT NULL COMMENT '审批流程实例ID(预留)',
  `template_set_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '绑定的项目模板集',
  `template_version_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '绑定的项目模板版本',
  `module_config` JSON DEFAULT NULL COMMENT '模块开关(milestones_enabled/process_audit_enabled等)',
  `board_config` JSON DEFAULT NULL COMMENT '看板配置(列定义/WIP限制)',
  `workflow_config` JSON DEFAULT NULL COMMENT '工作流配置(自定义状态)',
  `notification_config` JSON DEFAULT NULL COMMENT '通知配置',
  `created_by` VARCHAR(64) NOT NULL COMMENT '创建人uid',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_code` (`project_code`),
  KEY `idx_category` (`category`),
  KEY `idx_lifecycle_status` (`lifecycle_status`),
  KEY `idx_portfolio` (`portfolio_id`),
  KEY `idx_domain_code` (`domain_code`),
  KEY `idx_dept_code` (`dept_code`),
  KEY `idx_leader_uid` (`leader_uid`),
  KEY `idx_security_level_dept` (`security_level`, `dept_code`),
  KEY `idx_customer_code` (`customer_code`),
  KEY `idx_opp_id` (`opp_id`),
  KEY `idx_contract_id` (`contract_id`),
  KEY `idx_template_set_id` (`template_set_id`),
  KEY `idx_template_version_id` (`template_version_id`),
  CONSTRAINT `fk_project_portfolio` FOREIGN KEY (`portfolio_id`) REFERENCES `project_portfolios` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_project_template_set` FOREIGN KEY (`template_set_id`) REFERENCES `project_template_sets` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_project_template_version` FOREIGN KEY (`template_version_id`) REFERENCES `project_template_versions` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Aims项目主表';

-- ============================================================
-- 3. 项目成员表
-- ============================================================
CREATE TABLE IF NOT EXISTS `aims_project_members` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT '项目ID',
  `uid` VARCHAR(64) NOT NULL COMMENT '用户UID(关联Console Directory)',
  `role` ENUM('manager','member','viewer') NOT NULL DEFAULT 'member' COMMENT '项目角色: manager=项目经理/负责人, member=项目成员, viewer=观察者',
  `status` ENUM('active','suspended') NOT NULL DEFAULT 'active' COMMENT '成员状态: active=正常, suspended=已暂停',
  `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_uid` (`project_id`, `uid`),
  KEY `idx_uid` (`uid`),
  CONSTRAINT `fk_member_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目成员表';

CREATE TABLE IF NOT EXISTS `project_environments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT 'Aims项目ID',
  `environment_code` VARCHAR(64) NOT NULL COMMENT 'Assets正式环境编码',
  `delivery_asset_code` VARCHAR(64) DEFAULT NULL COMMENT 'Assets正式客户交付资产编码',
  `relation_type` ENUM('initial_delivery','upgrade','migration','maintenance','decommission','verification','other') NOT NULL DEFAULT 'initial_delivery',
  `delivery_status` ENUM('planned','provisioning','deployed','online','accepted','handed_over','suspended','cancelled') NOT NULL DEFAULT 'planned',
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否本项目主环境',
  `planned_go_live_at` DATETIME DEFAULT NULL COMMENT '计划上线时间',
  `actual_go_live_at` DATETIME DEFAULT NULL COMMENT '实际上线时间',
  `accepted_at` DATETIME DEFAULT NULL COMMENT '验收时间',
  `handover_status` ENUM('pending','ready','completed','rejected') NOT NULL DEFAULT 'pending',
  `handover_at` DATETIME DEFAULT NULL COMMENT '交接时间',
  `delivery_version_snapshot` VARCHAR(100) DEFAULT NULL COMMENT '本次项目交付版本快照',
  `assets_sync_status` ENUM('pending','synced','failed') NOT NULL DEFAULT 'pending',
  `assets_sync_error` TEXT DEFAULT NULL COMMENT 'Assets同步失败详情',
  `assets_synced_at` DATETIME DEFAULT NULL COMMENT 'Assets同步成功时间',
  `source_contract_line_code` VARCHAR(64) DEFAULT NULL COMMENT '来源合同行编码',
  `source_obligation_code` VARCHAR(64) DEFAULT NULL COMMENT '来源履约义务编码',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  `active_relation_key` VARCHAR(255) DEFAULT NULL COMMENT '当前有效关系唯一键，由 runtime 在写入和恢复时维护，软删除时清空',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_environment_active_relation` (`active_relation_key`),
  KEY `idx_project_environment_project` (`project_id`, `delivery_status`),
  KEY `idx_project_environment_environment` (`environment_code`, `delivery_status`),
  KEY `idx_project_environment_delivery_asset` (`delivery_asset_code`, `delivery_status`),
  KEY `idx_project_environment_sync` (`assets_sync_status`, `updated_at`),
  CONSTRAINT `fk_project_environment_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目-正式环境执行关系';

-- ============================================================
-- 3. 项目周报表
-- ============================================================
CREATE TABLE IF NOT EXISTS `project_weekly_reports` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT '项目ID',
  `report_year` SMALLINT UNSIGNED NOT NULL COMMENT 'ISO周所属年份',
  `report_week` TINYINT UNSIGNED NOT NULL COMMENT 'ISO周序号(1-53)',
  `week_start` DATE NOT NULL COMMENT '周一',
  `week_end` DATE NOT NULL COMMENT '周日',
  `main_work` TEXT DEFAULT NULL COMMENT '本周主要工作',
  `overall_progress` TEXT DEFAULT NULL COMMENT '整体进展',
  `department_name` VARCHAR(100) DEFAULT NULL COMMENT '周报汇总口径：隶属部门/小组名称快照',
  `project_type_name` VARCHAR(100) DEFAULT NULL COMMENT '周报汇总口径：项目类型快照',
  `project_manager_name` VARCHAR(100) DEFAULT NULL COMMENT '周报汇总口径：项目经理展示名快照',
  `initiation_status` VARCHAR(100) DEFAULT NULL COMMENT '周报汇总口径：立项情况',
  `current_stage` VARCHAR(100) DEFAULT NULL COMMENT '周报汇总口径：当前阶段',
  `progress_status` VARCHAR(100) DEFAULT NULL COMMENT '周报汇总口径：进度情况',
  `completion_percent` DECIMAL(5,2) DEFAULT NULL COMMENT '周报汇总口径：总体完成进度百分比',
  `contract_status` VARCHAR(200) DEFAULT NULL COMMENT '周报汇总口径：合同状态',
  `contract_amount` DECIMAL(14,2) DEFAULT NULL COMMENT '周报汇总口径：合同额',
  `payment_status` VARCHAR(200) DEFAULT NULL COMMENT '周报汇总口径：回款情况',
  `cumulative_labor_cost` DECIMAL(14,2) DEFAULT NULL COMMENT '周报汇总口径：累计人力成本',
  `major_risks` TEXT DEFAULT NULL COMMENT '周报汇总口径：重大问题和风险',
  `coordination_needs` TEXT DEFAULT NULL COMMENT '周报汇总口径：待协调资源',
  `remarks` TEXT DEFAULT NULL COMMENT '周报汇总口径：备注',
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

-- ============================================================
-- 3. 项目-仓库关联表 (N:M)
-- ============================================================
-- 关联 Account 模块的 GitLab 仓库(projects.project_code)
CREATE TABLE IF NOT EXISTS `aims_project_repos` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT 'Aims项目ID',
  `repo_project_code` VARCHAR(255) NOT NULL COMMENT 'Account仓库project_code(可含/)',
  `last_commit_sha` VARCHAR(64) DEFAULT NULL COMMENT '最后同步的commit SHA',
  `last_synced_at` DATETIME DEFAULT NULL COMMENT '最后同步时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_repo` (`project_id`, `repo_project_code`),
  CONSTRAINT `fk_repo_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目-仓库关联表';

-- ============================================================
-- 4. 工作项编号计数器
-- ============================================================
CREATE TABLE IF NOT EXISTS `project_counters` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `counter` INT UNSIGNED NOT NULL DEFAULT 0,
  `req_counter` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '需求项编号计数器(项目内自增，显示为 PROJECT-REQ-001)',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project` (`project_id`),
  CONSTRAINT `fk_counter_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作项编号计数器';

-- ============================================================
-- 5. 工作流状态目录与转换规则
-- ============================================================
CREATE TABLE IF NOT EXISTS `workflow_status_catalog` (
  `entity_type` ENUM('project','milestone','requirement','task','bug') NOT NULL,
  `status` VARCHAR(64) NOT NULL,
  `is_initial` TINYINT(1) NOT NULL DEFAULT 0,
  `is_terminal` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`entity_type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='工作流状态目录';

CREATE TABLE IF NOT EXISTS `work_item_status_catalog` (
  `item_type` ENUM('requirement','task','bug') NOT NULL,
  `status` VARCHAR(64) NOT NULL,
  `is_initial` TINYINT(1) NOT NULL DEFAULT 0,
  `is_terminal` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`item_type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='工作项状态目录';

-- project_id 为 NULL 表示系统默认规则
CREATE TABLE IF NOT EXISTS `workflow_transitions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED DEFAULT NULL COMMENT 'NULL=系统默认',
  `entity_type` ENUM('project','milestone','requirement','task','bug') NOT NULL,
  `from_status` VARCHAR(64) NOT NULL,
  `to_status` VARCHAR(64) NOT NULL,
  `transition_key` VARCHAR(64) NOT NULL COMMENT '流转标识(如 start, pause)',
  `is_initial` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否初始状态',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_transition` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`),
  KEY `idx_transition_from_status` (`entity_type`, `from_status`),
  KEY `idx_transition_to_status` (`entity_type`, `to_status`),
  CONSTRAINT `fk_transition_from_status` FOREIGN KEY (`entity_type`, `from_status`) REFERENCES `workflow_status_catalog` (`entity_type`, `status`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_transition_to_status` FOREIGN KEY (`entity_type`, `to_status`) REFERENCES `workflow_status_catalog` (`entity_type`, `status`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_transition_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='状态流转定义';

-- ============================================================
-- 6. 里程碑表 (目标层 - 项目的锚点)
-- ============================================================
-- 状态: planning → active → completed
-- 模式:
--   strong_constraint(强约束): 必须设置截止日期, 交付物明细存于 deliverables 表
--   rolling_plan(滚动计划): 完成即发布, 适用于 SaaS/持续迭代
--   periodic(周期性/维护): 月度/周度周期单元, 如"2026年3月度维护"
--
-- 同一项目内不同里程碑可使用不同模式, 例如:
--   交付阶段 → strong_constraint
--   试运行期 → rolling_plan
--   正式运行后 → periodic
CREATE TABLE IF NOT EXISTS `milestones` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(200) NOT NULL COMMENT '里程碑名称',
  `description` TEXT DEFAULT NULL COMMENT '里程碑描述',
  `mode` ENUM('strong_constraint','rolling_plan','periodic') NOT NULL DEFAULT 'rolling_plan' COMMENT '里程碑模式',
  `start_date` DATE DEFAULT NULL,
  `end_date` DATE DEFAULT NULL,
  `status` ENUM('planning','todo','active','completed') NOT NULL DEFAULT 'planning',
  `pivr_stage` ENUM('P','I','V','R') DEFAULT NULL COMMENT 'PIVR阶段标签(仅交付/定制类项目, NULL=不适用)',
  `template_key` VARCHAR(100) DEFAULT NULL COMMENT '来源模板中的里程碑键',
  `payment_term_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联Altoc contract_payment_term.id(逻辑关联, 非外键)',
  `recurrence_rule` VARCHAR(100) DEFAULT NULL COMMENT '周期规则(periodic模式, 如 monthly/weekly/quarterly)',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_milestone_project_id` (`project_id`, `id`),
  KEY `idx_project_status` (`project_id`, `status`),
  KEY `idx_project_mode` (`project_id`, `mode`),
  KEY `idx_milestone_project_template_key` (`project_id`, `template_key`),
  CONSTRAINT `fk_milestone_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='里程碑(目标层)';

-- ============================================================
-- 6b. 产品版本管理表
-- ============================================================
CREATE TABLE IF NOT EXISTS `product_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_code` VARCHAR(64) NOT NULL COMMENT '所属产品(关联Assets product_assets.product_code)',
  `version_code` VARCHAR(64) NOT NULL COMMENT '版本号(如 v2.1.0)',
  `name` VARCHAR(200) DEFAULT NULL COMMENT '版本名称/主题(可选)',
  `description` TEXT DEFAULT NULL COMMENT '版本说明(Markdown)',
  `status` ENUM('planning','developing','released','archived') NOT NULL DEFAULT 'planning'
    COMMENT '版本状态: planning(规划)→developing(开发中)→released(已发布)→archived(归档)',
  `planned_release_date` DATE DEFAULT NULL COMMENT '计划发布日期',
  `released_at` DATETIME DEFAULT NULL COMMENT '实际发布时间',
  `released_by` VARCHAR(64) DEFAULT NULL COMMENT '发布操作人uid',
  `milestone_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '软关联里程碑(可选, 逻辑关联非外键)',
  `owner_project_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '归属项目(生命周期操作仅限该项目负责人; 逻辑关联非外键)',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序(默认按版本创建倒序)',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_version` (`product_code`, `version_code`),
  KEY `idx_product_status` (`product_code`, `status`),
  KEY `idx_version_milestone` (`milestone_id`),
  KEY `idx_version_owner_project` (`owner_project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品版本(Release)';

CREATE TABLE IF NOT EXISTS `aims_project_products` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `product_code` VARCHAR(64) NOT NULL COMMENT '关联Assets product_assets.product_code(逻辑关联, 非外键)',
  `product_name` VARCHAR(255) DEFAULT NULL COMMENT '产品名称快照(展示用, 关联时同步)',
  `version_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '限定版本(关联product_versions.id; NULL=不限版本/全版本项目)',
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否主产品(项目默认版本上下文)',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_product` (`project_id`, `product_code`),
  UNIQUE KEY `uk_project_primary` ((CASE WHEN `is_primary` = 1 THEN `project_id` END)),
  KEY `idx_project_product_code` (`product_code`),
  KEY `idx_project_product_version` (`version_id`),
  CONSTRAINT `fk_project_product_project` FOREIGN KEY (`project_id`)
    REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_project_product_version` FOREIGN KEY (`version_id`)
    REFERENCES `product_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目与产品资产关联';

CREATE TABLE IF NOT EXISTS `product_version_features` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `version_id` BIGINT UNSIGNED NOT NULL COMMENT '所属版本',
  `title` VARCHAR(255) NOT NULL COMMENT '特性标题(对外口径)',
  `description` TEXT DEFAULT NULL COMMENT '特性说明(Markdown, 可含客户价值描述)',
  `category` VARCHAR(64) DEFAULT NULL COMMENT '特性分类(如 新增能力/体验优化/性能/安全, 字典可后置)',
  `status` ENUM('planned','delivered','deferred') NOT NULL DEFAULT 'planned'
    COMMENT '特性状态: planned(规划)→delivered(已交付)/deferred(顺延后续版本)',
  `is_public` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否对外可见(销售/Altoc消费时过滤)',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_feature_version` (`version_id`, `sort_order`),
  CONSTRAINT `fk_feature_version` FOREIGN KEY (`version_id`)
    REFERENCES `product_versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品版本功能特性清单(粗粒度, 销售/对外口径)';

CREATE TABLE IF NOT EXISTS `product_version_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `version_id` BIGINT UNSIGNED NOT NULL,
  `action` VARCHAR(64) NOT NULL COMMENT '操作类型',
  `old_value` TEXT DEFAULT NULL,
  `new_value` TEXT DEFAULT NULL,
  `operator_uid` VARCHAR(64) DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_version_log` (`version_id`, `created_at`),
  CONSTRAINT `fk_version_log_version` FOREIGN KEY (`version_id`)
    REFERENCES `product_versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品版本操作日志';

-- ============================================================
-- 7. 工作项/目标表 (统一模型, 支持嵌套)
-- ============================================================
-- 三层驱动: 里程碑(计划层) → 目标/工作项(目标层) → 任务(执行层)
-- 目标/工作项通过 parent_id 实现嵌套: 需求 → 任务 → 子任务
-- milestone_id 为必填, 每个工作项必须归属一个里程碑
-- level: target(目标) -> matter(事项/任务)
-- type: requirement(需求), task(任务), bug(缺陷) — 仅作分类标签，不影响状态流
-- Target 层状态: planning → todo → in_progress → in_review → completed
-- Matter 层状态: todo → in_progress → in_review → completed
CREATE TABLE IF NOT EXISTS `work_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `milestone_id` BIGINT UNSIGNED NOT NULL COMMENT '所属里程碑(必填, 工作项一级容器)',
  `version_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '目标版本(关联product_versions.id, 仅tier=target有效)',
  `feature_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属功能特性(关联product_version_features.id, 可选, 须与version_id同版本)',
  `item_number` INT UNSIGNED NOT NULL COMMENT '项目内自增编号',
  `item_key` VARCHAR(64) NOT NULL COMMENT '显示编号(如 AIMS-123/AIMS-123-1)',
  `tier` ENUM('target','matter') NOT NULL DEFAULT 'matter' COMMENT '层级: target(目标) > matter(事项/任务)',
  `type` ENUM('requirement','task','bug','change_request') NOT NULL,
  `requirement_category` VARCHAR(32) DEFAULT NULL COMMENT '需求分类: functional(功能需求)/non_functional(非功能需求)，仅分类模式使用',
  `requirement_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联的需求项ID',
  `change_request_of` BIGINT UNSIGNED DEFAULT NULL COMMENT '变更任务指向原任务ID',
  `title` VARCHAR(255) NOT NULL,
  `description` LONGTEXT DEFAULT NULL COMMENT 'Markdown',
  `start_date` DATE DEFAULT NULL COMMENT '计划开始日期',
  `status` ENUM('planning','todo','in_progress','in_review','completed') NOT NULL DEFAULT 'planning' COMMENT 'Target: planning→todo→in_progress→in_review→completed; Matter: todo→in_progress→in_review→completed',
  `priority` ENUM('P0','P1','P2','P3') NOT NULL DEFAULT 'P2',
  `severity` ENUM('critical','high','medium','low','suggestion') DEFAULT NULL COMMENT '严重程度(仅Bug)',
  `weight` SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '权重(用于里程碑进度Roll-up计算)',
  `assignee_uid` VARCHAR(64) DEFAULT NULL,
  `reporter_uid` VARCHAR(64) DEFAULT NULL,
  `due_date` DATE DEFAULT NULL,
  `estimated_hours` DECIMAL(8,2) DEFAULT NULL,
  `parent_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '父工作项(支持嵌套: 需求→任务→子任务)',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序权重',
  `approval_status` ENUM('not_required','pending','approved','rejected') NOT NULL DEFAULT 'not_required',
  `review_level` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '评审级别: 0=免评审, 1=一般, 2=重要, 3=重大, 4=关键',
  `required` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否模板必选工作项: 1=必选 0=可选',
  `template_key` VARCHAR(100) DEFAULT NULL COMMENT '来源模板中的工作项键',
  `decomposition_source_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '溯源：产生此工作项的需求分解/需求变更容器工作项ID',
  `workflow_instance_id` VARCHAR(128) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_item_key` (`item_key`),
  UNIQUE KEY `uk_project_item_number` (`project_id`, `item_number`),
  UNIQUE KEY `uk_work_item_project_id` (`project_id`, `id`),
  KEY `idx_project_status` (`project_id`, `status`),
  KEY `idx_project_type` (`project_id`, `type`),
  KEY `idx_milestone` (`milestone_id`),
  KEY `idx_work_item_version` (`version_id`),
  KEY `idx_work_item_feature` (`feature_id`),
  KEY `idx_assignee` (`assignee_uid`),
  KEY `idx_due_date` (`due_date`),
  KEY `idx_parent` (`parent_id`),
  KEY `idx_project_parent` (`project_id`, `parent_id`),
  KEY `idx_work_item_project_required` (`project_id`, `required`),
  KEY `idx_work_item_project_template_key` (`project_id`, `template_key`),
  KEY `idx_work_items_req_category` (`project_id`, `requirement_category`),
  KEY `idx_work_items_decomp_src` (`decomposition_source_id`),
  KEY `idx_type_status` (`type`, `status`),
  KEY `idx_work_item_requirement` (`requirement_id`),
  KEY `idx_work_item_change_request` (`change_request_of`),
  CONSTRAINT `fk_item_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_item_project_milestone` FOREIGN KEY (`project_id`, `milestone_id`) REFERENCES `milestones` (`project_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_item_parent` FOREIGN KEY (`parent_id`) REFERENCES `work_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_work_item_requirement` FOREIGN KEY (`requirement_id`) REFERENCES `requirement_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_work_item_change_request` FOREIGN KEY (`change_request_of`) REFERENCES `work_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_work_item_version` FOREIGN KEY (`version_id`) REFERENCES `product_versions` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_work_item_feature` FOREIGN KEY (`feature_id`) REFERENCES `product_version_features` (`id`) ON DELETE SET NULL
  -- fk_item_type_status 已移除：status 改为 ENUM，由数据库类型约束保证合法性
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='统一工作项(支持嵌套)';
-- 注:
--   1. parent_id 与 project_id 的同项目一致性由触发器保证
--   2. 存在子工作项时, 不允许将父工作项移动到其他项目

-- ============================================================
-- 8. 工作项关联关系表
-- ============================================================
CREATE TABLE IF NOT EXISTS `work_item_relations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source_id` BIGINT UNSIGNED NOT NULL,
  `target_id` BIGINT UNSIGNED NOT NULL,
  `relation_type` ENUM('blocks','blocked_by','relates_to') NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_relation` (`source_id`, `target_id`, `relation_type`),
  KEY `idx_target` (`target_id`),
  CONSTRAINT `fk_relation_source` FOREIGN KEY (`source_id`) REFERENCES `work_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_relation_target` FOREIGN KEY (`target_id`) REFERENCES `work_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作项关联关系';

-- ============================================================
-- 9. 工作项评论表
-- ============================================================
CREATE TABLE IF NOT EXISTS `work_item_comments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `author_uid` VARCHAR(64) NOT NULL,
  `content` LONGTEXT NOT NULL COMMENT 'Markdown',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_work_item` (`work_item_id`),
  CONSTRAINT `fk_comment_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作项评论';

-- ============================================================
-- 10. 工作项变更日志表
-- ============================================================
CREATE TABLE IF NOT EXISTS `work_item_changelog` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `field_name` VARCHAR(64) NOT NULL,
  `old_value` TEXT DEFAULT NULL,
  `new_value` TEXT DEFAULT NULL,
  `changed_by` VARCHAR(64) NOT NULL,
  `changed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_work_item` (`work_item_id`),
  KEY `idx_changed_at` (`changed_at`),
  CONSTRAINT `fk_changelog_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作项变更日志';

-- ============================================================
-- 11. 工作项附件表
-- ============================================================
CREATE TABLE IF NOT EXISTS `work_item_attachments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `oss_key` VARCHAR(500) NOT NULL,
  `file_size` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `content_type` VARCHAR(100) DEFAULT NULL,
  `uploaded_by` VARCHAR(64) NOT NULL,
  `uploaded_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_work_item` (`work_item_id`),
  CONSTRAINT `fk_attachment_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作项附件';

-- ============================================================
-- 12. 工作项-Codocs文档关联表 (已废弃, 合并到 project_documents)
-- ============================================================
-- 原 work_item_documents 表已合并到 project_documents 表
-- 迁移方式: work_item_id → project_documents.work_item_id, document_id → project_documents.codocs_uuid
-- DROP TABLE IF EXISTS `work_item_documents`;

-- ============================================================
-- 12b. 工作项源文档锚点表 (需求分解产物的章节引用, v2.6)
-- ============================================================
-- 一条 work_item 可挂多条锚点（打包任务场景），按 sort_order 展示
-- 运行时按锚点从 Codocs 拉章节原文，不把正文复制到 work_items.description
-- 源文档被删时保留记录，UI 做断链降级提示
CREATE TABLE IF NOT EXISTS `work_item_source_anchors` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `work_item_id` BIGINT UNSIGNED NOT NULL COMMENT '工作项ID',
  `source_document_uuid` CHAR(36) NOT NULL COMMENT '源文档UUID(Codocs)',
  `source_document_title` VARCHAR(255) NOT NULL COMMENT '源文档标题(冗余快照，断链时仍可展示)',
  `heading_anchor` VARCHAR(500) NOT NULL COMMENT '完整锚点文本(如 "2.1.1 用户注册")',
  `heading_depth` TINYINT NOT NULL COMMENT '标题层级: 2|3|4',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '同一工作项多锚点的展示顺序',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_work_item` (`work_item_id`, `sort_order`),
  KEY `idx_source_doc` (`source_document_uuid`),
  KEY `idx_heading_anchor` (`source_document_uuid`, `heading_anchor`),
  CONSTRAINT `fk_anchor_work_item` FOREIGN KEY (`work_item_id`)
    REFERENCES `work_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='工作项源文档锚点(需求分解产物的章节引用)';

-- ============================================================
-- 13. 工时记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS `time_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT 'Aims项目ID，用于项目级贡献工时统计',
  `work_item_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '可选工作项ID；任务执行工时保留该关联，项目日历填报为空',
  `weekly_report_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '历史周报生成记录关联；兼容字段，新逻辑不再写入',
  `uid` VARCHAR(64) NOT NULL,
  `entry_date` DATE NOT NULL,
  `hours` DECIMAL(6,2) NOT NULL,
  `description` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_project_date` (`project_id`, `entry_date`),
  KEY `idx_work_item` (`work_item_id`),
  KEY `idx_weekly_report` (`weekly_report_id`),
  KEY `idx_uid_date` (`uid`, `entry_date`),
  CONSTRAINT `fk_time_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_time_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_time_weekly_report` FOREIGN KEY (`weekly_report_id`) REFERENCES `project_weekly_reports` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工时记录';

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

-- ============================================================
-- 14. GitLab提交关联表
-- ============================================================
CREATE TABLE IF NOT EXISTS `gitlab_commits` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT 'Aims项目ID',
  `work_item_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联工作项(通过commit message匹配)',
  `item_key` VARCHAR(64) DEFAULT NULL COMMENT '匹配到的工作项编号',
  `repo_project_code` VARCHAR(255) NOT NULL COMMENT 'Account仓库project_code',
  `commit_sha` CHAR(40) NOT NULL,
  `message` TEXT NOT NULL,
  `author_name` VARCHAR(128) DEFAULT NULL,
  `author_email` VARCHAR(200) DEFAULT NULL,
  `committed_at` DATETIME NOT NULL,
  `additions` INT UNSIGNED DEFAULT NULL COMMENT '新增行数',
  `deletions` INT UNSIGNED DEFAULT NULL COMMENT '删除行数',
  `files_changed` INT UNSIGNED DEFAULT NULL COMMENT '修改文件数',
  `synced_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_repo_sha` (`repo_project_code`, `commit_sha`),
  KEY `idx_project` (`project_id`),
  KEY `idx_work_item` (`work_item_id`),
  KEY `idx_item_key` (`item_key`),
  CONSTRAINT `fk_commit_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_commit_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='GitLab提交关联';

-- ============================================================
-- 15. 通知规则表
-- ============================================================
CREATE TABLE IF NOT EXISTS `notification_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `event_type` VARCHAR(64) NOT NULL COMMENT 'task_assigned/due_reminder/status_changed等',
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `config` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_event` (`project_id`, `event_type`),
  CONSTRAINT `fk_notify_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通知规则';

-- ============================================================
-- 16. 系统参数表
-- ============================================================
CREATE TABLE IF NOT EXISTS `system_parameters` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `param_key` VARCHAR(100) NOT NULL,
  `param_value` TEXT NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_param_key` (`param_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统参数';

-- ============================================================
-- 种子数据: 默认工作流状态转换规则
-- ============================================================

-- 项目生命周期
INSERT INTO `workflow_transitions` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`) VALUES
(NULL, 'project', 'draft', 'approval_pending', 'submit'),
(NULL, 'project', 'approval_pending', 'active', 'approve'),
(NULL, 'project', 'approval_pending', 'draft', 'reject'),
(NULL, 'project', 'active', 'paused', 'pause'),
(NULL, 'project', 'paused', 'active', 'resume'),
(NULL, 'project', 'active', 'completed', 'complete'),
(NULL, 'project', 'completed', 'archived', 'archive');

-- 里程碑
INSERT INTO `workflow_transitions` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`) VALUES
(NULL, 'milestone', 'planning', 'active', 'start'),
(NULL, 'milestone', 'active', 'completed', 'complete'),
(NULL, 'milestone', 'completed', 'active', 'reopen');

-- 需求
INSERT INTO `workflow_transitions` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`) VALUES
(NULL, 'requirement', 'draft', 'reviewing', 'submit_review'),
(NULL, 'requirement', 'reviewing', 'draft', 'reject_review'),
(NULL, 'requirement', 'reviewing', 'confirmed', 'approve'),
(NULL, 'requirement', 'confirmed', 'developing', 'start_dev'),
(NULL, 'requirement', 'developing', 'confirmed', 'pause_dev'),
(NULL, 'requirement', 'developing', 'completed', 'complete'),
(NULL, 'requirement', 'completed', 'developing', 'reopen');

-- 任务
INSERT INTO `workflow_transitions` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`) VALUES
(NULL, 'task', 'todo', 'in_progress', 'start'),
(NULL, 'task', 'in_progress', 'todo', 'pause'),
(NULL, 'task', 'in_progress', 'done', 'complete'),
(NULL, 'task', 'done', 'in_progress', 'reopen');

-- 缺陷
INSERT INTO `workflow_transitions` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`) VALUES
(NULL, 'bug', 'new', 'confirmed', 'confirm'),
(NULL, 'bug', 'new', 'closed', 'reject'),
(NULL, 'bug', 'confirmed', 'fixing', 'start_fix'),
(NULL, 'bug', 'fixing', 'verifying', 'submit_verify'),
(NULL, 'bug', 'verifying', 'fixing', 'fail_verify'),
(NULL, 'bug', 'verifying', 'closed', 'pass_verify'),
(NULL, 'bug', 'closed', 'new', 'reopen');

-- ============================================================
-- 17. 用户常用项目 (user_favorite_projects)
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
-- 18. 项目文档表 (统一管理各层级文档)
-- ============================================================
-- 文档归属层级（四选一）：portfolio_id / project_id / milestone_id / work_item_id
-- 支持文件夹嵌套（parent_id），文件夹 is_folder=1
-- 内容通过 Codocs 编辑器管理（codocs_uuid 关联），或直接存 OSS
-- OSS 路径格式: aims-docs/{portfolio_code}/{project_code}/{pivr_stage}/{item_key}/
CREATE TABLE IF NOT EXISTS `project_documents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid` CHAR(36) NOT NULL COMMENT '文档UUID(对外标识)',
  `portfolio_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '归属项目集',
  `project_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '归属项目',
  `project_code` VARCHAR(50) DEFAULT NULL COMMENT '项目编码(冗余, 便于跨模块检索)',
  `milestone_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '归属里程碑',
  `work_item_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '归属工作项',
  `parent_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '父文件夹ID',
  `title` VARCHAR(255) NOT NULL COMMENT '文档/文件夹名称',
  `doc_category` VARCHAR(50) DEFAULT NULL COMMENT '文档分类: requirement_spec/design/test_report/meeting_notes/general',
  `is_folder` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否文件夹: 0=文档 1=文件夹',
  `oss_path` VARCHAR(500) DEFAULT NULL COMMENT 'OSS存储路径(文件夹为空)',
  `codocs_uuid` CHAR(36) DEFAULT NULL COMMENT '关联Codocs文档UUID(通过Codocs编辑)',
  `document_source` ENUM('codocs','repo') NOT NULL DEFAULT 'codocs' COMMENT '文档来源: codocs=项目组文档 / repo=项目仓库文档',
  `repo_project_code` VARCHAR(50) DEFAULT NULL COMMENT 'repo 来源: 仓库编码（指向 Account git_projects）',
  `repo_file_path` VARCHAR(500) DEFAULT NULL COMMENT 'repo 来源: 仓库中的相对路径，如 docs/design.md',
  `repo_commit_id` VARCHAR(64) DEFAULT NULL COMMENT 'repo 来源: 指定 commit_id 为快照；NULL 表示跟随默认分支',
  `content_size` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '内容大小(字节)',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序',
  `import_mode` ENUM('category','flat') DEFAULT NULL COMMENT '需求规格书导入模式（仅 doc_category=requirement_spec）',
  `heading_levels` VARCHAR(16) DEFAULT NULL COMMENT '标题层级（仅 doc_category=requirement_spec）',
  `import_status` ENUM('not_imported','imported_clean','imported_dirty','imported_locked') DEFAULT NULL COMMENT '需求规格书导入状态（仅 doc_category=requirement_spec）',
  `access_lifecycle_stage` ENUM('draft','formal','archived') DEFAULT NULL COMMENT '访问控制镜像：生命周期阶段（最终以 Codocs 策略为准）',
  `access_confidentiality_level` ENUM('L0','L1','L2','L3') DEFAULT NULL COMMENT '访问控制镜像：密级（最终以 Codocs 策略为准）',
  `access_summary` VARCHAR(255) DEFAULT NULL COMMENT '访问控制镜像：访问摘要（展示用）',
  `created_by` VARCHAR(64) NOT NULL COMMENT '创建人uid',
  `updated_by` VARCHAR(64) DEFAULT NULL COMMENT '最后修改人uid',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_doc_uuid` (`uuid`),
  KEY `idx_portfolio` (`portfolio_id`),
  KEY `idx_project` (`project_id`),
  KEY `idx_project_code` (`project_code`),
  KEY `idx_milestone` (`milestone_id`),
  KEY `idx_work_item` (`work_item_id`),
  KEY `idx_parent` (`parent_id`),
  KEY `idx_codocs` (`codocs_uuid`),
  CONSTRAINT `fk_doc_portfolio` FOREIGN KEY (`portfolio_id`) REFERENCES `project_portfolios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_doc_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_doc_milestone` FOREIGN KEY (`milestone_id`) REFERENCES `milestones` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_doc_work_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_doc_parent` FOREIGN KEY (`parent_id`) REFERENCES `project_documents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_doc_single_owner` CHECK (((`portfolio_id` IS NOT NULL) + (`project_id` IS NOT NULL) + (`milestone_id` IS NOT NULL) + (`work_item_id` IS NOT NULL)) = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目文档(统一管理各层级)';

-- ============================================================
-- 19. 交付物/验收项 (统一管理各实体的交付要求)
-- ============================================================
-- 适用于项目、里程碑、工作项等任何需要交付物的实体
-- 交付物可以是文档（关联 project_documents）、也可以是非文档类产出（如代码、部署、演示等）
-- 创建实体时由创建人定义交付要求和验收标准
-- target_id / matter_id 语义：
--   target_id    所属目标 work_item (tier='target')，表示「成果要求」的归属
--   matter_id    承接执行的 matter work_item (tier='matter')，表示实际产出方
--   两者同时非空 = matter 承接了 target 的成果要求（提交即视为 target 达成）
--   只有 target_id = 未承接的目标成果要求（待分配）
--   只有 matter_id = matter 的中间产物（不参与 target 验收）
CREATE TABLE IF NOT EXISTS `deliverables` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_owner_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属项目(项目级交付物时使用)',
  `milestone_owner_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属里程碑',
  `target_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属目标 work_item',
  `matter_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '承接执行的 matter work_item',
  `name` VARCHAR(200) NOT NULL COMMENT '交付物名称',
  `description` TEXT DEFAULT NULL COMMENT '交付物说明',
  `acceptance_criteria` TEXT DEFAULT NULL COMMENT '验收标准（审核人参照执行）',
  `deliverable_type` ENUM('document','code','artifact','task') NOT NULL DEFAULT 'document'
    COMMENT '交付物类型: document=文档, code=代码交付, artifact=部署包/环境交付, task=过程性事务',
  `required` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否必须: 1=必须 0=可选',
  `template_key` VARCHAR(100) DEFAULT NULL COMMENT '来源模板中的交付物键',
  `sort_order` INT NOT NULL DEFAULT 0,

  -- 完成状态
  `status` ENUM('pending','submitted','approved','rejected') NOT NULL DEFAULT 'pending'
    COMMENT 'pending=待提交, submitted=已提交待审核, approved=审核通过, rejected=驳回',

  -- 关联文档（交付物类型为 document 时）
  `document_uuid` CHAR(36) DEFAULT NULL COMMENT '关联 project_documents.uuid',
  `document_title` VARCHAR(255) DEFAULT NULL COMMENT '关联文档标题（冗余自 codocs，用于列表展示）',
  `document_source` ENUM('codocs','repo') NOT NULL DEFAULT 'codocs' COMMENT '文档来源: codocs=项目组文档 / repo=项目仓库文档',
  `repo_project_code` VARCHAR(50) DEFAULT NULL COMMENT 'repo 来源: 仓库编码（指向 Account git_projects）',
  `repo_file_path` VARCHAR(500) DEFAULT NULL COMMENT 'repo 来源: 仓库中的相对路径',
  `repo_commit_id` VARCHAR(64) DEFAULT NULL COMMENT 'repo 来源: 指定 commit_id 为快照；NULL 表示跟随默认分支',

  -- 非文档类交付物的证据链接/说明
  `evidence_url` VARCHAR(500) DEFAULT NULL COMMENT '产出物链接（如 GitLab MR、部署地址等）',
  `evidence_note` TEXT DEFAULT NULL COMMENT '产出物说明/备注',

  -- 提交信息
  `submitted_by` VARCHAR(64) DEFAULT NULL COMMENT '提交人uid',
  `submitted_at` DATETIME DEFAULT NULL,

  -- 冗余（方便查询）
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT '所属根项目',
  `project_code` VARCHAR(50) DEFAULT NULL,

  `created_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_deliverable_project_owner` (`project_owner_id`),
  KEY `idx_deliverable_milestone_owner` (`project_id`, `milestone_owner_id`),
  KEY `idx_deliverable_target` (`project_id`, `target_id`),
  KEY `idx_deliverable_matter` (`project_id`, `matter_id`),
  KEY `idx_deliverable_status` (`status`),
  KEY `idx_deliverable_project_status` (`project_id`, `status`),
  KEY `idx_deliverable_project_template_key` (`project_id`, `template_key`),
  KEY `idx_document` (`document_uuid`),
  CONSTRAINT `fk_deliverable_project_root` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_deliverable_project_owner` FOREIGN KEY (`project_owner_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_deliverable_milestone_owner` FOREIGN KEY (`project_id`, `milestone_owner_id`) REFERENCES `milestones` (`project_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `fk_deliverable_target` FOREIGN KEY (`project_id`, `target_id`) REFERENCES `work_items` (`project_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `fk_deliverable_matter` FOREIGN KEY (`project_id`, `matter_id`) REFERENCES `work_items` (`project_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `chk_deliverable_single_owner` CHECK (
    (`project_owner_id` IS NOT NULL AND `milestone_owner_id` IS NULL
      AND `target_id` IS NULL AND `matter_id` IS NULL)
    OR (`project_owner_id` IS NULL AND `milestone_owner_id` IS NOT NULL
      AND `target_id` IS NULL AND `matter_id` IS NULL)
    OR (`project_owner_id` IS NULL AND `milestone_owner_id` IS NULL
      AND (`target_id` IS NOT NULL OR `matter_id` IS NOT NULL))
  ),
  CONSTRAINT `chk_deliverable_project_owner_match` CHECK (`project_owner_id` IS NULL OR `project_owner_id` = `project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='交付物/验收项(统一管理各实体的交付要求)';

-- ============================================================
-- 20. 统一审核记录
-- ============================================================
-- 管理整个系统的状态流转审核：项目立项、里程碑完成、工作项确认/完成等
-- 里程碑完成审核时，审核人参照 deliverables 的验收标准逐项检查
CREATE TABLE IF NOT EXISTS `approval_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- 审核对象
  `project_owner_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '审核对象为项目时使用',
  `milestone_owner_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '审核对象为里程碑时使用',
  `work_item_owner_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '审核对象为工作项时使用',
  `entity_code` VARCHAR(100) DEFAULT NULL COMMENT '实体编码(冗余, 如HZY/P-准备阶段/HZY-42)',
  `transition` VARCHAR(100) NOT NULL COMMENT '状态流转, 如 active→completed',
  `title` VARCHAR(255) DEFAULT NULL COMMENT '审核标题(如"里程碑P-准备阶段完成审核")',

  -- 发起
  `requested_by` VARCHAR(64) NOT NULL COMMENT '发起人uid',
  `requested_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `request_comment` TEXT DEFAULT NULL COMMENT '发起说明',

  -- 审核
  `reviewer_uid` VARCHAR(64) DEFAULT NULL COMMENT '审核人uid（空=待分配）',
  `status` ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  `reviewed_at` DATETIME DEFAULT NULL,
  `review_comment` TEXT DEFAULT NULL COMMENT '审核意见',

  -- 工作流对接（预留）
  `workflow_instance_id` VARCHAR(128) DEFAULT NULL COMMENT 'Workflow模块流程实例ID',

  -- 冗余（方便查询和展示）
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT '所属根项目',
  `project_code` VARCHAR(50) DEFAULT NULL,

  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_approval_project_owner` (`project_owner_id`),
  KEY `idx_approval_milestone_owner` (`project_id`, `milestone_owner_id`),
  KEY `idx_approval_work_item_owner` (`project_id`, `work_item_owner_id`),
  KEY `idx_reviewer` (`reviewer_uid`, `status`),
  KEY `idx_requested_by` (`requested_by`),
  KEY `idx_project` (`project_id`),
  KEY `idx_status` (`status`),
  KEY `idx_workflow` (`workflow_instance_id`),
  CONSTRAINT `fk_approval_project_root` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_approval_project_owner` FOREIGN KEY (`project_owner_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_approval_milestone_owner` FOREIGN KEY (`project_id`, `milestone_owner_id`) REFERENCES `milestones` (`project_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `fk_approval_work_item_owner` FOREIGN KEY (`project_id`, `work_item_owner_id`) REFERENCES `work_items` (`project_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `chk_approval_single_owner` CHECK (((`project_owner_id` IS NOT NULL) + (`milestone_owner_id` IS NOT NULL) + (`work_item_owner_id` IS NOT NULL)) = 1),
  CONSTRAINT `chk_approval_project_owner_match` CHECK (`project_owner_id` IS NULL OR `project_owner_id` = `project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='统一审核记录';

-- ============================================================
-- 22. 需求项主表 (v3.0)
-- ============================================================
CREATE TABLE IF NOT EXISTS `requirement_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `item_kind` ENUM('baseline','change') NOT NULL DEFAULT 'baseline' COMMENT 'baseline=基线需求, change=变更需求',
  `parent_requirement_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '变更需求对应的原始基线需求ID',
  `change_no` INT UNSIGNED DEFAULT NULL COMMENT '同一基线需求下的变更序号',
  `change_reason` TEXT DEFAULT NULL COMMENT '变更原因',
  `scope_note` TEXT DEFAULT NULL COMMENT '需求范围备注，例如部分功能项不在本需求范围中',
  `project_id` BIGINT UNSIGNED NOT NULL,
  `req_number` INT UNSIGNED NOT NULL COMMENT '项目内自增编号',
  `req_code` VARCHAR(100) NOT NULL COMMENT '全局唯一显示编号，如 HZY-REQ-001',
  `title` VARCHAR(500) NOT NULL,
  `type` ENUM('functional','non_functional') NOT NULL DEFAULT 'functional' COMMENT '需求类型',
  `category` VARCHAR(64) DEFAULT NULL COMMENT '非功能子类: performance/security/usability/compatibility/...',
  `priority` ENUM('P0','P1','P2','P3') NOT NULL DEFAULT 'P2',
  `source` ENUM('customer','internal','compliance','regulation','other') NOT NULL DEFAULT 'internal' COMMENT '需求来源',
  `milestone_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '预计里程碑（软关联，创建任务时带入）',
  `work_item_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '归属的需求工作项ID（tier=target,type=requirement；基线批次或变更批次）',
  `status` ENUM('draft','in_review','baselined','change_pending','deprecated') NOT NULL DEFAULT 'draft'
    COMMENT '状态: draft=草稿, in_review=评审中, baselined=已基线, change_pending=变更评审中, deprecated=已废弃',
  `current_version` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前生效版本号，0=尚未基线',
  `baselined_at` DATETIME DEFAULT NULL COMMENT '首次基线时间',
  `created_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_req_code` (`req_code`),
  UNIQUE KEY `uk_project_req_number` (`project_id`, `req_number`),
  KEY `idx_req_project_status` (`project_id`, `status`),
  KEY `idx_req_project_type` (`project_id`, `type`),
  KEY `idx_req_milestone` (`milestone_id`),
  KEY `idx_req_work_item` (`work_item_id`),
  KEY `idx_req_parent_requirement` (`parent_requirement_id`),
  UNIQUE KEY `uk_req_change_no` (`parent_requirement_id`, `change_no`),
  CONSTRAINT `fk_req_item_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_req_item_milestone` FOREIGN KEY (`milestone_id`) REFERENCES `milestones` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_req_item_work_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_req_parent_requirement` FOREIGN KEY (`parent_requirement_id`) REFERENCES `requirement_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求项';

-- ============================================================
-- 23. 需求规格书章节内容表 (v3.0)
-- ============================================================
CREATE TABLE IF NOT EXISTS `requirement_contents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `content_original_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '同一逻辑章节/内容族的首个内容ID',
  `version_no` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '内容版本号',
  `version_status` ENUM('draft','baselined','change_draft','in_review','archived') NOT NULL DEFAULT 'draft' COMMENT '内容版本状态',
  `project_id` BIGINT UNSIGNED NOT NULL,
  `parent_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '父章节ID，根章节为 NULL',
  `heading_depth` TINYINT UNSIGNED NOT NULL COMMENT '标题层级 2/3/4',
  `title` VARCHAR(500) NOT NULL COMMENT '章节标题（不含编号前缀）',
  `content_md` MEDIUMTEXT DEFAULT NULL COMMENT '本章节正文（Markdown），不包含子章节',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '同级章节顺序，导出时按此生成编号',
  `status` ENUM('imported','modified','deprecated') NOT NULL DEFAULT 'imported'
    COMMENT '章节状态: imported=初始导入, modified=系统内修改过, deprecated=已废弃',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_req_content_project_parent` (`project_id`, `parent_id`, `sort_order`),
  KEY `idx_req_content_project_status` (`project_id`, `status`),
  KEY `idx_req_content_original_status` (`content_original_id`, `version_status`),
  UNIQUE KEY `uk_req_content_original_version` (`content_original_id`, `version_no`),
  CONSTRAINT `fk_req_content_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_req_content_parent` FOREIGN KEY (`parent_id`) REFERENCES `requirement_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求规格书章节内容';

-- ============================================================
-- 23.1 需求项与规格书内容版本关联表 (v3.4)
-- ============================================================
CREATE TABLE IF NOT EXISTS `requirement_item_contents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `requirement_id` BIGINT UNSIGNED NOT NULL,
  `content_id` BIGINT UNSIGNED NOT NULL,
  `relation_type` ENUM('baseline','change','archived') NOT NULL DEFAULT 'baseline',
  `sort_order` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_req_content_relation` (`requirement_id`, `content_id`, `relation_type`),
  KEY `idx_req_item_content_requirement` (`requirement_id`, `relation_type`),
  KEY `idx_req_item_content_content` (`content_id`),
  CONSTRAINT `fk_req_item_content_requirement` FOREIGN KEY (`requirement_id`) REFERENCES `requirement_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_req_item_content_content` FOREIGN KEY (`content_id`) REFERENCES `requirement_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求项与规格书内容版本关联';

-- ============================================================
-- 24. 需求项版本快照表 (v3.0)
-- ============================================================
CREATE TABLE IF NOT EXISTS `requirement_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `requirement_id` BIGINT UNSIGNED NOT NULL,
  `version_no` INT UNSIGNED NOT NULL COMMENT '版本号 1, 2, 3...',
  `snapshot_json` JSON NOT NULL COMMENT '需求项全字段快照 + 关联章节ID列表',
  `change_type` ENUM('baseline','add','modify','delete','restore') NOT NULL COMMENT '变更类型',
  `change_reason` TEXT DEFAULT NULL COMMENT '变更原因',
  `batch_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属评审批次',
  `approval_workflow_id` VARCHAR(128) DEFAULT NULL COMMENT 'Workflow 实例 ID',
  `approved_by` VARCHAR(64) DEFAULT NULL,
  `approved_at` DATETIME DEFAULT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_req_version` (`requirement_id`, `version_no`),
  KEY `idx_req_version_batch` (`batch_id`),
  CONSTRAINT `fk_req_version_item` FOREIGN KEY (`requirement_id`) REFERENCES `requirement_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求项版本快照';

-- ============================================================
-- 25. 需求评审批次表 (v3.0)
-- ============================================================
CREATE TABLE IF NOT EXISTS `requirement_review_batches` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `batch_type` ENUM('baseline','change') NOT NULL COMMENT 'baseline=首次基线评审, change=变更评审',
  `title` VARCHAR(255) NOT NULL COMMENT '评审批次标题',
  `description` TEXT DEFAULT NULL,
  `requirement_ids_json` JSON NOT NULL COMMENT '本次评审涉及的需求ID列表',
  `status` ENUM('pending','approved','rejected','withdrawn') NOT NULL DEFAULT 'pending',
  `workflow_instance_id` VARCHAR(128) DEFAULT NULL,
  `submitted_by` VARCHAR(64) NOT NULL,
  `submitted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_req_batch_project_status` (`project_id`, `status`),
  KEY `idx_req_batch_workflow` (`workflow_instance_id`),
  CONSTRAINT `fk_req_batch_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求评审批次';

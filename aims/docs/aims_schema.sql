-- ============================================================
-- Aims (汇智云·项目) 数据库 Schema
-- 数据库名: hzy_aims
-- 创建日期: 2026-03-21
-- 更新日期: 2026-07-10
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
  `is_product_line` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '[deprecated] 是否为产品线, 已由 default_category=product_dev 表达, 保留兼容',
  `default_category` ENUM('product_dev','custom_dev','delivery','maintenance','sales','presales','compliance','routine') DEFAULT NULL COMMENT '子项目默认分类, NULL=不预设; routine 为强约束不可覆盖',
  `is_system` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '系统预置项目集, 1=不可删除',
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
  KEY `idx_portfolio_default_category` (`default_category`),
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
  `category` ENUM('product_dev','custom_dev','delivery','maintenance','sales','presales','improvement','compliance','routine') NOT NULL COMMENT '适用项目分类(improvement 已停用, 保留供存量读取)',
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
  `category` ENUM('product_dev','custom_dev','delivery','maintenance','sales','presales','improvement','compliance','routine') NOT NULL DEFAULT 'product_dev' COMMENT '项目分类(improvement 已停用, 保留供存量读取; routine=日常事务容器)',
  `methodology` ENUM('PIVR','agile','waterfall','kanban','hybrid') NOT NULL DEFAULT 'PIVR' COMMENT '管理方法论(统一为PIVR, 预留敏捷/瀑布/看板等)',
  `lifecycle_status` ENUM('draft','approval_pending','active','paused','completed','archived') NOT NULL DEFAULT 'draft' COMMENT '项目业务状态',
  `portfolio_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属项目集',
  `domain_code` VARCHAR(50) DEFAULT NULL COMMENT '业务领域(关联Account business_domains)',
  `dept_code` VARCHAR(50) DEFAULT NULL COMMENT '所属部门(关联Account)',
  `leader_uid` VARCHAR(64) NOT NULL COMMENT '项目负责人(关联Account)',
  `security_level` ENUM('company','department','project_team','whitelist') NOT NULL DEFAULT 'company' COMMENT '项目可见范围: company=公司范围可见, department=所属部门可见, project_team=项目组可见, whitelist=白名单可见',
  `confidentiality_level` ENUM('L0','L1','L2','L3') NOT NULL DEFAULT 'L1' COMMENT '项目密级: L0=公开, L1=内部, L2=机密, L3=绝密',
  `access_whitelist` JSON DEFAULT NULL COMMENT '项目访问白名单UID数组，仅 security_level=whitelist 时用于额外授权',
  `start_date` DATE DEFAULT NULL COMMENT '计划开始日期',
  `end_date` DATE DEFAULT NULL COMMENT '计划结束日期',
  `opp_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联Altoc商机ID(逻辑关联, 非外键)',
  `contract_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联Altoc合同ID(逻辑关联, 非外键)',
  `customer_code` VARCHAR(100) DEFAULT NULL COMMENT '客户编码(关联Altoc customer.code)',
  `customer_name` VARCHAR(200) DEFAULT NULL COMMENT '客户名称',
  `contract_code` VARCHAR(100) DEFAULT NULL COMMENT '关联合同编号(关联Altoc contract.code)',
  `service_line_code` VARCHAR(64) DEFAULT NULL COMMENT '服务链标识，串联同一客户同一服务的历年项目',
  `service_period_seq` SMALLINT UNSIGNED DEFAULT NULL COMMENT '服务年度序号',
  `service_period_start` DATE DEFAULT NULL COMMENT '服务年度开始日期',
  `service_period_end` DATE DEFAULT NULL COMMENT '服务年度结束日期',
  `service_period_label` VARCHAR(32) DEFAULT NULL COMMENT '服务年度展示标签，如 2026.03-2027.02',
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
  UNIQUE KEY `uk_aims_project_opportunity_category` (`opp_id`, `category`),
  KEY `idx_category` (`category`),
  KEY `idx_lifecycle_status` (`lifecycle_status`),
  KEY `idx_portfolio` (`portfolio_id`),
  KEY `idx_domain_code` (`domain_code`),
  KEY `idx_dept_code` (`dept_code`),
  KEY `idx_leader_uid` (`leader_uid`),
  KEY `idx_security_level_dept` (`security_level`, `dept_code`),
  KEY `idx_confidentiality_security_dept` (`confidentiality_level`, `security_level`, `dept_code`),
  KEY `idx_customer_code` (`customer_code`),
  KEY `idx_opp_id` (`opp_id`),
  KEY `idx_contract_id` (`contract_id`),
  KEY `idx_service_line` (`service_line_code`, `service_period_seq`),
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
  `obligation_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '新周报责任义务',
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
  `status` ENUM('draft','submitted','returned','reviewed','frozen','correction_draft') NOT NULL DEFAULT 'draft' COMMENT '周报状态',
  `current_version_no` INT UNSIGNED NOT NULL DEFAULT 0,
  `current_submitted_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `current_reviewed_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `current_frozen_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `pending_correction_of_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `pending_correction_reason` VARCHAR(1000) DEFAULT NULL,
  `pending_correction_request_id` BIGINT UNSIGNED DEFAULT NULL,
  `created_by` VARCHAR(64) NOT NULL COMMENT '创建人uid',
  `updated_by` VARCHAR(64) DEFAULT NULL COMMENT '最后更新人uid',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_week` (`project_id`, `report_year`, `report_week`),
  UNIQUE KEY `uk_weekly_report_obligation` (`obligation_id`),
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
  `entity_type` ENUM('project','milestone','requirement','task','bug','target','matter') NOT NULL,
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
  `entity_type` ENUM('project','milestone','requirement','task','bug','target','matter') NOT NULL,
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
  `completion_lock_request_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '当前有效里程碑完成申请锁',
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
  KEY `idx_milestone_completion_lock` (`completion_lock_request_id`),
  KEY `idx_project_mode` (`project_id`, `mode`),
  KEY `idx_milestone_project_template_key` (`project_id`, `template_key`),
  CONSTRAINT `fk_milestone_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='里程碑(目标层)';

CREATE TABLE IF NOT EXISTS `milestone_cycle_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `source_milestone_id` BIGINT UNSIGNED NOT NULL COMMENT '关期来源里程碑',
  `next_milestone_id` BIGINT UNSIGNED NOT NULL COMMENT '新周期里程碑',
  `template_key` VARCHAR(100) NOT NULL COMMENT '周期模板键',
  `period_start` DATE NOT NULL COMMENT '新周期开始日期',
  `period_end` DATE NOT NULL COMMENT '新周期结束日期',
  `carryover_mode` ENUM('auto','manual') NOT NULL DEFAULT 'auto',
  `completed_count` INT NOT NULL DEFAULT 0,
  `carryover_count` INT NOT NULL DEFAULT 0,
  `total_work_items` INT NOT NULL DEFAULT 0,
  `total_hours` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `gate_result` JSON DEFAULT NULL COMMENT '五项关期门逐项校验结果',
  `gate_passed` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '关期门是否全部通过',
  `exception_reason` TEXT DEFAULT NULL COMMENT '未通过项例外原因',
  `exception_owner_uid` VARCHAR(64) DEFAULT NULL COMMENT '例外补救责任人',
  `exception_due_date` DATE DEFAULT NULL COMMENT '例外计划关闭日期',
  `confirmed_by` VARCHAR(64) DEFAULT NULL COMMENT '关期确认人',
  `confirmed_at` DATETIME(6) DEFAULT NULL COMMENT '关期确认时间',
  `sla_snapshot` JSON DEFAULT NULL COMMENT '关期时 SLA 执行快照，最终判定仍以 Altoc 为准',
  `period_cost` DECIMAL(14,2) DEFAULT NULL COMMENT '本周期已归集成本',
  `idempotency_key` VARCHAR(180) NOT NULL,
  `source_app` VARCHAR(32) NOT NULL DEFAULT 'aims',
  `source_biz_type` VARCHAR(64) NOT NULL DEFAULT 'milestone_rollover',
  `source_biz_code` VARCHAR(180) NOT NULL,
  `request_id` VARCHAR(100) DEFAULT NULL,
  `actor_uid` VARCHAR(64) DEFAULT NULL,
  `service_client_id` VARCHAR(100) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cycle_project_template_period` (`project_id`, `template_key`, `period_start`),
  UNIQUE KEY `uk_cycle_idempotency` (`idempotency_key`),
  KEY `idx_cycle_source_milestone` (`source_milestone_id`),
  KEY `idx_cycle_next_milestone` (`next_milestone_id`),
  CONSTRAINT `fk_cycle_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cycle_source_milestone` FOREIGN KEY (`source_milestone_id`) REFERENCES `milestones` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cycle_next_milestone` FOREIGN KEY (`next_milestone_id`) REFERENCES `milestones` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='周期性里程碑关期快照';

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
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `scope_revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `planning_mode` ENUM('cycle','simple') NOT NULL DEFAULT 'cycle' COMMENT 'cycle=高级周期评分规划；simple=轻量版本计划',
  `business_owner_uid` VARCHAR(64) DEFAULT NULL,
  `current_release_record_id` BIGINT UNSIGNED DEFAULT NULL,
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
  `product_feature_id` BIGINT UNSIGNED DEFAULT NULL,
  `planning_item_id` BIGINT UNSIGNED DEFAULT NULL,
  `change_type` ENUM('new','enhancement','fix','retirement') DEFAULT NULL,
  `acceptance_criteria` TEXT DEFAULT NULL,
  `deferred_from_feature_id` BIGINT UNSIGNED DEFAULT NULL,
  UNIQUE KEY `uk_pc_version_feature` (`version_id`,`product_feature_id`),
  UNIQUE KEY `uk_pc_version_planning` (`planning_item_id`),
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
-- milestone_id 对 PIVR 项目必填；routine 日常事务容器不生成里程碑，工作项必须为空
-- level: target(目标) -> matter(事项/任务)
-- type: requirement(需求), task(任务), bug(缺陷) — 仅作分类标签，不影响状态流
-- Target 层状态: planning → todo → in_progress → in_review → completed
-- Matter 层状态: todo → in_progress → in_review → completed
CREATE TABLE IF NOT EXISTS `work_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `milestone_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属里程碑；routine 项目可空，其余项目必填',
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
  `routine_scope` ENUM('department','cross_dept') DEFAULT NULL COMMENT '日常事务归属，仅 routine 类项目使用',
  `beneficiary_dept_code` VARCHAR(50) DEFAULT NULL COMMENT '受益部门，routine_scope=cross_dept 时必填',
  `is_unplanned` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '计划外工作标记',
  `carryover_origin_item_key` VARCHAR(64) DEFAULT NULL COMMENT '首次结转时冻结的原工作项标识',
  `carryover_origin_milestone_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '首次结转来源周期里程碑',
  `carryover_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计连续结转次数',
  `carryover_governance_abnormal` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '连续结转三期及以上治理异常',
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
  KEY `idx_work_items_due_scan` (`due_date`, `status`, `priority`, `severity`, `id`),
  KEY `idx_parent` (`parent_id`),
  KEY `idx_project_parent` (`project_id`, `parent_id`),
  KEY `idx_work_item_project_required` (`project_id`, `required`),
  KEY `idx_work_item_project_template_key` (`project_id`, `template_key`),
  KEY `idx_routine_beneficiary` (`beneficiary_dept_code`, `routine_scope`),
  KEY `idx_work_item_carryover_governance` (`project_id`, `carryover_governance_abnormal`, `carryover_count`),
  KEY `idx_work_items_req_category` (`project_id`, `requirement_category`),
  KEY `idx_work_items_decomp_src` (`decomposition_source_id`),
  KEY `idx_type_status` (`type`, `status`),
  KEY `idx_work_item_requirement` (`requirement_id`),
  KEY `idx_work_item_change_request` (`change_request_of`),
  CONSTRAINT `fk_item_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_item_project_milestone` FOREIGN KEY (`project_id`, `milestone_id`) REFERENCES `milestones` (`project_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_item_parent` FOREIGN KEY (`parent_id`) REFERENCES `work_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_work_item_change_request` FOREIGN KEY (`change_request_of`) REFERENCES `work_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_work_item_version` FOREIGN KEY (`version_id`) REFERENCES `product_versions` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_work_item_feature` FOREIGN KEY (`feature_id`) REFERENCES `product_version_features` (`id`) ON DELETE SET NULL
  -- fk_item_type_status 已移除：status 改为 ENUM，由数据库类型约束保证合法性
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='统一工作项(支持嵌套)';
-- 注:
--   1. parent_id 与 project_id 的同项目一致性由触发器保证
--   2. 存在子工作项时, 不允许将父工作项移动到其他项目

-- ============================================================
-- 7.1 项目周报工作项明细（依赖 work_items）
-- ============================================================
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

CREATE TABLE IF NOT EXISTS `work_item_service_ext` (
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `source_ticket_code` VARCHAR(64) NOT NULL,
  `customer_code` VARCHAR(100) DEFAULT NULL,
  `environment_code` VARCHAR(64) DEFAULT NULL,
  `response_due_at` DATETIME DEFAULT NULL,
  `resolution_due_at` DATETIME DEFAULT NULL,
  `sla_status_snapshot` VARCHAR(30) DEFAULT NULL,
  `first_responded_at` DATETIME DEFAULT NULL,
  `resolved_at` DATETIME DEFAULT NULL,
  `last_synced_at` DATETIME DEFAULT NULL,
  `delivery_generation` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '每次实际映射状态变化递增',
  `last_delivery_status` VARCHAR(30) DEFAULT NULL COMMENT '最近已冻结的Altoc映射状态',
  PRIMARY KEY (`work_item_id`),
  KEY `idx_svc_ext_project_customer` (`project_id`, `customer_code`),
  KEY `idx_svc_ext_project_env` (`project_id`, `environment_code`),
  KEY `idx_svc_ext_response_due` (`response_due_at`, `work_item_id`),
  KEY `idx_svc_ext_resolution_due` (`resolution_due_at`, `work_item_id`),
  UNIQUE KEY `uk_svc_ext_ticket` (`source_ticket_code`),
  CONSTRAINT `fk_svc_ext_work_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_svc_ext_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Altoc 服务工单执行扩展字段';

-- Aims 是到期通知事件的事实源：该表记录事件打开/关闭及 Console 投递证据。
-- event_version 随日期、状态、风险等级或责任字段变化，actionable_key 在同一事项流内稳定。
CREATE TABLE IF NOT EXISTS `aims_notification_checkpoint` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_stream` ENUM('response_due','resolution_due','work_item_due') NOT NULL,
  `source_id` BIGINT UNSIGNED NOT NULL COMMENT 'work_items.id',
  `condition_generation` BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '同一工作项/事件流的条件代次',
  `phase` VARCHAR(16) NOT NULL COMMENT 'T-4h/T-1h/breached 或 D3/D1/overdue',
  `source_version` CHAR(64) NOT NULL,
  `event_version` VARCHAR(64) NOT NULL,
  `previous_event_version` VARCHAR(64) DEFAULT NULL COMMENT '同代次上一提醒阶段，用于 pending projection CAS supersede',
  `previous_recipient_uid` VARCHAR(64) DEFAULT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `actionable_key` VARCHAR(191) NOT NULL,
  `due_at` DATETIME NOT NULL,
  `work_item_status` VARCHAR(32) NOT NULL,
  `priority` VARCHAR(16) NOT NULL,
  `severity` VARCHAR(16) DEFAULT NULL,
  `assignee_uid` VARCHAR(64) DEFAULT NULL,
  `project_leader_uid` VARCHAR(64) DEFAULT NULL,
  `dept_code` VARCHAR(64) DEFAULT NULL,
  `state` ENUM('open','closed') NOT NULL DEFAULT 'open',
  `close_reason` ENUM('superseded','condition_resolved','condition_cancelled') DEFAULT NULL,
  `notification_id` VARCHAR(128) DEFAULT NULL,
  `notified_recipient_uid` VARCHAR(64) DEFAULT NULL,
  `opened_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` DATETIME DEFAULT NULL,
  `acknowledged_at` DATETIME DEFAULT NULL,
  `lifecycle_next_version` VARCHAR(191) DEFAULT NULL,
  `lifecycle_closed_at` DATETIME DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aims_notification_event_version` (`event_version`),
  UNIQUE KEY `uk_aims_notification_idempotency` (`idempotency_key`),
  KEY `idx_aims_notification_open_source` (`event_stream`, `state`, `source_id`),
  KEY `idx_aims_notification_generation` (`event_stream`, `source_id`, `condition_generation`, `id`),
  KEY `idx_aims_notification_due_cursor` (`event_stream`, `due_at`, `source_id`),
  KEY `idx_aims_notification_lifecycle` (`event_stream`, `state`, `lifecycle_closed_at`, `closed_at`),
  CONSTRAINT `fk_aims_notification_work_item` FOREIGN KEY (`source_id`) REFERENCES `work_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Aims SLA/高风险工作项通知 checkpoint';

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
  `review_status` ENUM('draft','submitted','approved','returned') NOT NULL DEFAULT 'draft',
  `review_route` ENUM('project_manager','company_summary') DEFAULT NULL,
  `reviewer_uid_snapshot` VARCHAR(64) DEFAULT NULL,
  `locked_report_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `submitted_at` DATETIME(6) DEFAULT NULL,
  `reviewed_by` VARCHAR(64) DEFAULT NULL,
  `reviewed_at` DATETIME(6) DEFAULT NULL,
  `return_reason` VARCHAR(1000) DEFAULT NULL,
  `approved_summary_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `corrects_entry_id` BIGINT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_project_date` (`project_id`, `entry_date`),
  KEY `idx_work_item` (`work_item_id`),
  KEY `idx_weekly_report` (`weekly_report_id`),
  KEY `idx_uid_date` (`uid`, `entry_date`),
  KEY `idx_time_review_status` (`review_status`, `entry_date`),
  KEY `idx_time_corrects_entry` (`corrects_entry_id`),
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
-- 14.1 GitLab Issue 关联表
-- ============================================================
CREATE TABLE IF NOT EXISTS `gitlab_issue_links` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT 'Aims项目ID',
  `work_item_id` BIGINT UNSIGNED NOT NULL COMMENT 'Aims工作项ID',
  `repo_project_code` VARCHAR(255) NOT NULL COMMENT 'GitLab仓库project_code',
  `issue_iid` BIGINT UNSIGNED NOT NULL COMMENT 'GitLab项目内Issue IID',
  `issue_url` VARCHAR(1000) NOT NULL COMMENT 'GitLab Issue URL',
  `issue_state` ENUM('opened','closed') NOT NULL DEFAULT 'opened',
  `last_synced_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gitlab_issue_work_item_repo` (`work_item_id`, `repo_project_code`),
  UNIQUE KEY `uk_gitlab_issue_repo_iid` (`repo_project_code`, `issue_iid`),
  KEY `idx_gitlab_issue_project` (`project_id`),
  CONSTRAINT `fk_gitlab_issue_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gitlab_issue_work_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gitlab_issue_project_repo` FOREIGN KEY (`project_id`, `repo_project_code`) REFERENCES `aims_project_repos` (`project_id`, `repo_project_code`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Aims工作项与GitLab Issue关联';

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

-- 先幂等写入所有流转依赖的父状态，再写 workflow_transitions。
INSERT INTO `workflow_status_catalog` (`entity_type`, `status`, `is_initial`, `is_terminal`, `sort_order`) VALUES
('project', 'draft', 1, 0, 10),
('project', 'approval_pending', 0, 0, 20),
('project', 'active', 0, 0, 30),
('project', 'paused', 0, 0, 40),
('project', 'completed', 0, 0, 50),
('project', 'archived', 0, 1, 60),
('milestone', 'planning', 1, 0, 10),
('milestone', 'active', 0, 0, 20),
('milestone', 'completed', 0, 1, 30),
('requirement', 'draft', 1, 0, 10),
('requirement', 'reviewing', 0, 0, 20),
('requirement', 'confirmed', 0, 0, 30),
('requirement', 'developing', 0, 0, 40),
('requirement', 'completed', 0, 1, 50),
('task', 'todo', 1, 0, 10),
('task', 'in_progress', 0, 0, 20),
('task', 'done', 0, 1, 30),
('bug', 'new', 1, 0, 10),
('bug', 'confirmed', 0, 0, 20),
('bug', 'fixing', 0, 0, 30),
('bug', 'verifying', 0, 0, 40),
('bug', 'closed', 0, 1, 50),
('target', 'planning', 1, 0, 10),
('target', 'todo', 0, 0, 20),
('target', 'in_progress', 0, 0, 30),
('target', 'in_review', 0, 0, 40),
('target', 'completed', 0, 1, 50),
('matter', 'todo', 1, 0, 10),
('matter', 'in_progress', 0, 0, 20),
('matter', 'in_review', 0, 0, 30),
('matter', 'completed', 0, 1, 40)
ON DUPLICATE KEY UPDATE
  `is_initial` = VALUES(`is_initial`),
  `is_terminal` = VALUES(`is_terminal`),
  `sort_order` = VALUES(`sort_order`);

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

-- V2 target/matter 工作项流转；保留 legacy type 规则以兼容旧读写路径。
INSERT INTO `workflow_transitions` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`) VALUES
(NULL, 'target', 'planning', 'todo', 'decompose'),
(NULL, 'target', 'todo', 'in_progress', 'start'),
(NULL, 'target', 'in_progress', 'todo', 'reset'),
(NULL, 'target', 'in_progress', 'in_review', 'submit'),
(NULL, 'target', 'in_review', 'completed', 'approve'),
(NULL, 'target', 'in_review', 'in_progress', 'reject'),
(NULL, 'target', 'completed', 'in_progress', 'reopen'),
(NULL, 'matter', 'todo', 'in_progress', 'start'),
(NULL, 'matter', 'in_progress', 'todo', 'reset'),
(NULL, 'matter', 'in_progress', 'in_review', 'submit'),
(NULL, 'matter', 'in_review', 'completed', 'approve'),
(NULL, 'matter', 'in_review', 'in_progress', 'reject'),
(NULL, 'matter', 'completed', 'in_progress', 'reopen');

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
  `current_submission_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '当前不可变交付提交',
  `quality_status` ENUM('not_required','pending','preparing_review','awaiting_review','passed','returned','waived') NOT NULL DEFAULT 'pending',

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
  KEY `idx_deliverable_quality_status` (`quality_status`, `project_id`),
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
  `request_no` VARCHAR(100) DEFAULT NULL COMMENT '不可复用完成申请编号',
  `request_version` INT UNSIGNED NOT NULL DEFAULT 1,

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
  `snapshot_json` JSON DEFAULT NULL COMMENT '申请时验收事实快照',
  `snapshot_sha256` CHAR(64) DEFAULT NULL,
  `idempotency_key` VARCHAR(180) DEFAULT NULL,
  `locked_at` DATETIME(6) DEFAULT NULL,

  -- 审核
  `reviewer_uid` VARCHAR(64) DEFAULT NULL COMMENT '审核人uid（空=待分配）',
  `reviewer_role_code` VARCHAR(64) DEFAULT NULL COMMENT '动态审核职责角色编码',
  `reviewer_role_revision` BIGINT UNSIGNED DEFAULT NULL COMMENT '发起或最终处理时角色持有人版本',
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
  UNIQUE KEY `uk_approval_request_no` (`request_no`),
  UNIQUE KEY `uk_approval_idempotency_key` (`idempotency_key`),
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

-- work_items 与 requirement_items 相互引用；待两表均建立后补充此外键。
ALTER TABLE `work_items`
  ADD CONSTRAINT `fk_work_item_requirement`
  FOREIGN KEY (`requirement_id`) REFERENCES `requirement_items` (`id`) ON DELETE SET NULL;

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

-- ============================================================
-- 26. 跨应用可靠操作（调用方 Outbox / 尝试历史 / 目标 Inbox）
-- ============================================================
-- 每条 integration_operation 只表示一个不同目标应用的单一命令。
-- operation_code 仅作为版本化 dispatcher 代码映射键；required_capability
-- 仅作审计快照。命令、错误与响应摘要不得保存凭证、内部 URL 或完整正文。
CREATE TABLE IF NOT EXISTS aims_contribution_snapshot_versions (
  scope_key VARCHAR(64) NOT NULL PRIMARY KEY COMMENT 'project/cycle/source 原始作用域的 SHA-256',
  cycle_code VARCHAR(64) NOT NULL,
  project_code VARCHAR(64) NOT NULL,
  source_app VARCHAR(64) NOT NULL,
  source_biz_type VARCHAR(64) NOT NULL,
  revision_no BIGINT UNSIGNED NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  operation_key VARCHAR(191) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_aims_contribution_scope_revision (cycle_code, project_code, source_app, source_biz_type, revision_no),
  UNIQUE KEY uk_aims_contribution_scope_operation (operation_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Aims 工时贡献冻结快照单调版本';

CREATE TABLE IF NOT EXISTS integration_operation (
  operation_id CHAR(36) PRIMARY KEY COMMENT '全局稳定操作UUID；创建后不可修改',
  operation_key VARCHAR(191) NOT NULL COMMENT '调用方稳定业务操作键；创建后不可修改',
  correlation_key VARCHAR(191) NOT NULL COMMENT '多目标命令链业务关联键；单命令可等于operation_key',
  sequence_no INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '同一命令链内序号；创建后不可修改',
  depends_on_operation_key VARCHAR(191) DEFAULT NULL COMMENT '前置业务操作键；仅依赖成功后可派发',
  tenant_code VARCHAR(100) NOT NULL COMMENT '经认证上下文确认的租户；创建后不可修改',
  deployment_code VARCHAR(100) NOT NULL COMMENT '经认证上下文确认的部署；创建后不可修改',
  source_app VARCHAR(50) NOT NULL COMMENT '调用方应用；创建后不可修改且不得等于target_app',
  target_app VARCHAR(50) NOT NULL COMMENT '单一目标应用；创建后不可修改且不得等于source_app',
  operation_code VARCHAR(191) NOT NULL COMMENT '版本化dispatcher代码映射键；创建后不可修改',
  required_capability VARCHAR(191) NOT NULL COMMENT '创建时所需capability审计快照；不得作为dispatcher可执行来源',
  source_biz_type VARCHAR(100) NOT NULL COMMENT '调用方稳定业务对象类型；创建后不可修改',
  source_biz_code VARCHAR(191) NOT NULL COMMENT '调用方稳定业务对象编码；创建后不可修改',
  target_receipt_id CHAR(36) DEFAULT NULL COMMENT '目标端原子回执 UUID；source success 确认后写入',
  target_biz_type VARCHAR(100) DEFAULT NULL COMMENT '目标业务对象类型；成功确认后写入',
  target_biz_code VARCHAR(191) DEFAULT NULL COMMENT '目标稳定业务对象编码；成功确认后写入',
  idempotency_key VARCHAR(191) NOT NULL COMMENT '发送给目标服务的稳定幂等键；创建后不可修改',
  command_schema_version VARCHAR(30) NOT NULL DEFAULT 'v1' COMMENT '冻结命令schema版本；创建后不可修改',
  command_json JSON NOT NULL COMMENT '冻结命令载荷；不得包含Token、凭证、内部URL或动态路由字段',
  command_sha256 CHAR(64) NOT NULL COMMENT '规范化命令载荷SHA-256；创建后不可修改',
  status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT '状态：pending/processing/retry_wait/partial_unknown/succeeded/failed_permanent/dead_letter/cancelled',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已开始尝试次数',
  max_attempts INT UNSIGNED NOT NULL DEFAULT 8 COMMENT '最大自动尝试次数',
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '下次可领取时间',
  last_attempt_at DATETIME(3) DEFAULT NULL COMMENT '最近尝试开始时间',
  locked_by VARCHAR(100) DEFAULT NULL COMMENT '当前持有租约的worker标识',
  locked_until DATETIME(3) DEFAULT NULL COMMENT '当前租约截止时间',
  fencing_token BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '每次领取递增的栅栏令牌，拒绝陈旧worker写回',
  version_no BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本；每次状态写入递增',
  original_request_id VARCHAR(100) DEFAULT NULL COMMENT '原始调用请求ID',
  correlation_id VARCHAR(100) DEFAULT NULL COMMENT '跨服务技术追踪关联ID',
  original_actor_uid VARCHAR(100) DEFAULT NULL COMMENT '经验证的原始用户actor UID',
  service_client_id VARCHAR(100) DEFAULT NULL COMMENT '经验证的调用服务client ID',
  replay_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '管理员人工重放次数',
  last_replay_actor_uid VARCHAR(100) DEFAULT NULL COMMENT '最近人工重放管理员UID',
  last_replay_reason VARCHAR(500) DEFAULT NULL COMMENT '最近人工重放原因；不得包含敏感信息',
  last_replay_at DATETIME(3) DEFAULT NULL COMMENT '最近人工重放时间',
  last_http_status SMALLINT UNSIGNED DEFAULT NULL COMMENT '最近下游HTTP状态码',
  last_error_code VARCHAR(100) DEFAULT NULL COMMENT '安全稳定错误码；不得保存内部地址或凭证',
  last_error_class VARCHAR(50) DEFAULT NULL COMMENT '安全错误分类：authentication/authorization/transient/contract/conflict/protocol等',
  last_error_summary VARCHAR(1000) DEFAULT NULL COMMENT '脱敏错误摘要；不得保存响应正文、Token、内部URL或堆栈',
  last_error_at DATETIME(3) DEFAULT NULL COMMENT '最近错误时间',
  response_summary_sha256 CHAR(64) DEFAULT NULL COMMENT '脱敏响应摘要SHA-256；不保存完整响应',
  failure_notified_at DATETIME(3) DEFAULT NULL COMMENT '达到失败阈值后的首次通知时间，用于一次性告警',
  failure_notification_id VARCHAR(64) DEFAULT NULL COMMENT 'Console幂等通知ID；仅在发布成功后写入',
  succeeded_at DATETIME(3) DEFAULT NULL COMMENT '目标效果确认成功时间',
  failed_permanent_at DATETIME(3) DEFAULT NULL COMMENT '进入failed_permanent时间',
  dead_lettered_at DATETIME(3) DEFAULT NULL COMMENT '进入dead_letter时间',
  cancelled_at DATETIME(3) DEFAULT NULL COMMENT '受控取消时间',
  created_by VARCHAR(100) DEFAULT NULL COMMENT '创建者UID或服务client ID',
  updated_by VARCHAR(100) DEFAULT NULL COMMENT '最近更新者UID或worker标识',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',

  UNIQUE KEY uk_iop_identity (tenant_code, deployment_code, source_app, target_app, operation_code, idempotency_key),
  UNIQUE KEY uk_iop_operation_key (tenant_code, deployment_code, source_app, operation_key),
  UNIQUE KEY uk_iop_chain_sequence (tenant_code, deployment_code, source_app, correlation_key, sequence_no),
  INDEX idx_iop_due (status, next_attempt_at, locked_until),
  INDEX idx_iop_lock (status, locked_until),
  INDEX idx_iop_source_biz (tenant_code, deployment_code, source_app, source_biz_type, source_biz_code),
  INDEX idx_iop_target_biz (tenant_code, deployment_code, target_app, target_biz_type, target_biz_code),
  INDEX idx_iop_dependency (tenant_code, deployment_code, source_app, depends_on_operation_key),
  INDEX idx_iop_request (tenant_code, deployment_code, original_request_id),
  INDEX idx_iop_correlation_id (tenant_code, deployment_code, correlation_id),
  INDEX idx_iop_correlation_key (tenant_code, deployment_code, source_app, correlation_key, sequence_no),
  INDEX idx_iop_failure_notification (tenant_code, deployment_code, source_app, status, failure_notified_at, dead_lettered_at, operation_id),
  CONSTRAINT chk_iop_cross_app CHECK (source_app <> target_app),
  CONSTRAINT chk_iop_status CHECK (status IN ('pending', 'processing', 'retry_wait', 'partial_unknown', 'succeeded', 'failed_permanent', 'dead_letter', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='调用方跨应用单目标命令Outbox；身份和命令字段创建后不可修改';

CREATE TABLE IF NOT EXISTS integration_operation_dead_letter_actionable (
  operation_id CHAR(36) NOT NULL COMMENT '来源integration operation UUID',
  generation_no BIGINT UNSIGNED NOT NULL COMMENT '以进入dead_letter时operation version作为单调generation',
  tenant_code VARCHAR(100) NOT NULL,
  deployment_code VARCHAR(100) NOT NULL,
  source_app VARCHAR(64) NOT NULL,
  target_app VARCHAR(64) NOT NULL,
  operation_code VARCHAR(191) NOT NULL,
  source_biz_type VARCHAR(64) NOT NULL,
  source_biz_code VARCHAR(191) NOT NULL,
  attempt_count INT UNSIGNED NOT NULL,
  max_attempts INT UNSIGNED NOT NULL,
  last_error_code VARCHAR(100) DEFAULT NULL COMMENT '安全稳定错误码；不保存raw error',
  last_error_class VARCHAR(50) DEFAULT NULL,
  dead_lettered_at DATETIME(3) NOT NULL,
  original_actor_uid VARCHAR(100) DEFAULT NULL,
  source_operation_version BIGINT UNSIGNED NOT NULL,
  actionable_key VARCHAR(191) NOT NULL,
  publish_object_version VARCHAR(191) NOT NULL,
  notification_id VARCHAR(64) DEFAULT NULL,
  recipient_uids JSON DEFAULT NULL COMMENT 'Console实际返回的规范化显式收件UID数组',
  publish_acked_at DATETIME(3) DEFAULT NULL,
  closure_state VARCHAR(16) DEFAULT NULL COMMENT 'resolved/cancelled',
  closure_object_version VARCHAR(191) DEFAULT NULL,
  closure_pending_at DATETIME(3) DEFAULT NULL,
  closure_acked_at DATETIME(3) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id, generation_no),
  UNIQUE KEY uk_iopdla_actionable (tenant_code, deployment_code, source_app, actionable_key),
  UNIQUE KEY uk_iopdla_notification (tenant_code, deployment_code, source_app, notification_id),
  INDEX idx_iopdla_publish (tenant_code, deployment_code, source_app, publish_acked_at, dead_lettered_at),
  INDEX idx_iopdla_closure (tenant_code, deployment_code, source_app, closure_acked_at, closure_pending_at),
  CONSTRAINT fk_iopdla_operation FOREIGN KEY (operation_id) REFERENCES integration_operation(operation_id) ON DELETE RESTRICT,
  CONSTRAINT chk_iopdla_closure CHECK (closure_state IS NULL OR closure_state IN ('resolved','cancelled')),
  CONSTRAINT chk_iopdla_recipient CHECK (recipient_uids IS NULL OR JSON_TYPE(recipient_uids) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='跨应用死信actionable generation发布与closure证据';

CREATE TABLE IF NOT EXISTS integration_operation_attempt (
  attempt_id CHAR(36) PRIMARY KEY COMMENT '全局稳定尝试UUID',
  operation_id CHAR(36) NOT NULL COMMENT '所属integration operation UUID',
  operation_code VARCHAR(191) NOT NULL COMMENT '版本化dispatcher代码映射键审计快照',
  attempt_no INT UNSIGNED NOT NULL COMMENT '操作内递增尝试序号',
  trigger_type VARCHAR(32) NOT NULL COMMENT '触发方式：immediate/scheduled/manual_replay/lease_recovery',
  request_id VARCHAR(100) DEFAULT NULL COMMENT '本次派发请求ID',
  correlation_id VARCHAR(100) DEFAULT NULL COMMENT '本次跨服务技术追踪关联ID',
  locked_by VARCHAR(100) DEFAULT NULL COMMENT '本次执行worker标识快照',
  fencing_token BIGINT UNSIGNED NOT NULL COMMENT '本次执行栅栏令牌',
  result_status VARCHAR(32) NOT NULL DEFAULT 'processing' COMMENT '尝试状态：processing；完成后一次性收口为succeeded/retry_wait/partial_unknown/failed_permanent/dead_letter/cancelled',
  http_status SMALLINT UNSIGNED DEFAULT NULL COMMENT '下游HTTP状态码',
  error_code VARCHAR(100) DEFAULT NULL COMMENT '安全稳定错误码',
  error_class VARCHAR(50) DEFAULT NULL COMMENT '安全错误分类',
  error_summary VARCHAR(1000) DEFAULT NULL COMMENT '脱敏错误摘要；不得保存响应正文、Token、内部URL或堆栈',
  target_biz_type VARCHAR(100) DEFAULT NULL COMMENT '本次确认的目标业务对象类型',
  target_biz_code VARCHAR(191) DEFAULT NULL COMMENT '本次确认的目标稳定业务对象编码',
  response_summary_sha256 CHAR(64) DEFAULT NULL COMMENT '脱敏响应摘要SHA-256；不保存完整响应',
  started_at DATETIME(3) NOT NULL COMMENT '尝试开始时间',
  finished_at DATETIME(3) DEFAULT NULL COMMENT '尝试结束时间',
  duration_ms BIGINT UNSIGNED DEFAULT NULL COMMENT '尝试耗时毫秒',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '追加时间；身份字段禁止修改，processing仅允许一次性写入完成结果',

  UNIQUE KEY uk_ioa_operation_attempt (operation_id, attempt_no),
  INDEX idx_ioa_operation_created (operation_id, created_at),
  INDEX idx_ioa_operation_code (operation_code, created_at),
  INDEX idx_ioa_request (request_id),
  INDEX idx_ioa_correlation (correlation_id, created_at),
  INDEX idx_ioa_result (result_status, created_at),
  INDEX idx_ioa_error (error_class, error_code, created_at),
  CONSTRAINT fk_ioa_operation FOREIGN KEY (operation_id) REFERENCES integration_operation(operation_id) ON DELETE RESTRICT,
  CONSTRAINT chk_ioa_result_status CHECK (result_status IN ('processing', 'succeeded', 'retry_wait', 'partial_unknown', 'failed_permanent', 'dead_letter', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='跨应用命令执行尝试安全审计日志；身份行追加，processing只允许一次性收口且不保存命令/响应正文或凭证';

CREATE TABLE IF NOT EXISTS service_command_receipt (
  receipt_id CHAR(36) PRIMARY KEY COMMENT '全局稳定目标回执UUID',
  operation_id CHAR(36) NOT NULL COMMENT '调用方integration operation UUID；创建后不可修改',
  operation_code VARCHAR(191) NOT NULL COMMENT '版本化目标命令代码；创建后不可修改',
  tenant_code VARCHAR(100) NOT NULL COMMENT '目标端验证后的租户；创建后不可修改',
  source_deployment_code VARCHAR(100) NOT NULL COMMENT '目标 BFF 验证后的调用方部署；创建后不可修改',
  deployment_code VARCHAR(100) NOT NULL COMMENT '目标 Runtime token 验证后的目标部署；创建后不可修改',
  source_app VARCHAR(50) NOT NULL COMMENT '目标端验证后的调用方；创建后不可修改且不得等于target_app',
  target_app VARCHAR(50) NOT NULL COMMENT '当前目标应用；创建后不可修改且不得等于source_app',
  required_capability VARCHAR(191) NOT NULL COMMENT '目标接口所需capability审计快照；不得用于动态选择授权',
  idempotency_key VARCHAR(191) NOT NULL COMMENT '目标端稳定幂等键；创建后不可修改',
  identity_sha256 BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(CONCAT_WS('|', tenant_code, source_deployment_code, deployment_code, source_app, target_app, operation_code, idempotency_key), 256))) STORED COMMENT '目标幂等身份生成摘要；用于受索引宽度限制的唯一约束',
  command_schema_version VARCHAR(30) NOT NULL DEFAULT 'v1' COMMENT '目标端接收的冻结命令schema版本',
  command_sha256 CHAR(64) NOT NULL COMMENT '规范化命令载荷SHA-256；同键异hash必须409',
  status VARCHAR(32) NOT NULL DEFAULT 'processing' COMMENT '状态：processing/succeeded/rejected',
  locked_by VARCHAR(100) DEFAULT NULL COMMENT '当前处理worker标识',
  locked_until DATETIME(3) DEFAULT NULL COMMENT '目标端处理租约截止时间',
  fencing_token BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '目标端接管处理时递增的栅栏令牌',
  version_no BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本；每次状态写入递增',
  first_request_id VARCHAR(100) DEFAULT NULL COMMENT '首次接收请求ID',
  last_request_id VARCHAR(100) DEFAULT NULL COMMENT '最近同幂等键请求ID',
  correlation_id VARCHAR(100) DEFAULT NULL COMMENT '跨服务技术追踪关联ID',
  original_actor_uid VARCHAR(100) DEFAULT NULL COMMENT '目标端验证后的委托用户actor UID',
  service_client_id VARCHAR(100) DEFAULT NULL COMMENT '目标端验证后的调用服务client ID',
  target_biz_type VARCHAR(100) DEFAULT NULL COMMENT '目标业务对象类型',
  target_biz_code VARCHAR(191) DEFAULT NULL COMMENT '目标稳定业务对象编码；同键成功重放时返回',
  response_http_status SMALLINT UNSIGNED DEFAULT NULL COMMENT '首次终态HTTP状态码',
  response_summary_sha256 CHAR(64) DEFAULT NULL COMMENT '脱敏响应摘要SHA-256；不保存完整响应',
  last_error_code VARCHAR(100) DEFAULT NULL COMMENT '安全稳定错误码',
  last_error_class VARCHAR(50) DEFAULT NULL COMMENT '安全错误分类',
  last_error_summary VARCHAR(1000) DEFAULT NULL COMMENT '脱敏错误摘要；不得保存响应正文、Token、内部URL或堆栈',
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '首次接收时间',
  last_received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '最近接收时间',
  completed_at DATETIME(3) DEFAULT NULL COMMENT '处理完成时间',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',

  UNIQUE KEY uk_scr_identity (identity_sha256),
  UNIQUE KEY uk_scr_operation_id (operation_id),
  INDEX idx_scr_status_lock (status, locked_until),
  INDEX idx_scr_target_biz (tenant_code, deployment_code, target_app, target_biz_type, target_biz_code),
  INDEX idx_scr_first_request (tenant_code, deployment_code, first_request_id),
  INDEX idx_scr_last_request (tenant_code, deployment_code, last_request_id),
  INDEX idx_scr_correlation (tenant_code, deployment_code, correlation_id),
  INDEX idx_scr_received (received_at),
  CONSTRAINT chk_scr_cross_app CHECK (source_app <> target_app),
  CONSTRAINT chk_scr_status CHECK (status IN ('processing', 'succeeded', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='目标服务命令Inbox回执；同幂等键同摘要重放、不同摘要冲突';

-- ============================================================
-- 30. 项目治理首期（v5.6）
-- ============================================================
CREATE TABLE IF NOT EXISTS `weekly_reporting_settings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `config_key` VARCHAR(32) NOT NULL DEFAULT 'default',
  `timezone` VARCHAR(64) NOT NULL,
  `deadline_weekday` TINYINT UNSIGNED NOT NULL,
  `deadline_time` TIME NOT NULL,
  `summary_target_weekday` TINYINT UNSIGNED NOT NULL,
  `summary_target_time` TIME NOT NULL,
  `reminder_offsets_json` JSON NOT NULL,
  `rag_config_json` JSON NOT NULL,
  `rollout_mode` ENUM('disabled','pilot','company') NOT NULL DEFAULT 'disabled',
  `config_version` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `updated_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_reporting_settings_key` (`config_key`),
  CONSTRAINT `chk_weekly_deadline_weekday` CHECK (`deadline_weekday` BETWEEN 1 AND 7),
  CONSTRAINT `chk_weekly_summary_weekday` CHECK (`summary_target_weekday` BETWEEN 1 AND 7)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司项目周报版本化配置';

CREATE TABLE IF NOT EXISTS `weekly_reporting_pilot_projects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `effective_from` DATE NOT NULL,
  `effective_to` DATE DEFAULT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_pilot_project_from` (`project_id`, `effective_from`),
  KEY `idx_weekly_pilot_effective` (`effective_from`, `effective_to`),
  CONSTRAINT `fk_weekly_pilot_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_weekly_pilot_range` CHECK (`effective_to` IS NULL OR `effective_to` >= `effective_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目周报试点项目有效期';

CREATE TABLE IF NOT EXISTS `project_lifecycle_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `from_status` VARCHAR(32) DEFAULT NULL,
  `to_status` VARCHAR(32) NOT NULL,
  `effective_at` DATETIME(6) NOT NULL,
  `actor_uid` VARCHAR(64) NOT NULL,
  `source` VARCHAR(64) NOT NULL DEFAULT 'aims.runtime',
  `request_id` VARCHAR(100) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_project_lifecycle_effective` (`project_id`, `effective_at`, `id`),
  KEY `idx_project_lifecycle_status` (`to_status`, `effective_at`),
  CONSTRAINT `fk_project_lifecycle_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目生命周期追加式事件';

CREATE TABLE IF NOT EXISTS `project_activity_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `object_type` VARCHAR(32) NOT NULL,
  `object_code` VARCHAR(128) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `actor_uid` VARCHAR(64) NOT NULL,
  `changes` JSON NOT NULL,
  `request_id` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_project_activity` (`project_id`, `id`),
  CONSTRAINT `fk_project_activity_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目及成员追加式业务审计';

CREATE TABLE IF NOT EXISTS `work_item_completion_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `kind` ENUM('target','matter') NOT NULL DEFAULT 'target',
  `requested_by` VARCHAR(64) NOT NULL,
  `snapshot_json` JSON NOT NULL,
  `snapshot_sha256` CHAR(64) NOT NULL,
  `review_version` CHAR(64) NOT NULL,
  `status` ENUM('queued','running','approved','rejected','cancelled') NOT NULL,
  `workflow_instance_id` BIGINT UNSIGNED DEFAULT NULL,
  `workflow_instance_no` VARCHAR(64) DEFAULT NULL,
  `target_receipt_id` VARCHAR(64) DEFAULT NULL,
  `operation_key` VARCHAR(191) NOT NULL,
  `active_work_item_id` BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN `status` IN ('queued','running') THEN `work_item_id` ELSE NULL END) STORED,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_completion_active_item` (`active_work_item_id`),
  UNIQUE KEY `uk_completion_operation` (`operation_key`),
  KEY `idx_completion_project` (`project_id`,`id`),
  CONSTRAINT `fk_completion_work_item` FOREIGN KEY (`project_id`,`work_item_id`) REFERENCES `work_items` (`project_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='冻结工作项完成审批请求及可靠回执';

CREATE TABLE IF NOT EXISTS `project_manager_delegations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `delegate_uid` VARCHAR(64) NOT NULL,
  `starts_at` DATETIME(6) NOT NULL,
  `ends_at` DATETIME(6) NOT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `appointed_by` VARCHAR(64) NOT NULL,
  `role_holder_revision` BIGINT UNSIGNED NOT NULL COMMENT 'Console 单例角色持有人快照修订号',
  `revoked_at` DATETIME(6) DEFAULT NULL,
  `revoked_by` VARCHAR(64) DEFAULT NULL,
  `revoked_role_holder_revision` BIGINT UNSIGNED DEFAULT NULL COMMENT '撤销时 Console 单例角色持有人修订号',
  `revoke_reason` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_manager_delegation_effective` (`project_id`, `starts_at`, `ends_at`, `revoked_at`),
  KEY `idx_manager_delegation_delegate` (`delegate_uid`, `starts_at`, `ends_at`),
  CONSTRAINT `fk_manager_delegation_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_manager_delegation_range` CHECK (`ends_at` > `starts_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代理项目经理不可变任期';

CREATE TABLE IF NOT EXISTS `weekly_reporting_periods` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `period_key` VARCHAR(16) NOT NULL,
  `week_start` DATETIME(6) NOT NULL,
  `week_end` DATETIME(6) NOT NULL,
  `deadline_at` DATETIME(6) NOT NULL,
  `summary_target_at` DATETIME(6) NOT NULL,
  `timezone` VARCHAR(64) NOT NULL,
  `config_version` BIGINT UNSIGNED NOT NULL,
  `settings_snapshot_json` JSON NOT NULL,
  `status` ENUM('open','deadline_frozen','publishing','published','closed') NOT NULL DEFAULT 'open',
  `obligations_frozen_at` DATETIME(6) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_period_key` (`period_key`),
  KEY `idx_weekly_period_status` (`status`, `deadline_at`),
  CONSTRAINT `chk_weekly_period_range` CHECK (`week_end` > `week_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司项目周报自然周周期';

CREATE TABLE IF NOT EXISTS `weekly_report_obligations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `period_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `responsible_uid_snapshot` VARCHAR(64) NOT NULL,
  `responsibility_type` ENUM('project_manager','acting_project_manager') NOT NULL,
  `project_status_snapshot` VARCHAR(32) NOT NULL,
  `due_status` ENUM('pending','draft','submitted','reviewed','returned','late','missing','frozen') NOT NULL DEFAULT 'pending',
  `first_submitted_at` DATETIME(6) DEFAULT NULL,
  `late_flag` TINYINT(1) NOT NULL DEFAULT 0,
  `frozen_at` DATETIME(6) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_obligation_period_project` (`period_id`, `project_id`),
  KEY `idx_weekly_obligation_responsible` (`responsible_uid_snapshot`, `due_status`),
  KEY `idx_weekly_obligation_project` (`project_id`, `period_id`),
  CONSTRAINT `fk_weekly_obligation_period` FOREIGN KEY (`period_id`) REFERENCES `weekly_reporting_periods` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_weekly_obligation_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每周期项目周报责任快照';

CREATE TABLE IF NOT EXISTS `project_weekly_report_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_id` BIGINT UNSIGNED NOT NULL,
  `version_no` INT UNSIGNED NOT NULL,
  `kind` ENUM('legacy_import','submission','correction') NOT NULL DEFAULT 'submission',
  `correction_of_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `correction_reason` VARCHAR(1000) DEFAULT NULL,
  `manager_content_json` JSON NOT NULL,
  `fact_snapshot_json` JSON NOT NULL,
  `fact_snapshot_sha256` CHAR(64) NOT NULL,
  `system_rag` ENUM('green','yellow','red') NOT NULL,
  `selected_rag` ENUM('green','yellow','red') NOT NULL,
  `rag_override_reason` VARCHAR(1000) DEFAULT NULL,
  `rag_rule_version` VARCHAR(32) NOT NULL,
  `submitted_by` VARCHAR(64) NOT NULL,
  `submitted_at` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_report_version` (`report_id`, `version_no`),
  KEY `idx_weekly_report_version_submitted` (`submitted_at`),
  CONSTRAINT `fk_weekly_report_version_report` FOREIGN KEY (`report_id`) REFERENCES `project_weekly_reports` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_weekly_report_version_correction` FOREIGN KEY (`correction_of_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目周报不可变提交版本';

CREATE TABLE IF NOT EXISTS `project_weekly_report_correction_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_id` BIGINT UNSIGNED NOT NULL,
  `correction_of_version_id` BIGINT UNSIGNED NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `opened_by` VARCHAR(64) NOT NULL,
  `role_holder_revision` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('open','consumed','cancelled') NOT NULL DEFAULT 'open',
  `submitted_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `consumed_at` DATETIME(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_weekly_correction_report` (`report_id`, `status`, `created_at`),
  CONSTRAINT `fk_weekly_correction_request_report` FOREIGN KEY (`report_id`) REFERENCES `project_weekly_reports` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_weekly_correction_request_base` FOREIGN KEY (`correction_of_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_weekly_correction_request_submission` FOREIGN KEY (`submitted_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目周报更正发起审计';

CREATE TABLE IF NOT EXISTS `project_weekly_report_reviews` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_version_id` BIGINT UNSIGNED NOT NULL,
  `action` ENUM('approve','return','approve_with_corrective_action') NOT NULL,
  `comment` TEXT DEFAULT NULL,
  `reviewer_uid` VARCHAR(64) NOT NULL,
  `role_holder_revision` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_review_terminal` (`report_version_id`),
  KEY `idx_weekly_review_version` (`report_version_id`, `created_at`),
  KEY `idx_weekly_review_reviewer` (`reviewer_uid`, `created_at`),
  CONSTRAINT `fk_weekly_review_version` FOREIGN KEY (`report_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目周报追加式审阅';

CREATE TABLE IF NOT EXISTS `weekly_report_corrective_action_links` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `review_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_review_corrective_item` (`review_id`, `work_item_id`),
  CONSTRAINT `fk_weekly_corrective_review` FOREIGN KEY (`review_id`) REFERENCES `project_weekly_report_reviews` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_weekly_corrective_work_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='周报审阅整改工作项关联';

CREATE TABLE IF NOT EXISTS `time_entry_review_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `time_entry_id` BIGINT UNSIGNED NOT NULL,
  `from_status` VARCHAR(32) NOT NULL,
  `to_status` VARCHAR(32) NOT NULL,
  `actor_uid` VARCHAR(64) NOT NULL,
  `reason` VARCHAR(1000) DEFAULT NULL,
  `report_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `summary_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_time_review_entry` (`time_entry_id`, `created_at`),
  KEY `idx_time_review_actor` (`actor_uid`, `created_at`),
  CONSTRAINT `fk_time_review_entry` FOREIGN KEY (`time_entry_id`) REFERENCES `time_entries` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_time_review_report_version` FOREIGN KEY (`report_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工时审核追加式事件';

CREATE TABLE IF NOT EXISTS `qa_checklist_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `checklist_code` VARCHAR(64) NOT NULL,
  `version_no` INT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `items_json` JSON NOT NULL,
  `items_sha256` CHAR(64) NOT NULL,
  `status` ENUM('draft','published','retired') NOT NULL DEFAULT 'draft',
  `published_by` VARCHAR(64) DEFAULT NULL,
  `published_at` DATETIME(6) DEFAULT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_qa_checklist_version` (`checklist_code`, `version_no`),
  KEY `idx_qa_checklist_status` (`status`, `published_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='QA 检查清单不可变版本';

CREATE TABLE IF NOT EXISTS `deliverable_submissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `deliverable_id` BIGINT UNSIGNED NOT NULL,
  `submission_no` VARCHAR(100) NOT NULL,
  `document_uuid` CHAR(36) DEFAULT NULL,
  `document_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `document_version_num` INT UNSIGNED DEFAULT NULL,
  `content_sha256` CHAR(64) DEFAULT NULL,
  `evidence_snapshot_json` JSON NOT NULL,
  `checklist_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `review_route` ENUM('qa','pm_completeness_then_director_quality') NOT NULL DEFAULT 'qa',
  `review_grant_id` BIGINT UNSIGNED DEFAULT NULL,
  `review_granted_at` DATETIME(6) DEFAULT NULL,
  `status` ENUM('preparing_review','awaiting_review','passed','returned','waived') NOT NULL DEFAULT 'preparing_review',
  `submitted_by` VARCHAR(64) NOT NULL,
  `submitted_at` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_deliverable_submission_no` (`submission_no`),
  UNIQUE KEY `uk_deliverable_submission_version` (`deliverable_id`, `document_version_id`),
  KEY `idx_deliverable_submission` (`deliverable_id`, `created_at`),
  KEY `idx_deliverable_submission_status` (`status`, `review_route`),
  CONSTRAINT `fk_deliverable_submission_deliverable` FOREIGN KEY (`deliverable_id`) REFERENCES `deliverables` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_deliverable_submission_checklist` FOREIGN KEY (`checklist_version_id`) REFERENCES `qa_checklist_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='交付物不可变提交';

CREATE TABLE IF NOT EXISTS `deliverable_quality_reviews` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `submission_id` BIGINT UNSIGNED NOT NULL,
  `stage` ENUM('pm_completeness','qa_quality','director_quality') NOT NULL,
  `action` ENUM('pass','return') NOT NULL,
  `checklist_result_json` JSON NOT NULL,
  `result_sha256` CHAR(64) NOT NULL,
  `reviewer_uid` VARCHAR(64) NOT NULL,
  `role_holder_revision` BIGINT UNSIGNED DEFAULT NULL,
  `comment` TEXT DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_deliverable_quality_submission` (`submission_id`, `created_at`),
  CONSTRAINT `fk_deliverable_quality_submission` FOREIGN KEY (`submission_id`) REFERENCES `deliverable_submissions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='交付物追加式质量评审';

CREATE TABLE IF NOT EXISTS `deliverable_waivers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `deliverable_id` BIGINT UNSIGNED NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `approved_by` VARCHAR(64) NOT NULL,
  `role_holder_revision` BIGINT UNSIGNED NOT NULL,
  `effective_at` DATETIME(6) NOT NULL,
  `revoked_at` DATETIME(6) DEFAULT NULL,
  `revoked_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_deliverable_waiver_effective` (`deliverable_id`, `effective_at`, `revoked_at`),
  CONSTRAINT `fk_deliverable_waiver_deliverable` FOREIGN KEY (`deliverable_id`) REFERENCES `deliverables` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目总监交付物豁免';

CREATE TABLE IF NOT EXISTS `company_weekly_summaries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `period_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('draft','publishing','published','cancelled','correction_draft') NOT NULL DEFAULT 'draft',
  `current_revision_no` INT UNSIGNED NOT NULL DEFAULT 0,
  `current_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `codocs_document_uuid` CHAR(36) DEFAULT NULL,
  `draft_content_json` JSON DEFAULT NULL COMMENT '仅当前草稿可变；发布版本使用不可变快照',
  `created_by` VARCHAR(64) NOT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_weekly_summary_period` (`period_id`),
  CONSTRAINT `fk_company_summary_period` FOREIGN KEY (`period_id`) REFERENCES `weekly_reporting_periods` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司项目周报汇总逻辑主记录';

CREATE TABLE IF NOT EXISTS `company_weekly_summary_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `summary_id` BIGINT UNSIGNED NOT NULL,
  `revision_no` INT UNSIGNED NOT NULL,
  `correction_of_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `correction_reason` VARCHAR(1000) DEFAULT NULL,
  `structured_snapshot_json` JSON NOT NULL,
  `structured_sha256` CHAR(64) NOT NULL,
  `markdown_content` LONGTEXT NOT NULL,
  `markdown_sha256` CHAR(64) NOT NULL,
  `publish_status` ENUM('prepared','pending','published','failed','cancelled') NOT NULL DEFAULT 'prepared',
  `codocs_document_uuid` CHAR(36) DEFAULT NULL,
  `codocs_document_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `codocs_version_num` INT UNSIGNED DEFAULT NULL,
  `published_by` VARCHAR(64) DEFAULT NULL,
  `published_at` DATETIME(6) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_summary_revision` (`summary_id`, `revision_no`),
  CONSTRAINT `fk_company_summary_version_summary` FOREIGN KEY (`summary_id`) REFERENCES `company_weekly_summaries` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_company_summary_version_correction` FOREIGN KEY (`correction_of_version_id`) REFERENCES `company_weekly_summary_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司周报汇总不可变版本';

CREATE TABLE IF NOT EXISTS `company_weekly_summary_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `summary_version_id` BIGINT UNSIGNED NOT NULL,
  `obligation_id` BIGINT UNSIGNED NOT NULL,
  `report_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `inclusion_status` ENUM('included','missing','late_unincluded') NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_summary_item_obligation` (`summary_version_id`, `obligation_id`),
  CONSTRAINT `fk_company_summary_item_version` FOREIGN KEY (`summary_version_id`) REFERENCES `company_weekly_summary_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_company_summary_item_obligation` FOREIGN KEY (`obligation_id`) REFERENCES `weekly_report_obligations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_company_summary_item_report_version` FOREIGN KEY (`report_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司汇总纳入项目和版本快照';

CREATE TABLE IF NOT EXISTS `company_weekly_summary_recipient_selections` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `summary_id` BIGINT UNSIGNED NOT NULL,
  `subject_type` ENUM('user','department') NOT NULL,
  `subject_code` VARCHAR(128) NOT NULL,
  `subject_name_snapshot` VARCHAR(255) NOT NULL,
  `selected_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_summary_recipient_selection` (`summary_id`, `subject_type`, `subject_code`),
  CONSTRAINT `fk_company_summary_recipient_selection` FOREIGN KEY (`summary_id`) REFERENCES `company_weekly_summaries` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司汇总抄送原始选择';

CREATE TABLE IF NOT EXISTS `company_weekly_summary_recipient_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `summary_version_id` BIGINT UNSIGNED NOT NULL,
  `selection_id` BIGINT UNSIGNED NOT NULL,
  `resolved_uid` VARCHAR(64) NOT NULL,
  `display_name_snapshot` VARCHAR(255) NOT NULL,
  `department_code_snapshot` VARCHAR(128) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_summary_recipient_uid` (`summary_version_id`, `resolved_uid`),
  KEY `idx_company_summary_recipient_selection` (`selection_id`),
  CONSTRAINT `fk_company_summary_recipient_snapshot_version` FOREIGN KEY (`summary_version_id`) REFERENCES `company_weekly_summary_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_company_summary_recipient_snapshot_selection` FOREIGN KEY (`selection_id`) REFERENCES `company_weekly_summary_recipient_selections` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司汇总发布时实际抄送人快照';

CREATE TABLE IF NOT EXISTS `project_management_fact_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `revision` BIGINT UNSIGNED NOT NULL,
  `fact_code` VARCHAR(100) NOT NULL,
  `period_key` VARCHAR(16) NOT NULL,
  `subject_uid` VARCHAR(64) DEFAULT NULL,
  `project_id` BIGINT UNSIGNED DEFAULT NULL,
  `project_code` VARCHAR(50) DEFAULT NULL,
  `value_json` JSON NOT NULL,
  `source_refs_json` JSON NOT NULL,
  `source_sha256` CHAR(64) NOT NULL,
  `correction_of_id` BIGINT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_management_fact_revision` (`revision`),
  KEY `idx_project_management_fact_period` (`period_key`, `fact_code`),
  KEY `idx_project_management_fact_subject` (`subject_uid`, `period_key`),
  CONSTRAINT `fk_project_management_fact_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_project_management_fact_correction` FOREIGN KEY (`correction_of_id`) REFERENCES `project_management_fact_snapshots` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='供 People 消费的版本化项目管理事实';

ALTER TABLE `project_weekly_reports`
  ADD CONSTRAINT `fk_weekly_report_obligation`
    FOREIGN KEY (`obligation_id`) REFERENCES `weekly_report_obligations` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_weekly_report_submitted_version`
    FOREIGN KEY (`current_submitted_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_weekly_report_reviewed_version`
    FOREIGN KEY (`current_reviewed_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_weekly_report_frozen_version`
    FOREIGN KEY (`current_frozen_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_weekly_report_pending_correction_version`
    FOREIGN KEY (`pending_correction_of_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_weekly_report_pending_correction_request`
    FOREIGN KEY (`pending_correction_request_id`) REFERENCES `project_weekly_report_correction_requests` (`id`) ON DELETE RESTRICT;

ALTER TABLE `time_entries`
  ADD CONSTRAINT `fk_time_corrects_entry`
    FOREIGN KEY (`corrects_entry_id`) REFERENCES `time_entries` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_time_approved_summary_version`
    FOREIGN KEY (`approved_summary_version_id`) REFERENCES `company_weekly_summary_versions` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_time_locked_report_version`
    FOREIGN KEY (`locked_report_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT;

ALTER TABLE `deliverables`
  ADD CONSTRAINT `fk_deliverable_current_submission`
    FOREIGN KEY (`current_submission_id`) REFERENCES `deliverable_submissions` (`id`) ON DELETE RESTRICT;

ALTER TABLE `milestones`
  ADD CONSTRAINT `fk_milestone_completion_lock`
    FOREIGN KEY (`completion_lock_request_id`) REFERENCES `approval_records` (`id`) ON DELETE RESTRICT;

-- 里程碑完成审批快照的数据库级并发冻结。
-- 增量环境使用 migration_v5.10_milestone_completion_acceptance_lock.sql。
DELIMITER $$

CREATE TRIGGER `trg_milestone_completion_lock_update`
BEFORE UPDATE ON `milestones`
FOR EACH ROW
BEGIN
  IF OLD.completion_lock_request_id IS NOT NULL
     AND NOT (
       NEW.completion_lock_request_id IS NULL
       AND (
         NEW.status <=> OLD.status
         OR (OLD.status = 'active' AND NEW.status = 'completed')
       )
       AND NEW.project_id <=> OLD.project_id
       AND NEW.name <=> OLD.name
       AND NEW.description <=> OLD.description
       AND NEW.mode <=> OLD.mode
       AND NEW.start_date <=> OLD.start_date
       AND NEW.end_date <=> OLD.end_date
       AND NEW.pivr_stage <=> OLD.pivr_stage
       AND NEW.template_key <=> OLD.template_key
       AND NEW.payment_term_id <=> OLD.payment_term_id
       AND NEW.recurrence_rule <=> OLD.recurrence_rule
       AND NEW.sort_order <=> OLD.sort_order
     )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

CREATE TRIGGER `trg_milestone_completion_lock_delete`
BEFORE DELETE ON `milestones`
FOR EACH ROW
BEGIN
  IF OLD.completion_lock_request_id IS NOT NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

CREATE TRIGGER `trg_work_item_completion_lock_insert`
BEFORE INSERT ON `work_items`
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1 FROM `milestones`
    WHERE id = NEW.milestone_id
      AND completion_lock_request_id IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

CREATE TRIGGER `trg_work_item_completion_lock_update`
BEFORE UPDATE ON `work_items`
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1 FROM `milestones`
    WHERE id IN (OLD.milestone_id, NEW.milestone_id)
      AND completion_lock_request_id IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

CREATE TRIGGER `trg_work_item_completion_lock_delete`
BEFORE DELETE ON `work_items`
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1 FROM `milestones`
    WHERE id = OLD.milestone_id
      AND completion_lock_request_id IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

CREATE TRIGGER `trg_deliverable_completion_lock_insert`
BEFORE INSERT ON `deliverables`
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1
    FROM `milestones` m
    WHERE m.completion_lock_request_id IS NOT NULL
      AND m.id IN (
        COALESCE(NEW.milestone_owner_id, 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = NEW.target_id), 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = NEW.matter_id), 0)
      )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

CREATE TRIGGER `trg_deliverable_completion_lock_update`
BEFORE UPDATE ON `deliverables`
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1
    FROM `milestones` m
    WHERE m.completion_lock_request_id IS NOT NULL
      AND m.id IN (
        COALESCE(OLD.milestone_owner_id, 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = OLD.target_id), 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = OLD.matter_id), 0),
        COALESCE(NEW.milestone_owner_id, 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = NEW.target_id), 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = NEW.matter_id), 0)
      )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

CREATE TRIGGER `trg_deliverable_completion_lock_delete`
BEFORE DELETE ON `deliverables`
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1
    FROM `milestones` m
    WHERE m.completion_lock_request_id IS NOT NULL
      AND m.id IN (
        COALESCE(OLD.milestone_owner_id, 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = OLD.target_id), 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = OLD.matter_id), 0)
      )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

DELIMITER ;

-- ============================================================
-- Product Center (v5.19); product codes and object scopes are case-sensitive.
-- Existing databases use migration_v5.19_product_center.sql.
-- ============================================================
CREATE TABLE IF NOT EXISTS product_workspaces (
  product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  positioning TEXT NULL,
  target_users TEXT NULL,
  value_statement TEXT NULL,
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (product_code), UNIQUE KEY uk_pc_workspace_biz (biz_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_code VARCHAR(64) NOT NULL,
  uid VARCHAR(64) NOT NULL,
  relation_type ENUM('manager','contributor','viewer') NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  valid_from DATETIME(3) NOT NULL,
  valid_until DATETIME(3) NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_member (product_code,uid,relation_type),
  KEY idx_pc_member_subject (uid,status,product_code),
  CONSTRAINT fk_pc_member_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code),
  CONSTRAINT ck_pc_member_dates CHECK (valid_until IS NULL OR valid_until > valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  component_id BIGINT UNSIGNED NULL,
  title VARCHAR(500) NOT NULL,
  problem_statement TEXT NULL,
  source_type ENUM('customer','internal','engineering','other') NOT NULL DEFAULT 'internal',
  urgency_level ENUM('P0','P1','P2','P3') NOT NULL DEFAULT 'P2',
  decision_status ENUM('submitted','evaluating','accepted','deferred','rejected','merged') NOT NULL DEFAULT 'submitted',
  decision_reason TEXT NULL,
  decided_by VARCHAR(64) NULL,
  decided_at DATETIME(3) NULL,
  merged_into_id BIGINT UNSIGNED NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_request_biz (biz_id),
  UNIQUE KEY uk_pc_request_scope (id,product_code),
  KEY idx_pc_request_list (product_code,decision_status,id),
  KEY idx_pc_request_component (product_code,component_id,id),
  CONSTRAINT fk_pc_request_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code),
  CONSTRAINT fk_pc_request_merge FOREIGN KEY (merged_into_id,product_code) REFERENCES product_requests(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_request_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  source_app VARCHAR(32) NULL,
  source_type VARCHAR(64) NOT NULL,
  source_biz_id VARCHAR(191) NULL,
  source_note TEXT NOT NULL,
  evidence_date DATE NULL,
  evidence_kind ENUM('fact','assumption') NOT NULL DEFAULT 'assumption',
  direction ENUM('supporting','opposing','neutral') NOT NULL DEFAULT 'neutral',
  verification_status ENUM('unverified','verified','unavailable') NOT NULL DEFAULT 'unverified',
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), KEY idx_pc_source_request (request_id,id),
  CONSTRAINT fk_pc_source_request FOREIGN KEY (request_id) REFERENCES product_requests(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_components (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  parent_id BIGINT UNSIGNED NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY(id),
  UNIQUE KEY uk_pc_component_biz(biz_id),
  UNIQUE KEY uk_pc_component_scope(id,product_code),
  KEY idx_pc_component_tree(product_code,parent_id,sort_order,id),
  CONSTRAINT fk_pc_component_product FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code),
  CONSTRAINT fk_pc_component_parent FOREIGN KEY(parent_id,product_code) REFERENCES product_components(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_features (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  component_id BIGINT UNSIGNED NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT NULL,
  lifecycle ENUM('candidate','active','deprecated') NOT NULL DEFAULT 'candidate',
  lifecycle_evidence JSON NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_feature_biz (biz_id),
  UNIQUE KEY uk_pc_feature_scope (id,product_code),
  KEY idx_pc_feature_list (product_code,lifecycle,id),
  CONSTRAINT fk_pc_feature_component FOREIGN KEY(component_id,product_code) REFERENCES product_components(id,product_code),
  CONSTRAINT fk_pc_feature_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_request_features (
  product_code VARCHAR(64) NOT NULL,
  request_id BIGINT UNSIGNED NOT NULL,
  product_feature_id BIGINT UNSIGNED NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (request_id,product_feature_id),
  CONSTRAINT fk_pc_rf_request FOREIGN KEY (request_id,product_code) REFERENCES product_requests(id,product_code),
  CONSTRAINT fk_pc_rf_feature FOREIGN KEY (product_feature_id,product_code) REFERENCES product_features(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_planning_cycles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  goal_summary TEXT NOT NULL,
  metric_definition JSON NULL,
  baseline_value DECIMAL(20,6) NULL,
  target_value DECIMAL(20,6) NULL,
  total_person_days DECIMAL(12,2) NULL,
  reserve_person_days DECIMAL(12,2) NULL,
  reliability_person_days DECIMAL(12,2) NULL,
  usability_person_days DECIMAL(12,2) NULL,
  growth_person_days DECIMAL(12,2) NULL,
  model_version VARCHAR(64) NOT NULL DEFAULT 'weighted-value-effort-v1',
  model_snapshot JSON NOT NULL,
  matrix_value_threshold DECIMAL(6,2) NOT NULL DEFAULT 50,
  matrix_effort_threshold DECIMAL(12,2) NOT NULL DEFAULT 5,
  review_interval_days SMALLINT UNSIGNED NOT NULL DEFAULT 14,
  next_review_at DATETIME(3) NULL,
  status ENUM('draft','open','closed') NOT NULL DEFAULT 'draft',
  open_product_code VARCHAR(64) GENERATED ALWAYS AS (CASE WHEN status='open' THEN product_code ELSE NULL END) STORED,
  queue_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  closed_snapshot JSON NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_cycle_biz (biz_id),
  UNIQUE KEY uk_pc_cycle_scope (id,product_code),
  UNIQUE KEY uk_pc_cycle_open (open_product_code),
  KEY idx_pc_cycle_list (product_code,status,id),
  CONSTRAINT fk_pc_cycle_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code),
  CONSTRAINT ck_pc_cycle_dates CHECK (ends_on >= starts_on),
  CONSTRAINT ck_pc_cycle_interval CHECK (review_interval_days BETWEEN 1 AND 366),
  CONSTRAINT ck_pc_cycle_nonnegative CHECK (
    total_person_days >= 0 AND reserve_person_days >= 0 AND reliability_person_days >= 0
    AND usability_person_days >= 0 AND growth_person_days >= 0),
  CONSTRAINT ck_pc_cycle_capacity CHECK (
    reserve_person_days + reliability_person_days + usability_person_days + growth_person_days <= total_person_days),
  CONSTRAINT ck_pc_cycle_open_capacity CHECK (status <> 'open' OR (
    total_person_days IS NOT NULL AND reserve_person_days IS NOT NULL AND reliability_person_days IS NOT NULL
    AND usability_person_days IS NOT NULL AND growth_person_days IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_planning_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  title VARCHAR(500) NOT NULL,
  scope_summary TEXT NOT NULL,
  feature_id BIGINT UNSIGNED NULL,
  derived_from_id BIGINT UNSIGNED NULL,
  merged_into_id BIGINT UNSIGNED NULL,
  urgency_level ENUM('P0','P1','P2','P3') NOT NULL DEFAULT 'P2',
  deadline DATE NULL,
  deadline_evidence JSON NULL,
  investment_category ENUM('reliability','usability','growth') NOT NULL,
  lifecycle ENUM('proposed','in_delivery','delivered','cancelled','merged') NOT NULL DEFAULT 'proposed',
  scope_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  evidence_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_planning_biz (biz_id),
  UNIQUE KEY uk_pc_planning_scope (id,product_code),
  KEY idx_pc_planning_list (product_code,lifecycle,id),
  CONSTRAINT fk_pc_planning_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code),
  CONSTRAINT fk_pc_planning_feature FOREIGN KEY (feature_id,product_code) REFERENCES product_features(id,product_code),
  CONSTRAINT fk_pc_planning_origin FOREIGN KEY (derived_from_id,product_code) REFERENCES product_planning_items(id,product_code),
  CONSTRAINT fk_pc_planning_merge FOREIGN KEY (merged_into_id,product_code) REFERENCES product_planning_items(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_planning_item_requests (
  product_code VARCHAR(64) NOT NULL,
  planning_item_id BIGINT UNSIGNED NOT NULL,
  request_id BIGINT UNSIGNED NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (planning_item_id,request_id),
  CONSTRAINT fk_pc_ir_item FOREIGN KEY (planning_item_id,product_code) REFERENCES product_planning_items(id,product_code),
  CONSTRAINT fk_pc_ir_request FOREIGN KEY (request_id,product_code) REFERENCES product_requests(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_planning_cycle_items (
  cycle_id BIGINT UNSIGNED NOT NULL,
  planning_item_id BIGINT UNSIGNED NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  selection_status ENUM('candidate','selected','deferred') NOT NULL DEFAULT 'candidate',
  decision_rank BIGINT UNSIGNED NOT NULL,
  roadmap_bucket ENUM('now','next','later') NOT NULL DEFAULT 'later',
  current_assessment_id BIGINT UNSIGNED NULL,
  decision_snapshot JSON NULL,
  decided_by VARCHAR(64) NULL,
  decision_reason TEXT NULL,
  decided_at DATETIME(3) NULL,
  PRIMARY KEY (cycle_id,planning_item_id),
  UNIQUE KEY uk_pc_cycle_rank (cycle_id,decision_rank),
  CONSTRAINT fk_pc_ci_cycle FOREIGN KEY (cycle_id,product_code) REFERENCES product_planning_cycles(id,product_code),
  CONSTRAINT fk_pc_ci_item FOREIGN KEY (planning_item_id,product_code) REFERENCES product_planning_items(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_priority_assessments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cycle_id BIGINT UNSIGNED NOT NULL,
  planning_item_id BIGINT UNSIGNED NOT NULL,
  scope_revision BIGINT UNSIGNED NOT NULL,
  evidence_revision BIGINT UNSIGNED NOT NULL,
  model_version VARCHAR(64) NOT NULL,
  model_snapshot JSON NOT NULL,
  strategic TINYINT UNSIGNED NULL,
  user_value TINYINT UNSIGNED NULL,
  business TINYINT UNSIGNED NULL,
  risk TINYINT UNSIGNED NULL,
  confidence DECIMAL(3,2) NULL,
  effort_person_days DECIMAL(12,2) NULL,
  effort_unit VARCHAR(16) NOT NULL DEFAULT 'person_day',
  value_score SMALLINT UNSIGNED NULL,
  priority_score DECIMAL(20,8) NULL,
  evidence_snapshot JSON NOT NULL,
  rationale JSON NOT NULL,
  assessed_by VARCHAR(64) NOT NULL,
  estimated_by VARCHAR(64) NULL,
  assessed_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_assessment_identity (id,cycle_id,planning_item_id),
  KEY idx_pc_assessment_history (cycle_id,planning_item_id,id),
  CONSTRAINT fk_pc_assessment_item FOREIGN KEY (cycle_id,planning_item_id) REFERENCES product_planning_cycle_items(cycle_id,planning_item_id),
  CONSTRAINT ck_pc_assessment_dimensions CHECK (strategic <= 5 AND user_value <= 5 AND business <= 5 AND risk <= 5),
  CONSTRAINT ck_pc_assessment_confidence CHECK (confidence IN (0.50,0.80,1.00)),
  CONSTRAINT ck_pc_assessment_effort CHECK (effort_person_days BETWEEN 0.50 AND 1000000.00),
  CONSTRAINT ck_pc_assessment_unit CHECK (effort_unit='person_day'),
  CONSTRAINT ck_pc_assessment_value CHECK (value_score <= 100),
  CONSTRAINT ck_pc_assessment_score CHECK (priority_score >= 0),
  CONSTRAINT ck_pc_assessment_complete CHECK (priority_score IS NULL OR (
    strategic IS NOT NULL AND user_value IS NOT NULL AND business IS NOT NULL AND risk IS NOT NULL
    AND confidence IS NOT NULL AND effort_person_days IS NOT NULL AND value_score IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_planning_dependencies (
  product_code VARCHAR(64) NOT NULL,
  planning_item_id BIGINT UNSIGNED NOT NULL,
  predecessor_id BIGINT UNSIGNED NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (planning_item_id,predecessor_id),
  CONSTRAINT fk_pc_dep_item FOREIGN KEY (planning_item_id,product_code) REFERENCES product_planning_items(id,product_code),
  CONSTRAINT fk_pc_dep_predecessor FOREIGN KEY (predecessor_id,product_code) REFERENCES product_planning_items(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_planning_comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  planning_item_id BIGINT UNSIGNED NOT NULL,
  cycle_id BIGINT UNSIGNED NULL,
  author_uid VARCHAR(64) NOT NULL,
  body TEXT NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), KEY idx_pc_comment_item (planning_item_id,id),
  CONSTRAINT fk_pc_comment_cycle_item FOREIGN KEY (cycle_id,planning_item_id) REFERENCES product_planning_cycle_items(cycle_id,planning_item_id),
  CONSTRAINT fk_pc_comment_item FOREIGN KEY (planning_item_id) REFERENCES product_planning_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_outcome_observations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cycle_id BIGINT UNSIGNED NOT NULL,
  metric_snapshot JSON NOT NULL,
  observed_value DECIMAL(20,6) NULL,
  observed_at DATETIME(3) NOT NULL,
  evidence JSON NOT NULL,
  conclusion TEXT NOT NULL,
  correction_of_id BIGINT UNSIGNED NULL,
  recorded_by VARCHAR(64) NOT NULL,
  recorded_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_observation_scope (id,cycle_id),
  KEY idx_pc_observation_cycle (cycle_id,id),
  CONSTRAINT fk_pc_observation_cycle FOREIGN KEY (cycle_id) REFERENCES product_planning_cycles(id),
  CONSTRAINT fk_pc_observation_correction FOREIGN KEY (correction_of_id,cycle_id) REFERENCES product_outcome_observations(id,cycle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_request_delivery_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_code VARCHAR(64) NOT NULL,
  planning_item_id BIGINT UNSIGNED NOT NULL,
  request_id BIGINT UNSIGNED NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  requirement_id BIGINT UNSIGNED NOT NULL,
  source_revision BIGINT UNSIGNED NOT NULL,
  scope_snapshot JSON NOT NULL,
  delivery_slice_key VARCHAR(191) NOT NULL,
  planned_version_id BIGINT UNSIGNED NULL,
  planned_version_feature_id BIGINT UNSIGNED NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pc_delivery_slice (planning_item_id,project_id,delivery_slice_key),
  UNIQUE KEY uk_pc_delivery_requirement (planning_item_id,requirement_id),
  CONSTRAINT fk_pc_delivery_item FOREIGN KEY (planning_item_id,product_code) REFERENCES product_planning_items(id,product_code),
  CONSTRAINT fk_pc_delivery_request FOREIGN KEY (request_id,product_code) REFERENCES product_requests(id,product_code)
  -- project/requirement/version references are validated in the domain command;
  -- no cascading FK: project deletion must not erase product traceability.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_activity_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_code VARCHAR(64) NOT NULL,
  object_type VARCHAR(64) NOT NULL,
  object_id VARCHAR(191) NOT NULL,
  action VARCHAR(64) NOT NULL,
  actor_uid VARCHAR(64) NOT NULL,
  revision BIGINT UNSIGNED NULL,
  changes JSON NOT NULL,
  request_id VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), KEY idx_pc_activity_product (product_code,id),
  KEY idx_pc_activity_object (product_code,object_type,object_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_command_receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_code VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  actor_uid VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  execution_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('processing','succeeded') NOT NULL,
  result_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_command (product_code,action,actor_uid,idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_catalog_control (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  CONSTRAINT ck_pc_catalog_singleton CHECK (id=1)
) ENGINE=InnoDB;
INSERT IGNORE INTO product_catalog_control(id) VALUES(1);

CREATE TABLE IF NOT EXISTS product_catalog_refreshes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('staging','active','superseded','failed') NOT NULL DEFAULT 'staging',
  active_slot TINYINT GENERATED ALWAYS AS (CASE WHEN status='active' THEN 1 ELSE NULL END) STORED,
  source_watermark VARCHAR(191) NULL,
  source_cursor VARCHAR(500) NULL,
  row_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_refresh_biz (biz_id), UNIQUE KEY uk_pc_catalog_active (active_slot)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_catalog_page_receipts (
  generation BIGINT UNSIGNED NOT NULL,
  page_number INT UNSIGNED NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (generation,page_number),
  CONSTRAINT fk_pc_catalog_page_generation FOREIGN KEY (generation) REFERENCES product_catalog_refreshes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_catalog_projection (
  generation BIGINT UNSIGNED NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  product_line VARCHAR(64) NOT NULL,
  product_line_label VARCHAR(255) NULL,
  product_line_sort_order INT NULL,
  source_status VARCHAR(64) NOT NULL,
  business_owner_uid VARCHAR(64) NULL,
  technical_owner_uid VARCHAR(64) NULL,
  source_updated_at DATETIME(3) NULL,
  synced_at DATETIME(3) NOT NULL,
  PRIMARY KEY (generation,product_code),
  KEY idx_pc_catalog_line (generation,product_line,product_code),
  CONSTRAINT fk_pc_catalog_generation FOREIGN KEY (generation) REFERENCES product_catalog_refreshes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_version_acceptances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  version_id BIGINT UNSIGNED NOT NULL,
  scope_revision BIGINT UNSIGNED NOT NULL,
  accepted_by VARCHAR(64) NOT NULL,
  accepted_at DATETIME(3) NOT NULL,
  checklist JSON NOT NULL,
  exceptions JSON NOT NULL,
  PRIMARY KEY (id), KEY idx_pc_acceptance_version (version_id,scope_revision,id),
  CONSTRAINT fk_pc_acceptance_version FOREIGN KEY (version_id) REFERENCES product_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_release_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version_id BIGINT UNSIGNED NOT NULL,
  release_seq BIGINT UNSIGNED NOT NULL,
  scope_revision BIGINT UNSIGNED NOT NULL,
  scope_snapshot JSON NOT NULL,
  acceptance_snapshot JSON NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  released_by VARCHAR(64) NULL,
  released_at DATETIME(3) NULL,
  evidence_level ENUM('verified','legacy_import') NOT NULL,
  supersedes_record_id BIGINT UNSIGNED NULL,
  recorded_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_release_biz (biz_id),
  UNIQUE KEY uk_pc_release_seq (version_id,release_seq),
  UNIQUE KEY uk_pc_release_scope (id,version_id),
  CONSTRAINT fk_pc_release_version FOREIGN KEY (version_id) REFERENCES product_versions(id),
  CONSTRAINT fk_pc_release_supersedes FOREIGN KEY (supersedes_record_id,version_id) REFERENCES product_release_records(id,version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_release_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  release_record_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM('withdrawn','superseded') NOT NULL,
  actor_uid VARCHAR(64) NOT NULL,
  reason TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), KEY idx_pc_release_event (release_record_id,id),
  CONSTRAINT fk_pc_release_event FOREIGN KEY (release_record_id) REFERENCES product_release_records(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

ALTER TABLE product_planning_cycle_items ADD CONSTRAINT fk_pc_ci_assessment FOREIGN KEY (current_assessment_id,cycle_id,planning_item_id) REFERENCES product_priority_assessments(id,cycle_id,planning_item_id);
ALTER TABLE product_version_features ADD CONSTRAINT fk_pc_vf_feature FOREIGN KEY (product_feature_id) REFERENCES product_features(id);
ALTER TABLE product_version_features ADD CONSTRAINT fk_pc_vf_planning FOREIGN KEY (planning_item_id) REFERENCES product_planning_items(id);
ALTER TABLE product_version_features ADD CONSTRAINT fk_pc_vf_deferred FOREIGN KEY (deferred_from_feature_id) REFERENCES product_version_features(id);
ALTER TABLE product_versions ADD CONSTRAINT fk_pc_version_release FOREIGN KEY (current_release_record_id,id) REFERENCES product_release_records(id,version_id);
ALTER TABLE product_requests ADD CONSTRAINT fk_pc_request_component FOREIGN KEY (component_id,product_code) REFERENCES product_components(id,product_code);

-- v5.38 lightweight version planning keeps the existing version/scope
-- identities and stores only planning metadata, estimates and immutable
-- confirmation evidence.
CREATE TABLE IF NOT EXISTS product_version_plans (
 version_id BIGINT UNSIGNED NOT NULL, product_code VARCHAR(64) NOT NULL,
 goal TEXT NULL, starts_on DATE NULL, available_person_days DECIMAL(12,2) NULL, reserve_person_days DECIMAL(12,2) NULL,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1, scope_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 created_by VARCHAR(64) NOT NULL, updated_by VARCHAR(64) NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
 PRIMARY KEY(version_id), KEY idx_pc_plan_product(product_code,version_id),
 CONSTRAINT fk_pc_plan_version FOREIGN KEY(version_id) REFERENCES product_versions(id) ON DELETE CASCADE,
 CONSTRAINT fk_pc_plan_product FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code),
 CONSTRAINT ck_pc_plan_capacity CHECK(available_person_days IS NULL OR available_person_days>=0), CONSTRAINT ck_pc_plan_reserve CHECK(reserve_person_days IS NULL OR reserve_person_days>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS product_version_plan_scopes (
 version_feature_id BIGINT UNSIGNED NOT NULL, version_id BIGINT UNSIGNED NOT NULL, product_code VARCHAR(64) NOT NULL,
 request_id BIGINT UNSIGNED NOT NULL, planning_item_id BIGINT UNSIGNED NOT NULL, scope_summary TEXT NOT NULL, estimate_person_days DECIMAL(12,2) NULL,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1, created_by VARCHAR(64) NOT NULL, updated_by VARCHAR(64) NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
 PRIMARY KEY(version_feature_id), UNIQUE KEY uk_pc_plan_scope_request(version_id,request_id), UNIQUE KEY uk_pc_plan_scope_item(planning_item_id), KEY idx_pc_plan_scope_version(version_id,version_feature_id),
 CONSTRAINT fk_pc_plan_scope_feature FOREIGN KEY(version_feature_id) REFERENCES product_version_features(id) ON DELETE CASCADE,
 CONSTRAINT fk_pc_plan_scope_version FOREIGN KEY(version_id) REFERENCES product_versions(id) ON DELETE CASCADE,
 CONSTRAINT fk_pc_plan_scope_request FOREIGN KEY(request_id,product_code) REFERENCES product_requests(id,product_code),
 CONSTRAINT fk_pc_plan_scope_item FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code),
 CONSTRAINT ck_pc_plan_scope_estimate CHECK(estimate_person_days IS NULL OR estimate_person_days>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS product_version_plan_confirmations (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, version_id BIGINT UNSIGNED NOT NULL, plan_revision BIGINT UNSIGNED NOT NULL, scope_revision BIGINT UNSIGNED NOT NULL,
 snapshot JSON NOT NULL, confirmed_by VARCHAR(64) NOT NULL, confirmed_at DATETIME(3) NOT NULL, invalidated_by VARCHAR(64) NULL, invalidated_at DATETIME(3) NULL, invalidation_reason TEXT NULL,
 PRIMARY KEY(id), KEY idx_pc_plan_confirmation(version_id,id), CONSTRAINT fk_pc_plan_confirmation_version FOREIGN KEY(version_id) REFERENCES product_versions(id) ON DELETE CASCADE,
 CONSTRAINT ck_pc_plan_confirmation_invalidation CHECK((invalidated_at IS NULL AND invalidated_by IS NULL) OR (invalidated_at IS NOT NULL AND invalidated_by IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Immutable evidence: correction is an appended record/event, never UPDATE/DELETE.
DELIMITER $$
DROP TRIGGER IF EXISTS pc_priority_assessments_no_update$$
CREATE TRIGGER pc_priority_assessments_no_update BEFORE UPDATE ON product_priority_assessments FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_priority_assessments_no_delete$$
CREATE TRIGGER pc_priority_assessments_no_delete BEFORE DELETE ON product_priority_assessments FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_version_acceptances_no_update$$
CREATE TRIGGER pc_version_acceptances_no_update BEFORE UPDATE ON product_version_acceptances FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_version_acceptances_no_delete$$
CREATE TRIGGER pc_version_acceptances_no_delete BEFORE DELETE ON product_version_acceptances FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_release_records_no_update$$
CREATE TRIGGER pc_release_records_no_update BEFORE UPDATE ON product_release_records FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_release_records_no_delete$$
CREATE TRIGGER pc_release_records_no_delete BEFORE DELETE ON product_release_records FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_release_events_no_update$$
CREATE TRIGGER pc_release_events_no_update BEFORE UPDATE ON product_release_events FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_release_events_no_delete$$
CREATE TRIGGER pc_release_events_no_delete BEFORE DELETE ON product_release_events FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_outcome_observations_no_update$$
CREATE TRIGGER pc_outcome_observations_no_update BEFORE UPDATE ON product_outcome_observations FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_outcome_observations_no_delete$$
CREATE TRIGGER pc_outcome_observations_no_delete BEFORE DELETE ON product_outcome_observations FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_activity_logs_no_update$$
CREATE TRIGGER pc_activity_logs_no_update BEFORE UPDATE ON product_activity_logs FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_activity_logs_no_delete$$
CREATE TRIGGER pc_activity_logs_no_delete BEFORE DELETE ON product_activity_logs FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DELIMITER ;

-- Formal product objectives. Apply after v5.21; existing planning snapshots remain unchanged.
CREATE TABLE IF NOT EXISTS product_objectives (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 title VARCHAR(255) NOT NULL,
 description TEXT NULL,
 starts_on DATE NOT NULL,
 ends_on DATE NOT NULL,
 owner_uid VARCHAR(64) NOT NULL,
 metric_name VARCHAR(255) NOT NULL,
 metric_unit VARCHAR(64) NOT NULL,
 measurement_definition TEXT NOT NULL,
 direction VARCHAR(16) NOT NULL,
 baseline_value DECIMAL(20,6) NOT NULL,
 target_value DECIMAL(20,6) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'draft',
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 created_by VARCHAR(64) NOT NULL,
 updated_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_objective_biz(biz_id),
 UNIQUE KEY uk_pc_objective_scope(id,product_code),
 KEY idx_pc_objective_period(product_code,status,starts_on,ends_on,id),
 CONSTRAINT fk_pc_objective_product FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code),
 CONSTRAINT ck_pc_objective_period CHECK(ends_on>=starts_on),
 CONSTRAINT ck_pc_objective_direction CHECK(direction IN ('increase','decrease')),
 CONSTRAINT ck_pc_objective_target CHECK((direction='increase' AND target_value>baseline_value) OR (direction='decrease' AND target_value<baseline_value)),
 CONSTRAINT ck_pc_objective_status CHECK(status IN ('draft','active','closed','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS product_objective_items (
 objective_id BIGINT UNSIGNED NOT NULL,
 planning_item_id BIGINT UNSIGNED NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 contribution_note TEXT NOT NULL,
 created_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(objective_id,planning_item_id),
 KEY idx_pc_objective_item_scope(planning_item_id,product_code),
 CONSTRAINT fk_pc_objective_item_goal FOREIGN KEY(objective_id,product_code) REFERENCES product_objectives(id,product_code),
 CONSTRAINT fk_pc_objective_item_planning FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS product_objective_observations (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 objective_id BIGINT UNSIGNED NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 objective_revision BIGINT UNSIGNED NOT NULL,
 metric_snapshot JSON NOT NULL,
 observed_on DATE NOT NULL,
 measured_value DECIMAL(20,6) NOT NULL,
 evidence TEXT NOT NULL,
 note TEXT NULL,
 created_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_objective_observation_biz(biz_id),
 KEY idx_pc_objective_observation_date(objective_id,observed_on,id),
 CONSTRAINT fk_pc_objective_observation FOREIGN KEY(objective_id,product_code) REFERENCES product_objectives(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
DROP TRIGGER IF EXISTS pc_objective_observation_no_update;
CREATE TRIGGER pc_objective_observation_no_update BEFORE UPDATE ON product_objective_observations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='product objective observations are immutable';
DROP TRIGGER IF EXISTS pc_objective_observation_no_delete;
CREATE TRIGGER pc_objective_observation_no_delete BEFORE DELETE ON product_objective_observations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='product objective observations are immutable';

-- Append-only corrections for objective observations. Apply after v5.22.
SET @pc_objective_correction_sql = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_objective_observations' AND column_name='correction_of_id'), 'SELECT 1', 'ALTER TABLE product_objective_observations ADD COLUMN correction_of_id BIGINT UNSIGNED NULL');
PREPARE pc_objective_correction_stmt FROM @pc_objective_correction_sql;
EXECUTE pc_objective_correction_stmt;
DEALLOCATE PREPARE pc_objective_correction_stmt;
SET @pc_objective_correction_sql = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_objective_observations' AND column_name='correction_reason'), 'SELECT 1', 'ALTER TABLE product_objective_observations ADD COLUMN correction_reason TEXT NULL');
PREPARE pc_objective_correction_stmt FROM @pc_objective_correction_sql;
EXECUTE pc_objective_correction_stmt;
DEALLOCATE PREPARE pc_objective_correction_stmt;
SET @pc_objective_correction_sql = IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='product_objective_observations' AND index_name='uk_pc_objective_observation_scope'), 'SELECT 1', 'ALTER TABLE product_objective_observations ADD UNIQUE KEY uk_pc_objective_observation_scope(id,objective_id,product_code)');
PREPARE pc_objective_correction_stmt FROM @pc_objective_correction_sql;
EXECUTE pc_objective_correction_stmt;
DEALLOCATE PREPARE pc_objective_correction_stmt;
SET @pc_objective_correction_sql = IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='product_objective_observations' AND index_name='uk_pc_objective_observation_correction'), 'SELECT 1', 'ALTER TABLE product_objective_observations ADD UNIQUE KEY uk_pc_objective_observation_correction(correction_of_id)');
PREPARE pc_objective_correction_stmt FROM @pc_objective_correction_sql;
EXECUTE pc_objective_correction_stmt;
DEALLOCATE PREPARE pc_objective_correction_stmt;
SET @pc_objective_correction_sql = IF(EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='product_objective_observations' AND constraint_name='fk_pc_objective_observation_correction'), 'SELECT 1', 'ALTER TABLE product_objective_observations ADD CONSTRAINT fk_pc_objective_observation_correction FOREIGN KEY(correction_of_id,objective_id,product_code) REFERENCES product_objective_observations(id,objective_id,product_code)');
PREPARE pc_objective_correction_stmt FROM @pc_objective_correction_sql;
EXECUTE pc_objective_correction_stmt;
DEALLOCATE PREPARE pc_objective_correction_stmt;
SET @pc_objective_correction_sql = IF(EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='product_objective_observations' AND constraint_name='ck_pc_objective_observation_correction'), 'SELECT 1', 'ALTER TABLE product_objective_observations ADD CONSTRAINT ck_pc_objective_observation_correction CHECK((correction_of_id IS NULL AND correction_reason IS NULL) OR (correction_of_id IS NOT NULL AND correction_reason IS NOT NULL AND CHAR_LENGTH(TRIM(correction_reason))>0))');
PREPARE pc_objective_correction_stmt FROM @pc_objective_correction_sql;
EXECUTE pc_objective_correction_stmt;
DEALLOCATE PREPARE pc_objective_correction_stmt;

-- Product objective / planning cycle mapping. Preserve both definitions at mapping time.
-- Prerequisites: v5.19 product center and v5.22 formal objectives.
CREATE TABLE IF NOT EXISTS product_objective_cycles (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 objective_id BIGINT UNSIGNED NOT NULL,
 cycle_id BIGINT UNSIGNED NOT NULL,
 objective_revision BIGINT UNSIGNED NOT NULL,
 cycle_revision BIGINT UNSIGNED NOT NULL,
 objective_snapshot JSON NOT NULL,
 cycle_snapshot JSON NOT NULL,
 mapping_note TEXT NOT NULL,
 created_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 revoked_by VARCHAR(64) NULL,
 revoked_at DATETIME(3) NULL,
 revocation_reason TEXT NULL,
 active_cycle_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN revoked_at IS NULL THEN cycle_id ELSE NULL END) STORED,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_objective_cycle_biz(biz_id),
 UNIQUE KEY uk_pc_objective_cycle_active(objective_id,active_cycle_id),
 KEY idx_pc_objective_cycle_scope(cycle_id,product_code),
 CONSTRAINT fk_pc_objective_cycle_goal FOREIGN KEY(objective_id,product_code) REFERENCES product_objectives(id,product_code),
 CONSTRAINT fk_pc_objective_cycle_cycle FOREIGN KEY(cycle_id,product_code) REFERENCES product_planning_cycles(id,product_code),
 CONSTRAINT ck_pc_objective_cycle_revision CHECK(objective_revision>0 AND cycle_revision>0),
 CONSTRAINT ck_pc_objective_cycle_note CHECK(CHAR_LENGTH(TRIM(mapping_note))>0),
 CONSTRAINT ck_pc_objective_cycle_revocation CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND CHAR_LENGTH(TRIM(revoked_by))>0 AND revocation_reason IS NOT NULL AND CHAR_LENGTH(TRIM(revocation_reason))>0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
DROP TRIGGER IF EXISTS trg_pc_objective_cycle_no_rewrite;
DELIMITER $$
CREATE TRIGGER trg_pc_objective_cycle_no_rewrite BEFORE UPDATE ON product_objective_cycles FOR EACH ROW
BEGIN
 IF OLD.revoked_at IS NOT NULL OR NOT (NEW.id <=> OLD.id) OR NOT (NEW.biz_id <=> OLD.biz_id) OR NOT (NEW.product_code <=> OLD.product_code) OR NOT (NEW.objective_id <=> OLD.objective_id) OR NOT (NEW.cycle_id <=> OLD.cycle_id) OR NOT (NEW.objective_revision <=> OLD.objective_revision) OR NOT (NEW.cycle_revision <=> OLD.cycle_revision) OR NOT (NEW.objective_snapshot <=> OLD.objective_snapshot) OR NOT (NEW.cycle_snapshot <=> OLD.cycle_snapshot) OR NOT (NEW.mapping_note <=> OLD.mapping_note) OR NOT (NEW.created_by <=> OLD.created_by) OR NOT (NEW.created_at <=> OLD.created_at) OR NEW.revoked_at IS NULL THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Objective cycle mapping snapshots are immutable';
 END IF;
END$$
DELIMITER ;
DROP TRIGGER IF EXISTS trg_pc_objective_cycle_no_delete;
CREATE TRIGGER trg_pc_objective_cycle_no_delete BEFORE DELETE ON product_objective_cycles FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Objective cycle mapping history cannot be deleted';

-- Exploration time windows on existing planning items, not delivery commitments.
-- Quarters are derived from dates. Existing decision ranks and deadlines are preserved.
SET @pc_roadmap_window_sql = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_planning_items' AND column_name='roadmap_starts_on'), 'SELECT 1', 'ALTER TABLE product_planning_items ADD COLUMN roadmap_starts_on DATE NULL');
PREPARE pc_roadmap_window_stmt FROM @pc_roadmap_window_sql;
EXECUTE pc_roadmap_window_stmt;
DEALLOCATE PREPARE pc_roadmap_window_stmt;
SET @pc_roadmap_window_sql = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_planning_items' AND column_name='roadmap_ends_on'), 'SELECT 1', 'ALTER TABLE product_planning_items ADD COLUMN roadmap_ends_on DATE NULL');
PREPARE pc_roadmap_window_stmt FROM @pc_roadmap_window_sql;
EXECUTE pc_roadmap_window_stmt;
DEALLOCATE PREPARE pc_roadmap_window_stmt;
SET @pc_roadmap_window_sql = IF(EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='product_planning_items' AND constraint_name='ck_pc_planning_roadmap_window'), 'SELECT 1', 'ALTER TABLE product_planning_items ADD CONSTRAINT ck_pc_planning_roadmap_window CHECK((roadmap_starts_on IS NULL AND roadmap_ends_on IS NULL) OR (roadmap_starts_on IS NOT NULL AND roadmap_ends_on IS NOT NULL AND roadmap_ends_on>=roadmap_starts_on))');
PREPARE pc_roadmap_window_stmt FROM @pc_roadmap_window_sql;
EXECUTE pc_roadmap_window_stmt;
DEALLOCATE PREPARE pc_roadmap_window_stmt;
SET @pc_roadmap_window_sql = IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='product_planning_items' AND index_name='idx_pc_planning_roadmap_window'), 'SELECT 1', 'ALTER TABLE product_planning_items ADD INDEX idx_pc_planning_roadmap_window(product_code,roadmap_starts_on,roadmap_ends_on,id)');
PREPARE pc_roadmap_window_stmt FROM @pc_roadmap_window_sql;
EXECUTE pc_roadmap_window_stmt;
DEALLOCATE PREPARE pc_roadmap_window_stmt;

-- Immutable roadmap commitment history. A changed commitment appends a successor.
-- Prerequisites: v5.19 planning entities and v5.25 exploration windows.
CREATE TABLE IF NOT EXISTS product_roadmap_commitments (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 planning_item_id BIGINT UNSIGNED NOT NULL,
 cycle_id BIGINT UNSIGNED NOT NULL,
 item_revision BIGINT UNSIGNED NOT NULL,
 scope_revision BIGINT UNSIGNED NOT NULL,
 evidence_revision BIGINT UNSIGNED NOT NULL,
 cycle_revision BIGINT UNSIGNED NOT NULL,
 queue_revision BIGINT UNSIGNED NOT NULL,
 starts_on DATE NOT NULL,
 ends_on DATE NOT NULL,
 item_snapshot JSON NOT NULL,
 decision_snapshot JSON NOT NULL,
 model_snapshot JSON NOT NULL,
 reason TEXT NOT NULL,
 created_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_roadmap_commitment_biz(biz_id),
 KEY idx_pc_roadmap_commitment_item(planning_item_id,product_code,id),
 KEY idx_pc_roadmap_commitment_cycle(cycle_id,product_code,id),
 CONSTRAINT fk_pc_roadmap_commitment_item FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code),
 CONSTRAINT fk_pc_roadmap_commitment_cycle FOREIGN KEY(cycle_id,product_code) REFERENCES product_planning_cycles(id,product_code),
 CONSTRAINT ck_pc_roadmap_commitment_revisions CHECK(item_revision>0 AND scope_revision>0 AND evidence_revision>0 AND cycle_revision>0 AND queue_revision>0),
 CONSTRAINT ck_pc_roadmap_commitment_dates CHECK(ends_on>=starts_on),
 CONSTRAINT ck_pc_roadmap_commitment_reason CHECK(CHAR_LENGTH(TRIM(reason))>0 AND CHAR_LENGTH(TRIM(created_by))>0),
 CONSTRAINT ck_pc_roadmap_commitment_snapshots CHECK(JSON_TYPE(item_snapshot)='OBJECT' AND JSON_TYPE(decision_snapshot)='OBJECT' AND JSON_TYPE(model_snapshot)='OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
DROP TRIGGER IF EXISTS trg_pc_roadmap_commitment_no_update;
CREATE TRIGGER trg_pc_roadmap_commitment_no_update BEFORE UPDATE ON product_roadmap_commitments FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Roadmap commitments are immutable';
DROP TRIGGER IF EXISTS trg_pc_roadmap_commitment_no_delete;
CREATE TRIGGER trg_pc_roadmap_commitment_no_delete BEFORE DELETE ON product_roadmap_commitments FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Roadmap commitment history cannot be deleted';

-- Cross-product edges supplement the existing same-product dependency graph.
-- Commands must serialize graph changes and authorize both product scopes.
CREATE TABLE IF NOT EXISTS product_cross_dependencies (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 planning_item_id BIGINT UNSIGNED NOT NULL,
 predecessor_product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 predecessor_id BIGINT UNSIGNED NOT NULL,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 reason TEXT NOT NULL,
 created_by VARCHAR(64) NOT NULL,
 updated_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_cross_dependency_biz(biz_id),
 UNIQUE KEY uk_pc_cross_dependency_edge(planning_item_id,predecessor_id),
 KEY idx_pc_cross_dependency_source(planning_item_id,product_code),
 KEY idx_pc_cross_dependency_target(predecessor_id,predecessor_product_code),
 CONSTRAINT fk_pc_cross_dependency_source FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code),
 CONSTRAINT fk_pc_cross_dependency_target FOREIGN KEY(predecessor_id,predecessor_product_code) REFERENCES product_planning_items(id,product_code),
 CONSTRAINT ck_pc_cross_dependency_products CHECK(BINARY product_code<>BINARY predecessor_product_code AND planning_item_id<>predecessor_id),
 CONSTRAINT ck_pc_cross_dependency_revision CHECK(revision>0),
 CONSTRAINT ck_pc_cross_dependency_reason CHECK(CHAR_LENGTH(TRIM(reason))>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
-- Shared lock for cross- and same-product edge changes, preventing concurrent cycles.
CREATE TABLE IF NOT EXISTS product_dependency_graph_lock (
 id TINYINT UNSIGNED NOT NULL,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 PRIMARY KEY(id),
 CONSTRAINT ck_pc_dependency_graph_singleton CHECK(id=1 AND revision>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
INSERT IGNORE INTO product_dependency_graph_lock(id,revision) VALUES(1,1);

-- Private immutable predecessor evidence. Read only after authorization of the
-- commitment's source product and each predecessor product; never raw-forward
-- this table through the general commitment history endpoint.
CREATE TABLE IF NOT EXISTS product_roadmap_cross_dependency_snapshots (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 commitment_id BIGINT UNSIGNED NOT NULL,
 dependency_biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 dependency_revision BIGINT UNSIGNED NOT NULL,
 predecessor_product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 predecessor_biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 predecessor_revision BIGINT UNSIGNED NOT NULL,
 snapshot JSON NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_roadmap_cross_snapshot_edge(commitment_id,dependency_biz_id),
 KEY idx_pc_roadmap_cross_snapshot_scope(commitment_id,predecessor_product_code,id),
 CONSTRAINT fk_pc_roadmap_cross_snapshot_commitment FOREIGN KEY(commitment_id) REFERENCES product_roadmap_commitments(id),
 CONSTRAINT fk_pc_roadmap_cross_snapshot_product FOREIGN KEY(predecessor_product_code) REFERENCES product_workspaces(product_code),
 CONSTRAINT ck_pc_roadmap_cross_snapshot_revisions CHECK(dependency_revision>0 AND predecessor_revision>0),
 CONSTRAINT ck_pc_roadmap_cross_snapshot_json CHECK(JSON_TYPE(snapshot)='OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
DROP TRIGGER IF EXISTS trg_pc_roadmap_cross_snapshot_no_update;
CREATE TRIGGER trg_pc_roadmap_cross_snapshot_no_update BEFORE UPDATE ON product_roadmap_cross_dependency_snapshots FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Roadmap predecessor snapshots are immutable';
DROP TRIGGER IF EXISTS trg_pc_roadmap_cross_snapshot_no_delete;
CREATE TRIGGER trg_pc_roadmap_cross_snapshot_no_delete BEFORE DELETE ON product_roadmap_cross_dependency_snapshots FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Roadmap predecessor history cannot be deleted';

-- Product-owned immutable scoring versions. Existing cycle/assessment snapshots
-- remain authoritative; this migration does not recompute or reorder anything.
CREATE TABLE IF NOT EXISTS product_priority_model_versions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 version VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 title VARCHAR(200) NOT NULL,
 method VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
 configuration JSON NOT NULL,
 reason TEXT NOT NULL,
 created_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_priority_model_biz(biz_id),
 UNIQUE KEY uk_pc_priority_model_version(product_code,version),
 KEY idx_pc_priority_model_list(product_code,id),
 CONSTRAINT fk_pc_priority_model_product FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code),
 CONSTRAINT ck_pc_priority_model_text CHECK(CHAR_LENGTH(TRIM(version))>0 AND CHAR_LENGTH(TRIM(title))>0 AND CHAR_LENGTH(TRIM(reason))>0 AND CHAR_LENGTH(TRIM(created_by))>0),
 CONSTRAINT ck_pc_priority_model_method CHECK(method IN ('weighted-value-effort','rice')),
 CONSTRAINT ck_pc_priority_model_config CHECK(JSON_TYPE(configuration)='OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
DROP TRIGGER IF EXISTS trg_pc_priority_model_no_update;
CREATE TRIGGER trg_pc_priority_model_no_update BEFORE UPDATE ON product_priority_model_versions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Priority model versions are immutable';
DROP TRIGGER IF EXISTS trg_pc_priority_model_no_delete;
CREATE TRIGGER trg_pc_priority_model_no_delete BEFORE DELETE ON product_priority_model_versions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Priority model history cannot be deleted';

-- Immutable Reach evidence, scoped to a product planning item and published model.
CREATE TABLE IF NOT EXISTS product_rice_reach_observations (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 planning_item_id BIGINT UNSIGNED NOT NULL,
 model_version VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 scope_revision BIGINT UNSIGNED NOT NULL,
 evidence_revision BIGINT UNSIGNED NOT NULL,
 reach_count BIGINT UNSIGNED NOT NULL,
 snapshot JSON NOT NULL,
 recorded_by VARCHAR(64) NOT NULL,
 recorded_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_rice_observation_biz(biz_id),
 KEY idx_pc_rice_observation_list(product_code,planning_item_id,id),
 CONSTRAINT fk_pc_rice_observation_item FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code),
 CONSTRAINT fk_pc_rice_observation_model FOREIGN KEY(product_code,model_version) REFERENCES product_priority_model_versions(product_code,version),
 CONSTRAINT ck_pc_rice_observation_revision CHECK(scope_revision>0 AND evidence_revision>0),
 CONSTRAINT ck_pc_rice_observation_count CHECK(reach_count<=1000000000),
 CONSTRAINT ck_pc_rice_observation_snapshot CHECK(JSON_TYPE(snapshot)='OBJECT'),
 CONSTRAINT ck_pc_rice_observation_recorder CHECK(CHAR_LENGTH(TRIM(recorded_by))>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
DROP TRIGGER IF EXISTS trg_pc_rice_observation_no_update;
CREATE TRIGGER trg_pc_rice_observation_no_update BEFORE UPDATE ON product_rice_reach_observations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Reach observations are immutable';
DROP TRIGGER IF EXISTS trg_pc_rice_observation_no_delete;
CREATE TRIGGER trg_pc_rice_observation_no_delete BEFORE DELETE ON product_rice_reach_observations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Reach observation history cannot be deleted';

-- Preserve weighted assessments and store RICE-specific fields without fabricated value dimensions.
SET @pc_rice_assessment_sql = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_priority_assessments' AND column_name='model_method'), 'SELECT 1', 'ALTER TABLE product_priority_assessments ADD COLUMN model_method VARCHAR(32) COLLATE utf8mb4_bin NOT NULL DEFAULT ''weighted-value-effort''');
PREPARE pc_rice_assessment_stmt FROM @pc_rice_assessment_sql;
EXECUTE pc_rice_assessment_stmt;
DEALLOCATE PREPARE pc_rice_assessment_stmt;
SET @pc_rice_assessment_sql = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_priority_assessments' AND column_name='rice_impact'), 'SELECT 1', 'ALTER TABLE product_priority_assessments ADD COLUMN rice_impact DECIMAL(3,2) NULL');
PREPARE pc_rice_assessment_stmt FROM @pc_rice_assessment_sql;
EXECUTE pc_rice_assessment_stmt;
DEALLOCATE PREPARE pc_rice_assessment_stmt;
SET @pc_rice_assessment_sql = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_priority_assessments' AND column_name='reach_observation_id'), 'SELECT 1', 'ALTER TABLE product_priority_assessments ADD COLUMN reach_observation_id BIGINT UNSIGNED NULL');
PREPARE pc_rice_assessment_stmt FROM @pc_rice_assessment_sql;
EXECUTE pc_rice_assessment_stmt;
DEALLOCATE PREPARE pc_rice_assessment_stmt;
SET @pc_rice_assessment_sql = IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='product_rice_reach_observations' AND index_name='uk_pc_rice_observation_item'), 'SELECT 1', 'ALTER TABLE product_rice_reach_observations ADD UNIQUE KEY uk_pc_rice_observation_item(id,planning_item_id)');
PREPARE pc_rice_assessment_stmt FROM @pc_rice_assessment_sql;
EXECUTE pc_rice_assessment_stmt;
DEALLOCATE PREPARE pc_rice_assessment_stmt;
SET @pc_rice_assessment_sql = IF(EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='product_priority_assessments' AND constraint_name='fk_pc_assessment_reach'), 'SELECT 1', 'ALTER TABLE product_priority_assessments ADD CONSTRAINT fk_pc_assessment_reach FOREIGN KEY(reach_observation_id,planning_item_id) REFERENCES product_rice_reach_observations(id,planning_item_id)');
PREPARE pc_rice_assessment_stmt FROM @pc_rice_assessment_sql;
EXECUTE pc_rice_assessment_stmt;
DEALLOCATE PREPARE pc_rice_assessment_stmt;
SET @pc_rice_assessment_sql = IF(EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='product_priority_assessments' AND constraint_name='ck_pc_assessment_method'), 'SELECT 1', 'ALTER TABLE product_priority_assessments ADD CONSTRAINT ck_pc_assessment_method CHECK(model_method IN (''weighted-value-effort'',''rice''))');
PREPARE pc_rice_assessment_stmt FROM @pc_rice_assessment_sql;
EXECUTE pc_rice_assessment_stmt;
DEALLOCATE PREPARE pc_rice_assessment_stmt;
SET @pc_rice_assessment_sql = IF(EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='product_priority_assessments' AND constraint_name='ck_pc_assessment_rice_impact'), 'SELECT 1', 'ALTER TABLE product_priority_assessments ADD CONSTRAINT ck_pc_assessment_rice_impact CHECK(rice_impact IN (0.25,0.50,1.00,2.00,3.00))');
PREPARE pc_rice_assessment_stmt FROM @pc_rice_assessment_sql;
EXECUTE pc_rice_assessment_stmt;
DEALLOCATE PREPARE pc_rice_assessment_stmt;
SET @pc_rice_assessment_sql = IF(EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='product_priority_assessments' AND constraint_name='ck_pc_assessment_method_fields'), 'SELECT 1', 'ALTER TABLE product_priority_assessments ADD CONSTRAINT ck_pc_assessment_method_fields CHECK((model_method=''weighted-value-effort'' AND rice_impact IS NULL AND reach_observation_id IS NULL) OR (model_method=''rice'' AND strategic IS NULL AND user_value IS NULL AND business IS NULL AND risk IS NULL AND value_score IS NULL))');
PREPARE pc_rice_assessment_stmt FROM @pc_rice_assessment_sql;
EXECUTE pc_rice_assessment_stmt;
DEALLOCATE PREPARE pc_rice_assessment_stmt;
SET @pc_rice_assessment_sql = IF(EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='product_priority_assessments' AND constraint_name='ck_pc_assessment_model_complete'), 'SELECT 1', 'ALTER TABLE product_priority_assessments ADD CONSTRAINT ck_pc_assessment_model_complete CHECK(priority_score IS NULL OR (confidence IS NOT NULL AND effort_person_days IS NOT NULL AND ((model_method=''weighted-value-effort'' AND strategic IS NOT NULL AND user_value IS NOT NULL AND business IS NOT NULL AND risk IS NOT NULL AND value_score IS NOT NULL) OR (model_method=''rice'' AND rice_impact IS NOT NULL AND reach_observation_id IS NOT NULL))))');
PREPARE pc_rice_assessment_stmt FROM @pc_rice_assessment_sql;
EXECUTE pc_rice_assessment_stmt;
DEALLOCATE PREPARE pc_rice_assessment_stmt;
SET @pc_rice_assessment_sql = IF(NOT EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='product_priority_assessments' AND constraint_name='ck_pc_assessment_complete'), 'SELECT 1', 'ALTER TABLE product_priority_assessments DROP CHECK ck_pc_assessment_complete');
PREPARE pc_rice_assessment_stmt FROM @pc_rice_assessment_sql;
EXECUTE pc_rice_assessment_stmt;
DEALLOCATE PREPARE pc_rice_assessment_stmt;

-- v5.32 roadmap saved views
-- Presentation preferences only; these rows never grant access to roadmap data.
CREATE TABLE IF NOT EXISTS product_roadmap_saved_views (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 cycle_id BIGINT UNSIGNED NOT NULL,
 owner_uid VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 title VARCHAR(200) NOT NULL,
 audience VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
 visibility VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
 roadmap_year SMALLINT UNSIGNED NOT NULL,
 roadmap_quarter TINYINT UNSIGNED NOT NULL,
 unscheduled BOOLEAN NOT NULL DEFAULT FALSE,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 created_by VARCHAR(64) NOT NULL,
 updated_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_saved_view_biz(biz_id),
 KEY idx_pc_saved_view_owner(product_code,owner_uid,id),
 KEY idx_pc_saved_view_shared(product_code,visibility,id),
 CONSTRAINT fk_pc_saved_view_cycle FOREIGN KEY(cycle_id,product_code) REFERENCES product_planning_cycles(id,product_code),
 CONSTRAINT ck_pc_saved_view_audience CHECK(audience IN ('planning','delivery','stakeholder')),
 CONSTRAINT ck_pc_saved_view_visibility CHECK(visibility IN ('personal','product')),
 CONSTRAINT ck_pc_saved_view_window CHECK(roadmap_year BETWEEN 1000 AND 9999 AND roadmap_quarter BETWEEN 1 AND 4),
 CONSTRAINT ck_pc_saved_view_unscheduled CHECK(unscheduled IN (0,1)),
 CONSTRAINT ck_pc_saved_view_revision CHECK(revision>0),
 CONSTRAINT ck_pc_saved_view_title CHECK(CHAR_LENGTH(TRIM(title))>0),
 CONSTRAINT ck_pc_saved_view_actors CHECK(CHAR_LENGTH(TRIM(owner_uid))>0 AND CHAR_LENGTH(TRIM(created_by))>0 AND CHAR_LENGTH(TRIM(updated_by))>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- v5.33 saved view deletion
-- Retain view identity and ownership for authorized idempotent deletion replay.
SET @pc_saved_view_sql = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_roadmap_saved_views' AND column_name='deleted_at'), 'SELECT 1', 'ALTER TABLE product_roadmap_saved_views ADD COLUMN deleted_at DATETIME(3) NULL');
PREPARE pc_saved_view_stmt FROM @pc_saved_view_sql;
EXECUTE pc_saved_view_stmt;
DEALLOCATE PREPARE pc_saved_view_stmt;

-- Product/document index only. This relation never grants Codocs ACL or stores content.
CREATE TABLE IF NOT EXISTS product_documents (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 document_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 purpose VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 removed_at DATETIME(3) NULL,
 removed_by VARCHAR(64) NULL,
 created_by VARCHAR(64) NOT NULL,
 updated_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_document_biz(biz_id),
 UNIQUE KEY uk_pc_document_uuid(product_code,document_uuid),
 KEY idx_pc_document_list(product_code,removed_at,purpose,id),
 CONSTRAINT fk_pc_document_workspace FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code),
 CONSTRAINT ck_pc_document_purpose CHECK(purpose IN ('product-overview','requirements','design','release-notes','user-guide','other')),
 CONSTRAINT ck_pc_document_revision CHECK(revision>0),
 CONSTRAINT ck_pc_document_removed CHECK((removed_at IS NULL AND removed_by IS NULL) OR (removed_at IS NOT NULL AND removed_by IS NOT NULL AND CHAR_LENGTH(TRIM(removed_by))>0)),
 CONSTRAINT ck_pc_document_actors CHECK(CHAR_LENGTH(TRIM(created_by))>0 AND CHAR_LENGTH(TRIM(updated_by))>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Product-owned creation requests reference the existing caller operation.
-- Frozen title/template/actor and target receipt stay in integration_operation;
-- this table only records the product purpose and resulting relation.
CREATE TABLE IF NOT EXISTS product_document_creation_requests (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 operation_id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
 document_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 purpose VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
 relation_biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 created_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 linked_at DATETIME(3) NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_doc_creation_request(biz_id),
 UNIQUE KEY uk_pc_doc_creation_operation(operation_id),
 UNIQUE KEY uk_pc_doc_creation_target(document_uuid),
 UNIQUE KEY uk_pc_doc_creation_relation(relation_biz_id),
 KEY idx_pc_doc_creation_product(product_code,id),
 CONSTRAINT fk_pc_doc_creation_workspace FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code),
 CONSTRAINT fk_pc_doc_creation_operation FOREIGN KEY(operation_id) REFERENCES integration_operation(operation_id),
 CONSTRAINT fk_pc_doc_creation_relation FOREIGN KEY(relation_biz_id) REFERENCES product_documents(biz_id),
 CONSTRAINT ck_pc_doc_creation_purpose CHECK(purpose IN ('product-overview','requirements','design','release-notes','user-guide','other')),
 CONSTRAINT ck_pc_doc_creation_actor CHECK(CHAR_LENGTH(TRIM(created_by))>0),
 CONSTRAINT ck_pc_doc_creation_link CHECK((relation_biz_id IS NULL AND linked_at IS NULL) OR (relation_biz_id IS NOT NULL AND linked_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Formal feedback identity is separate from unrestricted manual source notes.
CREATE TABLE IF NOT EXISTS product_feedback_bindings (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 source_app VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_biz_id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 request_id BIGINT UNSIGNED NOT NULL,
 source_id BIGINT UNSIGNED NOT NULL,
 created_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_feedback_origin(source_app,source_type,source_biz_id),
 UNIQUE KEY uk_pc_feedback_source(source_id),
 KEY idx_pc_feedback_product(product_code,id),
 CONSTRAINT fk_pc_feedback_workspace FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code),
 CONSTRAINT fk_pc_feedback_request FOREIGN KEY(request_id) REFERENCES product_requests(id),
 CONSTRAINT fk_pc_feedback_source FOREIGN KEY(source_id) REFERENCES product_request_sources(id),
 CONSTRAINT ck_pc_feedback_origin CHECK(source_app='altoc' AND source_type='service_ticket' AND CHAR_LENGTH(TRIM(source_biz_id))>0),
 CONSTRAINT ck_pc_feedback_actor CHECK(CHAR_LENGTH(TRIM(created_by))>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
-- AIMS management subjects; Assets remains the product/catalog authority.
CREATE TABLE IF NOT EXISTS product_line_workspaces (
  line_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  line_label VARCHAR(255) NOT NULL,
  source_watermark VARCHAR(191) NOT NULL,
  PRIMARY KEY (line_code),
  UNIQUE KEY uk_pc_line_workspace (product_code),
  CONSTRAINT fk_pc_line_workspace FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS product_component_sources (
  source_product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  component_id BIGINT UNSIGNED NOT NULL,
  source_product_name VARCHAR(255) NOT NULL,
  PRIMARY KEY (source_product_code),
  UNIQUE KEY uk_pc_source_component (component_id),
  CONSTRAINT fk_pc_source_workspace FOREIGN KEY (product_code) REFERENCES product_line_workspaces(product_code),
  CONSTRAINT fk_pc_source_component FOREIGN KEY (component_id,product_code) REFERENCES product_components(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

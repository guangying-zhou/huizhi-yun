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
  `rank_series` ENUM('M', 'P') NOT NULL DEFAULT 'P' COMMENT '职级类型：M 管理，P 专业',
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
  KEY `idx_people_rank_level` (`rank_level`, `enabled`, `sort_order`),
  KEY `idx_people_rank_series_level` (`rank_series`, `rank_level`, `enabled`, `sort_order`),
  CONSTRAINT `ck_people_rank_numeric` CHECK (`rank_level` >= 0 AND `sort_order` >= 0),
  CONSTRAINT `ck_people_rank_enabled` CHECK (`enabled` IN (0, 1))
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

CREATE TABLE IF NOT EXISTS `people_employee_number_sequences` (
  `sequence_code` VARCHAR(64) NOT NULL,
  `next_value` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '下一次尝试分配的十进制整数',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`sequence_code`),
  CONSTRAINT `ck_people_employee_number_sequence_nonnegative` CHECK (`next_value` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 并发安全业务编号序列';

INSERT INTO `people_employee_number_sequences` (`sequence_code`, `next_value`)
VALUES ('employee_no', 0)
ON DUPLICATE KEY UPDATE `sequence_code` = VALUES(`sequence_code`);

CREATE TABLE IF NOT EXISTS `people_employees` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `employee_uid` VARCHAR(64) NOT NULL COMMENT 'Console Directory uid 或可映射稳定 UID',
  `employee_no` VARCHAR(64) NOT NULL COMMENT 'People 自动分配工号；至少三位十进制数字',
  `display_name` VARCHAR(100) NOT NULL COMMENT '姓名',
  `initials` VARCHAR(16) DEFAULT NULL,
  `login_name` VARCHAR(100) DEFAULT NULL,
  `mobile` VARCHAR(64) DEFAULT NULL COMMENT '手机号；Console Directory 是登录身份事实源，此列用于同步与展示',
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
  `onboard_date_source` ENUM('dingtalk', 'oa_archive', 'manual') DEFAULT NULL COMMENT '入职日期有效来源；钉钉有值时优先，否则可由 OA 历史档案或 HR 维护',
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
  KEY `idx_people_employee_manager` (`manager_uid`),
  KEY `idx_people_employee_onboard_date_source` (`onboard_date_source`, `onboard_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 员工最小事实';

CREATE TABLE IF NOT EXISTS `people_employee_private_facts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `employee_uid` VARCHAR(64) NOT NULL,
  `field_code` ENUM('id_number', 'birth_date', 'education_level', 'major', 'graduation_school', 'graduation_date') NOT NULL,
  `source_code` ENUM('dingtalk', 'oa_archive', 'manual') NOT NULL,
  `value_text` VARCHAR(255) NOT NULL COMMENT '规范化字段值；身份证号属于高度敏感数据，仅限 employees/admin 接口读取且只返回掩码',
  `source_biz_id` VARCHAR(128) DEFAULT NULL,
  `source_updated_at` DATETIME DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_employee_private_fact` (`employee_uid`, `field_code`, `source_code`),
  KEY `idx_people_employee_private_source` (`source_code`, `source_updated_at`),
  KEY `idx_people_employee_private_employee` (`employee_uid`, `field_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 员工私密档案分来源事实；有效值按钉钉、人工、OA 优先级解析';

CREATE TABLE IF NOT EXISTS `people_connector_sync_receipts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `job_id` VARCHAR(128) NOT NULL,
  `batch_number` INT UNSIGNED NOT NULL,
  `batch_hash` CHAR(64) NOT NULL,
  `provider_code` VARCHAR(32) NOT NULL,
  `integration_code` VARCHAR(128) NOT NULL,
  `status` ENUM('processing','success','failed') NOT NULL,
  `applied_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `skipped_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `is_final` TINYINT(1) NOT NULL DEFAULT 0,
  `error_message` VARCHAR(500) DEFAULT NULL,
  `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finished_at` DATETIME(3) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_connector_sync_batch` (`job_id`,`batch_number`),
  KEY `idx_people_connector_sync_status` (`status`,`updated_at`),
  CONSTRAINT `ck_people_connector_sync_final` CHECK (`is_final` IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Connector Runtime 钉钉 People 同步批次幂等回执';

CREATE TABLE IF NOT EXISTS `people_assignments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `assignment_code` VARCHAR(64) NOT NULL,
  `employee_uid` VARCHAR(64) NOT NULL,
  `change_type` ENUM('onboard', 'transfer', 'rank_change', 'leave') NOT NULL,
  `effective_from` DATE NOT NULL,
  `effective_to` DATE DEFAULT NULL,
  `is_primary` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否主任职；有效区间排他由 People 领域写入校验',
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
  KEY `idx_people_assignment_primary_effective` (`employee_uid`, `is_primary`, `approval_status`, `effective_from`, `effective_to`),
  KEY `idx_people_assignment_workflow` (`workflow_instance_id`),
  KEY `idx_people_assignment_source` (`source_app`, `source_biz_type`, `source_biz_id`),
  CONSTRAINT `fk_people_assignment_employee` FOREIGN KEY (`employee_uid`) REFERENCES `people_employees` (`employee_uid`),
  CONSTRAINT `ck_people_assignment_primary` CHECK (`is_primary` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 任职快照与入转调离记录';

CREATE TABLE IF NOT EXISTS `people_onboarding_cases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `onboarding_code` VARCHAR(64) NOT NULL COMMENT '入职单稳定业务键，例如 ONB-*',

  -- 外部事实源
  `provider_code` VARCHAR(32) NOT NULL DEFAULT 'dingtalk',
  `provider_subject` VARCHAR(255) NOT NULL COMMENT '钉钉用户唯一标识；仅作外部 identity，不得作为员工 UID',
  `source_revision` VARCHAR(128) DEFAULT NULL COMMENT '钉钉快照版本',
  `source_hash` CHAR(64) DEFAULT NULL COMMENT '规范化候选事实摘要，用于识别真实变化',
  `candidate_name` VARCHAR(100) NOT NULL COMMENT '钉钉权威姓名',
  `source_onboard_date` DATE DEFAULT NULL COMMENT '钉钉下发的入职日期原值，只读',
  `source_field_status` JSON DEFAULT NULL COMMENT '逐字段来源状态：provided / empty / absent / invalid',

  -- HR 确认事实
  `planned_onboard_date` DATE DEFAULT NULL,
  `employee_no` VARCHAR(64) DEFAULT NULL COMMENT 'People 自动工号；资料首次保存时分配且完成前必须唯一',
  `dept_code` VARCHAR(64) DEFAULT NULL COMMENT 'canonical Directory 部门编码',
  `position_code` VARCHAR(64) DEFAULT NULL,
  `rank_code` VARCHAR(32) DEFAULT NULL,
  `employment_type` ENUM('full_time', 'part_time', 'outsourced', 'intern', 'agent') NOT NULL DEFAULT 'full_time',

  -- 账号事实
  `canonical_uid` VARCHAR(64) DEFAULT NULL COMMENT 'UID 预留成功后写入；此前为空',
  `reservation_id` CHAR(36) DEFAULT NULL COMMENT 'Console 身份预留 ID',
  `provision_operation_id` CHAR(36) DEFAULT NULL COMMENT 'Console LDAP 建号 operation ID；员工激活前据此验真',
  `corporate_email` VARCHAR(255) DEFAULT NULL COMMENT 'Console/LDAP 企业邮箱；完成前必须唯一',
  `mobile` VARCHAR(64) DEFAULT NULL COMMENT '钉钉下发手机号，用于开户与 Directory 落地，不作为 People 事实源',

  -- 上级。经理未落地为 canonical 主体时只保留外部标识或候选单引用，禁止合成 UID。
  `manager_uid` VARCHAR(64) DEFAULT NULL,
  `manager_provider_subject` VARCHAR(255) DEFAULT NULL,
  `manager_onboarding_code` VARCHAR(64) DEFAULT NULL,

  `status` ENUM(
    'awaiting_profile', 'ready_for_provisioning', 'reserving_identity',
    'provisioning_account', 'activating_employee', 'projecting_authorization',
    'completed',
    'profile_conflict', 'identity_conflict', 'reservation_expired',
    'provisioning_failed', 'authorization_failed',
    'cancelled'
  ) NOT NULL DEFAULT 'awaiting_profile',
  `object_version` BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '用户动作 CAS 版本，API 表达为 vN',
  `last_error_code` VARCHAR(100) DEFAULT NULL COMMENT '去敏、稳定错误码',

  `completed_at` DATETIME DEFAULT NULL,
  `completed_by` VARCHAR(64) DEFAULT NULL,
  `cancelled_at` DATETIME DEFAULT NULL,
  `cancelled_by` VARCHAR(64) DEFAULT NULL,
  `cancellation_reason` VARCHAR(500) DEFAULT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `updated_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- 未取消的入职单之间工号与邮箱必须唯一；已取消的不再占用。
  `active_employee_no` VARCHAR(64) GENERATED ALWAYS AS (
    CASE WHEN `status` <> 'cancelled' THEN `employee_no` ELSE NULL END
  ) STORED,
  `active_corporate_email` VARCHAR(255) GENERATED ALWAYS AS (
    CASE WHEN `status` <> 'cancelled' THEN LOWER(`corporate_email`) ELSE NULL END
  ) STORED,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_onboarding_code` (`onboarding_code`),
  -- 钉钉重放不重复建单。
  UNIQUE KEY `uk_people_onboarding_provider_subject` (`provider_code`, `provider_subject`),
  -- MySQL 的 UNIQUE 允许多个 NULL，因此未预留 UID 的候选互不冲突。
  UNIQUE KEY `uk_people_onboarding_canonical_uid` (`canonical_uid`),
  UNIQUE KEY `uk_people_onboarding_active_employee_no` (`active_employee_no`),
  UNIQUE KEY `uk_people_onboarding_active_email` (`active_corporate_email`),
  KEY `idx_people_onboarding_status` (`status`, `updated_at`, `id`),
  KEY `idx_people_onboarding_dept` (`dept_code`, `status`),
  KEY `idx_people_onboarding_manager_subject` (`manager_provider_subject`),
  KEY `idx_people_onboarding_provision_operation` (`provision_operation_id`),

  CONSTRAINT `ck_people_onboarding_identity` CHECK (
    `onboarding_code` = TRIM(`onboarding_code`) AND `onboarding_code` <> ''
    AND `provider_subject` = TRIM(`provider_subject`) AND `provider_subject` <> ''
    AND `candidate_name` = TRIM(`candidate_name`) AND `candidate_name` <> ''
    AND `object_version` > 0
  ),
  -- 候选阶段禁止出现 dt-* 合成主体：它正是本设计要消除的分叉来源。
  CONSTRAINT `ck_people_onboarding_uid_not_synthetic` CHECK (
    `canonical_uid` IS NULL OR (
      `canonical_uid` = TRIM(`canonical_uid`) AND `canonical_uid` <> ''
      AND LOWER(`canonical_uid`) NOT LIKE 'dt-%'
    )
  ),
  CONSTRAINT `ck_people_onboarding_manager_uid_not_synthetic` CHECK (
    `manager_uid` IS NULL OR (
      `manager_uid` = TRIM(`manager_uid`) AND `manager_uid` <> ''
      AND LOWER(`manager_uid`) NOT LIKE 'dt-%'
    )
  ),
  CONSTRAINT `ck_people_onboarding_actor` CHECK (
    `created_by` = TRIM(`created_by`) AND `created_by` <> ''
    AND `updated_by` = TRIM(`updated_by`) AND `updated_by` <> ''
  ),
  -- 与离职单对称的终态审计：非对应终态不得伪造终态字段。
  CONSTRAINT `ck_people_onboarding_terminal_audit` CHECK (
    (`status` = 'completed'
      AND `completed_at` IS NOT NULL AND `completed_by` IS NOT NULL AND `completed_by` <> ''
      AND `cancelled_at` IS NULL AND `cancelled_by` IS NULL AND `cancellation_reason` IS NULL)
    OR
    (`status` = 'cancelled'
      AND `cancelled_at` IS NOT NULL AND `cancelled_by` IS NOT NULL AND `cancelled_by` <> ''
      AND `cancellation_reason` IS NOT NULL AND TRIM(`cancellation_reason`) <> ''
      AND `completed_at` IS NULL AND `completed_by` IS NULL)
    OR
    (`status` NOT IN ('completed', 'cancelled')
      AND `completed_at` IS NULL AND `completed_by` IS NULL
      AND `cancelled_at` IS NULL AND `cancelled_by` IS NULL AND `cancellation_reason` IS NULL)
  ),
  -- completed 必须已经持有 canonical UID，否则等于把候选当成正式员工收口。
  CONSTRAINT `ck_people_onboarding_completed_requires_uid` CHECK (
    `status` <> 'completed' OR `canonical_uid` IS NOT NULL
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='People 入职候选单；不是 employee，不参与任职、成本、绩效与权限范围计算';

CREATE TABLE IF NOT EXISTS `people_offboarding_cases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_code` VARCHAR(64) NOT NULL COMMENT '离职事项稳定业务键',
  `leave_assignment_code` VARCHAR(64) NOT NULL COMMENT '唯一绑定已生效或无需审批的离职任职记录',
  `employee_uid` VARCHAR(64) NOT NULL COMMENT '离职员工稳定 UID',
  `status` ENUM('active', 'completed', 'cancelled') NOT NULL DEFAULT 'active',
  `object_version` BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '用户动作 CAS 版本，API 表达为 vN',
  `completed_at` DATETIME DEFAULT NULL,
  `completed_by` VARCHAR(64) DEFAULT NULL,
  `cancelled_at` DATETIME DEFAULT NULL,
  `cancelled_by` VARCHAR(64) DEFAULT NULL,
  `cancellation_reason` VARCHAR(500) DEFAULT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `updated_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_offboarding_case_code` (`case_code`),
  UNIQUE KEY `uk_people_offboarding_leave_assignment` (`leave_assignment_code`),
  KEY `idx_people_offboarding_employee_status` (`employee_uid`, `status`, `updated_at`),
  KEY `idx_people_offboarding_status` (`status`, `updated_at`, `id`),
  CONSTRAINT `fk_people_offboarding_assignment` FOREIGN KEY (`leave_assignment_code`) REFERENCES `people_assignments` (`assignment_code`),
  CONSTRAINT `fk_people_offboarding_employee` FOREIGN KEY (`employee_uid`) REFERENCES `people_employees` (`employee_uid`),
  CONSTRAINT `ck_people_offboarding_case_code` CHECK (
    `case_code` = TRIM(`case_code`) AND `case_code` <> '' AND LOWER(`case_code`) <> '@all'
    AND `leave_assignment_code` = TRIM(`leave_assignment_code`) AND `leave_assignment_code` <> ''
    AND `employee_uid` = TRIM(`employee_uid`) AND `employee_uid` <> '' AND LOWER(`employee_uid`) <> '@all'
    AND `object_version` > 0
  ),
  CONSTRAINT `ck_people_offboarding_case_actor` CHECK (
    `created_by` = TRIM(`created_by`) AND `created_by` <> '' AND LOWER(`created_by`) <> '@all'
    AND `updated_by` = TRIM(`updated_by`) AND `updated_by` <> '' AND LOWER(`updated_by`) <> '@all'
  ),
  CONSTRAINT `ck_people_offboarding_case_terminal_audit` CHECK (
    (`status` = 'active'
      AND `completed_at` IS NULL AND `completed_by` IS NULL
      AND `cancelled_at` IS NULL AND `cancelled_by` IS NULL AND `cancellation_reason` IS NULL)
    OR
    (`status` = 'completed'
      AND `completed_at` IS NOT NULL
      AND `completed_by` IS NOT NULL AND `completed_by` = TRIM(`completed_by`)
      AND `completed_by` <> '' AND LOWER(`completed_by`) <> '@all'
      AND `cancelled_at` IS NULL AND `cancelled_by` IS NULL AND `cancellation_reason` IS NULL)
    OR
    (`status` = 'cancelled'
      AND `completed_at` IS NULL AND `completed_by` IS NULL
      AND `cancelled_at` IS NOT NULL
      AND `cancelled_by` IS NOT NULL AND `cancelled_by` = TRIM(`cancelled_by`)
      AND `cancelled_by` <> '' AND LOWER(`cancelled_by`) <> '@all'
      AND `cancellation_reason` IS NOT NULL AND TRIM(`cancellation_reason`) <> '')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 离职事项；不复制 Console 账号或 Assets 资产事实';

CREATE TABLE IF NOT EXISTS `people_offboarding_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_code` VARCHAR(64) NOT NULL COMMENT '离职任务稳定业务键与通知授权 descriptor ID',
  `case_code` VARCHAR(64) NOT NULL,
  `task_type` ENUM('handover', 'asset_recovery_coordination') NOT NULL COMMENT '资产回收仅表示协调确认，不声明资产实际已回收',
  `responsible_uid` VARCHAR(64) NOT NULL COMMENT '唯一直接责任人；禁止部门或全员展开',
  `due_at` DATETIME NOT NULL,
  `status` ENUM('pending', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
  `object_version` BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '用户动作 CAS 版本，API 表达为 vN',
  `completed_at` DATETIME DEFAULT NULL,
  `completed_by` VARCHAR(64) DEFAULT NULL,
  `cancelled_at` DATETIME DEFAULT NULL,
  `cancelled_by` VARCHAR(64) DEFAULT NULL,
  `cancellation_reason` VARCHAR(500) DEFAULT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `updated_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_offboarding_task_code` (`task_code`),
  UNIQUE KEY `uk_people_offboarding_case_type` (`case_code`, `task_type`),
  KEY `idx_people_offboarding_task_responsible` (`responsible_uid`, `status`, `due_at`, `id`),
  KEY `idx_people_offboarding_task_due_cursor` (`status`, `due_at`, `id`),
  CONSTRAINT `fk_people_offboarding_task_case` FOREIGN KEY (`case_code`) REFERENCES `people_offboarding_cases` (`case_code`) ON DELETE CASCADE,
  CONSTRAINT `ck_people_offboarding_task_code` CHECK (
    `task_code` = TRIM(`task_code`) AND `task_code` <> '' AND LOWER(`task_code`) <> '@all'
    AND `case_code` = TRIM(`case_code`) AND `case_code` <> ''
    AND `object_version` > 0
  ),
  CONSTRAINT `ck_people_offboarding_task_responsible` CHECK (
    `responsible_uid` = TRIM(`responsible_uid`)
    AND `responsible_uid` <> ''
    AND LOWER(`responsible_uid`) <> '@all'
  ),
  CONSTRAINT `ck_people_offboarding_task_actor` CHECK (
    `created_by` = TRIM(`created_by`) AND `created_by` <> '' AND LOWER(`created_by`) <> '@all'
    AND `updated_by` = TRIM(`updated_by`) AND `updated_by` <> '' AND LOWER(`updated_by`) <> '@all'
  ),
  CONSTRAINT `ck_people_offboarding_task_terminal_audit` CHECK (
    (`status` = 'pending'
      AND `completed_at` IS NULL AND `completed_by` IS NULL
      AND `cancelled_at` IS NULL AND `cancelled_by` IS NULL AND `cancellation_reason` IS NULL)
    OR
    (`status` = 'completed'
      AND `completed_at` IS NOT NULL
      AND `completed_by` IS NOT NULL AND `completed_by` = TRIM(`completed_by`)
      AND `completed_by` <> '' AND LOWER(`completed_by`) <> '@all'
      AND `cancelled_at` IS NULL AND `cancelled_by` IS NULL AND `cancellation_reason` IS NULL)
    OR
    (`status` = 'cancelled'
      AND `completed_at` IS NULL AND `completed_by` IS NULL
      AND `cancelled_at` IS NOT NULL
      AND `cancelled_by` IS NOT NULL AND `cancelled_by` = TRIM(`cancelled_by`)
      AND `cancelled_by` <> '' AND LOWER(`cancelled_by`) <> '@all'
      AND `cancellation_reason` IS NOT NULL AND TRIM(`cancellation_reason`) <> '')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 离职交接与资产回收协调任务';

CREATE TABLE IF NOT EXISTS `people_offboarding_notification_checkpoint` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_stream` ENUM('offboarding_handover_due', 'offboarding_asset_recovery_due') NOT NULL,
  `source_type` ENUM('offboarding_task') NOT NULL DEFAULT 'offboarding_task',
  `source_id` BIGINT UNSIGNED NOT NULL COMMENT 'people_offboarding_tasks.id',
  `condition_generation` BIGINT UNSIGNED NOT NULL,
  `phase` ENUM('D30', 'D7', 'D1', 'expired') NOT NULL,
  `source_version` CHAR(64) NOT NULL,
  `event_version` VARCHAR(191) NOT NULL,
  `previous_event_version` VARCHAR(191) DEFAULT NULL,
  `previous_recipient_uid` VARCHAR(64) DEFAULT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `actionable_key` VARCHAR(191) NOT NULL,
  `due_at` DATETIME NOT NULL,
  `case_code` VARCHAR(64) NOT NULL,
  `task_code` VARCHAR(64) NOT NULL,
  `task_type` ENUM('handover', 'asset_recovery_coordination') NOT NULL,
  `source_name` VARCHAR(255) NOT NULL,
  `recipient_candidates_json` JSON NOT NULL,
  `state` ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  `close_reason` ENUM('superseded', 'condition_resolved', 'condition_cancelled') DEFAULT NULL,
  `closed_at` DATETIME DEFAULT NULL,
  `notification_id` VARCHAR(191) DEFAULT NULL,
  `notified_recipient_uid` VARCHAR(64) DEFAULT NULL,
  `acknowledged_at` DATETIME DEFAULT NULL,
  `lifecycle_next_version` VARCHAR(191) DEFAULT NULL,
  `lifecycle_closed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_offboarding_notification_event` (`event_version`),
  UNIQUE KEY `uk_people_offboarding_notification_idempotency` (`idempotency_key`),
  UNIQUE KEY `uk_people_offboarding_notification_phase` (`event_stream`, `source_type`, `source_id`, `condition_generation`, `phase`),
  KEY `idx_people_offboarding_notification_source` (`event_stream`, `source_type`, `source_id`, `state`, `condition_generation`),
  KEY `idx_people_offboarding_notification_closure` (`event_stream`, `state`, `close_reason`, `lifecycle_closed_at`, `closed_at`),
  KEY `idx_people_offboarding_notification_task` (`task_code`, `state`, `condition_generation`),
  CONSTRAINT `fk_people_offboarding_notification_task` FOREIGN KEY (`source_id`) REFERENCES `people_offboarding_tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ck_people_offboarding_notification_identity` CHECK (
    `condition_generation` > 0
    AND `source_version` = TRIM(`source_version`) AND `source_version` <> ''
    AND `event_version` = TRIM(`event_version`) AND `event_version` <> ''
    AND `idempotency_key` = TRIM(`idempotency_key`) AND `idempotency_key` <> ''
    AND `actionable_key` = TRIM(`actionable_key`) AND `actionable_key` <> ''
    AND `case_code` = TRIM(`case_code`) AND `case_code` <> ''
    AND `task_code` = TRIM(`task_code`) AND `task_code` <> ''
    AND ((`event_stream` = 'offboarding_handover_due' AND `task_type` = 'handover')
      OR (`event_stream` = 'offboarding_asset_recovery_due' AND `task_type` = 'asset_recovery_coordination'))
  ),
  CONSTRAINT `ck_people_offboarding_notification_state` CHECK (
    (`state` = 'open' AND `close_reason` IS NULL AND `closed_at` IS NULL)
    OR (`state` = 'closed' AND `close_reason` IS NOT NULL AND `closed_at` IS NOT NULL)
  ),
  CONSTRAINT `ck_people_offboarding_notification_ack` CHECK (
    (`notification_id` IS NULL AND `notified_recipient_uid` IS NULL AND `acknowledged_at` IS NULL)
    OR (`notification_id` IS NOT NULL AND `notified_recipient_uid` IS NOT NULL AND `acknowledged_at` IS NOT NULL)
  ),
  CONSTRAINT `ck_people_offboarding_notification_lifecycle_ack` CHECK (
    (`lifecycle_next_version` IS NULL AND `lifecycle_closed_at` IS NULL)
    OR (`lifecycle_next_version` IS NOT NULL AND `lifecycle_closed_at` IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 离职任务通知可靠检查点与投递确认事实';

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
  `assignment_code` VARCHAR(64) DEFAULT NULL COMMENT '生成快照时命中的期间有效主任职编码',
  `dept_code_snapshot` VARCHAR(64) DEFAULT NULL COMMENT '生成时部门编码快照',
  `dept_name_snapshot` VARCHAR(100) DEFAULT NULL COMMENT '生成时部门名称快照',
  `position_code_snapshot` VARCHAR(64) DEFAULT NULL COMMENT '生成时岗位编码快照',
  `position_name_snapshot` VARCHAR(100) DEFAULT NULL COMMENT '生成时岗位名称快照',
  `rank_code_snapshot` VARCHAR(32) DEFAULT NULL COMMENT '生成时职级编码快照',
  `rank_name_snapshot` VARCHAR(100) DEFAULT NULL COMMENT '生成时职级名称快照',
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
  KEY `idx_people_cost_assignment` (`assignment_code`),
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
  `contribution_score` DECIMAL(6,2) DEFAULT NULL,
  `score_status` ENUM('unscored','scored') NOT NULL DEFAULT 'unscored',
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

CREATE TABLE IF NOT EXISTS `people_contribution_scope_versions` (
  `cycle_code` VARCHAR(64) NOT NULL,
  `project_code` VARCHAR(64) NOT NULL,
  `source_app` VARCHAR(64) NOT NULL,
  `source_biz_type` VARCHAR(64) NOT NULL,
  `applied_revision` BIGINT UNSIGNED NOT NULL,
  `snapshot_hash` CHAR(64) NOT NULL,
  `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`cycle_code`, `project_code`, `source_app`, `source_biz_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Aims 贡献完整快照的目标端已应用水位';

CREATE TABLE IF NOT EXISTS `people_directory_lifecycle_versions` (
  `employee_uid` VARCHAR(64) NOT NULL PRIMARY KEY, `revision_no` BIGINT UNSIGNED NOT NULL,
  `snapshot_hash` CHAR(64) NOT NULL, `operation_key` VARCHAR(191) NOT NULL,
  `lifecycle_type` VARCHAR(32) NOT NULL, `effective_date` DATE NULL,
  `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_people_directory_lifecycle_operation` (`operation_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 到 Console Directory 生命周期单调版本';

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

INSERT INTO `people_ranks` (`rank_code`, `rank_name`, `rank_series`, `rank_level`, `sort_order`)
VALUES
  ('M1', '管理 M1', 'M', 101, 10),
  ('M2', '管理 M2', 'M', 102, 20),
  ('M3', '管理 M3', 'M', 103, 30),
  ('M4', '管理 M4', 'M', 104, 40),
  ('M5', '管理 M5', 'M', 105, 50),
  ('P1', '专业 P1', 'P', 1, 110),
  ('P2', '专业 P2', 'P', 2, 120),
  ('P3', '专业 P3', 'P', 3, 130),
  ('P4', '专业 P4', 'P', 4, 140),
  ('P5', '专业 P5', 'P', 5, 150),
  ('P6', '专业 P6', 'P', 6, 160),
  ('P7', '专业 P7', 'P', 7, 170),
  ('P8', '专业 P8', 'P', 8, 180),
  ('P9', '专业 P9', 'P', 9, 190),
  ('P10', '专业 P10', 'P', 10, 200)
ON DUPLICATE KEY UPDATE `rank_name` = VALUES(`rank_name`), `rank_series` = VALUES(`rank_series`), `rank_level` = VALUES(`rank_level`);

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

CREATE TABLE IF NOT EXISTS `integration_operation` (
  `operation_id` CHAR(36) PRIMARY KEY,
  `operation_key` VARCHAR(191) NOT NULL,
  `correlation_key` VARCHAR(191) NOT NULL,
  `sequence_no` INT UNSIGNED NOT NULL DEFAULT 1,
  `depends_on_operation_key` VARCHAR(191) DEFAULT NULL,
  `tenant_code` VARCHAR(100) NOT NULL,
  `deployment_code` VARCHAR(100) NOT NULL,
  `source_app` VARCHAR(50) NOT NULL,
  `target_app` VARCHAR(50) NOT NULL,
  `operation_code` VARCHAR(191) NOT NULL,
  `required_capability` VARCHAR(191) NOT NULL,
  `source_biz_type` VARCHAR(100) NOT NULL,
  `source_biz_code` VARCHAR(191) NOT NULL,
  `target_receipt_id` CHAR(36) DEFAULT NULL,
  `target_biz_type` VARCHAR(100) DEFAULT NULL,
  `target_biz_code` VARCHAR(191) DEFAULT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `command_schema_version` VARCHAR(30) NOT NULL DEFAULT 'v1',
  `command_json` JSON NOT NULL,
  `command_sha256` CHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `max_attempts` INT UNSIGNED NOT NULL DEFAULT 8,
  `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_attempt_at` DATETIME(3) DEFAULT NULL,
  `locked_by` VARCHAR(100) DEFAULT NULL,
  `locked_until` DATETIME(3) DEFAULT NULL,
  `fencing_token` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `version_no` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `original_request_id` VARCHAR(100) DEFAULT NULL,
  `correlation_id` VARCHAR(100) DEFAULT NULL,
  `original_actor_uid` VARCHAR(100) DEFAULT NULL,
  `service_client_id` VARCHAR(100) DEFAULT NULL,
  `replay_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `last_replay_actor_uid` VARCHAR(100) DEFAULT NULL,
  `last_replay_reason` VARCHAR(500) DEFAULT NULL,
  `last_replay_at` DATETIME(3) DEFAULT NULL,
  `last_http_status` SMALLINT UNSIGNED DEFAULT NULL,
  `last_error_code` VARCHAR(100) DEFAULT NULL,
  `last_error_class` VARCHAR(50) DEFAULT NULL,
  `last_error_summary` VARCHAR(1000) DEFAULT NULL,
  `last_error_at` DATETIME(3) DEFAULT NULL,
  `response_summary_sha256` CHAR(64) DEFAULT NULL,
  `failure_notified_at` DATETIME(3) DEFAULT NULL,
  `failure_notification_id` VARCHAR(64) DEFAULT NULL,
  `succeeded_at` DATETIME(3) DEFAULT NULL,
  `failed_permanent_at` DATETIME(3) DEFAULT NULL,
  `dead_lettered_at` DATETIME(3) DEFAULT NULL,
  `cancelled_at` DATETIME(3) DEFAULT NULL,
  `created_by` VARCHAR(100) DEFAULT NULL,
  `updated_by` VARCHAR(100) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_people_iop_identity` (`tenant_code`,`deployment_code`,`source_app`,`target_app`,`operation_code`,`idempotency_key`),
  UNIQUE KEY `uk_people_iop_operation_key` (`tenant_code`,`deployment_code`,`source_app`,`operation_key`),
  UNIQUE KEY `uk_people_iop_chain_sequence` (`tenant_code`,`deployment_code`,`source_app`,`correlation_key`,`sequence_no`),
  KEY `idx_people_iop_due` (`status`,`next_attempt_at`,`locked_until`),
  KEY `idx_people_iop_source_biz` (`tenant_code`,`deployment_code`,`source_app`,`source_biz_type`,`source_biz_code`),
  CONSTRAINT `chk_people_iop_cross_app` CHECK (`source_app` <> `target_app`),
  CONSTRAINT `chk_people_iop_status` CHECK (`status` IN ('pending','processing','retry_wait','partial_unknown','succeeded','failed_permanent','dead_letter','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People caller-owned reliable cross-app operation outbox';

CREATE TABLE IF NOT EXISTS `integration_operation_attempt` (
  `attempt_id` CHAR(36) PRIMARY KEY,
  `operation_id` CHAR(36) NOT NULL,
  `operation_code` VARCHAR(191) NOT NULL,
  `attempt_no` INT UNSIGNED NOT NULL,
  `trigger_type` VARCHAR(32) NOT NULL,
  `request_id` VARCHAR(100) DEFAULT NULL,
  `correlation_id` VARCHAR(100) DEFAULT NULL,
  `locked_by` VARCHAR(100) DEFAULT NULL,
  `fencing_token` BIGINT UNSIGNED NOT NULL,
  `result_status` VARCHAR(32) NOT NULL DEFAULT 'processing',
  `http_status` SMALLINT UNSIGNED DEFAULT NULL,
  `error_code` VARCHAR(100) DEFAULT NULL,
  `error_class` VARCHAR(50) DEFAULT NULL,
  `error_summary` VARCHAR(1000) DEFAULT NULL,
  `target_biz_type` VARCHAR(100) DEFAULT NULL,
  `target_biz_code` VARCHAR(191) DEFAULT NULL,
  `response_summary_sha256` CHAR(64) DEFAULT NULL,
  `started_at` DATETIME(3) NOT NULL,
  `finished_at` DATETIME(3) DEFAULT NULL,
  `duration_ms` BIGINT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_people_ioa_operation_attempt` (`operation_id`,`attempt_no`),
  KEY `idx_people_ioa_operation_created` (`operation_id`,`created_at`),
  KEY `idx_people_ioa_result` (`result_status`,`created_at`),
  CONSTRAINT `fk_people_ioa_operation` FOREIGN KEY (`operation_id`) REFERENCES `integration_operation` (`operation_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_people_ioa_result` CHECK (`result_status` IN ('processing','succeeded','retry_wait','partial_unknown','failed_permanent','dead_letter','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People reliable operation attempt audit';

-- G4: dead-letter notifications are source-owned, generation-bound actionables.
-- Upgrade tenants run docs/migrations/20260711_people_dead_letter_actionable_lifecycle.sql.
CREATE TABLE IF NOT EXISTS `integration_operation_dead_letter_actionable` (
  `operation_id` CHAR(36) NOT NULL,
  `generation_no` BIGINT UNSIGNED NOT NULL,
  `tenant_code` VARCHAR(100) NOT NULL,
  `deployment_code` VARCHAR(100) NOT NULL,
  `source_app` VARCHAR(64) NOT NULL,
  `target_app` VARCHAR(64) NOT NULL,
  `operation_code` VARCHAR(191) NOT NULL,
  `source_biz_type` VARCHAR(64) NOT NULL,
  `source_biz_code` VARCHAR(191) NOT NULL,
  `attempt_count` INT UNSIGNED NOT NULL,
  `max_attempts` INT UNSIGNED NOT NULL,
  `last_error_code` VARCHAR(100) DEFAULT NULL,
  `last_error_class` VARCHAR(50) DEFAULT NULL,
  `dead_lettered_at` DATETIME(3) NOT NULL,
  `original_actor_uid` VARCHAR(100) DEFAULT NULL,
  `source_operation_version` BIGINT UNSIGNED NOT NULL,
  `actionable_key` VARCHAR(191) NOT NULL,
  `publish_object_version` VARCHAR(191) NOT NULL,
  `notification_id` VARCHAR(64) DEFAULT NULL,
  `recipient_uids` JSON DEFAULT NULL,
  `publish_acked_at` DATETIME(3) DEFAULT NULL,
  `closure_state` VARCHAR(16) DEFAULT NULL,
  `closure_object_version` VARCHAR(191) DEFAULT NULL,
  `closure_pending_at` DATETIME(3) DEFAULT NULL,
  `closure_acked_at` DATETIME(3) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`operation_id`,`generation_no`),
  UNIQUE KEY `uk_people_iopdla_actionable` (`tenant_code`,`deployment_code`,`source_app`,`actionable_key`),
  UNIQUE KEY `uk_people_iopdla_notification` (`tenant_code`,`deployment_code`,`source_app`,`notification_id`),
  KEY `idx_people_iopdla_publish` (`tenant_code`,`deployment_code`,`source_app`,`publish_acked_at`,`dead_lettered_at`),
  KEY `idx_people_iopdla_closure` (`tenant_code`,`deployment_code`,`source_app`,`closure_acked_at`,`closure_pending_at`),
  CONSTRAINT `fk_people_iopdla_operation` FOREIGN KEY (`operation_id`) REFERENCES `integration_operation` (`operation_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_people_iopdla_closure` CHECK (`closure_state` IS NULL OR `closure_state` IN ('resolved','cancelled')),
  CONSTRAINT `chk_people_iopdla_recipient` CHECK (`recipient_uids` IS NULL OR JSON_TYPE(`recipient_uids`) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People caller-owned dead-letter actionable lifecycle';

-- Target-owned inbox for reliable Aims contribution commands.
CREATE TABLE IF NOT EXISTS service_command_receipt (
  receipt_id CHAR(36) PRIMARY KEY,
  operation_id CHAR(36) NOT NULL,
  operation_code VARCHAR(191) NOT NULL,
  tenant_code VARCHAR(100) NOT NULL,
  source_deployment_code VARCHAR(100) NOT NULL,
  deployment_code VARCHAR(100) NOT NULL,
  source_app VARCHAR(50) NOT NULL,
  target_app VARCHAR(50) NOT NULL,
  required_capability VARCHAR(191) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  identity_sha256 BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(CONCAT_WS('|', tenant_code, source_deployment_code, deployment_code, source_app, target_app, operation_code, idempotency_key), 256))) STORED,
  command_schema_version VARCHAR(30) NOT NULL DEFAULT 'v1',
  command_sha256 CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'processing',
  locked_by VARCHAR(100) DEFAULT NULL,
  locked_until DATETIME(3) DEFAULT NULL,
  fencing_token BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version_no BIGINT UNSIGNED NOT NULL DEFAULT 1,
  first_request_id VARCHAR(100) DEFAULT NULL,
  last_request_id VARCHAR(100) DEFAULT NULL,
  correlation_id VARCHAR(100) DEFAULT NULL,
  original_actor_uid VARCHAR(100) DEFAULT NULL,
  service_client_id VARCHAR(100) DEFAULT NULL,
  target_biz_type VARCHAR(100) DEFAULT NULL,
  target_biz_code VARCHAR(191) DEFAULT NULL,
  response_http_status SMALLINT UNSIGNED DEFAULT NULL,
  response_summary_sha256 CHAR(64) DEFAULT NULL,
  last_error_code VARCHAR(100) DEFAULT NULL,
  last_error_class VARCHAR(50) DEFAULT NULL,
  last_error_summary VARCHAR(1000) DEFAULT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_scr_identity (identity_sha256),
  UNIQUE KEY uk_scr_operation_id (operation_id),
  INDEX idx_scr_status_lock (status, locked_until),
  INDEX idx_scr_target_biz (tenant_code, deployment_code, target_app, target_biz_type, target_biz_code),
  INDEX idx_scr_first_request (tenant_code, deployment_code, first_request_id),
  INDEX idx_scr_last_request (tenant_code, deployment_code, last_request_id),
  INDEX idx_scr_correlation (tenant_code, deployment_code, correlation_id),
  CONSTRAINT chk_scr_cross_app CHECK (source_app <> target_app),
  CONSTRAINT chk_scr_status CHECK (status IN ('processing', 'succeeded', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Target-owned reliable service-command receipt';

SET FOREIGN_KEY_CHECKS = 1;

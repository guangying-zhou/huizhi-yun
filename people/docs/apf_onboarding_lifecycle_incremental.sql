-- APF-09c1 installation candidate; not executed. Base People schema unchanged.

CREATE TABLE `people_onboarding_cases` (
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

CREATE TABLE `people_directory_lifecycle_versions` (
  `employee_uid` VARCHAR(64) NOT NULL PRIMARY KEY, `revision_no` BIGINT UNSIGNED NOT NULL,
  `snapshot_hash` CHAR(64) NOT NULL, `operation_key` VARCHAR(191) NOT NULL,
  `lifecycle_type` VARCHAR(32) NOT NULL, `effective_date` DATE NULL,
  `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_people_directory_lifecycle_operation` (`operation_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 到 Console Directory 生命周期单调版本';

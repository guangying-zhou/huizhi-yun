-- hzy_platform 第二版 SQL DDL
-- 取代：docs/archive/platform-v1/HZY-Platform-SQL-DDL-Draft-v1.sql
-- 配套：HZY-Platform-Schema-Draft-v2.md
--
-- 设计骨架：
--   Section A: Platform Domain（不带 tenant_code）
--   Section B: Boundary Domain（平台签给租户的契约）
--   Section C: Tenant Domain（tenant_code NOT NULL）
--
-- 约定：
--   - MySQL 8.0+
--   - utf8mb4 / utf8mb4_unicode_ci
--   - 所有唯一键列 NOT NULL
--   - 跨物理域不设 FK（便于 Enterprise 剥离），域内 FK 正常设
--   - 高频表（*_heartbeats / *_audit_logs）在真实部署中建议分区，DDL 内以注释标注

CREATE DATABASE IF NOT EXISTS `hzy_platform`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `hzy_platform`;

-- ============================================================
-- Section A: Platform Domain
-- ============================================================

-- ----- A.1 身份与访问 --------------------------------------------------------

CREATE TABLE IF NOT EXISTS `platform_accounts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` VARCHAR(64) NOT NULL,
  `account_type` VARCHAR(32) NOT NULL DEFAULT 'staff',
  `username` VARCHAR(128) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `email_verified_at` DATETIME NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NULL,
  `oidc_sub` VARCHAR(255) NULL,
  `mfa_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `last_login_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_accounts_uid` (`uid`),
  UNIQUE KEY `uk_platform_accounts_email` (`email`),
  UNIQUE KEY `uk_platform_accounts_username` (`username`),
  KEY `idx_platform_accounts_type_status` (`account_type`, `status`),
  KEY `idx_platform_accounts_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_uuid` CHAR(36) NOT NULL,
  `account_id` BIGINT UNSIGNED NOT NULL,
  `session_scope` VARCHAR(32) NOT NULL DEFAULT 'platform_admin',
  `tenant_code` VARCHAR(64) NULL,
  `idp_type` VARCHAR(32) NOT NULL DEFAULT 'local',
  `issued_at` DATETIME NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `refreshed_at` DATETIME NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  `ip` VARCHAR(64) NULL,
  `user_agent` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_sessions_uuid` (`session_uuid`),
  KEY `idx_platform_sessions_account_status` (`account_id`, `status`),
  KEY `idx_platform_sessions_scope_tenant_status` (`session_scope`, `tenant_code`, `status`),
  KEY `idx_platform_sessions_expires_at` (`expires_at`),
  CONSTRAINT `fk_platform_sessions_account`
    FOREIGN KEY (`account_id`) REFERENCES `platform_accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_account_identities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `account_id` BIGINT UNSIGNED NOT NULL,
  `provider_type` VARCHAR(32) NOT NULL COMMENT 'wecom_3rd / oidc / passwordless_email / local_bind',
  `provider_code` VARCHAR(64) NOT NULL DEFAULT 'default',
  `external_subject_key` VARCHAR(255) NOT NULL,
  `external_tenant_key` VARCHAR(255) NULL,
  `profile_json` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `last_login_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_account_identities_provider_subject` (`provider_type`, `provider_code`, `external_subject_key`),
  KEY `idx_platform_account_identities_account_status` (`account_id`, `status`),
  KEY `idx_platform_account_identities_provider_tenant` (`provider_type`, `provider_code`, `external_tenant_key`, `status`),
  CONSTRAINT `fk_platform_account_identities_account`
    FOREIGN KEY (`account_id`) REFERENCES `platform_accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_email_activation_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `account_id` BIGINT UNSIGNED NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `token_hash` CHAR(64) NOT NULL COMMENT 'sha256(token)，明文只通过邮件发送',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_email_activation_tokens_hash` (`token_hash`),
  KEY `idx_platform_email_activation_tokens_account_status` (`account_id`, `status`, `expires_at`),
  KEY `idx_platform_email_activation_tokens_email_status` (`email`, `status`, `expires_at`),
  CONSTRAINT `fk_platform_email_activation_tokens_account`
    FOREIGN KEY (`account_id`) REFERENCES `platform_accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_resources` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `resource_code` VARCHAR(128) NOT NULL,
  `resource_name` VARCHAR(255) NOT NULL,
  `parent_id` BIGINT UNSIGNED NULL,
  `description` VARCHAR(500) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_resources_code` (`resource_code`),
  KEY `idx_platform_resources_parent` (`parent_id`),
  CONSTRAINT `fk_platform_resources_parent`
    FOREIGN KEY (`parent_id`) REFERENCES `platform_resources` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_code` VARCHAR(128) NOT NULL,
  `role_name` VARCHAR(255) NOT NULL,
  `description` VARCHAR(500) NULL,
  `is_builtin` TINYINT(1) NOT NULL DEFAULT 1,
  `is_assignable` TINYINT(1) NOT NULL DEFAULT 1,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_roles_code` (`role_code`),
  KEY `idx_platform_roles_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_role_permissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `resource_id` BIGINT UNSIGNED NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_role_perm_role_resource_action` (`role_id`, `resource_id`, `action`),
  KEY `idx_platform_role_perm_resource_action` (`resource_id`, `action`),
  CONSTRAINT `fk_platform_role_perm_role`
    FOREIGN KEY (`role_id`) REFERENCES `platform_roles` (`id`),
  CONSTRAINT `fk_platform_role_perm_resource`
    FOREIGN KEY (`resource_id`) REFERENCES `platform_resources` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_account_roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `account_id` BIGINT UNSIGNED NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `granted_by_account_id` BIGINT UNSIGNED NULL,
  `granted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expired_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_account_roles` (`account_id`, `role_id`),
  KEY `idx_platform_account_roles_role` (`role_id`),
  CONSTRAINT `fk_platform_account_roles_account`
    FOREIGN KEY (`account_id`) REFERENCES `platform_accounts` (`id`),
  CONSTRAINT `fk_platform_account_roles_role`
    FOREIGN KEY (`role_id`) REFERENCES `platform_roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----- A.2 产品目录 ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS `platform_applications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `app_code` VARCHAR(64) NOT NULL,
  `app_name` VARCHAR(255) NOT NULL,
  `description` VARCHAR(500) NULL,
  `icon` VARCHAR(255) NULL,
  `home_url` VARCHAR(500) NULL,
  `callback_url` VARCHAR(500) NULL,
  `logout_url` VARCHAR(500) NULL,
  `repo_url` VARCHAR(500) NULL COMMENT 'GitLab repository URL used for release manifest import',
  `app_type` VARCHAR(32) NOT NULL DEFAULT 'internal',
  `runtime_mode` VARCHAR(32) NOT NULL DEFAULT 'customer-hosted',
  `service_role` VARCHAR(32) NOT NULL DEFAULT 'business_app'
    COMMENT 'business_app / directory_runtime / workflow_runtime / supporting_service',
  `auth_mode` VARCHAR(32) NOT NULL DEFAULT 'oidc',
  `bundle_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 1000 COMMENT '应用展示顺序；越小越靠前，进入 runtime applications / policy bundle',
  `latest_manifest_id` BIGINT UNSIGNED NULL,
  `latest_registration_id` BIGINT UNSIGNED NULL,
  `latest_release_id` BIGINT UNSIGNED NULL COMMENT '最新 released 版本，platform_app_releases.id',
  `last_manifest_registered_at` DATETIME NULL,
  `last_manifest_review_status` VARCHAR(32) NULL,
  `last_released_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_applications_code` (`app_code`),
  KEY `idx_platform_applications_sort` (`sort_order`, `app_code`),
  KEY `idx_platform_applications_status` (`status`),
  KEY `idx_platform_applications_service_role` (`service_role`, `status`),
  KEY `idx_platform_applications_manifest_review` (`last_manifest_review_status`, `status`),
  KEY `idx_platform_applications_latest_manifest_ref` (`latest_manifest_id`, `app_code`),
  KEY `idx_platform_applications_latest_registration_ref` (`latest_registration_id`, `app_code`),
  KEY `idx_platform_applications_latest_release_ref` (`latest_release_id`, `app_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_app_manifests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `app_code` VARCHAR(64) NOT NULL,
  `manifest_seq` INT NOT NULL COMMENT '从 1 递增，应用内唯一；资源未变则复用',
  `manifest_hash` VARCHAR(128) NOT NULL,
  `manifest_json` JSON NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_app_manifests_app_seq` (`app_code`, `manifest_seq`),
  UNIQUE KEY `uk_platform_app_manifests_app_hash` (`app_code`, `manifest_hash`),
  UNIQUE KEY `uk_platform_app_manifests_id_app` (`id`, `app_code`),
  KEY `idx_platform_app_manifests_status` (`app_code`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_app_manifest_registrations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `registration_no` VARCHAR(64) NOT NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `submitted_version` VARCHAR(64) NOT NULL,
  `submitted_manifest_hash` VARCHAR(128) NOT NULL,
  `submitted_manifest_json` JSON NULL,
  `source_type` VARCHAR(32) NOT NULL DEFAULT 'release_pipeline' COMMENT 'release_pipeline / admin_ui / cli / api',
  `source_endpoint` VARCHAR(500) NULL,
  `registration_status` VARCHAR(32) NOT NULL DEFAULT 'received',
  `review_status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `result_manifest_id` BIGINT UNSIGNED NULL,
  `submitted_by_account_id` BIGINT UNSIGNED NULL,
  `reviewed_by_account_id` BIGINT UNSIGNED NULL,
  `review_comment` VARCHAR(1000) NULL,
  `error_message` VARCHAR(1000) NULL,
  `reviewed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_app_manifest_registrations_no` (`registration_no`),
  UNIQUE KEY `uk_platform_app_manifest_registrations_id_app` (`id`, `app_code`),
  KEY `idx_platform_app_manifest_reg_app_status` (`app_code`, `registration_status`, `review_status`),
  KEY `idx_platform_app_manifest_reg_created` (`app_code`, `created_at`),
  KEY `idx_platform_app_manifest_reg_result_manifest` (`result_manifest_id`, `app_code`),
  CONSTRAINT `fk_platform_app_manifest_reg_app`
    FOREIGN KEY (`app_code`) REFERENCES `platform_applications` (`app_code`),
  CONSTRAINT `fk_platform_app_manifest_reg_manifest`
    FOREIGN KEY (`result_manifest_id`, `app_code`) REFERENCES `platform_app_manifests` (`id`, `app_code`),
  CONSTRAINT `fk_platform_app_manifest_reg_submitter`
    FOREIGN KEY (`submitted_by_account_id`) REFERENCES `platform_accounts` (`id`),
  CONSTRAINT `fk_platform_app_manifest_reg_reviewer`
    FOREIGN KEY (`reviewed_by_account_id`) REFERENCES `platform_accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_app_releases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `app_code` VARCHAR(64) NOT NULL,
  `release_version` VARCHAR(64) NOT NULL COMMENT '等于 GitLab release tag，如 v1.2.3',
  `source_tag` VARCHAR(128) NOT NULL COMMENT 'GitLab tag ref',
  `source_commit_sha` VARCHAR(64) NULL,
  `manifest_id` BIGINT UNSIGNED NOT NULL,
  `bundle_uri` VARCHAR(500) NULL,
  `bundle_hash` VARCHAR(128) NULL,
  `bundle_size_bytes` BIGINT UNSIGNED NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft'
    COMMENT 'draft / permissions_pending / ready / released / deprecated',
  `release_notes` TEXT NULL,
  `released_by_account_id` BIGINT UNSIGNED NULL,
  `released_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_app_releases_app_version` (`app_code`, `release_version`),
  UNIQUE KEY `uk_platform_app_releases_id_app` (`id`, `app_code`),
  KEY `idx_platform_app_releases_app_status` (`app_code`, `status`),
  KEY `idx_platform_app_releases_manifest` (`manifest_id`, `app_code`),
  KEY `idx_platform_app_releases_released_at` (`app_code`, `status`, `released_at`),
  CONSTRAINT `fk_platform_app_releases_app`
    FOREIGN KEY (`app_code`) REFERENCES `platform_applications` (`app_code`),
  CONSTRAINT `fk_platform_app_releases_manifest`
    FOREIGN KEY (`manifest_id`, `app_code`) REFERENCES `platform_app_manifests` (`id`, `app_code`),
  CONSTRAINT `fk_platform_app_releases_releaser`
    FOREIGN KEY (`released_by_account_id`) REFERENCES `platform_accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `platform_applications`
  ADD CONSTRAINT `fk_platform_applications_latest_manifest`
    FOREIGN KEY (`latest_manifest_id`, `app_code`) REFERENCES `platform_app_manifests` (`id`, `app_code`),
  ADD CONSTRAINT `fk_platform_applications_latest_registration`
    FOREIGN KEY (`latest_registration_id`, `app_code`) REFERENCES `platform_app_manifest_registrations` (`id`, `app_code`),
  ADD CONSTRAINT `fk_platform_applications_latest_release`
    FOREIGN KEY (`latest_release_id`, `app_code`) REFERENCES `platform_app_releases` (`id`, `app_code`);

-- Manifest 版本级资源快照：应用资源/动作以 manifest 为一等入口，唯一权威源。
-- v2.4 废弃 platform_app_resources 聚合表；"应用当前资源" 改为查询
-- platform_applications.latest_release_id 对应 manifest 下的 resources。
CREATE TABLE IF NOT EXISTS `platform_app_manifest_resources` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `manifest_id` BIGINT UNSIGNED NOT NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `resource_code` VARCHAR(128) NOT NULL,
  `resource_name` VARCHAR(255) NOT NULL,
  `description` VARCHAR(500) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_app_manifest_resources` (`manifest_id`, `resource_code`),
  UNIQUE KEY `uk_platform_app_manifest_resources_id_tuple` (`id`, `manifest_id`, `app_code`, `resource_code`),
  KEY `idx_platform_app_manifest_resources_app` (`app_code`, `manifest_id`, `status`),
  CONSTRAINT `fk_platform_app_manifest_resources_manifest`
    FOREIGN KEY (`manifest_id`, `app_code`) REFERENCES `platform_app_manifests` (`id`, `app_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_app_manifest_resource_actions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `manifest_resource_id` BIGINT UNSIGNED NOT NULL,
  `manifest_id` BIGINT UNSIGNED NOT NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `resource_code` VARCHAR(128) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `action_code` VARCHAR(255)
    GENERATED ALWAYS AS (CONCAT(`app_code`, '.', `resource_code`, '.', `action`)) STORED
    COMMENT '由 app_code.resource_code.action 自动拼接，如 aims.projects.view',
  `action_name` VARCHAR(255) NULL,
  `description` VARCHAR(500) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `requires_grant` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '是否需要权限授予；0=运营标记"无需授权"（豁免覆盖检测）',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_app_manifest_resource_actions` (`manifest_id`, `resource_code`, `action`),
  UNIQUE KEY `uk_platform_app_manifest_resource_actions_id_tuple` (`id`, `app_code`, `resource_code`, `action`),
  KEY `idx_platform_app_manifest_actions_resource_ref` (`manifest_resource_id`, `manifest_id`, `app_code`, `resource_code`),
  KEY `idx_platform_app_manifest_actions_app` (`app_code`, `manifest_id`, `status`),
  KEY `idx_platform_app_manifest_actions_code` (`action_code`),
  KEY `idx_platform_app_manifest_actions_requires_grant` (`manifest_id`, `requires_grant`, `status`),
  CONSTRAINT `fk_platform_app_manifest_actions_resource`
    FOREIGN KEY (`manifest_resource_id`, `manifest_id`, `app_code`, `resource_code`)
    REFERENCES `platform_app_manifest_resources` (`id`, `manifest_id`, `app_code`, `resource_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_app_supported_scopes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `app_code` VARCHAR(64) NOT NULL,
  `scope_type` VARCHAR(32) NOT NULL,
  `scope_value` VARCHAR(255) NOT NULL,
  `resolver_endpoint` VARCHAR(500) NULL,
  `description` VARCHAR(500) NULL,
  `source_manifest_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_app_scopes` (`app_code`, `scope_type`, `scope_value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_capabilities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `capability_code` VARCHAR(128) NOT NULL,
  `capability_name` VARCHAR(255) NOT NULL,
  `capability_type` VARCHAR(32) NOT NULL DEFAULT 'feature',
  `value_schema_json` JSON NULL,
  `description` VARCHAR(500) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_capabilities_code` (`capability_code`),
  KEY `idx_platform_capabilities_type_status` (`capability_type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_plans` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `plan_code` VARCHAR(64) NOT NULL,
  `plan_name` VARCHAR(255) NOT NULL,
  `plan_tier` VARCHAR(32) NOT NULL DEFAULT 'standard',
  `price_model` VARCHAR(32) NOT NULL DEFAULT 'fixed',
  `base_price` DECIMAL(12, 2) NULL,
  `currency` VARCHAR(8) NULL,
  `billing_cycle` VARCHAR(32) NULL,
  `description` VARCHAR(500) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_plans_code` (`plan_code`),
  KEY `idx_platform_plans_tier_status` (`plan_tier`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_plan_capabilities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `plan_id` BIGINT UNSIGNED NOT NULL,
  `capability_code` VARCHAR(128) NOT NULL,
  `capability_value` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_plan_capabilities` (`plan_id`, `capability_code`),
  KEY `idx_platform_plan_capabilities_cap` (`capability_code`),
  CONSTRAINT `fk_platform_plan_capabilities_plan`
    FOREIGN KEY (`plan_id`) REFERENCES `platform_plans` (`id`),
  CONSTRAINT `fk_platform_plan_capabilities_cap`
    FOREIGN KEY (`capability_code`) REFERENCES `platform_capabilities` (`capability_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_plan_apps` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `plan_id` BIGINT UNSIGNED NOT NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `role_in_plan` VARCHAR(16) NOT NULL DEFAULT 'business'
    COMMENT 'core=基础模块(console/account/workflow) / business=业务应用',
  `pin_release_id` BIGINT UNSIGNED NULL
    COMMENT 'NULL = 自动对应最新 released 版本；非 NULL 表示锁定版本',
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_plan_apps` (`plan_id`, `app_code`),
  KEY `idx_platform_plan_apps_role` (`plan_id`, `role_in_plan`),
  KEY `idx_platform_plan_apps_pin` (`pin_release_id`, `app_code`),
  CONSTRAINT `fk_platform_plan_apps_plan`
    FOREIGN KEY (`plan_id`) REFERENCES `platform_plans` (`id`),
  CONSTRAINT `fk_platform_plan_apps_app`
    FOREIGN KEY (`app_code`) REFERENCES `platform_applications` (`app_code`),
  CONSTRAINT `fk_platform_plan_apps_pin_release`
    FOREIGN KEY (`pin_release_id`, `app_code`) REFERENCES `platform_app_releases` (`id`, `app_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----- A.3 应用权限角色与企业系统角色 ----------------------------------------

CREATE TABLE IF NOT EXISTS `platform_app_roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_code` VARCHAR(128) NOT NULL,
  `role_name` VARCHAR(255) NOT NULL,
  `role_type` VARCHAR(32) NOT NULL DEFAULT 'app' COMMENT '应用权限角色；由应用 recommendedRoles 或平台运营维护',
  `app_code` VARCHAR(64) NOT NULL COMMENT '应用权限角色所属应用',
  `description` VARCHAR(500) NULL,
  `is_required` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `policy_revision` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '应用角色权限/scope 策略版本',
  `policy_hash` VARCHAR(96) NULL COMMENT '应用角色权限/scope 的稳定哈希',
  `policy_updated_at` DATETIME NULL COMMENT '应用角色授权最后变化时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_app_roles_code` (`role_code`),
  KEY `idx_platform_app_roles_app_status` (`app_code`, `status`),
  KEY `idx_platform_app_roles_type_app` (`role_type`, `app_code`, `status`),
  CONSTRAINT `fk_platform_app_roles_app`
    FOREIGN KEY (`app_code`) REFERENCES `platform_applications` (`app_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_app_role_permissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `app_role_id` BIGINT UNSIGNED NOT NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `resource_code` VARCHAR(128) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `manifest_action_id` BIGINT UNSIGNED NULL COMMENT '关联 manifest 解析出的动作；NULL=跨版本/手工权限项',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_app_role_perm` (`app_role_id`, `app_code`, `resource_code`, `action`),
  KEY `idx_platform_app_role_perm_resource` (`app_code`, `resource_code`, `action`),
  KEY `idx_platform_app_role_perm_manifest_action` (`manifest_action_id`, `app_code`, `resource_code`, `action`),
  CONSTRAINT `fk_platform_app_role_perm_role`
    FOREIGN KEY (`app_role_id`) REFERENCES `platform_app_roles` (`id`),
  CONSTRAINT `fk_platform_app_role_perm_manifest_action`
    FOREIGN KEY (`manifest_action_id`, `app_code`, `resource_code`, `action`)
    REFERENCES `platform_app_manifest_resource_actions` (`id`, `app_code`, `resource_code`, `action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_app_role_scopes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `app_role_id` BIGINT UNSIGNED NOT NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `resource_code` VARCHAR(128) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `manifest_action_id` BIGINT UNSIGNED NULL COMMENT '关联 manifest 解析出的动作；NULL=跨版本/手工范围',
  `scope_type` VARCHAR(32) NOT NULL,
  `scope_value` VARCHAR(255) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_app_role_scope` (`app_role_id`, `app_code`, `resource_code`, `action`, `scope_type`, `scope_value`),
  KEY `idx_platform_app_role_scope_manifest_action` (`manifest_action_id`, `app_code`, `resource_code`, `action`),
  CONSTRAINT `fk_platform_app_role_scope_role`
    FOREIGN KEY (`app_role_id`) REFERENCES `platform_app_roles` (`id`),
  CONSTRAINT `fk_platform_app_role_scope_manifest_action`
    FOREIGN KEY (`manifest_action_id`, `app_code`, `resource_code`, `action`)
    REFERENCES `platform_app_manifest_resource_actions` (`id`, `app_code`, `resource_code`, `action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 权限覆盖检测不建表：由 platform_app_manifest_resource_actions.requires_grant
-- 与 platform_app_role_permissions.manifest_action_id 实时 JOIN 计算。
-- "运营标记无需授权" 通过 UPDATE requires_grant=0 持久化；操作记录走 platform_audit_logs。

CREATE TABLE IF NOT EXISTS `platform_system_roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_code` VARCHAR(128) NOT NULL,
  `role_name` VARCHAR(255) NOT NULL,
  `role_type` VARCHAR(32) NOT NULL DEFAULT 'system' COMMENT '平台内置企业角色模板，如系统管理员/总经理/销售总监',
  `description` VARCHAR(500) NULL,
  `is_required` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `policy_revision` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '企业角色默认应用角色映射版本',
  `policy_hash` VARCHAR(96) NULL COMMENT '企业角色默认映射的稳定哈希',
  `policy_updated_at` DATETIME NULL COMMENT '企业角色默认映射最后变化时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_system_roles_code` (`role_code`),
  KEY `idx_platform_system_roles_type_status` (`role_type`, `status`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_system_app_role_maps` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `system_role_id` BIGINT UNSIGNED NOT NULL,
  `system_role_code` VARCHAR(128) NOT NULL,
  `app_role_id` BIGINT UNSIGNED NOT NULL,
  `app_role_code` VARCHAR(128) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_system_app_role_maps` (`system_role_id`, `app_role_id`),
  KEY `idx_platform_system_app_role_maps_role_code` (`system_role_code`),
  KEY `idx_platform_system_app_role_maps_app_role` (`app_role_code`),
  CONSTRAINT `fk_platform_system_app_role_maps_system`
    FOREIGN KEY (`system_role_id`) REFERENCES `platform_system_roles` (`id`),
  CONSTRAINT `fk_platform_system_app_role_maps_app_role`
    FOREIGN KEY (`app_role_id`) REFERENCES `platform_app_roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----- A.4 商业运营 ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS `platform_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_no` VARCHAR(64) NOT NULL,
  `tenant_code` VARCHAR(64) NOT NULL,
  `plan_code` VARCHAR(64) NOT NULL,
  `quantity` INT NOT NULL DEFAULT 1,
  `unit_price` DECIMAL(12, 2) NULL,
  `total_amount` DECIMAL(12, 2) NULL,
  `currency` VARCHAR(8) NULL,
  `payment_method` VARCHAR(32) NULL COMMENT 'bank_transfer / wechat_pay / alipay；pending 对公转账订单也需要记录支付方式',
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `placed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at` DATETIME NULL,
  `effective_from` DATETIME NULL,
  `effective_until` DATETIME NULL,
  `created_by_account_id` BIGINT UNSIGNED NULL,
  `notes` VARCHAR(1000) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_orders_no` (`order_no`),
  KEY `idx_platform_orders_tenant_status` (`tenant_code`, `status`),
  KEY `idx_platform_orders_payment_method` (`payment_method`, `status`),
  KEY `idx_platform_orders_plan` (`plan_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_invoices` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invoice_no` VARCHAR(64) NOT NULL,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `tenant_code` VARCHAR(64) NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `currency` VARCHAR(8) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'issued',
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_invoices_no` (`invoice_no`),
  KEY `idx_platform_invoices_tenant` (`tenant_code`, `status`),
  CONSTRAINT `fk_platform_invoices_order`
    FOREIGN KEY (`order_id`) REFERENCES `platform_orders` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_payments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `payment_no` VARCHAR(64) NOT NULL,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `invoice_id` BIGINT UNSIGNED NULL,
  `tenant_code` VARCHAR(64) NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `currency` VARCHAR(8) NOT NULL,
  `method` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'succeeded',
  `transaction_ref` VARCHAR(128) NULL COMMENT '第三方支付单号或对公转账银行流水号',
  `paid_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `confirmed_by_account_id` BIGINT UNSIGNED NULL COMMENT '对公转账人工确认人；跨域→platform_accounts，无 FK',
  `confirmed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_payments_no` (`payment_no`),
  KEY `idx_platform_payments_tenant` (`tenant_code`, `status`),
  KEY `idx_platform_payments_confirmed_by` (`confirmed_by_account_id`, `confirmed_at`),
  CONSTRAINT `fk_platform_payments_order`
    FOREIGN KEY (`order_id`) REFERENCES `platform_orders` (`id`),
  CONSTRAINT `fk_platform_payments_invoice`
    FOREIGN KEY (`invoice_id`) REFERENCES `platform_invoices` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_tenant_lifecycle_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `event_data_json` JSON NULL,
  `operator_account_id` BIGINT UNSIGNED NULL,
  `operator_type` VARCHAR(32) NOT NULL DEFAULT 'platform',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_platform_lifecycle_tenant_time` (`tenant_code`, `created_at`),
  KEY `idx_platform_lifecycle_event` (`event_type`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_tickets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_no` VARCHAR(64) NOT NULL,
  `tenant_code` VARCHAR(64) NULL,
  `title` VARCHAR(500) NOT NULL,
  `category` VARCHAR(64) NOT NULL,
  `priority` VARCHAR(32) NOT NULL DEFAULT 'normal',
  `status` VARCHAR(32) NOT NULL DEFAULT 'open',
  `reporter_contact` VARCHAR(255) NULL,
  `assignee_account_id` BIGINT UNSIGNED NULL,
  `description` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `closed_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_tickets_no` (`ticket_no`),
  KEY `idx_platform_tickets_tenant_status` (`tenant_code`, `status`),
  KEY `idx_platform_tickets_assignee` (`assignee_account_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_announcements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(500) NOT NULL,
  `content` TEXT NOT NULL,
  `audience_type` VARCHAR(32) NOT NULL DEFAULT 'all',
  `audience_value` VARCHAR(255) NULL,
  `severity` VARCHAR(32) NOT NULL DEFAULT 'info',
  `published_at` DATETIME NULL,
  `expired_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `created_by_account_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_platform_announcements_status_pub` (`status`, `published_at`),
  KEY `idx_platform_announcements_audience` (`audience_type`, `audience_value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_feature_flags` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flag_code` VARCHAR(128) NOT NULL,
  `flag_name` VARCHAR(255) NOT NULL,
  `description` VARCHAR(500) NULL,
  `default_value_json` JSON NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_feature_flags_code` (`flag_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_feature_flag_assignments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flag_id` BIGINT UNSIGNED NOT NULL,
  `scope_type` VARCHAR(32) NOT NULL,
  `scope_value` VARCHAR(255) NOT NULL,
  `value_json` JSON NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_flag_assignments` (`flag_id`, `scope_type`, `scope_value`),
  CONSTRAINT `fk_platform_flag_assignments_flag`
    FOREIGN KEY (`flag_id`) REFERENCES `platform_feature_flags` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_api_keys` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key_prefix` VARCHAR(32) NOT NULL,
  `key_hash` VARCHAR(255) NOT NULL,
  `owner_account_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `scopes_json` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `expires_at` DATETIME NULL,
  `last_used_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_api_keys_prefix` (`key_prefix`),
  KEY `idx_platform_api_keys_owner` (`owner_account_id`, `status`),
  CONSTRAINT `fk_platform_api_keys_owner`
    FOREIGN KEY (`owner_account_id`) REFERENCES `platform_accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_signing_keys` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `kid` VARCHAR(64) NOT NULL,
  `alg` VARCHAR(32) NOT NULL DEFAULT 'Ed25519',
  `public_key` TEXT NOT NULL COMMENT 'PEM/SPKI public key',
  `private_key_ref` VARCHAR(500) NOT NULL COMMENT 'file://... / env:... / kms:...',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `activated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `rotated_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_signing_keys_kid` (`kid`),
  KEY `idx_platform_signing_keys_status` (`status`, `activated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_webhooks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `event_types_json` JSON NOT NULL,
  `target_url` VARCHAR(500) NOT NULL,
  `secret` VARCHAR(255) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by_account_id` BIGINT UNSIGNED NULL,
  `last_delivered_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_platform_webhooks_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----- A.5 审计 --------------------------------------------------------------
-- 高频表：实际部署建议 PARTITION BY RANGE (TO_DAYS(created_at))，保留 180 天

CREATE TABLE IF NOT EXISTS `platform_audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `operator_account_id` BIGINT UNSIGNED NULL,
  `target_type` VARCHAR(64) NOT NULL,
  `target_id` VARCHAR(128) NOT NULL,
  `target_tenant_code` VARCHAR(64) NULL,
  `action` VARCHAR(64) NOT NULL,
  `before_json` JSON NULL,
  `after_json` JSON NULL,
  `source` VARCHAR(64) NULL,
  `ip` VARCHAR(64) NULL,
  `user_agent` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_platform_audit_tenant_time` (`target_tenant_code`, `created_at`),
  KEY `idx_platform_audit_operator_time` (`operator_account_id`, `created_at`),
  KEY `idx_platform_audit_target_time` (`target_type`, `target_id`, `created_at`),
  KEY `idx_platform_audit_action_time` (`action`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Section B: Boundary Domain
-- ============================================================

CREATE TABLE IF NOT EXISTS `tenants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `tenant_name` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(255) NULL,
  `tenant_type` VARCHAR(32) NOT NULL DEFAULT 'enterprise',
  `primary_domain` VARCHAR(255) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `default_auth_mode` VARCHAR(32) NOT NULL DEFAULT 'oidc',
  `default_deployment_mode` VARCHAR(64) NOT NULL DEFAULT 'managed-control-plane',
  `onboarding_stage` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `owner_contact_email` VARCHAR(255) NULL,
  `settings_json` JSON NULL,
  `onboarding_updated_at` DATETIME NULL,
  `onboarding_completed_at` DATETIME NULL,
  `activated_at` DATETIME NULL,
  `suspended_at` DATETIME NULL,
  `terminated_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenants_code` (`tenant_code`),
  KEY `idx_tenants_status` (`status`),
  KEY `idx_tenants_type_status` (`tenant_type`, `status`),
  KEY `idx_tenants_onboarding_stage` (`onboarding_stage`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_reserved_subdomains` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subdomain` VARCHAR(63) NOT NULL,
  `category` VARCHAR(64) NOT NULL DEFAULT 'reserved',
  `description` VARCHAR(255) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_reserved_subdomains_subdomain` (`subdomain`),
  KEY `idx_tenant_reserved_subdomains_status` (`status`, `category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_onboarding_steps` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `step_code` VARCHAR(64) NOT NULL,
  `step_name` VARCHAR(255) NOT NULL,
  `step_order` INT NOT NULL DEFAULT 100,
  `step_status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `step_payload_json` JSON NULL,
  `blocker_reason` VARCHAR(500) NULL,
  `started_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_onboarding_steps` (`tenant_code`, `step_code`),
  KEY `idx_tenant_onboarding_steps_status` (`tenant_code`, `step_status`, `step_order`),
  KEY `idx_tenant_onboarding_steps_completed` (`tenant_code`, `completed_at`),
  CONSTRAINT `fk_tenant_onboarding_steps_tenant`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 注意：account_id / invited_by_account_id 跨 boundary -> platform 域，不设 FK（应用层校验）
CREATE TABLE IF NOT EXISTS `tenant_account_memberships` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `account_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'invited',
  `is_owner` TINYINT(1) NOT NULL DEFAULT 0,
  `invited_by_account_id` BIGINT UNSIGNED NULL,
  `invited_at` DATETIME NULL,
  `joined_at` DATETIME NULL,
  `last_accessed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_account_memberships` (`tenant_code`, `account_id`),
  KEY `idx_tenant_account_memberships_account_status` (`account_id`, `status`),
  KEY `idx_tenant_account_memberships_tenant_status` (`tenant_code`, `status`),
  KEY `idx_tenant_account_memberships_owner` (`tenant_code`, `is_owner`, `status`),
  CONSTRAINT `fk_tenant_account_memberships_tenant`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 租户级主订阅：一企业一计划（active 唯一）
CREATE TABLE IF NOT EXISTS `tenant_subscriptions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subscription_no` VARCHAR(64) NOT NULL,
  `tenant_code` VARCHAR(64) NOT NULL,
  `plan_code` VARCHAR(64) NOT NULL COMMENT '跨域→platform_plans，无 FK',
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending'
    COMMENT 'pending / active / suspended / ended',
  `active_unique_key` VARCHAR(80)
    GENERATED ALWAYS AS (
      CASE
        WHEN `status` = 'active' THEN 'active'
        ELSE CONCAT('inactive#', `subscription_no`)
      END
    ) STORED COMMENT '同租户 active 唯一键',
  `source` VARCHAR(32) NOT NULL DEFAULT 'self_service'
    COMMENT 'self_service / ops_grant / trial',
  `started_at` DATETIME NULL,
  `ended_at` DATETIME NULL,
  `current_order_id` BIGINT UNSIGNED NULL COMMENT '跨域→platform_orders，无 FK',
  `created_by_account_id` BIGINT UNSIGNED NULL COMMENT '跨域→platform_accounts，无 FK',
  `notes` VARCHAR(1000) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_subscriptions_no` (`subscription_no`),
  UNIQUE KEY `uk_tenant_subscriptions_tenant_active` (`tenant_code`, `active_unique_key`),
  KEY `idx_tenant_subscriptions_tenant_status` (`tenant_code`, `status`),
  KEY `idx_tenant_subscriptions_plan` (`plan_code`),
  CONSTRAINT `fk_tenant_subscriptions_tenant`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-app entitlement：由 tenant_subscriptions 按 plan_apps 展开而来
CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subscription_no` VARCHAR(64) NOT NULL,
  `tenant_subscription_id` BIGINT UNSIGNED NOT NULL COMMENT '父订阅指针',
  `tenant_code` VARCHAR(64) NOT NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `plan_code` VARCHAR(64) NOT NULL COMMENT '来自父订阅的快照，便于查询',
  `target_release_id` BIGINT UNSIGNED NULL
    COMMENT '租户期望部署的版本；NULL=跟随 plan_apps.pin_release_id 或最新 released',
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `active_unique_key` VARCHAR(80)
    GENERATED ALWAYS AS (
      CASE
        WHEN `status` = 'active' THEN 'active'
        ELSE CONCAT('inactive#', `subscription_no`)
      END
    ) STORED COMMENT 'active 状态唯一键',
  `source` VARCHAR(32) NOT NULL DEFAULT 'ops_grant',
  `started_at` DATETIME NULL,
  `ended_at` DATETIME NULL,
  `current_order_id` BIGINT UNSIGNED NULL,
  `created_by_account_id` BIGINT UNSIGNED NULL,
  `notes` VARCHAR(1000) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_subscriptions_no` (`subscription_no`),
  UNIQUE KEY `uk_subscriptions_tenant_app_active` (`tenant_code`, `app_code`, `active_unique_key`),
  UNIQUE KEY `uk_subscriptions_id_tenant_app` (`id`, `tenant_code`, `app_code`),
  KEY `idx_subscriptions_parent` (`tenant_subscription_id`),
  KEY `idx_subscriptions_tenant_status` (`tenant_code`, `status`),
  KEY `idx_subscriptions_plan` (`plan_code`),
  KEY `idx_subscriptions_current_order` (`current_order_id`),
  KEY `idx_subscriptions_target_release` (`target_release_id`, `app_code`),
  CONSTRAINT `fk_subscriptions_parent`
    FOREIGN KEY (`tenant_subscription_id`) REFERENCES `tenant_subscriptions` (`id`)
  -- 注意：current_order_id / target_release_id 跨 boundary→platform 域，不设 FK
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `deployment_sites` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `site_code` VARCHAR(128) NOT NULL,
  `site_name` VARCHAR(255) NOT NULL,
  `public_url` VARCHAR(512) NOT NULL,
  `root_app_code` VARCHAR(64) NULL,
  `environment` VARCHAR(32) NOT NULL DEFAULT 'prod',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `active_tenant_environment_key` VARCHAR(160)
    GENERATED ALWAYS AS (
      CASE
        WHEN `status` = 'active' THEN CONCAT(`tenant_code`, ':', `environment`)
        ELSE NULL
      END
    ) STORED COMMENT '同租户同环境 active 站点唯一键',
  `created_by_account_id` BIGINT UNSIGNED NULL COMMENT '跨域→platform_accounts，无 FK',
  `updated_by_account_id` BIGINT UNSIGNED NULL COMMENT '跨域→platform_accounts，无 FK',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_deployment_sites_site_code` (`site_code`),
  UNIQUE KEY `uk_deployment_sites_tenant_site` (`tenant_code`, `site_code`),
  UNIQUE KEY `uk_deployment_sites_active_tenant_env` (`active_tenant_environment_key`),
  KEY `idx_deployment_sites_tenant_env_status` (`tenant_code`, `environment`, `status`),
  CONSTRAINT `fk_deployment_sites_tenant`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `deployments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `deployment_code` VARCHAR(128) NOT NULL,
  `tenant_code` VARCHAR(64) NOT NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `subscription_id` BIGINT UNSIGNED NOT NULL,
  `site_id` BIGINT UNSIGNED NULL,
  `base_path` VARCHAR(255) NULL,
  `api_base` VARCHAR(255) NULL,
  `route_source` VARCHAR(32) NOT NULL DEFAULT 'default',
  `deployment_name` VARCHAR(255) NOT NULL,
  `deployment_mode` VARCHAR(64) NOT NULL,
  `environment` VARCHAR(32) NOT NULL DEFAULT 'prod',
  `region` VARCHAR(64) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `active_unique_key` VARCHAR(160)
    GENERATED ALWAYS AS (
      CASE
        WHEN `status` = 'active' THEN `environment`
        ELSE CONCAT('inactive#', `deployment_code`)
      END
    ) STORED COMMENT '同租户同应用同环境 active 状态唯一键',
  `active_site_path_key` VARCHAR(320)
    GENERATED ALWAYS AS (
      CASE
        WHEN `status` = 'active' AND `site_id` IS NOT NULL AND `base_path` IS NOT NULL
          THEN CONCAT(`site_id`, ':', `base_path`)
        ELSE NULL
      END
    ) STORED COMMENT '同一 active site 下 base_path 唯一键',
  `license_status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `connectivity_status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `target_release_id` BIGINT UNSIGNED NULL
    COMMENT '期望运行的 release；与 reported_app_version 对比得出升级提示（跨域，无 FK）',
  `current_kid` VARCHAR(64) NULL,
  `current_pubkey_fingerprint` VARCHAR(64) NULL COMMENT 'deployment 当前公钥指纹摘要（sha256 前缀）',
  `last_kid_reported_at` DATETIME NULL,
  `last_key_rotated_at` DATETIME NULL,
  `runtime_endpoint` VARCHAR(500) NULL,
  `deployment_config_json` JSON NULL,
  `callback_url` VARCHAR(500) NULL,
  `webhook_url` VARCHAR(500) NULL,
  `reported_app_version` VARCHAR(64) NULL,
  `reported_manifest_version` VARCHAR(64) NULL,
  `reported_manifest_hash` VARCHAR(128) NULL,
  `reported_sdk_version` VARCHAR(64) NULL,
  `reported_directory_contract_version` VARCHAR(64) NULL,
  `reported_directory_snapshot_hash` VARCHAR(128) NULL,
  `reported_directory_sync_cursor` VARCHAR(255) NULL,
  `reported_directory_user_count` INT UNSIGNED NULL,
  `reported_directory_department_count` INT UNSIGNED NULL,
  `reported_directory_project_count` INT UNSIGNED NULL,
  `reported_directory_sync_lag_seconds` INT UNSIGNED NULL,
  `last_reported_at` DATETIME NULL,
  `version_status` VARCHAR(32) NOT NULL DEFAULT 'unknown' COMMENT 'unknown / current / drifted / incompatible',
  `last_directory_sync_at` DATETIME NULL,
  `directory_contract_status` VARCHAR(32) NOT NULL DEFAULT 'n/a'
    COMMENT 'n/a / unknown / compatible / incompatible',
  `directory_sync_status` VARCHAR(32) NOT NULL DEFAULT 'n/a'
    COMMENT 'n/a / unknown / healthy / lagging / stale / failed',
  `last_heartbeat_at` DATETIME NULL,
  `last_connectivity_check_at` DATETIME NULL,
  `last_connectivity_check_status` VARCHAR(32) NULL,
  `last_connectivity_check_summary` VARCHAR(500) NULL,
  `connectivity_verified_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_deployments_code` (`deployment_code`),
  UNIQUE KEY `uk_deployments_tenant_app_active` (`tenant_code`, `app_code`, `active_unique_key`),
  UNIQUE KEY `uk_deployments_active_site_path` (`active_site_path_key`),
  UNIQUE KEY `uk_deployments_id_tenant` (`id`, `tenant_code`),
  KEY `idx_deployments_site_status` (`site_id`, `status`),
  KEY `idx_deployments_subscription_tenant_app_ref` (`subscription_id`, `tenant_code`, `app_code`),
  KEY `idx_deployments_tenant_status` (`tenant_code`, `status`),
  KEY `idx_deployments_tenant_env_status` (`tenant_code`, `environment`, `status`),
  KEY `idx_deployments_connectivity` (`tenant_code`, `connectivity_status`),
  KEY `idx_deployments_version_status` (`tenant_code`, `version_status`),
  KEY `idx_deployments_directory_status` (`tenant_code`, `directory_contract_status`, `directory_sync_status`),
  KEY `idx_deployments_last_reported` (`last_reported_at`),
  KEY `idx_deployments_last_directory_sync` (`last_directory_sync_at`),
  KEY `idx_deployments_connectivity_time` (`last_connectivity_check_at`),
  KEY `idx_deployments_last_heartbeat` (`last_heartbeat_at`),
  KEY `idx_deployments_target_release` (`target_release_id`, `app_code`),
  CONSTRAINT `fk_deployments_site`
    FOREIGN KEY (`site_id`) REFERENCES `deployment_sites` (`id`),
  CONSTRAINT `fk_deployments_subscription`
    FOREIGN KEY (`subscription_id`, `tenant_code`, `app_code`) REFERENCES `subscriptions` (`id`, `tenant_code`, `app_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `deployment_connectivity_checks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `deployment_id` BIGINT UNSIGNED NOT NULL,
  `check_type` VARCHAR(32) NOT NULL DEFAULT 'runtime_probe',
  `trigger_source` VARCHAR(32) NOT NULL DEFAULT 'admin_ui',
  `trigger_ref` VARCHAR(128) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `request_payload_json` JSON NULL,
  `response_payload_json` JSON NULL,
  `error_message` VARCHAR(1000) NULL,
  `started_at` DATETIME NULL,
  `finished_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dep_connectivity_checks_dep_time` (`deployment_id`, `created_at`),
  KEY `idx_dep_connectivity_checks_dep_status` (`deployment_id`, `status`),
  CONSTRAINT `fk_dep_connectivity_checks_dep`
    FOREIGN KEY (`deployment_id`) REFERENCES `deployments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- deployment 交付启动密钥。
-- 当前用于保存 Platform 自动生成的 Console HZY_CONSOLE_VAULT_MASTER_KEY。
-- 该密钥必须可恢复，以便重新下载 console.env 时保持 Console db_encrypted vault 可解密。
CREATE TABLE IF NOT EXISTS `deployment_bootstrap_secrets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `deployment_id` BIGINT UNSIGNED NOT NULL,
  `tenant_code` VARCHAR(64) NOT NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `secret_code` VARCHAR(128) NOT NULL,
  `secret_name` VARCHAR(255) NOT NULL,
  `secret_value` TEXT NOT NULL COMMENT '交付材料可恢复密钥；仅用于生成 runtime env，不进入普通部署配置 API',
  `secret_last4` VARCHAR(8) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by_account_id` BIGINT UNSIGNED NULL COMMENT '跨域→platform_accounts，无 FK',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_deployment_bootstrap_secrets_code` (`deployment_id`, `secret_code`),
  KEY `idx_deployment_bootstrap_secrets_tenant_app` (`tenant_code`, `app_code`, `status`),
  KEY `idx_deployment_bootstrap_secrets_status` (`status`, `updated_at`),
  CONSTRAINT `fk_deployment_bootstrap_secrets_deployment`
    FOREIGN KEY (`deployment_id`) REFERENCES `deployments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `licenses` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `license_code` VARCHAR(128) NOT NULL,
  `subscription_id` BIGINT UNSIGNED NOT NULL,
  `tenant_code` VARCHAR(64) NOT NULL,
  `plan_code` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `issued_at` DATETIME NOT NULL,
  `expires_at` DATETIME NULL,
  `grace_until` DATETIME NULL,
  `payload_hash` VARCHAR(128) NOT NULL,
  `signed_token` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_licenses_code` (`license_code`),
  KEY `idx_licenses_subscription` (`subscription_id`),
  KEY `idx_licenses_tenant_status` (`tenant_code`, `status`),
  KEY `idx_licenses_expires_at` (`expires_at`),
  CONSTRAINT `fk_licenses_subscription`
    FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `license_capabilities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `license_id` BIGINT UNSIGNED NOT NULL,
  `capability_code` VARCHAR(128) NOT NULL,
  `capability_value` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_license_capabilities` (`license_id`, `capability_code`),
  KEY `idx_license_capabilities_cap` (`capability_code`),
  -- 注意：capability_code 跨 platform_capabilities 域，不设 FK（应用层校验）
  CONSTRAINT `fk_license_capabilities_license`
    FOREIGN KEY (`license_id`) REFERENCES `licenses` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `license_deployments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `license_id` BIGINT UNSIGNED NOT NULL,
  `deployment_id` BIGINT UNSIGNED NOT NULL,
  `effective_from` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `effective_until` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_license_deployments` (`license_id`, `deployment_id`),
  KEY `idx_license_deployments_dep` (`deployment_id`, `status`),
  CONSTRAINT `fk_license_deployments_license`
    FOREIGN KEY (`license_id`) REFERENCES `licenses` (`id`),
  CONSTRAINT `fk_license_deployments_dep`
    FOREIGN KEY (`deployment_id`) REFERENCES `deployments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `policy_bundles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `environment` VARCHAR(32) NOT NULL DEFAULT 'prod',
  `bundle_version` VARCHAR(64) NOT NULL,
  `bundle_hash` VARCHAR(128) NOT NULL,
  `bundle_payload_json` JSON NULL,
  `bundle_uri` VARCHAR(500) NOT NULL,
  `signature` TEXT NULL,
  `signed_by_kid` VARCHAR(64) NULL,
  `signed_at` DATETIME NULL,
  `schema_version` VARCHAR(32) NOT NULL,
  `issued_at` DATETIME NOT NULL,
  `expires_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_policy_bundles_tenant_version` (`tenant_code`, `bundle_version`),
  KEY `idx_policy_bundles_status` (`tenant_code`, `environment`, `status`),
  KEY `idx_policy_bundles_signed_kid` (`signed_by_kid`, `issued_at`),
  KEY `idx_policy_bundles_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `policy_bundle_targets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bundle_id` BIGINT UNSIGNED NOT NULL,
  `deployment_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `delivered_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_policy_bundle_targets` (`bundle_id`, `deployment_id`),
  KEY `idx_policy_bundle_targets_dep` (`deployment_id`, `status`),
  CONSTRAINT `fk_policy_bundle_targets_bundle`
    FOREIGN KEY (`bundle_id`) REFERENCES `policy_bundles` (`id`),
  CONSTRAINT `fk_policy_bundle_targets_dep`
    FOREIGN KEY (`deployment_id`) REFERENCES `deployments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `revocation_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `snapshot_version` VARCHAR(64) NOT NULL,
  `snapshot_hash` VARCHAR(128) NOT NULL,
  `entries_json` JSON NULL,
  `snapshot_uri` VARCHAR(500) NOT NULL,
  `signature` TEXT NULL,
  `signed_by_kid` VARCHAR(64) NULL,
  `issued_at` DATETIME NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_revocation_snapshots_tenant_version` (`tenant_code`, `snapshot_version`),
  KEY `idx_revocation_snapshots_status` (`tenant_code`, `status`),
  KEY `idx_revocation_snapshots_signed_kid` (`signed_by_kid`, `issued_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `revocation_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `entry_no` VARCHAR(64) NOT NULL,
  `tenant_code` VARCHAR(64) NOT NULL,
  `deployment_id` BIGINT UNSIGNED NULL,
  `target_type` VARCHAR(32) NOT NULL,
  `target_id` VARCHAR(255) NOT NULL,
  `reason` VARCHAR(255) NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'system',
  `source_ref` VARCHAR(128) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `revoked_at` DATETIME NOT NULL,
  `expires_at` DATETIME NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_revocation_entries_no` (`entry_no`),
  KEY `idx_revocation_entries_tenant_time` (`tenant_code`, `revoked_at`),
  KEY `idx_revocation_entries_target` (`tenant_code`, `target_type`, `target_id`, `status`),
  KEY `idx_revocation_entries_dep_tenant` (`deployment_id`, `tenant_code`, `status`, `revoked_at`),
  CONSTRAINT `fk_revocation_entries_tenant`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`),
  CONSTRAINT `fk_revocation_entries_dep`
    FOREIGN KEY (`deployment_id`, `tenant_code`) REFERENCES `deployments` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `revocation_snapshot_targets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `snapshot_id` BIGINT UNSIGNED NOT NULL,
  `deployment_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `delivered_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_revocation_snapshot_targets` (`snapshot_id`, `deployment_id`),
  KEY `idx_revocation_snapshot_targets_dep` (`deployment_id`, `status`),
  CONSTRAINT `fk_revocation_snapshot_targets_snapshot`
    FOREIGN KEY (`snapshot_id`) REFERENCES `revocation_snapshots` (`id`),
  CONSTRAINT `fk_revocation_snapshot_targets_dep`
    FOREIGN KEY (`deployment_id`) REFERENCES `deployments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 高频表：实际部署建议 PARTITION BY RANGE (TO_DAYS(heartbeat_at))，保留 30 天
CREATE TABLE IF NOT EXISTS `deployment_heartbeats` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `deployment_id` BIGINT UNSIGNED NOT NULL,
  `runtime_id` VARCHAR(128) NOT NULL,
  `app_version` VARCHAR(64) NULL,
  `manifest_version` VARCHAR(64) NULL,
  `manifest_hash` VARCHAR(128) NULL,
  `bundle_version` VARCHAR(64) NULL,
  `revocation_version` VARCHAR(64) NULL,
  `sdk_version` VARCHAR(64) NULL,
  `directory_contract_version` VARCHAR(64) NULL,
  `directory_snapshot_hash` VARCHAR(128) NULL,
  `directory_sync_cursor` VARCHAR(255) NULL,
  `directory_user_count` INT UNSIGNED NULL,
  `directory_department_count` INT UNSIGNED NULL,
  `directory_project_count` INT UNSIGNED NULL,
  `directory_sync_lag_seconds` INT UNSIGNED NULL,
  `directory_sync_at` DATETIME NULL,
  `license_status_seen` VARCHAR(32) NULL,
  `heartbeat_at` DATETIME NOT NULL,
  `payload_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_deployment_heartbeats_dep_time` (`deployment_id`, `heartbeat_at`),
  KEY `idx_deployment_heartbeats_runtime` (`runtime_id`, `heartbeat_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 租户级 runtime 凭证（用于 console/runtime 调用 platform runtime API）
-- 说明：
-- 1) /oauth/token 与 OIDC client secret 由客户侧 console 处理，不落 platform-core
-- 2) platform 仅保留 runtime token hash 与生命周期治理信息
CREATE TABLE IF NOT EXISTS `tenant_runtime_credentials` (
  `tenant_code` VARCHAR(64) NOT NULL,
  `credential_mode` VARCHAR(32) NOT NULL DEFAULT 'tenant'
    COMMENT 'tenant（当前）/ deployment（未来预留）',
  `runtime_token_hash` VARCHAR(128) NOT NULL COMMENT 'sha256(token)',
  `runtime_token_last4` VARCHAR(8) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `issued_by_account_id` BIGINT UNSIGNED NULL COMMENT '跨域→platform_accounts，无 FK',
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `rotated_at` DATETIME NULL,
  `expires_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `last_used_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_code`),
  KEY `idx_tenant_runtime_credentials_status` (`status`, `expires_at`),
  CONSTRAINT `fk_tenant_runtime_credentials_tenant`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Section C: Tenant Domain
-- ============================================================

CREATE TABLE IF NOT EXISTS `tenant_identity_providers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `provider_code` VARCHAR(64) NOT NULL,
  `provider_type` VARCHAR(32) NOT NULL,
  `provider_name` VARCHAR(255) NOT NULL,
  `config_json` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_idp_code` (`tenant_code`, `provider_code`),
  UNIQUE KEY `uk_tenant_idp_id_tenant` (`id`, `tenant_code`),
  KEY `idx_tenant_idp_type` (`tenant_code`, `provider_type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_subjects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `subject_type` VARCHAR(32) NOT NULL,
  `subject_code` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(255) NULL COMMENT '可空；仅允许脱敏展示名，不存实名 PII',
  `external_ref` VARCHAR(255) NULL,
  `parent_subject_id` BIGINT UNSIGNED NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_subjects` (`tenant_code`, `subject_type`, `subject_code`),
  UNIQUE KEY `uk_tenant_subjects_id_tenant` (`id`, `tenant_code`),
  KEY `idx_tenant_subjects_type_status` (`tenant_code`, `subject_type`, `status`),
  KEY `idx_tenant_subjects_parent` (`parent_subject_id`),
  CONSTRAINT `fk_tenant_subjects_parent`
    FOREIGN KEY (`parent_subject_id`) REFERENCES `tenant_subjects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_subject_memberships` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'runtime',
  `subject_id` BIGINT UNSIGNED NOT NULL,
  `container_subject_id` BIGINT UNSIGNED NOT NULL,
  `relation_type` VARCHAR(32) NOT NULL DEFAULT 'member',
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_subject_memberships` (`tenant_code`, `source`, `subject_id`, `container_subject_id`, `relation_type`),
  KEY `idx_tenant_subject_memberships_subject` (`tenant_code`, `subject_id`, `status`),
  KEY `idx_tenant_subject_memberships_container` (`tenant_code`, `container_subject_id`, `status`),
  CONSTRAINT `fk_tenant_subject_memberships_subject`
    FOREIGN KEY (`subject_id`, `tenant_code`) REFERENCES `tenant_subjects` (`id`, `tenant_code`),
  CONSTRAINT `fk_tenant_subject_memberships_container`
    FOREIGN KEY (`container_subject_id`, `tenant_code`) REFERENCES `tenant_subjects` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_subject_identities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `subject_id` BIGINT UNSIGNED NOT NULL,
  `provider_id` BIGINT UNSIGNED NOT NULL,
  `provider_subject_key` VARCHAR(255) NOT NULL,
  `provider_metadata_json` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_subject_identities` (`tenant_code`, `provider_id`, `provider_subject_key`),
  KEY `idx_tenant_subject_identities_subject` (`subject_id`),
  KEY `idx_tenant_subject_identities_subject_tenant` (`subject_id`, `tenant_code`),
  KEY `idx_tenant_subject_identities_provider_tenant` (`provider_id`, `tenant_code`),
  CONSTRAINT `fk_tenant_subject_identities_subject`
    FOREIGN KEY (`subject_id`, `tenant_code`) REFERENCES `tenant_subjects` (`id`, `tenant_code`),
  CONSTRAINT `fk_tenant_subject_identities_provider`
    FOREIGN KEY (`provider_id`, `tenant_code`) REFERENCES `tenant_identity_providers` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_uuid` CHAR(36) NOT NULL,
  `tenant_code` VARCHAR(64) NOT NULL,
  `subject_id` BIGINT UNSIGNED NOT NULL,
  `deployment_id` BIGINT UNSIGNED NOT NULL,
  `idp_type` VARCHAR(32) NOT NULL,
  `issued_at` DATETIME NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `refreshed_at` DATETIME NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  `ip` VARCHAR(64) NULL,
  `user_agent` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_sessions_uuid` (`session_uuid`),
  KEY `idx_tenant_sessions_subject` (`tenant_code`, `subject_id`, `status`),
  KEY `idx_tenant_sessions_deployment` (`deployment_id`, `status`),
  KEY `idx_tenant_sessions_subject_tenant_ref` (`subject_id`, `tenant_code`),
  KEY `idx_tenant_sessions_deployment_tenant_ref` (`deployment_id`, `tenant_code`),
  KEY `idx_tenant_sessions_expires_at` (`expires_at`),
  CONSTRAINT `fk_tenant_sessions_subject`
    FOREIGN KEY (`subject_id`, `tenant_code`) REFERENCES `tenant_subjects` (`id`, `tenant_code`),
  CONSTRAINT `fk_tenant_sessions_deployment`
    FOREIGN KEY (`deployment_id`, `tenant_code`) REFERENCES `deployments` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `role_code` VARCHAR(128) NOT NULL,
  `role_name` VARCHAR(255) NOT NULL,
  `role_type` VARCHAR(32) NOT NULL,
  `app_code` VARCHAR(64) NULL,
  `description` VARCHAR(500) NULL,
  `parent_id` BIGINT UNSIGNED NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'custom',
  `source_role_code` VARCHAR(128) NULL,
  `source_manifest_id` BIGINT UNSIGNED NULL COMMENT '衍生自哪个 manifest；跨域→platform_app_manifests，无 FK',
  `source_policy_hash` VARCHAR(96) NULL COMMENT '启用/同步时对应的系统角色默认授权哈希',
  `effective_policy_hash` VARCHAR(96) NULL COMMENT '租户角色当前实际权限/scope 哈希',
  `policy_revision` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '租户角色授权版本；权限/scope 或来源哈希变化时递增',
  `policy_updated_at` DATETIME NULL COMMENT '租户角色授权最后变化时间',
  `is_overridden` TINYINT(1) NOT NULL DEFAULT 0,
  `is_assignable` TINYINT(1) NOT NULL DEFAULT 1,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_roles_code` (`tenant_code`, `role_code`),
  UNIQUE KEY `uk_tenant_roles_id_tenant` (`id`, `tenant_code`),
  KEY `idx_tenant_roles_type_app_status` (`tenant_code`, `role_type`, `app_code`, `status`),
  KEY `idx_tenant_roles_source` (`source`, `source_role_code`),
  KEY `idx_tenant_roles_source_manifest` (`source_manifest_id`),
  KEY `idx_tenant_roles_parent` (`parent_id`),
  CONSTRAINT `fk_tenant_roles_parent`
    FOREIGN KEY (`parent_id`) REFERENCES `tenant_roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_role_permissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `resource_code` VARCHAR(128) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `source_manifest_action_id` BIGINT UNSIGNED NULL COMMENT '资源/动作来自哪个 manifest action；跨域→platform_app_manifest_resource_actions，无 FK；manifest_id 可 JOIN 得出',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_role_perm` (`role_id`, `app_code`, `resource_code`, `action`),
  KEY `idx_tenant_role_perm_tenant_role` (`tenant_code`, `role_id`),
  KEY `idx_tenant_role_perm_role_tenant_ref` (`role_id`, `tenant_code`),
  KEY `idx_tenant_role_perm_resource` (`app_code`, `resource_code`, `action`),
  KEY `idx_tenant_role_perm_source_manifest_action` (`source_manifest_action_id`, `app_code`, `resource_code`, `action`),
  CONSTRAINT `fk_tenant_role_perm_role`
    FOREIGN KEY (`role_id`, `tenant_code`) REFERENCES `tenant_roles` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_role_app_role_maps` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL COMMENT '租户企业角色',
  `app_role_code` VARCHAR(128) NOT NULL COMMENT '平台应用权限角色编码；跨域→platform_app_roles.role_code，无 FK',
  `source_system_role_code` VARCHAR(128) NULL COMMENT '来自哪个平台企业角色模板；自定义映射为 NULL',
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_role_app_role_maps` (`tenant_code`, `role_id`, `app_role_code`),
  KEY `idx_tenant_role_app_role_maps_role` (`role_id`, `tenant_code`),
  KEY `idx_tenant_role_app_role_maps_app_role` (`app_role_code`),
  KEY `idx_tenant_role_app_role_maps_source` (`tenant_code`, `source_system_role_code`),
  CONSTRAINT `fk_tenant_role_app_role_maps_role`
    FOREIGN KEY (`role_id`, `tenant_code`) REFERENCES `tenant_roles` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_role_conflict_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `rule_code` VARCHAR(128) NOT NULL,
  `rule_name` VARCHAR(255) NOT NULL,
  `conflict_type` VARCHAR(32) NOT NULL DEFAULT 'segregation_of_duties',
  `enforcement` VARCHAR(32) NOT NULL DEFAULT 'warning'
    COMMENT 'warning / enforce',
  `left_role_code` VARCHAR(128) NULL,
  `right_role_code` VARCHAR(128) NULL,
  `left_app_code` VARCHAR(64) NULL,
  `left_resource_code` VARCHAR(128) NULL,
  `left_action` VARCHAR(32) NULL,
  `right_app_code` VARCHAR(64) NULL,
  `right_resource_code` VARCHAR(128) NULL,
  `right_action` VARCHAR(32) NULL,
  `description` VARCHAR(500) NULL,
  `condition_json` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by_uid` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_role_conflict_rule` (`tenant_code`, `rule_code`),
  KEY `idx_tenant_role_conflict_status` (`tenant_code`, `status`),
  KEY `idx_tenant_role_conflict_left_role` (`tenant_code`, `left_role_code`),
  KEY `idx_tenant_role_conflict_right_role` (`tenant_code`, `right_role_code`),
  KEY `idx_tenant_role_conflict_left_permission` (`left_app_code`, `left_resource_code`, `left_action`),
  KEY `idx_tenant_role_conflict_right_permission` (`right_app_code`, `right_resource_code`, `right_action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='租户角色职责冲突规则；warning 允许授予但提示，enforce 阻断授予';

CREATE TABLE IF NOT EXISTS `tenant_subject_roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `subject_id` BIGINT UNSIGNED NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `source_type` VARCHAR(32) NOT NULL DEFAULT 'manual',
  `assignment_kind` VARCHAR(32) NOT NULL DEFAULT 'duty'
    COMMENT 'position / duty / temporary / inherited / privileged',
  `source_id` VARCHAR(128) NULL,
  `reason` VARCHAR(500) NULL,
  `source_id_key` VARCHAR(128)
    GENERATED ALWAYS AS (IFNULL(`source_id`, '__NULL__')) STORED,
  `granted_by_uid` VARCHAR(128) NULL,
  `approved_by_uid` VARCHAR(128) NULL,
  `granted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `starts_at` DATETIME NULL,
  `expired_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active'
    COMMENT 'active / suspended / revoked',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_subject_roles` (`tenant_code`, `subject_id`, `role_id`, `source_type`, `source_id_key`),
  UNIQUE KEY `uk_tenant_subject_roles_id_tenant` (`id`, `tenant_code`),
  KEY `idx_tenant_subject_roles_subject` (`tenant_code`, `subject_id`),
  KEY `idx_tenant_subject_roles_role` (`role_id`),
  KEY `idx_tenant_subject_roles_subject_tenant_ref` (`subject_id`, `tenant_code`),
  KEY `idx_tenant_subject_roles_role_tenant_ref` (`role_id`, `tenant_code`),
  KEY `idx_tenant_subject_roles_expired_at` (`expired_at`),
  KEY `idx_tenant_subject_roles_effective` (`tenant_code`, `subject_id`, `status`, `starts_at`, `expired_at`),
  CONSTRAINT `fk_tenant_subject_roles_subject`
    FOREIGN KEY (`subject_id`, `tenant_code`) REFERENCES `tenant_subjects` (`id`, `tenant_code`),
  CONSTRAINT `fk_tenant_subject_roles_role`
    FOREIGN KEY (`role_id`, `tenant_code`) REFERENCES `tenant_roles` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='应用运行时主体授权绑定（runtime bundle 来源）';

CREATE TABLE IF NOT EXISTS `tenant_account_roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `account_id` BIGINT UNSIGNED NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `source_type` VARCHAR(32) NOT NULL DEFAULT 'manual',
  `source_id` VARCHAR(128) NULL,
  `source_id_key` VARCHAR(128)
    GENERATED ALWAYS AS (IFNULL(`source_id`, '__NULL__')) STORED,
  `granted_by_account_id` BIGINT UNSIGNED NULL,
  `granted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `starts_at` DATETIME NULL,
  `expired_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active'
    COMMENT 'active / suspended / revoked',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_account_roles` (`tenant_code`, `account_id`, `role_id`, `source_type`, `source_id_key`),
  KEY `idx_tenant_account_roles_account` (`tenant_code`, `account_id`),
  KEY `idx_tenant_account_roles_role` (`role_id`),
  KEY `idx_tenant_account_roles_account_tenant_ref` (`account_id`, `tenant_code`),
  KEY `idx_tenant_account_roles_role_tenant_ref` (`role_id`, `tenant_code`),
  KEY `idx_tenant_account_roles_expired_at` (`expired_at`),
  KEY `idx_tenant_account_roles_effective` (`tenant_code`, `account_id`, `status`, `starts_at`, `expired_at`),
  CONSTRAINT `fk_tenant_account_roles_membership`
    FOREIGN KEY (`tenant_code`, `account_id`) REFERENCES `tenant_account_memberships` (`tenant_code`, `account_id`),
  CONSTRAINT `fk_tenant_account_roles_role`
    FOREIGN KEY (`role_id`, `tenant_code`) REFERENCES `tenant_roles` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='平台控制台账户授权绑定（dashboard/admin），不参与 runtime bundle';

CREATE TABLE IF NOT EXISTS `tenant_permission_templates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `template_code` VARCHAR(128) NOT NULL,
  `template_name` VARCHAR(255) NOT NULL,
  `template_type` VARCHAR(32) NOT NULL,
  `description` VARCHAR(500) NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'custom',
  `source_template_code` VARCHAR(128) NULL,
  `is_overridden` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by_uid` VARCHAR(128) NULL,
  `updated_by_uid` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_permission_templates` (`tenant_code`, `template_code`),
  UNIQUE KEY `uk_tenant_permission_templates_id_tenant` (`id`, `tenant_code`),
  KEY `idx_tenant_permission_templates_type_status` (`tenant_code`, `template_type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_template_roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `template_id` BIGINT UNSIGNED NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_template_roles` (`template_id`, `role_id`),
  KEY `idx_tenant_template_roles_tenant` (`tenant_code`, `template_id`),
  KEY `idx_tenant_template_roles_role` (`role_id`),
  KEY `idx_tenant_template_roles_template_tenant_ref` (`template_id`, `tenant_code`),
  KEY `idx_tenant_template_roles_role_tenant_ref` (`role_id`, `tenant_code`),
  CONSTRAINT `fk_tenant_template_roles_template`
    FOREIGN KEY (`template_id`, `tenant_code`) REFERENCES `tenant_permission_templates` (`id`, `tenant_code`),
  CONSTRAINT `fk_tenant_template_roles_role`
    FOREIGN KEY (`role_id`, `tenant_code`) REFERENCES `tenant_roles` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_template_bindings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `template_id` BIGINT UNSIGNED NOT NULL,
  `subject_type` VARCHAR(32) NOT NULL,
  `subject_id` BIGINT UNSIGNED NOT NULL,
  `priority` INT NOT NULL DEFAULT 100,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `start_at` DATETIME NULL,
  `end_at` DATETIME NULL,
  `created_by_uid` VARCHAR(128) NULL,
  `updated_by_uid` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_template_bindings_tenant_template_subject` (`tenant_code`, `template_id`, `subject_type`, `subject_id`),
  KEY `idx_tenant_template_bindings_subject` (`tenant_code`, `subject_type`, `subject_id`, `status`),
  KEY `idx_tenant_template_bindings_template` (`template_id`),
  KEY `idx_tenant_template_bindings_template_tenant_ref` (`template_id`, `tenant_code`),
  KEY `idx_tenant_template_bindings_subject_tenant_ref` (`subject_id`, `tenant_code`),
  KEY `idx_tenant_template_bindings_priority` (`priority`),
  CONSTRAINT `fk_tenant_template_bindings_template`
    FOREIGN KEY (`template_id`, `tenant_code`) REFERENCES `tenant_permission_templates` (`id`, `tenant_code`),
  CONSTRAINT `fk_tenant_template_bindings_subject`
    FOREIGN KEY (`subject_id`, `tenant_code`) REFERENCES `tenant_subjects` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_template_overrides` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `subject_type` VARCHAR(32) NOT NULL,
  `subject_id` BIGINT UNSIGNED NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `override_type` VARCHAR(32) NOT NULL,
  `source_template_id` BIGINT UNSIGNED NULL,
  `source_template_key` BIGINT UNSIGNED
    GENERATED ALWAYS AS (IFNULL(`source_template_id`, 0)) STORED,
  `reason` VARCHAR(500) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by_uid` VARCHAR(128) NULL,
  `updated_by_uid` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_template_overrides_norm` (`tenant_code`, `subject_type`, `subject_id`, `role_id`, `override_type`, `source_template_key`),
  KEY `idx_tenant_template_overrides_subject` (`tenant_code`, `subject_type`, `subject_id`, `status`),
  KEY `idx_tenant_template_overrides_role` (`role_id`),
  KEY `idx_tenant_template_overrides_source_template` (`source_template_id`),
  KEY `idx_tenant_template_overrides_subject_tenant_ref` (`subject_id`, `tenant_code`),
  KEY `idx_tenant_template_overrides_role_tenant_ref` (`role_id`, `tenant_code`),
  KEY `idx_tenant_template_overrides_template_tenant_ref` (`source_template_id`, `tenant_code`),
  CONSTRAINT `fk_tenant_template_overrides_subject`
    FOREIGN KEY (`subject_id`, `tenant_code`) REFERENCES `tenant_subjects` (`id`, `tenant_code`),
  CONSTRAINT `fk_tenant_template_overrides_role`
    FOREIGN KEY (`role_id`, `tenant_code`) REFERENCES `tenant_roles` (`id`, `tenant_code`),
  CONSTRAINT `fk_tenant_template_overrides_template`
    FOREIGN KEY (`source_template_id`, `tenant_code`) REFERENCES `tenant_permission_templates` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_role_scopes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `resource_code` VARCHAR(128) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `source_manifest_action_id` BIGINT UNSIGNED NULL COMMENT '资源/动作来自哪个 manifest action；跨域→platform_app_manifest_resource_actions，无 FK',
  `scope_type` VARCHAR(32) NOT NULL,
  `scope_value` VARCHAR(255) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by_uid` VARCHAR(128) NULL,
  `updated_by_uid` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_role_scopes` (`role_id`, `app_code`, `resource_code`, `action`, `scope_type`, `scope_value`),
  KEY `idx_tenant_role_scopes_tenant_role_action` (`tenant_code`, `role_id`, `action`, `status`),
  KEY `idx_tenant_role_scopes_role_tenant_ref` (`role_id`, `tenant_code`),
  KEY `idx_tenant_role_scopes_resource` (`app_code`, `resource_code`, `action`),
  KEY `idx_tenant_role_scopes_source_manifest_action` (`source_manifest_action_id`, `app_code`, `resource_code`, `action`),
  CONSTRAINT `fk_tenant_role_scopes_role`
    FOREIGN KEY (`role_id`, `tenant_code`) REFERENCES `tenant_roles` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_subject_role_scopes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `assignment_id` BIGINT UNSIGNED NOT NULL,
  `app_code` VARCHAR(64) NULL,
  `resource_code` VARCHAR(128) NULL,
  `action` VARCHAR(32) NULL,
  `scope_dimension` VARCHAR(64) NOT NULL,
  `scope_predicate` VARCHAR(64) NOT NULL,
  `scope_value` VARCHAR(255) NULL,
  `scope_group` VARCHAR(64) NOT NULL DEFAULT 'default',
  `scope_mode` VARCHAR(32) NOT NULL DEFAULT 'intersect'
    COMMENT 'inherit / intersect / replace',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by_uid` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_subject_role_scope_assignment` (`tenant_code`, `assignment_id`, `status`),
  KEY `idx_subject_role_scope_assignment_ref` (`assignment_id`, `tenant_code`),
  KEY `idx_subject_role_scope_resource` (`app_code`, `resource_code`, `action`),
  KEY `idx_subject_role_scope_dimension` (`tenant_code`, `scope_dimension`, `scope_predicate`, `scope_value`),
  CONSTRAINT `fk_subject_role_scope_assignment`
    FOREIGN KEY (`assignment_id`, `tenant_code`) REFERENCES `tenant_subject_roles` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='授权关系级数据范围约束；后续 Policy Bundle v2/evaluate 使用';

-- 高频表：实际部署建议 PARTITION BY RANGE (TO_DAYS(created_at))，保留 365 天
CREATE TABLE IF NOT EXISTS `tenant_audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `operator_account_id` BIGINT UNSIGNED NULL,
  `operator_subject_id` BIGINT UNSIGNED NULL,
  `operator_uid` VARCHAR(128) NULL,
  `target_type` VARCHAR(64) NOT NULL,
  `target_id` VARCHAR(128) NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `before_json` JSON NULL,
  `after_json` JSON NULL,
  `source` VARCHAR(64) NULL,
  `ip` VARCHAR(64) NULL,
  `user_agent` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_audit_tenant_time` (`tenant_code`, `created_at`),
  KEY `idx_tenant_audit_operator_account_time` (`tenant_code`, `operator_account_id`, `created_at`),
  KEY `idx_tenant_audit_operator_time` (`tenant_code`, `operator_uid`, `created_at`),
  KEY `idx_tenant_audit_target_time` (`tenant_code`, `target_type`, `target_id`, `created_at`),
  KEY `idx_tenant_audit_action_time` (`tenant_code`, `action`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 版本历史
-- ============================================================
-- v2.0  初版三域模型（HZY-Platform-Schema-Draft-v2.md）
-- v2.1  运营补遗（HZY-Platform-Schema-Addendum-v2.1.md）：
--       tenant_onboarding_steps / deployment_connectivity_checks /
--       platform_app_manifest_registrations / policy_bundles 扩展 /
--       revocation_entries
-- v2.2  platform_applications.repo_url（GitLab release 导入）
-- v2.3  应用版本一等化 + 租户级主订阅 + 当前凭证轮换（Addendum-v2.3.md）：
--       新增 platform_app_releases / tenant_subscriptions / tenant_app_credentials（后续被 v2.4 runtime 凭证模型取代）
--       修改 platform_app_manifests（manifest_seq）/ platform_plan_apps（role_in_plan）/
--            subscriptions（tenant_subscription_id / target_release_id）/
--            deployments（target_release_id，去掉 client_id/client_secret_ref）/
--            tenant_roles（source_manifest_id）/ tenant_role_permissions（source_manifest_action_id）
--       删除 platform_app_credentials / platform_applications.current_credential_id
-- v2.4  manifest 资源动作版本化 + 权限关联：
--       删除 platform_app_resources（聚合表废弃，manifest 快照成为唯一权威源）
--       新增 platform_app_manifest_resources / platform_app_manifest_resource_actions
--         action_code 为生成列（CONCAT app_code.resource_code.action）
--         新增 requires_grant 字段承载"豁免覆盖检测"
--       platform_plan_apps.pin_release_id 改为 app_code 复合约束
--       platform_app_role_permissions / platform_app_role_scopes 增加
--         manifest_action_id 复合 FK，追溯平台内置权限来源
--       tenant_role_permissions / tenant_role_scopes 增加 source_manifest_action_id
--         （跨域无 FK；manifest_id 可从 manifest_action JOIN 得出，不再冗余存）
--       权限覆盖检测不建表：实时 JOIN manifest_action.requires_grant 与 system_role_perm.manifest_action_id
--       凭证模型收敛：租户应用 OIDC client secret 不在 platform-core 存储，改为 tenant_runtime_credentials
--         （tenant 级 runtime token hash；/oauth/token 由 console 处理）
--       deployment 密钥边界收敛：删除 deployment_signing_keys，平台仅在 deployments 持有治理摘要
--         （current_kid / current_pubkey_fingerprint / last_kid_reported_at / last_key_rotated_at）
--       新增 platform_signing_keys 作为平台根签名密钥表，用于签 bundle/license/revocation
-- v2.14 platform_applications.sort_order：
--       应用展示顺序进入 Platform runtime applications、policy bundle 与 Console / Foundation 应用入口。
--
-- ============================================================
-- 下一步建议（仅注释，不执行）
-- ============================================================
-- 1. 基于本 DDL 产出 HZY-Platform-Seed-Draft-v2.sql：
--    - 系统内置资源 (platform_resources)
--    - 系统内置角色 (platform_roles) 与权限
--    - 产品目录 (platform_applications / platform_capabilities / platform_plans)
--    - 订阅计划包（platform_plan_apps 的 core/business 分组）
--    - 应用权限角色 (platform_app_roles) 与企业系统角色 (platform_system_roles)
--    - 首个平台超级管理员 (platform_accounts)
-- 2. 基于本 DDL 更新 HZY-Platform-API-Draft-v2.md：
--    - /api/platform/ops/**            平台运营
--    - /api/platform/tenant-admin/**   租户管理员
--    - /api/platform/runtime/**        SDK / adapter
--    - /api/platform/internal/**       Identity Plane 内部
-- 3. 现有 platform/server/api/platform/** 实现需按新 schema 持续重构：
--    - 应用创建/导入：/ops/app-manifest-imports/** 按 hash 去重并生成 platform_app_releases
--    - manifest 导入：解析 resources/actions 写入 platform_app_manifest_resources /
--      platform_app_manifest_resource_actions
--    - 废弃 platform_app_resources：
--      * /platform/ops/resources.get, /platform/tenant-admin/resources.get 改读 manifest 快照
--      * roles/[id]/permissions & scopes 的 get/put 改读/写 manifest_action_id
--      * tenantConsole.ts 维护 tenant_console manifest 快照
--    - 权限覆盖检测：实时 SQL 计算，不再落库；"运营标记豁免" UPDATE requires_grant=0
--    - 订阅链路：subscriptions 依赖 tenant_subscriptions；一企业一计划的强约束由 UK 保证
--    - 凭证链路：废弃 platform_app_credentials 与 tenant_app_credentials，改走 tenant_runtime_credentials
--      （仅保存 runtime token hash；OIDC client secret 在 console/vault 侧）

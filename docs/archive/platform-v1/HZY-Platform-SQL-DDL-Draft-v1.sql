-- hzy_platform 第一版 SQL DDL 草案
-- 目标：
-- 1. 支撑 hzy_platform 绿地方案的最小平台内核
-- 2. 服务于 Identity Plane / Control Plane / Runtime Control / Audit
-- 3. 仅覆盖 v1 必需表，不包含 effective_user_*、复杂 ABAC、计费表
--
-- 说明：
-- - 方言按 MySQL 8.0 编写
-- - 采用 IF NOT EXISTS 以便在测试库重复执行
-- - tenant_code = NULL 表示系统级对象；非 NULL 表示租户级对象
-- - v1 中 tenant_code 逻辑上对应 tenants.tenant_code
-- - 本草案优先保证清晰和结构完整，真实上线前仍需结合部署方式收紧约束

CREATE DATABASE IF NOT EXISTS `hzy_platform`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `hzy_platform`;

-- ------------------------------------------------------------
-- Batch A: Identity + App Registry
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `tenants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `tenant_name` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(255) NULL,
  `tenant_type` VARCHAR(32) NOT NULL DEFAULT 'enterprise',
  `primary_domain` VARCHAR(255) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `default_auth_mode` VARCHAR(32) NOT NULL DEFAULT 'oidc',
  `default_deployment_mode` VARCHAR(64) NOT NULL DEFAULT 'managed-control-plane',
  `settings_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenants_tenant_code` (`tenant_code`),
  KEY `idx_tenants_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `uid` VARCHAR(128) NOT NULL,
  `username` VARCHAR(128) NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NULL,
  `mobile` VARCHAR(64) NULL,
  `avatar_url` VARCHAR(500) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `source_type` VARCHAR(32) NOT NULL DEFAULT 'manual',
  `last_login_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_tenant_uid` (`tenant_code`, `uid`),
  UNIQUE KEY `uk_users_tenant_email` (`tenant_code`, `email`),
  KEY `idx_users_tenant_status` (`tenant_code`, `status`),
  KEY `idx_users_last_login_at` (`last_login_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `subjects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `subject_type` VARCHAR(32) NOT NULL,
  `subject_code` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `external_ref` VARCHAR(255) NULL,
  `parent_subject_id` BIGINT UNSIGNED NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_subjects_tenant_type_code` (`tenant_code`, `subject_type`, `subject_code`),
  KEY `idx_subjects_user_id` (`user_id`),
  KEY `idx_subjects_parent_subject_id` (`parent_subject_id`),
  KEY `idx_subjects_tenant_type_status` (`tenant_code`, `subject_type`, `status`),
  CONSTRAINT `fk_subjects_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `subject_identities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NULL,
  `subject_id` BIGINT UNSIGNED NOT NULL,
  `provider_type` VARCHAR(32) NOT NULL,
  `provider_subject_key` VARCHAR(255) NOT NULL,
  `provider_metadata` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_subject_identities_provider_subject` (`provider_type`, `provider_subject_key`),
  KEY `idx_subject_identities_subject_id` (`subject_id`),
  KEY `idx_subject_identities_tenant_status` (`tenant_code`, `status`),
  CONSTRAINT `fk_subject_identities_subject_id`
    FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `applications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `app_name` VARCHAR(128) NOT NULL,
  `description` VARCHAR(500) NULL,
  `icon` VARCHAR(255) NULL,
  `home_url` VARCHAR(500) NULL,
  `callback_url` VARCHAR(500) NULL,
  `logout_url` VARCHAR(500) NULL,
  `app_secret` VARCHAR(255) NULL,
  `app_type` VARCHAR(32) NOT NULL DEFAULT 'internal',
  `runtime_mode` VARCHAR(32) NOT NULL DEFAULT 'customer-hosted',
  `auth_mode` VARCHAR(32) NOT NULL DEFAULT 'oidc',
  `bundle_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_applications_tenant_app_code` (`tenant_code`, `app_code`),
  KEY `idx_applications_tenant_status` (`tenant_code`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `app_manifests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `version` VARCHAR(64) NOT NULL,
  `manifest_hash` VARCHAR(128) NOT NULL,
  `manifest_json` JSON NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_app_manifests_tenant_app_version` (`tenant_code`, `app_code`, `version`),
  KEY `idx_app_manifests_tenant_app_status` (`tenant_code`, `app_code`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Batch B: Authorization
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NULL,
  `role_code` VARCHAR(128) NOT NULL,
  `role_name` VARCHAR(255) NOT NULL,
  `role_type` VARCHAR(32) NOT NULL,
  `app_code` VARCHAR(64) NULL,
  `description` VARCHAR(500) NULL,
  `parent_id` BIGINT UNSIGNED NULL,
  `is_system` TINYINT(1) NOT NULL DEFAULT 0,
  `is_assignable` TINYINT(1) NOT NULL DEFAULT 1,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_roles_tenant_role_code` (`tenant_code`, `role_code`),
  KEY `idx_roles_tenant_type_status` (`tenant_code`, `role_type`, `status`),
  KEY `idx_roles_app_code` (`app_code`),
  KEY `idx_roles_parent_id` (`parent_id`),
  CONSTRAINT `fk_roles_parent_id`
    FOREIGN KEY (`parent_id`) REFERENCES `roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NULL,
  `uid` VARCHAR(128) NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `source_type` VARCHAR(32) NOT NULL DEFAULT 'manual',
  `source_id` VARCHAR(128) NULL,
  `granted_by` VARCHAR(128) NULL,
  `granted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expired_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_roles_uid_role_source` (`tenant_code`, `uid`, `role_id`, `source_type`, `source_id`),
  KEY `idx_user_roles_uid` (`tenant_code`, `uid`),
  KEY `idx_user_roles_role_id` (`role_id`),
  KEY `idx_user_roles_expired_at` (`expired_at`),
  CONSTRAINT `fk_user_roles_role_id`
    FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `resources` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `resource_code` VARCHAR(128) NOT NULL,
  `resource_name` VARCHAR(255) NOT NULL,
  `description` VARCHAR(500) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_resources_tenant_app_resource` (`tenant_code`, `app_code`, `resource_code`),
  KEY `idx_resources_tenant_app_status` (`tenant_code`, `app_code`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `role_permissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `resource_id` BIGINT UNSIGNED NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_permissions_role_resource_action` (`role_id`, `resource_id`, `action`),
  KEY `idx_role_permissions_tenant_role` (`tenant_code`, `role_id`),
  KEY `idx_role_permissions_resource_action` (`resource_id`, `action`),
  CONSTRAINT `fk_role_permissions_role_id`
    FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`),
  CONSTRAINT `fk_role_permissions_resource_id`
    FOREIGN KEY (`resource_id`) REFERENCES `resources` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `permission_templates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NULL,
  `template_code` VARCHAR(128) NOT NULL,
  `template_name` VARCHAR(255) NOT NULL,
  `template_type` VARCHAR(32) NOT NULL,
  `description` VARCHAR(500) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_by` VARCHAR(128) NULL,
  `updated_by` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_permission_templates_tenant_code` (`tenant_code`, `template_code`),
  KEY `idx_permission_templates_tenant_type_status` (`tenant_code`, `template_type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `template_roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NULL,
  `template_id` BIGINT UNSIGNED NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_template_roles_template_role` (`template_id`, `role_id`),
  KEY `idx_template_roles_tenant_template` (`tenant_code`, `template_id`),
  KEY `idx_template_roles_role_id` (`role_id`),
  CONSTRAINT `fk_template_roles_template_id`
    FOREIGN KEY (`template_id`) REFERENCES `permission_templates` (`id`),
  CONSTRAINT `fk_template_roles_role_id`
    FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `template_bindings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NULL,
  `template_id` BIGINT UNSIGNED NOT NULL,
  `subject_type` VARCHAR(32) NOT NULL,
  `subject_id` BIGINT UNSIGNED NOT NULL,
  `priority` INT NOT NULL DEFAULT 100,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `start_at` DATETIME NULL,
  `end_at` DATETIME NULL,
  `created_by` VARCHAR(128) NULL,
  `updated_by` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_template_bindings_tenant_subject` (`tenant_code`, `subject_type`, `subject_id`, `status`),
  KEY `idx_template_bindings_template_id` (`template_id`),
  KEY `idx_template_bindings_priority` (`priority`),
  CONSTRAINT `fk_template_bindings_template_id`
    FOREIGN KEY (`template_id`) REFERENCES `permission_templates` (`id`),
  CONSTRAINT `fk_template_bindings_subject_id`
    FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `template_overrides` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NULL,
  `subject_type` VARCHAR(32) NOT NULL,
  `subject_id` BIGINT UNSIGNED NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `override_type` VARCHAR(32) NOT NULL,
  `source_template_id` BIGINT UNSIGNED NULL,
  `reason` VARCHAR(500) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by` VARCHAR(128) NULL,
  `updated_by` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_template_overrides_tenant_subject` (`tenant_code`, `subject_type`, `subject_id`, `status`),
  KEY `idx_template_overrides_role_id` (`role_id`),
  KEY `idx_template_overrides_source_template_id` (`source_template_id`),
  CONSTRAINT `fk_template_overrides_subject_id`
    FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`),
  CONSTRAINT `fk_template_overrides_role_id`
    FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`),
  CONSTRAINT `fk_template_overrides_source_template_id`
    FOREIGN KEY (`source_template_id`) REFERENCES `permission_templates` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `role_scopes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `resource_id` BIGINT UNSIGNED NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `scope_type` VARCHAR(32) NOT NULL,
  `scope_value` VARCHAR(255) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by` VARCHAR(128) NULL,
  `updated_by` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_scopes_role_resource_action_scope` (`role_id`, `resource_id`, `action`, `scope_type`, `scope_value`),
  KEY `idx_role_scopes_tenant_role_action` (`tenant_code`, `role_id`, `action`, `status`),
  KEY `idx_role_scopes_resource_action` (`resource_id`, `action`),
  CONSTRAINT `fk_role_scopes_role_id`
    FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`),
  CONSTRAINT `fk_role_scopes_resource_id`
    FOREIGN KEY (`resource_id`) REFERENCES `resources` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Batch C: Runtime Control
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `deployments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `deployment_code` VARCHAR(128) NOT NULL,
  `deployment_name` VARCHAR(255) NOT NULL,
  `deployment_mode` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `license_status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `last_heartbeat_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_deployments_tenant_deployment_code` (`tenant_code`, `deployment_code`),
  KEY `idx_deployments_tenant_status` (`tenant_code`, `status`),
  KEY `idx_deployments_last_heartbeat_at` (`last_heartbeat_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `licenses` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `deployment_id` BIGINT UNSIGNED NOT NULL,
  `license_code` VARCHAR(128) NOT NULL,
  `plan_code` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `issued_at` DATETIME NOT NULL,
  `expires_at` DATETIME NULL,
  `grace_until` DATETIME NULL,
  `payload_hash` VARCHAR(128) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_licenses_tenant_license_code` (`tenant_code`, `license_code`),
  KEY `idx_licenses_deployment_id` (`deployment_id`),
  KEY `idx_licenses_status` (`status`),
  KEY `idx_licenses_expires_at` (`expires_at`),
  CONSTRAINT `fk_licenses_deployment_id`
    FOREIGN KEY (`deployment_id`) REFERENCES `deployments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `license_capabilities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `license_id` BIGINT UNSIGNED NOT NULL,
  `capability_code` VARCHAR(128) NOT NULL,
  `capability_value` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_license_capabilities_license_code` (`license_id`, `capability_code`),
  KEY `idx_license_capabilities_tenant_code` (`tenant_code`, `capability_code`),
  CONSTRAINT `fk_license_capabilities_license_id`
    FOREIGN KEY (`license_id`) REFERENCES `licenses` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `policy_bundles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `deployment_id` BIGINT UNSIGNED NOT NULL,
  `bundle_version` VARCHAR(64) NOT NULL,
  `bundle_hash` VARCHAR(128) NOT NULL,
  `bundle_uri` VARCHAR(500) NOT NULL,
  `schema_version` VARCHAR(32) NOT NULL,
  `issued_at` DATETIME NOT NULL,
  `expires_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_policy_bundles_deployment_version` (`deployment_id`, `bundle_version`),
  KEY `idx_policy_bundles_tenant_status` (`tenant_code`, `status`),
  KEY `idx_policy_bundles_expires_at` (`expires_at`),
  CONSTRAINT `fk_policy_bundles_deployment_id`
    FOREIGN KEY (`deployment_id`) REFERENCES `deployments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `revocation_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `deployment_id` BIGINT UNSIGNED NOT NULL,
  `snapshot_version` VARCHAR(64) NOT NULL,
  `snapshot_hash` VARCHAR(128) NOT NULL,
  `snapshot_uri` VARCHAR(500) NOT NULL,
  `issued_at` DATETIME NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_revocation_snapshots_deployment_version` (`deployment_id`, `snapshot_version`),
  KEY `idx_revocation_snapshots_tenant_status` (`tenant_code`, `status`),
  CONSTRAINT `fk_revocation_snapshots_deployment_id`
    FOREIGN KEY (`deployment_id`) REFERENCES `deployments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `deployment_heartbeats` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `deployment_id` BIGINT UNSIGNED NOT NULL,
  `runtime_id` VARCHAR(128) NOT NULL,
  `bundle_version` VARCHAR(64) NULL,
  `sdk_version` VARCHAR(64) NULL,
  `license_status_seen` VARCHAR(32) NULL,
  `heartbeat_at` DATETIME NOT NULL,
  `payload_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_deployment_heartbeats_deployment_time` (`deployment_id`, `heartbeat_at`),
  KEY `idx_deployment_heartbeats_tenant_runtime` (`tenant_code`, `runtime_id`),
  CONSTRAINT `fk_deployment_heartbeats_deployment_id`
    FOREIGN KEY (`deployment_id`) REFERENCES `deployments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Batch D: Audit
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `authorization_audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NULL,
  `operator_uid` VARCHAR(128) NULL,
  `target_type` VARCHAR(64) NOT NULL,
  `target_id` VARCHAR(128) NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `before_json` JSON NULL,
  `after_json` JSON NULL,
  `source` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_authorization_audit_logs_tenant_action` (`tenant_code`, `action`, `created_at`),
  KEY `idx_authorization_audit_logs_target` (`target_type`, `target_id`, `created_at`),
  KEY `idx_authorization_audit_logs_operator` (`operator_uid`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Seed recommendations (comment only, not executed)
-- ------------------------------------------------------------
-- 1. 先插入系统级 base role，例如 internal_user
-- 2. 为 aims/codocs 预置 applications 记录
-- 3. 为平台管理后台预置 account/platform admin 相关角色
-- 4. 为首个 deployment 预置 managed-control-plane 或 self-hosted-enterprise 记录
--
-- 下一步建议：
-- 1. 基于本 DDL 输出 hzy_platform 第一版 API 草案
-- 2. 再根据 API 草案补 seed.sql 与最小初始化数据

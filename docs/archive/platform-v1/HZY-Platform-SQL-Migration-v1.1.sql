-- ============================================================
-- hzy_platform v1.1 Migration
-- 日期: 2026-04-22
-- 目标:
-- 1) 修复 DDL 与 platform 代码契约不一致（deployments.app_code）
-- 2) 将“租户运行层”表收紧为 tenant_code 必填并外键到 tenants
-- 3) 补齐平台控制层核心表（tenant_app_subscriptions / catalog）
-- 4) 对“系统默认 + 租户覆盖”表引入作用域字段，修复 NULL 唯一键问题
--
-- 适用前提:
-- - 已执行 docs/HZY-Platform-SQL-DDL-Draft-v1.sql
-- - MySQL 8.0
-- - 建议先在预发环境验证
-- ============================================================

USE `hzy_platform`;

-- ============================================================
-- 0. 预检查（必须先确认）
-- ============================================================

-- 0.1 运行层表中 tenant_code 为空的脏数据（必须为 0）
SELECT 'users' AS table_name, COUNT(*) AS null_tenant_rows FROM `users` WHERE `tenant_code` IS NULL
UNION ALL
SELECT 'subjects', COUNT(*) FROM `subjects` WHERE `tenant_code` IS NULL
UNION ALL
SELECT 'subject_identities', COUNT(*) FROM `subject_identities` WHERE `tenant_code` IS NULL
UNION ALL
SELECT 'user_roles', COUNT(*) FROM `user_roles` WHERE `tenant_code` IS NULL
UNION ALL
SELECT 'template_bindings', COUNT(*) FROM `template_bindings` WHERE `tenant_code` IS NULL
UNION ALL
SELECT 'template_overrides', COUNT(*) FROM `template_overrides` WHERE `tenant_code` IS NULL
UNION ALL
SELECT 'deployments', COUNT(*) FROM `deployments` WHERE `tenant_code` IS NULL
UNION ALL
SELECT 'licenses', COUNT(*) FROM `licenses` WHERE `tenant_code` IS NULL
UNION ALL
SELECT 'license_capabilities', COUNT(*) FROM `license_capabilities` WHERE `tenant_code` IS NULL
UNION ALL
SELECT 'policy_bundles', COUNT(*) FROM `policy_bundles` WHERE `tenant_code` IS NULL
UNION ALL
SELECT 'revocation_snapshots', COUNT(*) FROM `revocation_snapshots` WHERE `tenant_code` IS NULL
UNION ALL
SELECT 'deployment_heartbeats', COUNT(*) FROM `deployment_heartbeats` WHERE `tenant_code` IS NULL;

-- 0.2 运行层表中 tenant_code 指向不存在租户的脏数据（必须为 0）
SELECT 'users' AS table_name, COUNT(*) AS orphan_rows
FROM `users` u LEFT JOIN `tenants` t ON t.tenant_code = u.tenant_code
WHERE t.tenant_code IS NULL
UNION ALL
SELECT 'subjects', COUNT(*)
FROM `subjects` s LEFT JOIN `tenants` t ON t.tenant_code = s.tenant_code
WHERE t.tenant_code IS NULL
UNION ALL
SELECT 'subject_identities', COUNT(*)
FROM `subject_identities` si LEFT JOIN `tenants` t ON t.tenant_code = si.tenant_code
WHERE t.tenant_code IS NULL
UNION ALL
SELECT 'user_roles', COUNT(*)
FROM `user_roles` ur LEFT JOIN `tenants` t ON t.tenant_code = ur.tenant_code
WHERE t.tenant_code IS NULL
UNION ALL
SELECT 'template_bindings', COUNT(*)
FROM `template_bindings` tb LEFT JOIN `tenants` t ON t.tenant_code = tb.tenant_code
WHERE t.tenant_code IS NULL
UNION ALL
SELECT 'template_overrides', COUNT(*)
FROM `template_overrides` tovr LEFT JOIN `tenants` t ON t.tenant_code = tovr.tenant_code
WHERE t.tenant_code IS NULL
UNION ALL
SELECT 'deployments', COUNT(*)
FROM `deployments` d LEFT JOIN `tenants` t ON t.tenant_code = d.tenant_code
WHERE t.tenant_code IS NULL
UNION ALL
SELECT 'licenses', COUNT(*)
FROM `licenses` l LEFT JOIN `tenants` t ON t.tenant_code = l.tenant_code
WHERE t.tenant_code IS NULL
UNION ALL
SELECT 'license_capabilities', COUNT(*)
FROM `license_capabilities` lc LEFT JOIN `tenants` t ON t.tenant_code = lc.tenant_code
WHERE t.tenant_code IS NULL
UNION ALL
SELECT 'policy_bundles', COUNT(*)
FROM `policy_bundles` pb LEFT JOIN `tenants` t ON t.tenant_code = pb.tenant_code
WHERE t.tenant_code IS NULL
UNION ALL
SELECT 'revocation_snapshots', COUNT(*)
FROM `revocation_snapshots` rs LEFT JOIN `tenants` t ON t.tenant_code = rs.tenant_code
WHERE t.tenant_code IS NULL
UNION ALL
SELECT 'deployment_heartbeats', COUNT(*)
FROM `deployment_heartbeats` dh LEFT JOIN `tenants` t ON t.tenant_code = dh.tenant_code
WHERE t.tenant_code IS NULL;

-- 0.3 修复 NULL 唯一键前的冲突检查（必须无返回）
SELECT COALESCE(`tenant_code`, '__SYS__') AS owner_tenant_key, `app_code`, COUNT(*) AS c
FROM `applications`
GROUP BY COALESCE(`tenant_code`, '__SYS__'), `app_code`
HAVING COUNT(*) > 1;

SELECT COALESCE(`tenant_code`, '__SYS__') AS owner_tenant_key, `role_code`, COUNT(*) AS c
FROM `roles`
GROUP BY COALESCE(`tenant_code`, '__SYS__'), `role_code`
HAVING COUNT(*) > 1;

SELECT COALESCE(`tenant_code`, '__SYS__') AS owner_tenant_key, `app_code`, `resource_code`, COUNT(*) AS c
FROM `resources`
GROUP BY COALESCE(`tenant_code`, '__SYS__'), `app_code`, `resource_code`
HAVING COUNT(*) > 1;

SELECT COALESCE(`tenant_code`, '__SYS__') AS owner_tenant_key, `template_code`, COUNT(*) AS c
FROM `permission_templates`
GROUP BY COALESCE(`tenant_code`, '__SYS__'), `template_code`
HAVING COUNT(*) > 1;

SELECT COALESCE(`tenant_code`, '__SYS__') AS owner_tenant_key, `app_code`, `version`, COUNT(*) AS c
FROM `app_manifests`
GROUP BY COALESCE(`tenant_code`, '__SYS__'), `app_code`, `version`
HAVING COUNT(*) > 1;

-- 0.4 关系表重复检查（必须无返回）
SELECT `tenant_code`, `template_id`, `subject_type`, `subject_id`, COUNT(*) AS c
FROM `template_bindings`
GROUP BY `tenant_code`, `template_id`, `subject_type`, `subject_id`
HAVING COUNT(*) > 1;

SELECT `tenant_code`, `subject_type`, `subject_id`, `role_id`, `override_type`, COALESCE(`source_template_id`, 0) AS source_template_key, COUNT(*) AS c
FROM `template_overrides`
GROUP BY `tenant_code`, `subject_type`, `subject_id`, `role_id`, `override_type`, COALESCE(`source_template_id`, 0)
HAVING COUNT(*) > 1;

SELECT `tenant_code`, `uid`, `role_id`, `source_type`, COALESCE(`source_id`, '__NULL__') AS source_id_key, COUNT(*) AS c
FROM `user_roles`
GROUP BY `tenant_code`, `uid`, `role_id`, `source_type`, COALESCE(`source_id`, '__NULL__')
HAVING COUNT(*) > 1;

-- ============================================================
-- Batch 1: 契约修复（字段与枚举）
-- ============================================================

-- 1.1 deployments 增加 app_code（platform 代码已依赖）
ALTER TABLE `deployments`
  ADD COLUMN `app_code` VARCHAR(64) NULL COMMENT '关联应用编码' AFTER `tenant_code`;

ALTER TABLE `deployments`
  ADD KEY `idx_deployments_tenant_app_code` (`tenant_code`, `app_code`),
  ADD UNIQUE KEY `uk_deployments_tenant_app_code` (`tenant_code`, `app_code`);

-- 1.2 状态/模式约束统一（以当前 platform 代码常量为准）
ALTER TABLE `applications`
  ADD CONSTRAINT `ck_applications_runtime_mode`
    CHECK (`runtime_mode` IN ('customer-hosted', 'managed-control-plane', 'self-hosted-enterprise')),
  ADD CONSTRAINT `ck_applications_auth_mode`
    CHECK (`auth_mode` IN ('oidc', 'gitlab_oidc', 'cas', 'wecom')),
  ADD CONSTRAINT `ck_applications_status`
    CHECK (`status` IN ('active', 'suspended', 'disabled'));

ALTER TABLE `deployments`
  ADD CONSTRAINT `ck_deployments_mode`
    CHECK (`deployment_mode` IN ('managed-control-plane', 'self-hosted-enterprise', 'customer-hosted')),
  ADD CONSTRAINT `ck_deployments_status`
    CHECK (`status` IN ('active', 'suspended', 'disabled')),
  ADD CONSTRAINT `ck_deployments_license_status`
    CHECK (`license_status` IN ('active', 'grace', 'expired', 'suspended', 'disabled'));

ALTER TABLE `licenses`
  ADD CONSTRAINT `ck_licenses_status`
    CHECK (`status` IN ('active', 'grace', 'expired', 'suspended', 'disabled'));

ALTER TABLE `template_bindings`
  ADD CONSTRAINT `ck_template_bindings_status`
    CHECK (`status` IN ('active', 'paused', 'disabled'));

ALTER TABLE `template_overrides`
  ADD CONSTRAINT `ck_template_overrides_status`
    CHECK (`status` IN ('active', 'disabled'));

ALTER TABLE `role_scopes`
  ADD CONSTRAINT `ck_role_scopes_status`
    CHECK (`status` IN ('active', 'disabled'));

-- ============================================================
-- Batch 2: 租户运行层收紧（tenant_code 必填 + FK）
-- ============================================================

-- 2.1 tenant_code 必填
ALTER TABLE `users` MODIFY COLUMN `tenant_code` VARCHAR(64) NOT NULL;
ALTER TABLE `subjects` MODIFY COLUMN `tenant_code` VARCHAR(64) NOT NULL;
ALTER TABLE `subject_identities` MODIFY COLUMN `tenant_code` VARCHAR(64) NOT NULL;
ALTER TABLE `user_roles` MODIFY COLUMN `tenant_code` VARCHAR(64) NOT NULL;
ALTER TABLE `template_bindings` MODIFY COLUMN `tenant_code` VARCHAR(64) NOT NULL;
ALTER TABLE `template_overrides` MODIFY COLUMN `tenant_code` VARCHAR(64) NOT NULL;
ALTER TABLE `deployments` MODIFY COLUMN `tenant_code` VARCHAR(64) NOT NULL;
ALTER TABLE `licenses` MODIFY COLUMN `tenant_code` VARCHAR(64) NOT NULL;
ALTER TABLE `license_capabilities` MODIFY COLUMN `tenant_code` VARCHAR(64) NOT NULL;
ALTER TABLE `policy_bundles` MODIFY COLUMN `tenant_code` VARCHAR(64) NOT NULL;
ALTER TABLE `revocation_snapshots` MODIFY COLUMN `tenant_code` VARCHAR(64) NOT NULL;
ALTER TABLE `deployment_heartbeats` MODIFY COLUMN `tenant_code` VARCHAR(64) NOT NULL;

-- 2.2 关系表唯一性（防并发重复）
ALTER TABLE `template_bindings`
  ADD UNIQUE KEY `uk_template_bindings_tenant_template_subject`
    (`tenant_code`, `template_id`, `subject_type`, `subject_id`);

ALTER TABLE `template_overrides`
  ADD COLUMN `source_template_key` BIGINT UNSIGNED
    GENERATED ALWAYS AS (IFNULL(`source_template_id`, 0)) STORED,
  ADD UNIQUE KEY `uk_template_overrides_tenant_subject_role_override_source`
    (`tenant_code`, `subject_type`, `subject_id`, `role_id`, `override_type`, `source_template_key`);

ALTER TABLE `user_roles`
  ADD COLUMN `source_id_key` VARCHAR(128)
    GENERATED ALWAYS AS (IFNULL(`source_id`, '__NULL__')) STORED,
  DROP INDEX `uk_user_roles_uid_role_source`,
  ADD UNIQUE KEY `uk_user_roles_tenant_uid_role_source`
    (`tenant_code`, `uid`, `role_id`, `source_type`, `source_id_key`);

-- 2.3 运行层 tenant 外键
ALTER TABLE `users`
  ADD CONSTRAINT `fk_users_tenant_code`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE `subjects`
  ADD CONSTRAINT `fk_subjects_tenant_code`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE `subject_identities`
  ADD CONSTRAINT `fk_subject_identities_tenant_code`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE `user_roles`
  ADD CONSTRAINT `fk_user_roles_tenant_code`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE `template_bindings`
  ADD CONSTRAINT `fk_template_bindings_tenant_code`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE `template_overrides`
  ADD CONSTRAINT `fk_template_overrides_tenant_code`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE `deployments`
  ADD CONSTRAINT `fk_deployments_tenant_code`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE `licenses`
  ADD CONSTRAINT `fk_licenses_tenant_code`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE `license_capabilities`
  ADD CONSTRAINT `fk_license_capabilities_tenant_code`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE `policy_bundles`
  ADD CONSTRAINT `fk_policy_bundles_tenant_code`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE `revocation_snapshots`
  ADD CONSTRAINT `fk_revocation_snapshots_tenant_code`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE `deployment_heartbeats`
  ADD CONSTRAINT `fk_deployment_heartbeats_tenant_code`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

-- ============================================================
-- Batch 3: 控制层补表（订阅与全局目录）
-- ============================================================

-- 3.1 租户应用订阅主表（控制层关键实体）
CREATE TABLE `tenant_app_subscriptions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `subscription_status` VARCHAR(32) NOT NULL DEFAULT 'selected',
  `source` VARCHAR(32) NOT NULL DEFAULT 'manual',
  `selected_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `activated_at` DATETIME NULL,
  `disabled_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_app_subscriptions_tenant_app` (`tenant_code`, `app_code`),
  KEY `idx_tenant_app_subscriptions_status` (`tenant_code`, `subscription_status`),
  CONSTRAINT `fk_tenant_app_subscriptions_tenant_code`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `ck_tenant_app_subscriptions_status`
    CHECK (`subscription_status` IN ('selected', 'active', 'suspended', 'disabled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户应用订阅表';

-- 3.2 从 deployments 回填订阅数据
INSERT INTO `tenant_app_subscriptions`
  (`tenant_code`, `app_code`, `subscription_status`, `source`, `selected_at`, `activated_at`, `disabled_at`, `created_at`, `updated_at`)
SELECT
  d.`tenant_code`,
  d.`app_code`,
  CASE
    WHEN d.`status` = 'active' AND d.`license_status` IN ('active', 'grace') THEN 'active'
    WHEN d.`status` = 'disabled' THEN 'disabled'
    WHEN d.`status` = 'suspended' THEN 'suspended'
    ELSE 'selected'
  END AS subscription_status,
  'deployment_backfill' AS source,
  UTC_TIMESTAMP() AS selected_at,
  CASE
    WHEN d.`status` = 'active' AND d.`license_status` IN ('active', 'grace') THEN UTC_TIMESTAMP()
    ELSE NULL
  END AS activated_at,
  CASE
    WHEN d.`status` = 'disabled' THEN UTC_TIMESTAMP()
    ELSE NULL
  END AS disabled_at,
  UTC_TIMESTAMP() AS created_at,
  UTC_TIMESTAMP() AS updated_at
FROM `deployments` d
WHERE d.`app_code` IS NOT NULL
ON DUPLICATE KEY UPDATE
  `subscription_status` = VALUES(`subscription_status`),
  `source` = VALUES(`source`),
  `activated_at` = VALUES(`activated_at`),
  `disabled_at` = VALUES(`disabled_at`),
  `updated_at` = VALUES(`updated_at`);

-- 3.3 全局套餐目录
CREATE TABLE `plan_catalog` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `plan_code` VARCHAR(64) NOT NULL,
  `plan_name` VARCHAR(128) NOT NULL,
  `description` VARCHAR(500) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_plan_catalog_plan_code` (`plan_code`),
  CONSTRAINT `ck_plan_catalog_status`
    CHECK (`status` IN ('active', 'disabled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='套餐目录';

-- 3.4 全局能力目录
CREATE TABLE `capability_catalog` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `capability_code` VARCHAR(128) NOT NULL,
  `capability_name` VARCHAR(255) NOT NULL,
  `value_type` VARCHAR(32) NOT NULL DEFAULT 'string',
  `description` VARCHAR(500) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_capability_catalog_code` (`capability_code`),
  CONSTRAINT `ck_capability_catalog_status`
    CHECK (`status` IN ('active', 'disabled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='能力目录';

-- 3.5 根据已有 license_capabilities 回填 capability_catalog
INSERT INTO `capability_catalog`
  (`capability_code`, `capability_name`, `value_type`, `status`, `created_at`, `updated_at`)
SELECT DISTINCT
  lc.`capability_code`,
  lc.`capability_code`,
  'string',
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `license_capabilities` lc
WHERE lc.`capability_code` IS NOT NULL AND lc.`capability_code` <> ''
ON DUPLICATE KEY UPDATE
  `updated_at` = VALUES(`updated_at`);

-- ============================================================
-- Batch 4: 混合层作用域化（系统默认 + 租户覆盖）
-- ============================================================

-- 4.1 applications
ALTER TABLE `applications`
  ADD COLUMN `owner_scope` VARCHAR(16)
    GENERATED ALWAYS AS (CASE WHEN `tenant_code` IS NULL THEN 'system' ELSE 'tenant' END) STORED COMMENT '归属作用域',
  ADD COLUMN `owner_tenant_key` VARCHAR(64)
    GENERATED ALWAYS AS (IFNULL(`tenant_code`, '__SYS__')) STORED COMMENT '归一化租户键';

ALTER TABLE `applications`
  DROP INDEX `uk_applications_tenant_app_code`,
  ADD UNIQUE KEY `uk_applications_owner_app_code` (`owner_tenant_key`, `app_code`),
  ADD KEY `idx_applications_owner_scope_status` (`owner_scope`, `status`);

-- 4.2 app_manifests
ALTER TABLE `app_manifests`
  ADD COLUMN `owner_scope` VARCHAR(16)
    GENERATED ALWAYS AS (CASE WHEN `tenant_code` IS NULL THEN 'system' ELSE 'tenant' END) STORED COMMENT '归属作用域',
  ADD COLUMN `owner_tenant_key` VARCHAR(64)
    GENERATED ALWAYS AS (IFNULL(`tenant_code`, '__SYS__')) STORED COMMENT '归一化租户键';

ALTER TABLE `app_manifests`
  DROP INDEX `uk_app_manifests_tenant_app_version`,
  ADD UNIQUE KEY `uk_app_manifests_owner_app_version` (`owner_tenant_key`, `app_code`, `version`),
  ADD KEY `idx_app_manifests_owner_scope_status` (`owner_scope`, `status`);

-- 4.3 roles
ALTER TABLE `roles`
  ADD COLUMN `owner_scope` VARCHAR(16)
    GENERATED ALWAYS AS (CASE WHEN `tenant_code` IS NULL THEN 'system' ELSE 'tenant' END) STORED COMMENT '归属作用域',
  ADD COLUMN `owner_tenant_key` VARCHAR(64)
    GENERATED ALWAYS AS (IFNULL(`tenant_code`, '__SYS__')) STORED COMMENT '归一化租户键';

ALTER TABLE `roles`
  DROP INDEX `uk_roles_tenant_role_code`,
  ADD UNIQUE KEY `uk_roles_owner_role_code` (`owner_tenant_key`, `role_code`),
  ADD KEY `idx_roles_owner_scope_status` (`owner_scope`, `status`);

-- 4.4 resources
ALTER TABLE `resources`
  ADD COLUMN `owner_scope` VARCHAR(16)
    GENERATED ALWAYS AS (CASE WHEN `tenant_code` IS NULL THEN 'system' ELSE 'tenant' END) STORED COMMENT '归属作用域',
  ADD COLUMN `owner_tenant_key` VARCHAR(64)
    GENERATED ALWAYS AS (IFNULL(`tenant_code`, '__SYS__')) STORED COMMENT '归一化租户键';

ALTER TABLE `resources`
  DROP INDEX `uk_resources_tenant_app_resource`,
  ADD UNIQUE KEY `uk_resources_owner_app_resource` (`owner_tenant_key`, `app_code`, `resource_code`),
  ADD KEY `idx_resources_owner_scope_status` (`owner_scope`, `status`);

-- 4.5 permission_templates
ALTER TABLE `permission_templates`
  ADD COLUMN `owner_scope` VARCHAR(16)
    GENERATED ALWAYS AS (CASE WHEN `tenant_code` IS NULL THEN 'system' ELSE 'tenant' END) STORED COMMENT '归属作用域',
  ADD COLUMN `owner_tenant_key` VARCHAR(64)
    GENERATED ALWAYS AS (IFNULL(`tenant_code`, '__SYS__')) STORED COMMENT '归一化租户键';

ALTER TABLE `permission_templates`
  DROP INDEX `uk_permission_templates_tenant_code`,
  ADD UNIQUE KEY `uk_permission_templates_owner_template_code` (`owner_tenant_key`, `template_code`),
  ADD KEY `idx_permission_templates_owner_scope_status` (`owner_scope`, `status`);

-- ============================================================
-- 5. 迁移后验证（建议执行）
-- ============================================================

-- 5.1 deployments 契约验证
SELECT
  COUNT(*) AS total_deployments,
  SUM(CASE WHEN app_code IS NULL THEN 1 ELSE 0 END) AS app_code_null_count
FROM `deployments`;

-- 5.2 新增订阅表验证
SELECT `tenant_code`, COUNT(*) AS subscription_count
FROM `tenant_app_subscriptions`
GROUP BY `tenant_code`
ORDER BY `tenant_code`;

-- 5.3 混合层 owner_scope 验证
SELECT 'applications' AS table_name, `owner_scope`, COUNT(*) AS c
FROM `applications`
GROUP BY `owner_scope`
UNION ALL
SELECT 'roles', `owner_scope`, COUNT(*)
FROM `roles`
GROUP BY `owner_scope`
UNION ALL
SELECT 'resources', `owner_scope`, COUNT(*)
FROM `resources`
GROUP BY `owner_scope`
UNION ALL
SELECT 'permission_templates', `owner_scope`, COUNT(*)
FROM `permission_templates`
GROUP BY `owner_scope`
UNION ALL
SELECT 'app_manifests', `owner_scope`, COUNT(*)
FROM `app_manifests`
GROUP BY `owner_scope`;

-- ============================================================
-- 完成
-- 后续建议:
-- 1) 将 platform 代码逐步切到 tenant_app_subscriptions 作为“租户启用应用”主数据
-- 2) 对 template_bindings 增加“可绑定系统模板”的服务端校验策略
-- 3) 增加租户一致性触发器（role/resource/template 跨租户引用拦截）
-- ============================================================

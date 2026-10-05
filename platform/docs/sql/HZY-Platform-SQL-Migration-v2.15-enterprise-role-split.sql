-- HZY Platform migration v2.15: split app permission roles from enterprise roles
--
-- Intent:
--   - Old platform_system_roles were actually application permission role templates.
--     Rename them to platform_app_roles.
--   - Old platform_system_templates were enterprise/system role templates.
--     Rename them to platform_system_roles.
--   - Add tenant_role_app_role_maps so tenant enterprise roles can include app roles
--     without expanding inherited permissions into tenant_role_permissions.
--
-- Run after v2.14. This migration drops the old FK constraints before column
-- renames because MySQL will otherwise reject CHANGE COLUMN on indexed FK
-- columns with Error 1553.

ALTER TABLE `platform_system_role_permissions`
  DROP FOREIGN KEY `fk_platform_sys_role_perm_role`,
  DROP FOREIGN KEY `fk_platform_sys_role_perm_manifest_action`;

ALTER TABLE `platform_system_role_scopes`
  DROP FOREIGN KEY `fk_platform_sys_role_scope_role`,
  DROP FOREIGN KEY `fk_platform_sys_role_scope_manifest_action`;

ALTER TABLE `platform_system_template_roles`
  DROP FOREIGN KEY `fk_platform_sys_tpl_roles_tpl`,
  DROP FOREIGN KEY `fk_platform_sys_tpl_roles_role`;

RENAME TABLE
  `platform_system_roles` TO `platform_app_roles`,
  `platform_system_role_permissions` TO `platform_app_role_permissions`,
  `platform_system_role_scopes` TO `platform_app_role_scopes`,
  `platform_system_templates` TO `platform_system_roles`,
  `platform_system_template_roles` TO `platform_system_app_role_maps`;

ALTER TABLE `platform_app_role_permissions`
  CHANGE COLUMN `system_role_id` `app_role_id` BIGINT UNSIGNED NOT NULL;

ALTER TABLE `platform_app_role_scopes`
  CHANGE COLUMN `system_role_id` `app_role_id` BIGINT UNSIGNED NOT NULL;

ALTER TABLE `platform_system_roles`
  CHANGE COLUMN `template_code` `role_code` VARCHAR(128) NOT NULL,
  CHANGE COLUMN `template_name` `role_name` VARCHAR(255) NOT NULL,
  CHANGE COLUMN `template_type` `role_type` VARCHAR(32) NOT NULL DEFAULT 'system',
  ADD COLUMN `is_required` TINYINT(1) NOT NULL DEFAULT 0 AFTER `description`,
  ADD COLUMN `policy_revision` BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `status`,
  ADD COLUMN `policy_hash` VARCHAR(96) NULL AFTER `policy_revision`,
  ADD COLUMN `policy_updated_at` DATETIME NULL AFTER `policy_hash`;

ALTER TABLE `platform_system_app_role_maps`
  CHANGE COLUMN `system_template_id` `system_role_id` BIGINT UNSIGNED NOT NULL,
  CHANGE COLUMN `system_role_code` `app_role_code` VARCHAR(128) NOT NULL,
  ADD COLUMN `system_role_code` VARCHAR(128) NULL AFTER `system_role_id`,
  ADD COLUMN `app_role_id` BIGINT UNSIGNED NULL AFTER `system_role_code`;

UPDATE `platform_system_app_role_maps` m
INNER JOIN `platform_system_roles` sr ON sr.id = m.system_role_id
LEFT JOIN `platform_app_roles` ar ON ar.role_code = m.app_role_code
SET m.system_role_code = sr.role_code,
    m.app_role_id = ar.id;

ALTER TABLE `platform_system_app_role_maps`
  MODIFY COLUMN `system_role_code` VARCHAR(128) NOT NULL,
  MODIFY COLUMN `app_role_id` BIGINT UNSIGNED NOT NULL,
  DROP INDEX `uk_platform_sys_tpl_roles`,
  ADD UNIQUE KEY `uk_platform_system_app_role_maps` (`system_role_id`, `app_role_id`),
  ADD KEY `idx_platform_system_app_role_maps_role_code` (`system_role_code`),
  ADD KEY `idx_platform_system_app_role_maps_app_role` (`app_role_code`),
  ADD CONSTRAINT `fk_platform_system_app_role_maps_system`
    FOREIGN KEY (`system_role_id`) REFERENCES `platform_system_roles` (`id`),
  ADD CONSTRAINT `fk_platform_system_app_role_maps_app_role`
    FOREIGN KEY (`app_role_id`) REFERENCES `platform_app_roles` (`id`);

ALTER TABLE `platform_app_role_permissions`
  ADD CONSTRAINT `fk_platform_app_role_perm_role`
    FOREIGN KEY (`app_role_id`) REFERENCES `platform_app_roles` (`id`),
  ADD CONSTRAINT `fk_platform_app_role_perm_manifest_action`
    FOREIGN KEY (`manifest_action_id`, `app_code`, `resource_code`, `action`)
    REFERENCES `platform_app_manifest_resource_actions` (`id`, `app_code`, `resource_code`, `action`);

ALTER TABLE `platform_app_role_scopes`
  ADD CONSTRAINT `fk_platform_app_role_scope_role`
    FOREIGN KEY (`app_role_id`) REFERENCES `platform_app_roles` (`id`),
  ADD CONSTRAINT `fk_platform_app_role_scope_manifest_action`
    FOREIGN KEY (`manifest_action_id`, `app_code`, `resource_code`, `action`)
    REFERENCES `platform_app_manifest_resource_actions` (`id`, `app_code`, `resource_code`, `action`);

CREATE TABLE IF NOT EXISTS `tenant_role_app_role_maps` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `app_role_code` VARCHAR(128) NOT NULL,
  `source_system_role_code` VARCHAR(128) NULL,
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

-- Preserve existing tenant role behavior by converting previous system-sourced
-- tenant roles into enterprise roles that map back to their former app role.
INSERT INTO `tenant_role_app_role_maps`
  (`tenant_code`, `role_id`, `app_role_code`, `source_system_role_code`, `sort_order`, `created_at`, `updated_at`)
SELECT
  tr.tenant_code,
  tr.id,
  COALESCE(tr.source_role_code, tr.role_code),
  tr.source_role_code,
  0,
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `tenant_roles` tr
WHERE tr.source IN ('system', 'custom')
  AND tr.app_code IS NOT NULL
ON DUPLICATE KEY UPDATE
  source_system_role_code = VALUES(source_system_role_code),
  updated_at = UTC_TIMESTAMP();

UPDATE `tenant_roles`
SET app_code = NULL,
    updated_at = UTC_TIMESTAMP()
WHERE source IN ('system', 'custom')
  AND app_code IS NOT NULL;

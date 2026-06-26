-- Resume helper for v2.15 when migration stopped at:
--   Error Code: 1553. Cannot drop index 'fk_platform_sys_tpl_roles_role'
--
-- Expected state:
--   - RENAME TABLE statements have already succeeded.
--   - platform_app_role_permissions / platform_app_role_scopes column renames
--     have already succeeded.
--   - platform_system_roles template column renames have already succeeded.
--   - platform_system_app_role_maps still has old columns:
--       system_template_id, system_role_code

ALTER TABLE `platform_system_app_role_maps`
  DROP FOREIGN KEY `fk_platform_sys_tpl_roles_tpl`,
  DROP FOREIGN KEY `fk_platform_sys_tpl_roles_role`;

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

-- This result must be empty before continuing. If rows appear here, those
-- app_role_code values do not exist in platform_app_roles and must be fixed.
SELECT m.id, m.system_role_code, m.app_role_code
FROM `platform_system_app_role_maps` m
WHERE m.app_role_id IS NULL;

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

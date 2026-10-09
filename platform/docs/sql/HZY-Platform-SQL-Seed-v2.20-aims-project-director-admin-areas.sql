-- HZY Platform seed v2.20: Aims project director administration areas
--
-- Purpose:
--   Allow the enterprise project_director role, through aims:project_director,
--   to administer global projects and project templates without granting the
--   broader aims:admin application role or aims:admin:admin permission.
--
-- Preconditions:
--   1. The latest Aims manifest has been imported.
--
-- Re-runnable: the Aims project-director role is created/reactivated when
-- missing, the enterprise-role mappings are repaired for existing tenants,
-- then only the two requested permissions are upserted. Existing unrelated
-- roles and permissions remain unchanged.

START TRANSACTION;

SET @aims_manifest_id := (
  SELECT COALESCE(release_row.`manifest_id`, application.`latest_manifest_id`)
  FROM `platform_applications` application
  LEFT JOIN `platform_app_releases` release_row
    ON release_row.`id` = application.`latest_release_id`
   AND release_row.`app_code` = application.`app_code`
  WHERE application.`app_code` = 'aims'
  LIMIT 1
);

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_aims_project_director_admin_areas` (
  `role_code` VARCHAR(128) NOT NULL,
  `resource_code` VARCHAR(128) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  PRIMARY KEY (`role_code`, `resource_code`, `action`)
) ENGINE=Memory;

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_aims_project_director_admin_guard` (
  `check_name` VARCHAR(64) NOT NULL PRIMARY KEY,
  `passed` TINYINT NOT NULL,
  CONSTRAINT `chk_tmp_aims_project_director_admin_guard_passed` CHECK (`passed` = 1)
) ENGINE=Memory;

TRUNCATE TABLE `tmp_aims_project_director_admin_areas`;
TRUNCATE TABLE `tmp_aims_project_director_admin_guard`;

INSERT INTO `tmp_aims_project_director_admin_areas`
  (`role_code`, `resource_code`, `action`)
VALUES
  ('aims:project_director', 'projects', 'admin'),
  ('aims:project_director', 'project_templates', 'admin');

INSERT INTO `tmp_aims_project_director_admin_guard` (`check_name`, `passed`)
SELECT 'aims_manifest_exists', IF(@aims_manifest_id IS NOT NULL, 1, 0);

INSERT INTO `tmp_aims_project_director_admin_guard` (`check_name`, `passed`)
SELECT 'all_manifest_actions_exist', IF(COUNT(*) = 0, 1, 0)
FROM `tmp_aims_project_director_admin_areas` desired
LEFT JOIN `platform_app_manifest_resource_actions` manifest_action
  ON manifest_action.`manifest_id` = @aims_manifest_id
 AND manifest_action.`app_code` = 'aims'
 AND manifest_action.`resource_code` = desired.`resource_code`
 AND manifest_action.`action` = desired.`action`
 AND manifest_action.`status` = 'active'
WHERE manifest_action.`id` IS NULL;

INSERT INTO `platform_app_roles`
  (`role_code`, `role_name`, `role_type`, `app_code`, `description`,
   `is_required`, `status`, `created_at`, `updated_at`)
VALUES
  ('aims:project_director', 'AIMS 项目总监', 'system', 'aims',
   '独立审阅项目周报、发布公司汇总、处理 QA 豁免和里程碑完成审批，并管理全局项目与项目模板。',
   0, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `role_name` = VALUES(`role_name`),
  `role_type` = VALUES(`role_type`),
  `app_code` = VALUES(`app_code`),
  `description` = VALUES(`description`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

INSERT INTO `tmp_aims_project_director_admin_guard` (`check_name`, `passed`)
SELECT 'project_director_role_exists', IF(COUNT(*) = 1, 1, 0)
FROM `platform_app_roles` role
WHERE role.`role_code` = 'aims:project_director'
  AND role.`app_code` = 'aims'
  AND role.`status` = 'active';

INSERT INTO `platform_app_role_permissions`
  (`app_role_id`, `app_code`, `resource_code`, `action`, `manifest_action_id`, `created_at`)
SELECT
  role.`id`,
  'aims',
  desired.`resource_code`,
  desired.`action`,
  manifest_action.`id`,
  UTC_TIMESTAMP()
FROM `tmp_aims_project_director_admin_areas` desired
INNER JOIN `platform_app_roles` role
  ON role.`role_code` = desired.`role_code`
 AND role.`app_code` = 'aims'
 AND role.`status` = 'active'
INNER JOIN `platform_app_manifest_resource_actions` manifest_action
  ON manifest_action.`manifest_id` = @aims_manifest_id
 AND manifest_action.`app_code` = 'aims'
 AND manifest_action.`resource_code` = desired.`resource_code`
 AND manifest_action.`action` = desired.`action`
 AND manifest_action.`status` = 'active'
ON DUPLICATE KEY UPDATE
  `manifest_action_id` = VALUES(`manifest_action_id`);

INSERT INTO `platform_system_roles`
  (`role_code`, `role_name`, `role_type`, `description`, `is_required`,
   `max_active_assignments`, `subject_type_constraint`,
   `sort_order`, `status`, `created_at`, `updated_at`)
VALUES
  ('project_director', '项目总监', 'department',
   '统筹项目组合、项目审批、项目交付和项目经营视图。',
   0, 1, 'user', 80, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `role_name` = VALUES(`role_name`),
  `role_type` = VALUES(`role_type`),
  `description` = VALUES(`description`),
  `max_active_assignments` = 1,
  `subject_type_constraint` = 'user',
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

INSERT INTO `platform_system_app_role_maps`
  (`system_role_id`, `system_role_code`, `app_role_id`, `app_role_code`,
   `sort_order`, `created_at`)
SELECT
  system_role.`id`,
  'project_director',
  app_role.`id`,
  'aims:project_director',
  5,
  UTC_TIMESTAMP()
FROM `platform_system_roles` system_role
INNER JOIN `platform_app_roles` app_role
  ON app_role.`role_code` = 'aims:project_director'
 AND app_role.`app_code` = 'aims'
 AND app_role.`status` = 'active'
WHERE system_role.`role_code` = 'project_director'
  AND system_role.`status` = 'active'
ON DUPLICATE KEY UPDATE
  `system_role_code` = VALUES(`system_role_code`),
  `app_role_code` = VALUES(`app_role_code`),
  `sort_order` = VALUES(`sort_order`);

-- Existing tenants keep a materialized copy of system-role mappings. Repair
-- both current system-derived roles and legacy enterprise roles carrying the
-- reserved project_director code; updating only the platform default does not
-- alter an already provisioned tenant Policy Bundle.
INSERT INTO `tenant_role_app_role_maps`
  (`tenant_code`, `role_id`, `app_role_code`, `source_system_role_code`,
   `sort_order`, `created_at`, `updated_at`)
SELECT
  tenant_role.`tenant_code`,
  tenant_role.`id`,
  'aims:project_director',
  'project_director',
  5,
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `tenant_roles` tenant_role
WHERE tenant_role.`app_code` IS NULL
  AND tenant_role.`status` = 'active'
  AND (
    (
      tenant_role.`source` = 'system'
      AND tenant_role.`source_role_code` = 'project_director'
    )
    OR tenant_role.`role_code` = 'project_director'
  )
ON DUPLICATE KEY UPDATE
  `source_system_role_code` = VALUES(`source_system_role_code`),
  `sort_order` = VALUES(`sort_order`),
  `updated_at` = UTC_TIMESTAMP();

UPDATE `platform_app_roles`
SET `description` = '独立审阅项目周报、发布公司汇总、处理 QA 豁免和里程碑完成审批，并管理全局项目与项目模板。',
    `policy_revision` = `policy_revision` + 1,
    `policy_hash` = NULL,
    `policy_updated_at` = UTC_TIMESTAMP(),
    `updated_at` = UTC_TIMESTAMP()
WHERE `role_code` = 'aims:project_director'
  AND `app_code` = 'aims';

UPDATE `platform_system_roles` system_role
INNER JOIN `platform_system_app_role_maps` role_map
  ON role_map.`system_role_id` = system_role.`id`
SET system_role.`policy_revision` = system_role.`policy_revision` + 1,
    system_role.`policy_hash` = NULL,
    system_role.`policy_updated_at` = UTC_TIMESTAMP(),
    system_role.`updated_at` = UTC_TIMESTAMP()
WHERE role_map.`app_role_code` = 'aims:project_director';

UPDATE `tenant_roles` tenant_role
INNER JOIN `tenant_role_app_role_maps` role_map
  ON role_map.`tenant_code` = tenant_role.`tenant_code`
 AND role_map.`role_id` = tenant_role.`id`
SET tenant_role.`source_policy_hash` = NULL,
    tenant_role.`effective_policy_hash` = NULL,
    tenant_role.`policy_revision` = tenant_role.`policy_revision` + 1,
    tenant_role.`policy_updated_at` = UTC_TIMESTAMP(),
    tenant_role.`updated_at` = UTC_TIMESTAMP()
WHERE role_map.`app_role_code` = 'aims:project_director';

COMMIT;

-- Post-check: exactly these two additional administration permissions should be present.
SELECT
  role.`role_code`,
  permission.`resource_code`,
  permission.`action`,
  permission.`manifest_action_id`
FROM `platform_app_roles` role
INNER JOIN `platform_app_role_permissions` permission
  ON permission.`app_role_id` = role.`id`
WHERE role.`role_code` = 'aims:project_director'
  AND role.`app_code` = 'aims'
  AND (
    (permission.`resource_code` = 'projects' AND permission.`action` = 'admin')
    OR (permission.`resource_code` = 'project_templates' AND permission.`action` = 'admin')
  )
ORDER BY permission.`resource_code`, permission.`action`;

-- Post-check: the enterprise role must inherit the application role.
SELECT
  system_role.`role_code` AS `system_role_code`,
  app_role.`role_code` AS `app_role_code`
FROM `platform_system_app_role_maps` role_map
INNER JOIN `platform_system_roles` system_role
  ON system_role.`id` = role_map.`system_role_id`
INNER JOIN `platform_app_roles` app_role
  ON app_role.`id` = role_map.`app_role_id`
WHERE system_role.`role_code` = 'project_director'
  AND app_role.`role_code` = 'aims:project_director';

-- Post-check: every active tenant project-director role must contain the
-- application-role mapping used by Policy Bundle generation.
SELECT
  tenant_role.`tenant_code`,
  tenant_role.`role_code`,
  role_map.`app_role_code`,
  tenant_role.`policy_revision`
FROM `tenant_roles` tenant_role
INNER JOIN `tenant_role_app_role_maps` role_map
  ON role_map.`tenant_code` = tenant_role.`tenant_code`
 AND role_map.`role_id` = tenant_role.`id`
WHERE tenant_role.`app_code` IS NULL
  AND tenant_role.`status` = 'active'
  AND (
    (
      tenant_role.`source` = 'system'
      AND tenant_role.`source_role_code` = 'project_director'
    )
    OR tenant_role.`role_code` = 'project_director'
  )
  AND role_map.`app_role_code` = 'aims:project_director'
ORDER BY tenant_role.`tenant_code`, tenant_role.`role_code`;

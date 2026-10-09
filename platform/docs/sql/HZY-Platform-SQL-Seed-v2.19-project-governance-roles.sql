-- HZY Platform seed v2.19: Aims project governance roles
--
-- Preconditions:
--   1. Migration v2.29 has been applied.
--   2. The latest Aims manifest containing weekly_reports, quality_reviews,
--      aims:project_director and aims:qa has been imported.
--
-- Re-runnable. This seed does not assign either company role to a user.

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

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_project_governance_role_permissions` (
  `role_code` VARCHAR(128) NOT NULL,
  `resource_code` VARCHAR(128) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  PRIMARY KEY (`role_code`, `resource_code`, `action`)
) ENGINE=Memory;

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_project_governance_role_guard` (
  `check_name` VARCHAR(64) NOT NULL PRIMARY KEY,
  `passed` TINYINT NOT NULL,
  CONSTRAINT `chk_tmp_project_governance_role_guard_passed` CHECK (`passed` = 1)
) ENGINE=Memory;

TRUNCATE TABLE `tmp_project_governance_role_permissions`;
TRUNCATE TABLE `tmp_project_governance_role_guard`;

INSERT INTO `tmp_project_governance_role_permissions`
  (`role_code`, `resource_code`, `action`)
VALUES
  ('aims:project_director', 'aims_overview', 'view'),
  ('aims:project_director', 'projects', 'view'),
  ('aims:project_director', 'projects', 'admin'),
  ('aims:project_director', 'timesheet', 'view'),
  ('aims:project_director', 'weekly_reports', 'view'),
  ('aims:project_director', 'weekly_reports', 'review'),
  ('aims:project_director', 'weekly_reports', 'publish'),
  ('aims:project_director', 'weekly_reports', 'export'),
  ('aims:project_director', 'quality_reviews', 'view'),
  ('aims:project_director', 'quality_reviews', 'waive'),
  ('aims:project_director', 'project_templates', 'admin'),
  ('aims:project_director', 'notifications', 'view'),
  ('aims:qa', 'aims_overview', 'view'),
  ('aims:qa', 'projects', 'view'),
  ('aims:qa', 'quality_reviews', 'view'),
  ('aims:qa', 'quality_reviews', 'review'),
  ('aims:qa', 'quality_reviews', 'configure'),
  ('aims:qa', 'notifications', 'view');

INSERT INTO `tmp_project_governance_role_guard` (`check_name`, `passed`)
SELECT 'aims_manifest_exists', IF(@aims_manifest_id IS NOT NULL, 1, 0);

INSERT INTO `tmp_project_governance_role_guard` (`check_name`, `passed`)
SELECT 'all_manifest_actions_exist', IF(COUNT(*) = 0, 1, 0)
FROM `tmp_project_governance_role_permissions` desired
LEFT JOIN `platform_app_manifest_resource_actions` action
  ON action.`manifest_id` = @aims_manifest_id
 AND action.`app_code` = 'aims'
 AND action.`resource_code` = desired.`resource_code`
 AND action.`action` = desired.`action`
 AND action.`status` = 'active'
WHERE action.`id` IS NULL;

INSERT INTO `platform_app_roles`
  (`role_code`, `role_name`, `role_type`, `app_code`, `description`,
   `is_required`, `status`, `created_at`, `updated_at`)
VALUES
  ('aims:project_director', 'AIMS 项目总监', 'system', 'aims',
   '独立审阅项目周报、发布公司汇总、处理 QA 豁免和里程碑完成审批，并管理全局项目与项目模板。',
   0, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aims:qa', 'AIMS QA', 'system', 'aims',
   '维护项目文档检查清单并对必交文档确定版本进行完整性与质量检查。',
   0, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `role_name` = VALUES(`role_name`),
  `role_type` = VALUES(`role_type`),
  `app_code` = VALUES(`app_code`),
  `description` = VALUES(`description`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

DELETE permission
FROM `platform_app_role_permissions` permission
INNER JOIN `platform_app_roles` role
  ON role.`id` = permission.`app_role_id`
WHERE role.`role_code` IN ('aims:project_director', 'aims:qa')
  AND role.`app_code` = 'aims';

INSERT INTO `platform_app_role_permissions`
  (`app_role_id`, `app_code`, `resource_code`, `action`, `manifest_action_id`, `created_at`)
SELECT
  role.`id`,
  'aims',
  desired.`resource_code`,
  desired.`action`,
  action.`id`,
  UTC_TIMESTAMP()
FROM `tmp_project_governance_role_permissions` desired
INNER JOIN `platform_app_roles` role
  ON role.`role_code` = desired.`role_code`
 AND role.`app_code` = 'aims'
INNER JOIN `platform_app_manifest_resource_actions` action
  ON action.`manifest_id` = @aims_manifest_id
 AND action.`app_code` = 'aims'
 AND action.`resource_code` = desired.`resource_code`
 AND action.`action` = desired.`action`
 AND action.`status` = 'active';

INSERT INTO `platform_system_roles`
  (`role_code`, `role_name`, `role_type`, `description`, `is_required`,
   `max_active_assignments`, `subject_type_constraint`,
   `sort_order`, `status`, `created_at`, `updated_at`)
VALUES
  ('project_director', '项目总监', 'department',
   '统筹项目组合、项目审批、项目交付和项目经营视图。',
   0, 1, 'user', 80, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('qa', '质量保证', 'department',
   '负责项目必交文档的完整性和确定版本质量检查。',
   0, 1, 'user', 85, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `role_name` = VALUES(`role_name`),
  `role_type` = VALUES(`role_type`),
  `description` = VALUES(`description`),
  `max_active_assignments` = 1,
  `subject_type_constraint` = 'user',
  `status` = 'active',
  `policy_revision` = `policy_revision` + 1,
  `policy_hash` = NULL,
  `policy_updated_at` = UTC_TIMESTAMP(),
  `updated_at` = UTC_TIMESTAMP();

INSERT INTO `platform_system_app_role_maps`
  (`system_role_id`, `system_role_code`, `app_role_id`, `app_role_code`,
   `sort_order`, `created_at`)
SELECT
  system_role.`id`,
  system_role.`role_code`,
  app_role.`id`,
  app_role.`role_code`,
  desired.`sort_order`,
  UTC_TIMESTAMP()
FROM (
  SELECT 'project_director' AS `system_role_code`, 'aims:project_director' AS `app_role_code`, 5 AS `sort_order`
  UNION ALL SELECT 'qa', 'aims:qa', 10
  UNION ALL SELECT 'qa', 'codocs:viewer', 20
) desired
INNER JOIN `platform_system_roles` system_role
  ON system_role.`role_code` = desired.`system_role_code`
INNER JOIN `platform_app_roles` app_role
  ON app_role.`role_code` = desired.`app_role_code`
 AND app_role.`status` = 'active'
ON DUPLICATE KEY UPDATE
  `system_role_code` = VALUES(`system_role_code`),
  `app_role_code` = VALUES(`app_role_code`),
  `sort_order` = VALUES(`sort_order`);

UPDATE `tenant_roles`
SET `max_active_assignments` = 1,
    `subject_type_constraint` = 'user',
    `updated_at` = UTC_TIMESTAMP()
WHERE `source` = 'system'
  AND (`source_role_code` IN ('project_director', 'qa') OR `role_code` IN ('project_director', 'qa'));

COMMIT;

SELECT
  role.`role_code`,
  role.`max_active_assignments`,
  role.`subject_type_constraint`,
  role.`status`
FROM `platform_system_roles` role
WHERE role.`role_code` IN ('project_director', 'qa')
ORDER BY role.`role_code`;

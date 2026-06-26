-- HZY Platform seed v2.7: AIMS system roles and default permissions
--
-- Purpose:
--   Seed platform_app_roles / platform_app_role_permissions for app_code='aims'.
--   These are platform global role templates. Tenant roles are still materialized through
--   dashboard/tenant-admin flows before policy bundle generation.
--
-- Preconditions:
--   1. platform_applications has app_code='aims'.
--   2. AIMS latest released manifest or latest manifest has been imported/materialized.
--   3. platform_app_manifest_resource_actions contains the actions referenced below.
--
-- Notes:
--   - Re-runnable. It upserts role metadata and replaces permissions for the seeded roles.
--   - It does not touch platform_app_role_scopes. AIMS scope defaults should be added
--     after the AIMS runtime project/dept/self scope resolver is wired.

START TRANSACTION;

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_aims_system_role_seed` (
  `role_code` VARCHAR(128) NOT NULL PRIMARY KEY,
  `role_name` VARCHAR(255) NOT NULL,
  `description` VARCHAR(500) NULL
) ENGINE=Memory;

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_aims_system_role_permission_seed` (
  `role_code` VARCHAR(128) NOT NULL,
  `resource_code` VARCHAR(128) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  PRIMARY KEY (`role_code`, `resource_code`, `action`)
) ENGINE=Memory;

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_aims_system_role_seed_guard` (
  `check_name` VARCHAR(64) NOT NULL PRIMARY KEY,
  `passed` TINYINT NOT NULL,
  CONSTRAINT `chk_tmp_aims_system_role_seed_guard_passed` CHECK (`passed` = 1)
) ENGINE=Memory;

TRUNCATE TABLE `tmp_aims_system_role_seed`;
TRUNCATE TABLE `tmp_aims_system_role_permission_seed`;
TRUNCATE TABLE `tmp_aims_system_role_seed_guard`;

INSERT INTO `tmp_aims_system_role_seed`
  (`role_code`, `role_name`, `description`)
VALUES
  ('aims.viewer', 'AIMS 观察员', '查看个人工作台、已授权项目、工作项、看板、工时和报表。'),
  ('aims.member', 'AIMS 项目成员', '参与项目执行，维护工作项、流转看板并提交个人工时。'),
  ('aims.project_manager', 'AIMS 项目经理', '负责项目创建、项目管理、成员协作、工作项分配、工时审核和项目报表。'),
  ('aims.portfolio_manager', 'AIMS 项目组合管理员', '管理项目组合、跨项目进度和经营交付视图，可查看项目执行细节和导出报表。'),
  ('aims.admin', 'AIMS 应用管理员', '管理 AIMS 全部应用能力、项目模板和租户级配置。');

INSERT INTO `tmp_aims_system_role_permission_seed`
  (`role_code`, `resource_code`, `action`)
VALUES
  -- aims.viewer
  ('aims.viewer', 'aims_overview', 'view'),
  ('aims.viewer', 'projects', 'view'),
  ('aims.viewer', 'work_items', 'view'),
  ('aims.viewer', 'board', 'view'),
  ('aims.viewer', 'timesheet', 'view'),
  ('aims.viewer', 'reports', 'view'),
  ('aims.viewer', 'notifications', 'view'),

  -- aims.member
  ('aims.member', 'aims_overview', 'view'),
  ('aims.member', 'projects', 'view'),
  ('aims.member', 'work_items', 'view'),
  ('aims.member', 'work_items', 'create'),
  ('aims.member', 'work_items', 'edit'),
  ('aims.member', 'board', 'view'),
  ('aims.member', 'board', 'edit'),
  ('aims.member', 'timesheet', 'view'),
  ('aims.member', 'timesheet', 'submit'),
  ('aims.member', 'reports', 'view'),
  ('aims.member', 'notifications', 'view'),

  -- aims.project_manager
  ('aims.project_manager', 'aims_overview', 'view'),
  ('aims.project_manager', 'portfolios', 'view'),
  ('aims.project_manager', 'projects', 'view'),
  ('aims.project_manager', 'projects', 'create'),
  ('aims.project_manager', 'projects', 'edit'),
  ('aims.project_manager', 'projects', 'close'),
  ('aims.project_manager', 'projects', 'admin'),
  ('aims.project_manager', 'work_items', 'view'),
  ('aims.project_manager', 'work_items', 'create'),
  ('aims.project_manager', 'work_items', 'edit'),
  ('aims.project_manager', 'work_items', 'delete'),
  ('aims.project_manager', 'work_items', 'assign'),
  ('aims.project_manager', 'board', 'view'),
  ('aims.project_manager', 'board', 'edit'),
  ('aims.project_manager', 'timesheet', 'view'),
  ('aims.project_manager', 'timesheet', 'submit'),
  ('aims.project_manager', 'timesheet', 'approve'),
  ('aims.project_manager', 'reports', 'view'),
  ('aims.project_manager', 'reports', 'export'),
  ('aims.project_manager', 'notifications', 'view'),
  ('aims.project_manager', 'project_templates', 'view'),

  -- aims.portfolio_manager
  ('aims.portfolio_manager', 'aims_overview', 'view'),
  ('aims.portfolio_manager', 'portfolios', 'view'),
  ('aims.portfolio_manager', 'portfolios', 'edit'),
  ('aims.portfolio_manager', 'portfolios', 'admin'),
  ('aims.portfolio_manager', 'projects', 'view'),
  ('aims.portfolio_manager', 'projects', 'create'),
  ('aims.portfolio_manager', 'projects', 'edit'),
  ('aims.portfolio_manager', 'projects', 'close'),
  ('aims.portfolio_manager', 'work_items', 'view'),
  ('aims.portfolio_manager', 'board', 'view'),
  ('aims.portfolio_manager', 'timesheet', 'view'),
  ('aims.portfolio_manager', 'timesheet', 'approve'),
  ('aims.portfolio_manager', 'reports', 'view'),
  ('aims.portfolio_manager', 'reports', 'export'),
  ('aims.portfolio_manager', 'notifications', 'view'),
  ('aims.portfolio_manager', 'project_templates', 'view'),

  -- aims.admin
  ('aims.admin', 'aims_overview', 'view'),
  ('aims.admin', 'portfolios', 'view'),
  ('aims.admin', 'portfolios', 'edit'),
  ('aims.admin', 'portfolios', 'admin'),
  ('aims.admin', 'projects', 'view'),
  ('aims.admin', 'projects', 'create'),
  ('aims.admin', 'projects', 'edit'),
  ('aims.admin', 'projects', 'close'),
  ('aims.admin', 'projects', 'admin'),
  ('aims.admin', 'work_items', 'view'),
  ('aims.admin', 'work_items', 'create'),
  ('aims.admin', 'work_items', 'edit'),
  ('aims.admin', 'work_items', 'delete'),
  ('aims.admin', 'work_items', 'assign'),
  ('aims.admin', 'board', 'view'),
  ('aims.admin', 'board', 'edit'),
  ('aims.admin', 'timesheet', 'view'),
  ('aims.admin', 'timesheet', 'submit'),
  ('aims.admin', 'timesheet', 'approve'),
  ('aims.admin', 'timesheet', 'admin'),
  ('aims.admin', 'reports', 'view'),
  ('aims.admin', 'reports', 'export'),
  ('aims.admin', 'notifications', 'view'),
  ('aims.admin', 'project_templates', 'view'),
  ('aims.admin', 'project_templates', 'edit'),
  ('aims.admin', 'project_templates', 'admin');

SET @aims_manifest_id := (
  SELECT COALESCE(par.manifest_id, pa.latest_manifest_id)
  FROM platform_applications pa
  LEFT JOIN platform_app_releases par
    ON par.id = pa.latest_release_id
   AND par.app_code = pa.app_code
  WHERE pa.app_code = 'aims'
  LIMIT 1
);

-- Guard 1: AIMS must have a current manifest.
INSERT INTO `tmp_aims_system_role_seed_guard` (`check_name`, `passed`)
SELECT 'aims_manifest_exists', IF(@aims_manifest_id IS NOT NULL, 1, 0);

-- Guard 2: every seeded permission must exist in the current AIMS manifest.
-- If this fails, import/publish the latest AIMS manifest first, or run the post-check
-- query at the end separately to list the missing resource/action pairs.
INSERT INTO `tmp_aims_system_role_seed_guard` (`check_name`, `passed`)
SELECT
  'all_seed_actions_exist',
  IF(COUNT(*) = 0, 1, 0)
FROM `tmp_aims_system_role_permission_seed` seed
LEFT JOIN `platform_app_manifest_resource_actions` mra
  ON mra.manifest_id = @aims_manifest_id
 AND mra.app_code = 'aims'
 AND mra.resource_code = seed.resource_code
 AND mra.action = seed.action
 AND mra.status = 'active'
WHERE mra.id IS NULL;

INSERT INTO `platform_app_roles`
  (`role_code`, `role_name`, `role_type`, `app_code`, `description`, `is_required`, `status`, `created_at`, `updated_at`)
SELECT
  seed.role_code,
  seed.role_name,
  'system',
  'aims',
  seed.description,
  0,
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `tmp_aims_system_role_seed` seed
ON DUPLICATE KEY UPDATE
  `role_name` = VALUES(`role_name`),
  `role_type` = VALUES(`role_type`),
  `app_code` = VALUES(`app_code`),
  `description` = VALUES(`description`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

DELETE psrp
FROM `platform_app_role_permissions` psrp
INNER JOIN `platform_app_roles` psr
  ON psr.id = psrp.app_role_id
INNER JOIN `tmp_aims_system_role_seed` seed
  ON seed.role_code = psr.role_code
WHERE psr.app_code = 'aims';

INSERT INTO `platform_app_role_permissions`
  (`app_role_id`, `app_code`, `resource_code`, `action`, `manifest_action_id`, `created_at`)
SELECT
  psr.id,
  mra.app_code,
  mra.resource_code,
  mra.action,
  mra.id,
  UTC_TIMESTAMP()
FROM `tmp_aims_system_role_permission_seed` seed
INNER JOIN `platform_app_roles` psr
  ON psr.role_code = seed.role_code
 AND psr.app_code = 'aims'
INNER JOIN `platform_app_manifest_resource_actions` mra
  ON mra.manifest_id = @aims_manifest_id
 AND mra.app_code = 'aims'
 AND mra.resource_code = seed.resource_code
 AND mra.action = seed.action
 AND mra.status = 'active';

COMMIT;

-- Post-checks:
-- 1. If rows appear here, import/publish the AIMS manifest first or update this seed to match the current manifest.
SELECT
  seed.role_code,
  seed.resource_code,
  seed.action
FROM `tmp_aims_system_role_permission_seed` seed
LEFT JOIN `platform_app_manifest_resource_actions` mra
  ON mra.manifest_id = @aims_manifest_id
 AND mra.app_code = 'aims'
 AND mra.resource_code = seed.resource_code
 AND mra.action = seed.action
 AND mra.status = 'active'
WHERE mra.id IS NULL
ORDER BY seed.role_code, seed.resource_code, seed.action;

-- 2. Summary of seeded permissions by role.
SELECT
  psr.role_code,
  psr.role_name,
  psr.app_code,
  COUNT(psrp.id) AS permission_count
FROM `platform_app_roles` psr
LEFT JOIN `platform_app_role_permissions` psrp
  ON psrp.app_role_id = psr.id
WHERE psr.role_code IN (
  'aims.viewer',
  'aims.member',
  'aims.project_manager',
  'aims.portfolio_manager',
  'aims.admin'
)
GROUP BY psr.role_code, psr.role_name, psr.app_code
ORDER BY psr.role_code;

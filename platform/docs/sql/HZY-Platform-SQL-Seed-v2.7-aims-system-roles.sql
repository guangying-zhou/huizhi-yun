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
    ('aims:viewer', 'AIMS 只读', '查看分配给自己的项目与工作项'),
  ('aims:dev', 'AIMS 开发', '执行任务、提交工时、参与看板流转'),
  ('aims:member', 'AIMS 项目成员', '执行项目任务、提交工时、参与看板流转；用于替代历史 aims:dev 展示语义'),
  ('aims:pm', 'AIMS 项目经理', '管理项目计划、迭代、人员、工时审核和工作项确认；项目级管理范围主要由项目关系或授权范围决定，不默认获得全局项目管理员'),
  ('aims:pmo', 'AIMS PMO', '管理项目组合、跨项目交付质量、项目状态、工时审核和研发报表，不包含项目审批、应用后台配置或全局项目管理员'),
  ('aims:project_director', 'AIMS 项目总监', '独立审阅项目周报、发布公司汇总、处理 QA 豁免和里程碑完成审批，并管理全局项目与项目模板'),
  ('aims:qa', 'AIMS QA', '维护项目文档检查清单并对必交文档确定版本进行完整性与质量检查'),
  ('aims:project_approver', 'AIMS 项目审批', '处理立项、项目变更、验收和重大里程碑等项目审批'),
  ('aims:admin', 'AIMS 管理员', '创建项目并管理 AIMS 全局配置与项目模板'),
  ('aims:product_viewer', '产品观察者', '查看授权产品；企业角色须配置 product:member 或显式产品范围'),
  ('aims:product_contributor', '产品贡献者', '提交需求、补充证据和参与讨论；须配置产品成员范围'),
  ('aims:product_manager', '产品经理', '管理授权产品规划并负责验收；须配置 product:manager 范围，发布由独立发布者执行'),
  ('aims:product_director', '产品总监', '治理全租户产品目录、空间、成员、目标、优先级、路线图与版本计划；企业角色须显式配置 tenant:global 范围。验收与发布由独立职责执行，不授予永久删除权限。'),
  ('aims:product_publisher', '版本发布者', '独立发布与重新打开授权产品版本；须配置产品范围，不包含验收权');

-- Product-center templates projected from aims/app.manifest.json. No tenant assignment or scope is granted here.


INSERT INTO `tmp_aims_system_role_permission_seed`
  (`role_code`, `resource_code`, `action`)
VALUES
    ('aims:viewer', 'aims_overview', 'view'),
  ('aims:viewer', 'projects', 'view'),
  ('aims:viewer', 'requirements', 'view'),
  ('aims:viewer', 'work_items', 'view'),
  ('aims:viewer', 'board', 'view'),
  ('aims:viewer', 'timesheet', 'view'),
  ('aims:viewer', 'reports', 'view'),
  ('aims:dev', 'aims_overview', 'view'),
  ('aims:dev', 'projects', 'view'),
  ('aims:dev', 'requirements', 'view'),
  ('aims:dev', 'work_items', 'edit'),
  ('aims:dev', 'board', 'edit'),
  ('aims:dev', 'timesheet', 'submit'),
  ('aims:dev', 'weekly_reports', 'view'),
  ('aims:dev', 'notifications', 'view'),
  ('aims:member', 'aims_overview', 'view'),
  ('aims:member', 'projects', 'view'),
  ('aims:member', 'requirements', 'view'),
  ('aims:member', 'work_items', 'edit'),
  ('aims:member', 'board', 'edit'),
  ('aims:member', 'timesheet', 'submit'),
  ('aims:member', 'weekly_reports', 'view'),
  ('aims:member', 'notifications', 'view'),
  ('aims:pm', 'aims_overview', 'view'),
  ('aims:pm', 'portfolios', 'view'),
  ('aims:pm', 'projects', 'view'),
  ('aims:pm', 'projects', 'create'),
  ('aims:pm', 'projects', 'edit'),
  ('aims:pm', 'projects', 'close'),
  ('aims:pm', 'requirements', 'view'),
  ('aims:pm', 'requirements', 'edit'),
  ('aims:pm', 'work_items', 'view'),
  ('aims:pm', 'work_items', 'create'),
  ('aims:pm', 'work_items', 'edit'),
  ('aims:pm', 'work_items', 'delete'),
  ('aims:pm', 'work_items', 'assign'),
  ('aims:pm', 'work_items', 'confirm'),
  ('aims:pm', 'board', 'view'),
  ('aims:pm', 'board', 'edit'),
  ('aims:pm', 'timesheet', 'view'),
  ('aims:pm', 'timesheet', 'submit'),
  ('aims:pm', 'timesheet', 'approve'),
  ('aims:pm', 'weekly_reports', 'view'),
  ('aims:pm', 'weekly_reports', 'submit'),
  ('aims:pm', 'reports', 'view'),
  ('aims:pm', 'reports', 'export'),
  ('aims:pm', 'notifications', 'view'),
  ('aims:pmo', 'aims_overview', 'view'),
  ('aims:pmo', 'portfolios', 'view'),
  ('aims:pmo', 'portfolios', 'edit'),
  ('aims:pmo', 'portfolios', 'admin'),
  ('aims:pmo', 'projects', 'view'),
  ('aims:pmo', 'projects', 'create'),
  ('aims:pmo', 'projects', 'edit'),
  ('aims:pmo', 'projects', 'close'),
  ('aims:pmo', 'requirements', 'view'),
  ('aims:pmo', 'requirements', 'edit'),
  ('aims:pmo', 'work_items', 'view'),
  ('aims:pmo', 'board', 'view'),
  ('aims:pmo', 'timesheet', 'view'),
  ('aims:pmo', 'timesheet', 'approve'),
  ('aims:pmo', 'reports', 'view'),
  ('aims:pmo', 'reports', 'export'),
  ('aims:pmo', 'notifications', 'view'),
  ('aims:project_director', 'aims_overview', 'view'),
  ('aims:project_director', 'projects', 'view'),
  ('aims:project_director', 'projects', 'admin'),
  ('aims:project_director', 'requirements', 'view'),
  ('aims:project_director', 'requirements', 'edit'),
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
  ('aims:qa', 'requirements', 'view'),
  ('aims:qa', 'quality_reviews', 'view'),
  ('aims:qa', 'quality_reviews', 'review'),
  ('aims:qa', 'quality_reviews', 'configure'),
  ('aims:qa', 'notifications', 'view'),
  ('aims:project_approver', 'aims_overview', 'view'),
  ('aims:project_approver', 'projects', 'view'),
  ('aims:project_approver', 'projects', 'approve'),
  ('aims:project_approver', 'requirements', 'view'),
  ('aims:project_approver', 'reports', 'view'),
  ('aims:admin', 'aims_overview', 'view'),
  ('aims:admin', 'portfolios', 'admin'),
  ('aims:admin', 'projects', 'create'),
  ('aims:admin', 'projects', 'admin'),
  ('aims:admin', 'requirements', 'admin'),
  ('aims:admin', 'work_items', 'edit'),
  ('aims:admin', 'timesheet', 'admin'),
  ('aims:admin', 'reports', 'view'),
  ('aims:admin', 'reports', 'admin'),
  ('aims:admin', 'weekly_reports', 'configure'),
  ('aims:admin', 'project_templates', 'admin'),
  ('aims:admin', 'integration_operations', 'view'),
  ('aims:admin', 'integration_operations', 'replay'),
  ('aims:admin', 'admin', 'admin'),
  ('aims:product_viewer', 'products', 'view'),
  ('aims:product_viewer', 'product_requests', 'view'),
  ('aims:product_viewer', 'product_features', 'view'),
  ('aims:product_viewer', 'product_components', 'view'),
  ('aims:product_viewer', 'product_objectives', 'view'),
  ('aims:product_viewer', 'product_priorities', 'view'),
  ('aims:product_viewer', 'product_roadmaps', 'view'),
  ('aims:product_viewer', 'product_versions', 'view'),
  ('aims:product_viewer', 'product_documents', 'view'),
  ('aims:product_contributor', 'products', 'view'),
  ('aims:product_contributor', 'product_requests', 'view'),
  ('aims:product_contributor', 'product_features', 'view'),
  ('aims:product_contributor', 'product_components', 'view'),
  ('aims:product_contributor', 'product_objectives', 'view'),
  ('aims:product_contributor', 'product_priorities', 'view'),
  ('aims:product_contributor', 'product_roadmaps', 'view'),
  ('aims:product_contributor', 'product_versions', 'view'),
  ('aims:product_contributor', 'product_requests', 'create'),
  ('aims:product_contributor', 'product_requests', 'edit'),
  ('aims:product_contributor', 'product_priorities', 'comment'),
  ('aims:product_contributor', 'product_documents', 'view'),
  ('aims:product_manager', 'products', 'view'),
  ('aims:product_manager', 'product_requests', 'view'),
  ('aims:product_manager', 'product_features', 'view'),
  ('aims:product_manager', 'product_components', 'view'),
  ('aims:product_manager', 'product_objectives', 'view'),
  ('aims:product_manager', 'product_priorities', 'view'),
  ('aims:product_manager', 'product_roadmaps', 'view'),
  ('aims:product_manager', 'product_roadmaps', 'edit'),
  ('aims:product_manager', 'product_versions', 'view'),
  ('aims:product_manager', 'products', 'edit'),
  ('aims:product_manager', 'products', 'admin'),
  ('aims:product_manager', 'products', 'archive'),
  ('aims:product_manager', 'products', 'restore'),
  ('aims:product_manager', 'product_requests', 'create'),
  ('aims:product_manager', 'product_requests', 'edit'),
  ('aims:product_manager', 'product_requests', 'decide'),
  ('aims:product_manager', 'product_requests', 'handoff'),
  ('aims:product_manager', 'product_requests', 'delete'),
  ('aims:product_manager', 'product_features', 'edit'),
  ('aims:product_manager', 'product_components', 'edit'),
  ('aims:product_manager', 'product_objectives', 'edit'),
  ('aims:product_manager', 'product_objectives', 'observe'),
  ('aims:product_manager', 'product_objectives', 'activate'),
  ('aims:product_manager', 'product_objectives', 'close'),
  ('aims:product_manager', 'product_objectives', 'reopen'),
  ('aims:product_manager', 'product_objectives', 'archive'),
  ('aims:product_manager', 'product_components', 'delete'),
  ('aims:product_manager', 'product_features', 'delete'),
  ('aims:product_manager', 'product_priorities', 'edit'),
  ('aims:product_manager', 'product_priorities', 'assess'),
  ('aims:product_manager', 'product_priorities', 'prioritize'),
  ('aims:product_manager', 'product_priorities', 'handoff'),
  ('aims:product_manager', 'product_priorities', 'comment'),
  ('aims:product_manager', 'product_priorities', 'observe'),
  ('aims:product_manager', 'product_versions', 'edit'),
  ('aims:product_manager', 'product_versions', 'accept'),
  ('aims:product_manager', 'product_versions', 'archive'),
  ('aims:product_manager', 'product_versions', 'delete'),
  ('aims:product_manager', 'product_documents', 'view'),
  ('aims:product_manager', 'product_documents', 'edit'),
  ('aims:product_director', 'products', 'view'),
  ('aims:product_director', 'product_requests', 'view'),
  ('aims:product_director', 'product_features', 'view'),
  ('aims:product_director', 'product_components', 'view'),
  ('aims:product_director', 'product_objectives', 'view'),
  ('aims:product_director', 'product_priorities', 'view'),
  ('aims:product_director', 'product_roadmaps', 'view'),
  ('aims:product_director', 'product_roadmaps', 'edit'),
  ('aims:product_director', 'product_versions', 'view'),
  ('aims:product_director', 'products', 'onboard'),
  ('aims:product_director', 'products', 'edit'),
  ('aims:product_director', 'products', 'admin'),
  ('aims:product_director', 'products', 'archive'),
  ('aims:product_director', 'products', 'restore'),
  ('aims:product_director', 'product_requests', 'create'),
  ('aims:product_director', 'product_requests', 'edit'),
  ('aims:product_director', 'product_requests', 'decide'),
  ('aims:product_director', 'product_requests', 'handoff'),
  ('aims:product_director', 'product_features', 'edit'),
  ('aims:product_director', 'product_components', 'edit'),
  ('aims:product_director', 'product_objectives', 'edit'),
  ('aims:product_director', 'product_objectives', 'observe'),
  ('aims:product_director', 'product_objectives', 'activate'),
  ('aims:product_director', 'product_objectives', 'close'),
  ('aims:product_director', 'product_objectives', 'reopen'),
  ('aims:product_director', 'product_objectives', 'archive'),
  ('aims:product_director', 'product_priorities', 'edit'),
  ('aims:product_director', 'product_priorities', 'assess'),
  ('aims:product_director', 'product_priorities', 'prioritize'),
  ('aims:product_director', 'product_priorities', 'handoff'),
  ('aims:product_director', 'product_priorities', 'comment'),
  ('aims:product_director', 'product_priorities', 'observe'),
  ('aims:product_director', 'product_versions', 'edit'),
  ('aims:product_director', 'product_versions', 'archive'),
  ('aims:product_director', 'product_documents', 'view'),
  ('aims:product_director', 'product_documents', 'edit'),
  ('aims:product_publisher', 'products', 'view'),
  ('aims:product_publisher', 'product_versions', 'view'),
  ('aims:product_publisher', 'product_versions', 'publish'),
  ('aims:product_publisher', 'product_versions', 'reopen'),
  ('aims:product_publisher', 'product_documents', 'view');

-- Product-center action templates; actual product scopes are assigned separately.


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
  'aims:viewer',
  'aims:dev',
  'aims:member',
  'aims:pm',
  'aims:pmo',
  'aims:project_director',
  'aims:qa',
  'aims:project_approver',
  'aims:admin',
  'aims:product_viewer',
  'aims:product_contributor',
  'aims:product_manager',
  'aims:product_director',
  'aims:product_publisher'
)
GROUP BY psr.role_code, psr.role_name, psr.app_code
ORDER BY psr.role_code;

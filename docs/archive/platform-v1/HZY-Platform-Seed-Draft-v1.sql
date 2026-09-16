-- hzy_platform 第一版 Seed 草案
-- 目标：
-- 1. 预置系统级基础角色、应用、资源、模板
-- 2. 为 platform-sdk / platform-adapter-nuxt / AIMS 首条链路提供最小初始化数据
-- 3. 租户级 deployment / license / subject 初始化作为第二段模板执行
--
-- 说明：
-- - 本草案假设已执行 HZY-Platform-SQL-DDL-Draft-v1.sql
-- - 方言按 MySQL 8.0 编写
-- - 使用 tenant_code = NULL 作为系统级 seed
-- - 租户级初始化请替换文末模板中的占位符

USE `hzy_platform`;

-- ------------------------------------------------------------
-- Section A: 系统级应用
-- ------------------------------------------------------------

INSERT INTO `applications`
  (`tenant_code`, `app_code`, `app_name`, `description`, `app_type`, `runtime_mode`, `auth_mode`, `bundle_enabled`, `status`)
SELECT NULL, 'platform', '平台管理后台', 'hzy_platform 控制面管理后台', 'internal', 'managed', 'oidc', 1, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `applications` WHERE `tenant_code` IS NULL AND `app_code` = 'platform'
);

INSERT INTO `applications`
  (`tenant_code`, `app_code`, `app_name`, `description`, `app_type`, `runtime_mode`, `auth_mode`, `bundle_enabled`, `status`)
SELECT NULL, 'aims', 'AIMS', '研发项目与需求协作应用', 'internal', 'customer-hosted', 'oidc', 1, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `applications` WHERE `tenant_code` IS NULL AND `app_code` = 'aims'
);

INSERT INTO `applications`
  (`tenant_code`, `app_code`, `app_name`, `description`, `app_type`, `runtime_mode`, `auth_mode`, `bundle_enabled`, `status`)
SELECT NULL, 'codocs', 'Codocs', '文档协作应用', 'internal', 'customer-hosted', 'oidc', 1, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `applications` WHERE `tenant_code` IS NULL AND `app_code` = 'codocs'
);

-- ------------------------------------------------------------
-- Section B: 系统级资源
-- ------------------------------------------------------------

INSERT INTO `resources`
  (`tenant_code`, `app_code`, `resource_code`, `resource_name`, `description`, `sort_order`, `status`)
SELECT NULL, 'platform', 'tenants', '租户管理', '平台租户主实体管理', 5, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `resources` WHERE `tenant_code` IS NULL AND `app_code` = 'platform' AND `resource_code` = 'tenants'
);

INSERT INTO `resources`
  (`tenant_code`, `app_code`, `resource_code`, `resource_name`, `description`, `sort_order`, `status`)
SELECT NULL, 'platform', 'users', '用户管理', '平台用户主实体管理', 8, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `resources` WHERE `tenant_code` IS NULL AND `app_code` = 'platform' AND `resource_code` = 'users'
);

INSERT INTO `resources`
  (`tenant_code`, `app_code`, `resource_code`, `resource_name`, `description`, `sort_order`, `status`)
SELECT NULL, 'platform', 'subjects', '主体管理', '平台主体目录管理', 10, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `resources` WHERE `tenant_code` IS NULL AND `app_code` = 'platform' AND `resource_code` = 'subjects'
);

INSERT INTO `resources`
  (`tenant_code`, `app_code`, `resource_code`, `resource_name`, `description`, `sort_order`, `status`)
SELECT NULL, 'platform', 'roles', '角色管理', '平台角色与权限管理', 20, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `resources` WHERE `tenant_code` IS NULL AND `app_code` = 'platform' AND `resource_code` = 'roles'
);

INSERT INTO `resources`
  (`tenant_code`, `app_code`, `resource_code`, `resource_name`, `description`, `sort_order`, `status`)
SELECT NULL, 'platform', 'templates', '模板管理', '权限模板与绑定管理', 30, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `resources` WHERE `tenant_code` IS NULL AND `app_code` = 'platform' AND `resource_code` = 'templates'
);

INSERT INTO `resources`
  (`tenant_code`, `app_code`, `resource_code`, `resource_name`, `description`, `sort_order`, `status`)
SELECT NULL, 'platform', 'applications', '应用注册', '应用注册与 manifest 管理', 40, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `resources` WHERE `tenant_code` IS NULL AND `app_code` = 'platform' AND `resource_code` = 'applications'
);

INSERT INTO `resources`
  (`tenant_code`, `app_code`, `resource_code`, `resource_name`, `description`, `sort_order`, `status`)
SELECT NULL, 'platform', 'deployments', '部署管理', 'deployment / license / runtime 管理', 50, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `resources` WHERE `tenant_code` IS NULL AND `app_code` = 'platform' AND `resource_code` = 'deployments'
);

INSERT INTO `resources`
  (`tenant_code`, `app_code`, `resource_code`, `resource_name`, `description`, `sort_order`, `status`)
SELECT NULL, 'aims', 'projects', '项目管理', '项目查看与编辑', 10, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `resources` WHERE `tenant_code` IS NULL AND `app_code` = 'aims' AND `resource_code` = 'projects'
);

INSERT INTO `resources`
  (`tenant_code`, `app_code`, `resource_code`, `resource_name`, `description`, `sort_order`, `status`)
SELECT NULL, 'aims', 'requirements', '需求管理', '需求查看与编辑', 20, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `resources` WHERE `tenant_code` IS NULL AND `app_code` = 'aims' AND `resource_code` = 'requirements'
);

INSERT INTO `resources`
  (`tenant_code`, `app_code`, `resource_code`, `resource_name`, `description`, `sort_order`, `status`)
SELECT NULL, 'aims', 'work_items', '工作项管理', '工作项查看与编辑', 30, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `resources` WHERE `tenant_code` IS NULL AND `app_code` = 'aims' AND `resource_code` = 'work_items'
);

INSERT INTO `resources`
  (`tenant_code`, `app_code`, `resource_code`, `resource_name`, `description`, `sort_order`, `status`)
SELECT NULL, 'codocs', 'documents', '文档管理', '文档查看与编辑', 10, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `resources` WHERE `tenant_code` IS NULL AND `app_code` = 'codocs' AND `resource_code` = 'documents'
);

INSERT INTO `resources`
  (`tenant_code`, `app_code`, `resource_code`, `resource_name`, `description`, `sort_order`, `status`)
SELECT NULL, 'codocs', 'spaces', '空间管理', '文档空间与协作域管理', 20, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `resources` WHERE `tenant_code` IS NULL AND `app_code` = 'codocs' AND `resource_code` = 'spaces'
);

-- ------------------------------------------------------------
-- Section C: 系统级角色
-- ------------------------------------------------------------

INSERT INTO `roles`
  (`tenant_code`, `role_code`, `role_name`, `role_type`, `app_code`, `description`, `is_system`, `is_assignable`, `status`)
SELECT NULL, 'super_admin', '超级管理员', 'system', NULL, '平台超级管理员', 1, 0, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` WHERE `tenant_code` IS NULL AND `role_code` = 'super_admin'
);

INSERT INTO `roles`
  (`tenant_code`, `role_code`, `role_name`, `role_type`, `app_code`, `description`, `is_system`, `is_assignable`, `status`)
SELECT NULL, 'internal_user', '内部用户', 'base', NULL, '内部用户基础身份角色', 1, 1, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` WHERE `tenant_code` IS NULL AND `role_code` = 'internal_user'
);

INSERT INTO `roles`
  (`tenant_code`, `role_code`, `role_name`, `role_type`, `app_code`, `description`, `is_system`, `is_assignable`, `status`)
SELECT NULL, 'guest', '访客用户', 'base', NULL, '访客基础身份角色', 1, 1, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` WHERE `tenant_code` IS NULL AND `role_code` = 'guest'
);

INSERT INTO `roles`
  (`tenant_code`, `role_code`, `role_name`, `role_type`, `app_code`, `description`, `is_system`, `is_assignable`, `status`)
SELECT NULL, 'job:developer', '开发人员', 'job', NULL, '研发岗位标签角色', 1, 1, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` WHERE `tenant_code` IS NULL AND `role_code` = 'job:developer'
);

INSERT INTO `roles`
  (`tenant_code`, `role_code`, `role_name`, `role_type`, `app_code`, `description`, `is_system`, `is_assignable`, `status`)
SELECT NULL, 'platform:admin', '平台管理员', 'app', 'platform', '平台控制面管理角色', 1, 1, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` WHERE `tenant_code` IS NULL AND `role_code` = 'platform:admin'
);

INSERT INTO `roles`
  (`tenant_code`, `role_code`, `role_name`, `role_type`, `app_code`, `description`, `is_system`, `is_assignable`, `status`)
SELECT NULL, 'aims:member', 'AIMS 普通成员', 'app', 'aims', 'AIMS 普通成员角色', 1, 1, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` WHERE `tenant_code` IS NULL AND `role_code` = 'aims:member'
);

INSERT INTO `roles`
  (`tenant_code`, `role_code`, `role_name`, `role_type`, `app_code`, `description`, `is_system`, `is_assignable`, `status`)
SELECT NULL, 'aims:pm', 'AIMS 项目经理', 'app', 'aims', 'AIMS 项目经理角色', 1, 1, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` WHERE `tenant_code` IS NULL AND `role_code` = 'aims:pm'
);

INSERT INTO `roles`
  (`tenant_code`, `role_code`, `role_name`, `role_type`, `app_code`, `description`, `is_system`, `is_assignable`, `status`)
SELECT NULL, 'aims:admin', 'AIMS 管理员', 'app', 'aims', 'AIMS 管理员角色', 1, 1, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` WHERE `tenant_code` IS NULL AND `role_code` = 'aims:admin'
);

INSERT INTO `roles`
  (`tenant_code`, `role_code`, `role_name`, `role_type`, `app_code`, `description`, `is_system`, `is_assignable`, `status`)
SELECT NULL, 'codocs:member', 'Codocs 普通成员', 'app', 'codocs', 'Codocs 普通成员角色', 1, 1, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` WHERE `tenant_code` IS NULL AND `role_code` = 'codocs:member'
);

INSERT INTO `roles`
  (`tenant_code`, `role_code`, `role_name`, `role_type`, `app_code`, `description`, `is_system`, `is_assignable`, `status`)
SELECT NULL, 'codocs:editor', 'Codocs 编辑者', 'app', 'codocs', 'Codocs 编辑角色', 1, 1, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` WHERE `tenant_code` IS NULL AND `role_code` = 'codocs:editor'
);

INSERT INTO `roles`
  (`tenant_code`, `role_code`, `role_name`, `role_type`, `app_code`, `description`, `is_system`, `is_assignable`, `status`)
SELECT NULL, 'codocs:admin', 'Codocs 管理员', 'app', 'codocs', 'Codocs 管理员角色', 1, 1, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` WHERE `tenant_code` IS NULL AND `role_code` = 'codocs:admin'
);

-- ------------------------------------------------------------
-- Section D: 角色权限
-- ------------------------------------------------------------

INSERT INTO `role_permissions` (`tenant_code`, `role_id`, `resource_id`, `action`, `created_at`)
SELECT NULL, r.id, res.id, 'admin', NOW()
FROM `roles` r
JOIN `resources` res ON res.tenant_code IS NULL AND res.app_code = 'platform'
WHERE r.tenant_code IS NULL
  AND r.role_code IN ('super_admin', 'platform:admin')
  AND NOT EXISTS (
    SELECT 1
    FROM `role_permissions` rp
    WHERE rp.role_id = r.id AND rp.resource_id = res.id AND rp.action = 'admin'
  );

INSERT INTO `role_permissions` (`tenant_code`, `role_id`, `resource_id`, `action`, `created_at`)
SELECT NULL, r.id, res.id, 'view', NOW()
FROM `roles` r
JOIN `resources` res ON res.tenant_code IS NULL AND res.app_code = 'aims'
WHERE r.tenant_code IS NULL
  AND r.role_code = 'aims:member'
  AND NOT EXISTS (
    SELECT 1
    FROM `role_permissions` rp
    WHERE rp.role_id = r.id AND rp.resource_id = res.id AND rp.action = 'view'
  );

INSERT INTO `role_permissions` (`tenant_code`, `role_id`, `resource_id`, `action`, `created_at`)
SELECT NULL, r.id, res.id, 'edit', NOW()
FROM `roles` r
JOIN `resources` res ON res.tenant_code IS NULL AND res.app_code = 'aims'
WHERE r.tenant_code IS NULL
  AND r.role_code = 'aims:pm'
  AND NOT EXISTS (
    SELECT 1
    FROM `role_permissions` rp
    WHERE rp.role_id = r.id AND rp.resource_id = res.id AND rp.action = 'edit'
  );

INSERT INTO `role_permissions` (`tenant_code`, `role_id`, `resource_id`, `action`, `created_at`)
SELECT NULL, r.id, res.id, 'admin', NOW()
FROM `roles` r
JOIN `resources` res ON res.tenant_code IS NULL AND res.app_code = 'aims'
WHERE r.tenant_code IS NULL
  AND r.role_code = 'aims:admin'
  AND NOT EXISTS (
    SELECT 1
    FROM `role_permissions` rp
    WHERE rp.role_id = r.id AND rp.resource_id = res.id AND rp.action = 'admin'
  );

INSERT INTO `role_permissions` (`tenant_code`, `role_id`, `resource_id`, `action`, `created_at`)
SELECT NULL, r.id, res.id, 'view', NOW()
FROM `roles` r
JOIN `resources` res ON res.tenant_code IS NULL AND res.app_code = 'codocs'
WHERE r.tenant_code IS NULL
  AND r.role_code = 'codocs:member'
  AND NOT EXISTS (
    SELECT 1
    FROM `role_permissions` rp
    WHERE rp.role_id = r.id AND rp.resource_id = res.id AND rp.action = 'view'
  );

INSERT INTO `role_permissions` (`tenant_code`, `role_id`, `resource_id`, `action`, `created_at`)
SELECT NULL, r.id, res.id, 'edit', NOW()
FROM `roles` r
JOIN `resources` res ON res.tenant_code IS NULL AND res.app_code = 'codocs'
WHERE r.tenant_code IS NULL
  AND r.role_code = 'codocs:editor'
  AND NOT EXISTS (
    SELECT 1
    FROM `role_permissions` rp
    WHERE rp.role_id = r.id AND rp.resource_id = res.id AND rp.action = 'edit'
  );

INSERT INTO `role_permissions` (`tenant_code`, `role_id`, `resource_id`, `action`, `created_at`)
SELECT NULL, r.id, res.id, 'admin', NOW()
FROM `roles` r
JOIN `resources` res ON res.tenant_code IS NULL AND res.app_code = 'codocs'
WHERE r.tenant_code IS NULL
  AND r.role_code = 'codocs:admin'
  AND NOT EXISTS (
    SELECT 1
    FROM `role_permissions` rp
    WHERE rp.role_id = r.id AND rp.resource_id = res.id AND rp.action = 'admin'
  );

-- ------------------------------------------------------------
-- Section E: 默认 scope
-- ------------------------------------------------------------

INSERT INTO `role_scopes`
  (`tenant_code`, `role_id`, `resource_id`, `action`, `scope_type`, `scope_value`, `status`, `created_at`, `updated_at`)
SELECT NULL, r.id, res.id, 'view', 'relation', 'project_member', 'active', NOW(), NOW()
FROM `roles` r
JOIN `resources` res ON res.tenant_code IS NULL AND res.app_code = 'aims'
WHERE r.tenant_code IS NULL
  AND r.role_code = 'aims:member'
  AND NOT EXISTS (
    SELECT 1
    FROM `role_scopes` rs
    WHERE rs.role_id = r.id
      AND rs.resource_id = res.id
      AND rs.action = 'view'
      AND rs.scope_type = 'relation'
      AND rs.scope_value = 'project_member'
  );

INSERT INTO `role_scopes`
  (`tenant_code`, `role_id`, `resource_id`, `action`, `scope_type`, `scope_value`, `status`, `created_at`, `updated_at`)
SELECT NULL, r.id, res.id, 'edit', 'relation', 'project_member', 'active', NOW(), NOW()
FROM `roles` r
JOIN `resources` res ON res.tenant_code IS NULL AND res.app_code = 'aims'
WHERE r.tenant_code IS NULL
  AND r.role_code = 'aims:pm'
  AND NOT EXISTS (
    SELECT 1
    FROM `role_scopes` rs
    WHERE rs.role_id = r.id
      AND rs.resource_id = res.id
      AND rs.action = 'edit'
      AND rs.scope_type = 'relation'
      AND rs.scope_value = 'project_member'
  );

INSERT INTO `role_scopes`
  (`tenant_code`, `role_id`, `resource_id`, `action`, `scope_type`, `scope_value`, `status`, `created_at`, `updated_at`)
SELECT NULL, r.id, res.id, 'admin', 'all', 'all', 'active', NOW(), NOW()
FROM `roles` r
JOIN `resources` res ON res.tenant_code IS NULL AND res.app_code IN ('aims', 'platform', 'codocs')
WHERE r.tenant_code IS NULL
  AND r.role_code IN ('super_admin', 'platform:admin', 'aims:admin', 'codocs:admin')
  AND NOT EXISTS (
    SELECT 1
    FROM `role_scopes` rs
    WHERE rs.role_id = r.id
      AND rs.resource_id = res.id
      AND rs.action = 'admin'
      AND rs.scope_type = 'all'
      AND rs.scope_value = 'all'
  );

-- ------------------------------------------------------------
-- Section F: 系统级模板
-- ------------------------------------------------------------

INSERT INTO `permission_templates`
  (`tenant_code`, `template_code`, `template_name`, `template_type`, `description`, `status`, `sort_order`, `created_at`, `updated_at`)
SELECT NULL, 'tpl:rd_staff', '研发员工模板', 'job', '研发岗位默认角色组合', 'active', 10, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `permission_templates` WHERE `tenant_code` IS NULL AND `template_code` = 'tpl:rd_staff'
);

INSERT INTO `permission_templates`
  (`tenant_code`, `template_code`, `template_name`, `template_type`, `description`, `status`, `sort_order`, `created_at`, `updated_at`)
SELECT NULL, 'tpl:aims_pm', 'AIMS 项目经理模板', 'duty', 'AIMS 项目经理标准角色组合', 'active', 20, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `permission_templates` WHERE `tenant_code` IS NULL AND `template_code` = 'tpl:aims_pm'
);

INSERT INTO `permission_templates`
  (`tenant_code`, `template_code`, `template_name`, `template_type`, `description`, `status`, `sort_order`, `created_at`, `updated_at`)
SELECT NULL, 'tpl:codocs_editor', 'Codocs 编辑模板', 'duty', 'Codocs 编辑者标准角色组合', 'active', 30, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `permission_templates` WHERE `tenant_code` IS NULL AND `template_code` = 'tpl:codocs_editor'
);

INSERT INTO `template_roles` (`tenant_code`, `template_id`, `role_id`, `sort_order`, `created_at`)
SELECT NULL, t.id, r.id, x.sort_order, NOW()
FROM (
  SELECT 'tpl:rd_staff' AS template_code, 'internal_user' AS role_code, 10 AS sort_order
  UNION ALL SELECT 'tpl:rd_staff', 'job:developer', 20
  UNION ALL SELECT 'tpl:rd_staff', 'aims:member', 30
  UNION ALL SELECT 'tpl:aims_pm', 'internal_user', 10
  UNION ALL SELECT 'tpl:aims_pm', 'aims:pm', 20
  UNION ALL SELECT 'tpl:codocs_editor', 'internal_user', 10
  UNION ALL SELECT 'tpl:codocs_editor', 'codocs:editor', 20
) x
JOIN `permission_templates` t ON t.tenant_code IS NULL AND t.template_code = x.template_code
JOIN `roles` r ON r.tenant_code IS NULL AND r.role_code = x.role_code
WHERE NOT EXISTS (
  SELECT 1 FROM `template_roles` tr WHERE tr.template_id = t.id AND tr.role_id = r.id
);

-- ------------------------------------------------------------
-- Section G: 租户初始化模板（需要替换占位符后执行）
-- ------------------------------------------------------------
-- 说明：
-- 1. 以下语句默认注释，不直接执行
-- 2. 请替换 __TENANT_CODE__ / __DEPLOYMENT_CODE__ / __LICENSE_CODE__
-- 3. 租户级 user / department / job 主体可从 Identity Plane 同步流程中创建

-- INSERT INTO `tenants`
--   (`tenant_code`, `tenant_name`, `display_name`, `tenant_type`, `status`, `default_auth_mode`, `default_deployment_mode`, `created_at`, `updated_at`)
-- VALUES
--   ('__TENANT_CODE__', '__TENANT_NAME__', '__TENANT_DISPLAY_NAME__', 'enterprise', 'active', 'oidc', 'managed-control-plane', NOW(), NOW());

-- INSERT INTO `deployments`
--   (`tenant_code`, `deployment_code`, `deployment_name`, `deployment_mode`, `status`, `license_status`, `created_at`, `updated_at`)
-- VALUES
--   ('__TENANT_CODE__', '__DEPLOYMENT_CODE__', '__TENANT_CODE__ 生产部署', 'managed-control-plane', 'active', 'active', NOW(), NOW());

-- INSERT INTO `licenses`
--   (`tenant_code`, `deployment_id`, `license_code`, `plan_code`, `status`, `issued_at`, `expires_at`, `payload_hash`, `created_at`, `updated_at`)
-- SELECT
--   '__TENANT_CODE__',
--   d.id,
--   '__LICENSE_CODE__',
--   'enterprise',
--   'active',
--   NOW(),
--   DATE_ADD(NOW(), INTERVAL 365 DAY),
--   'TODO_REPLACE_WITH_REAL_HASH',
--   NOW(),
--   NOW()
-- FROM `deployments` d
-- WHERE d.tenant_code = '__TENANT_CODE__' AND d.deployment_code = '__DEPLOYMENT_CODE__';

-- INSERT INTO `license_capabilities`
--   (`tenant_code`, `license_id`, `capability_code`, `capability_value`, `created_at`)
-- SELECT '__TENANT_CODE__', l.id, 'aims_enabled', 'true', NOW()
-- FROM `licenses` l
-- WHERE l.tenant_code = '__TENANT_CODE__' AND l.license_code = '__LICENSE_CODE__';

-- INSERT INTO `users`
--   (`tenant_code`, `uid`, `username`, `display_name`, `email`, `status`, `source_type`, `created_at`, `updated_at`)
-- VALUES
--   ('__TENANT_CODE__', '__ADMIN_UID__', '__ADMIN_USERNAME__', '__ADMIN_DISPLAY_NAME__', '__ADMIN_EMAIL__', 'active', 'manual', NOW(), NOW());

-- INSERT INTO `subjects`
--   (`tenant_code`, `user_id`, `subject_type`, `subject_code`, `display_name`, `status`, `created_at`, `updated_at`)
-- SELECT
--   '__TENANT_CODE__',
--   u.id,
--   'user',
--   '__ADMIN_UID__',
--   '__ADMIN_DISPLAY_NAME__',
--   'active',
--   NOW(),
--   NOW()
-- FROM `users` u
-- WHERE u.tenant_code = '__TENANT_CODE__' AND u.uid = '__ADMIN_UID__';

-- INSERT INTO `subjects`
--   (`tenant_code`, `subject_type`, `subject_code`, `display_name`, `status`, `created_at`, `updated_at`)
-- VALUES
--   ('__TENANT_CODE__', 'job', 'job:developer', '开发人员', 'active', NOW(), NOW());

-- INSERT INTO `template_bindings`
--   (`tenant_code`, `template_id`, `subject_type`, `subject_id`, `priority`, `status`, `created_at`, `updated_at`)
-- SELECT
--   '__TENANT_CODE__',
--   t.id,
--   'job',
--   s.id,
--   100,
--   'active',
--   NOW(),
--   NOW()
-- FROM `permission_templates` t
-- JOIN `subjects` s ON s.tenant_code = '__TENANT_CODE__' AND s.subject_type = 'job' AND s.subject_code = 'job:developer'
-- WHERE t.tenant_code IS NULL AND t.template_code = 'tpl:rd_staff';

-- ------------------------------------------------------------
-- Section H: 校验查询（可选）
-- ------------------------------------------------------------

-- SELECT app_code, COUNT(*) AS resource_count
-- FROM `resources`
-- WHERE tenant_code IS NULL
-- GROUP BY app_code
-- ORDER BY app_code;

-- SELECT role_code, role_type, app_code
-- FROM `roles`
-- WHERE tenant_code IS NULL
-- ORDER BY role_type, role_code;

-- SELECT template_code, template_type
-- FROM `permission_templates`
-- WHERE tenant_code IS NULL
-- ORDER BY sort_order, template_code;

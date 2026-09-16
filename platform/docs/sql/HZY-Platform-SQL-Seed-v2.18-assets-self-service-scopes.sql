-- HZY Platform seed v2.18: Assets employee self-service permissions and object scopes
--
-- Preconditions:
--   1. HZY Platform v2.15+ enterprise-role schema is present.
--   2. The latest Assets manifest has been imported and declares assignments:request.
--
-- Result:
--   - assets:employee can see only asset:user related dashboard/assets/operations/alerts.
--   - assets:requester can see and create only subject:self assignment requests.
--   - neither role receives assignments:edit/approve/admin.
--   - affected role policy snapshots are invalidated; the Platform application flow must
--     run refreshSystemRolePolicySnapshot and regenerate tenant policy bundles afterwards.
--
-- Re-runnable: desired permissions/scopes are upserted and only the owned scope rows are replaced.

START TRANSACTION;

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_assets_self_service_policy` (
  `role_code` VARCHAR(128) NOT NULL,
  `resource_code` VARCHAR(128) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `scope_type` VARCHAR(32) NOT NULL,
  `scope_value` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`role_code`, `resource_code`, `action`, `scope_type`, `scope_value`)
) ENGINE=Memory;

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_assets_self_service_guard` (
  `check_name` VARCHAR(64) NOT NULL PRIMARY KEY,
  `passed` TINYINT NOT NULL,
  CONSTRAINT `chk_tmp_assets_self_service_guard_passed` CHECK (`passed` = 1)
) ENGINE=Memory;

TRUNCATE TABLE `tmp_assets_self_service_policy`;
TRUNCATE TABLE `tmp_assets_self_service_guard`;

INSERT INTO `tmp_assets_self_service_policy`
  (`role_code`, `resource_code`, `action`, `scope_type`, `scope_value`)
VALUES
  ('assets:employee', 'dashboard',   'view',    'asset',   'user'),
  ('assets:employee', 'asset_items', 'view',    'asset',   'user'),
  ('assets:employee', 'assignments', 'view',    'asset',   'user'),
  ('assets:employee', 'assignments', 'request', 'asset',   'user'),
  ('assets:employee', 'alerts',      'view',    'asset',   'user'),
  ('assets:requester', 'assignments', 'view',    'subject', 'self'),
  ('assets:requester', 'assignments', 'request', 'subject', 'self');

-- Fail closed when the manifest/role import has not completed.
INSERT INTO `tmp_assets_self_service_guard` (`check_name`, `passed`)
SELECT 'app_roles_exist', CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM (
  SELECT DISTINCT desired.role_code
  FROM `tmp_assets_self_service_policy` desired
  LEFT JOIN `platform_app_roles` role
    ON role.role_code = desired.role_code
   AND role.app_code = 'assets'
   AND role.status = 'active'
  WHERE role.id IS NULL
) missing;

INSERT INTO `tmp_assets_self_service_guard` (`check_name`, `passed`)
SELECT 'manifest_actions_exist', CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM (
  SELECT DISTINCT desired.resource_code, desired.action
  FROM `tmp_assets_self_service_policy` desired
  LEFT JOIN `platform_app_manifest_resource_actions` manifest_action
    ON manifest_action.app_code = 'assets'
   AND manifest_action.resource_code = desired.resource_code
   AND manifest_action.action = desired.action
  WHERE manifest_action.id IS NULL
) missing;

-- Remove maintenance/approval powers from end-user roles even when an older manifest
-- materialization left stale rows behind.
DELETE permission
FROM `platform_app_role_permissions` permission
INNER JOIN `platform_app_roles` role
  ON role.id = permission.app_role_id
WHERE role.role_code IN ('assets:employee', 'assets:requester')
  AND permission.app_code = 'assets'
  AND permission.resource_code = 'assignments'
  AND permission.action IN ('edit', 'approve', 'admin');

INSERT INTO `platform_app_role_permissions`
  (`app_role_id`, `app_code`, `resource_code`, `action`, `manifest_action_id`, `created_at`)
SELECT role.id, 'assets', desired.resource_code, desired.action, manifest_action.id, UTC_TIMESTAMP()
FROM `tmp_assets_self_service_policy` desired
INNER JOIN `platform_app_roles` role
  ON role.role_code = desired.role_code
 AND role.app_code = 'assets'
 AND role.status = 'active'
INNER JOIN `platform_app_manifest_resource_actions` manifest_action
  ON manifest_action.app_code = 'assets'
 AND manifest_action.resource_code = desired.resource_code
 AND manifest_action.action = desired.action
ON DUPLICATE KEY UPDATE
  manifest_action_id = VALUES(manifest_action_id);

DELETE scope
FROM `platform_app_role_scopes` scope
INNER JOIN `platform_app_roles` role
  ON role.id = scope.app_role_id
INNER JOIN `tmp_assets_self_service_policy` desired
  ON desired.role_code = role.role_code
 AND desired.resource_code = scope.resource_code
 AND desired.action = scope.action
WHERE scope.app_code = 'assets';

INSERT INTO `platform_app_role_scopes`
  (`app_role_id`, `app_code`, `resource_code`, `action`, `manifest_action_id`,
   `scope_type`, `scope_value`, `status`, `created_at`, `updated_at`)
SELECT role.id, 'assets', desired.resource_code, desired.action, manifest_action.id,
       desired.scope_type, desired.scope_value, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM `tmp_assets_self_service_policy` desired
INNER JOIN `platform_app_roles` role
  ON role.role_code = desired.role_code
 AND role.app_code = 'assets'
 AND role.status = 'active'
INNER JOIN `platform_app_manifest_resource_actions` manifest_action
  ON manifest_action.app_code = 'assets'
 AND manifest_action.resource_code = desired.resource_code
 AND manifest_action.action = desired.action
ON DUPLICATE KEY UPDATE
  manifest_action_id = VALUES(manifest_action_id),
  status = 'active',
  updated_at = UTC_TIMESTAMP();

UPDATE `platform_app_roles`
SET policy_revision = policy_revision + 1,
    policy_hash = NULL,
    policy_updated_at = UTC_TIMESTAMP(),
    updated_at = UTC_TIMESTAMP()
WHERE role_code IN ('assets:employee', 'assets:requester');

UPDATE `platform_system_roles` system_role
INNER JOIN `platform_system_app_role_maps` role_map
  ON role_map.system_role_id = system_role.id
SET system_role.policy_revision = system_role.policy_revision + 1,
    system_role.policy_hash = NULL,
    system_role.policy_updated_at = UTC_TIMESTAMP(),
    system_role.updated_at = UTC_TIMESTAMP()
WHERE role_map.app_role_code IN ('assets:employee', 'assets:requester');

UPDATE `tenant_roles` tenant_role
INNER JOIN `tenant_role_app_role_maps` role_map
  ON role_map.tenant_code = tenant_role.tenant_code
 AND role_map.role_id = tenant_role.id
SET tenant_role.source_policy_hash = NULL,
    tenant_role.effective_policy_hash = NULL,
    tenant_role.policy_revision = tenant_role.policy_revision + 1,
    tenant_role.policy_updated_at = UTC_TIMESTAMP(),
    tenant_role.updated_at = UTC_TIMESTAMP()
WHERE role_map.app_role_code IN ('assets:employee', 'assets:requester');

COMMIT;

SELECT role.role_code, permission.resource_code, permission.action,
       scope.scope_type, scope.scope_value, scope.status
FROM `platform_app_roles` role
INNER JOIN `platform_app_role_permissions` permission
  ON permission.app_role_id = role.id
LEFT JOIN `platform_app_role_scopes` scope
  ON scope.app_role_id = permission.app_role_id
 AND scope.app_code = permission.app_code
 AND scope.resource_code = permission.resource_code
 AND scope.action = permission.action
WHERE role.role_code IN ('assets:employee', 'assets:requester')
ORDER BY role.role_code, permission.resource_code, permission.action;

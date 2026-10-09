-- Wiztek role governance remediation (2026-07-16)
-- Tenant: C000001
--
-- Scope:
--   1. Replace the six audited P0 enterprise-role compositions in both the
--      platform template catalog and the non-overridden Wiztek tenant roles.
--   2. Add assignment-bound P1 data scopes for the current sales specialist,
--      sales manager, department managers, and deputy general managers.
--
-- Re-runnable. The guard statements fail closed if the expected roles,
-- app roles, holders, or assignment shape drift before execution.
-- Generate a new prod policy bundle only after this transaction commits.

START TRANSACTION;

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_wiztek_p0_role_map` (
  `role_code` VARCHAR(128) NOT NULL,
  `app_role_code` VARCHAR(128) NOT NULL,
  `sort_order` INT NOT NULL,
  PRIMARY KEY (`role_code`, `app_role_code`)
) ENGINE=Memory;

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_wiztek_p1_assignment_scope` (
  `role_code` VARCHAR(128) NOT NULL,
  `subject_code` VARCHAR(128) NOT NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `scope_dimension` VARCHAR(64) NOT NULL,
  `scope_predicate` VARCHAR(64) NOT NULL,
  `scope_value` VARCHAR(255) NULL,
  UNIQUE KEY `uk_tmp_wiztek_p1_assignment_scope`
    (`role_code`, `subject_code`, `app_code`, `scope_dimension`, `scope_predicate`)
) ENGINE=Memory;

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_wiztek_role_audit_guard` (
  `check_name` VARCHAR(96) NOT NULL PRIMARY KEY,
  `passed` TINYINT NOT NULL,
  CONSTRAINT `chk_tmp_wiztek_role_audit_guard_passed` CHECK (`passed` = 1)
) ENGINE=Memory;

TRUNCATE TABLE `tmp_wiztek_p0_role_map`;
TRUNCATE TABLE `tmp_wiztek_p1_assignment_scope`;
TRUNCATE TABLE `tmp_wiztek_role_audit_guard`;

INSERT INTO `tmp_wiztek_p0_role_map`
  (`role_code`, `app_role_code`, `sort_order`)
VALUES
  ('general_manager', 'console:viewer', 10),
  ('general_manager', 'workflow:viewer', 20),
  ('general_manager', 'codocs:viewer', 30),
  ('general_manager', 'aims:viewer', 40),
  ('general_manager', 'altoc:viewer', 50),
  ('general_manager', 'assets:viewer', 60),
  ('general_manager', 'finance:viewer', 70),
  ('general_manager', 'insights:viewer', 80),
  ('general_manager', 'people:viewer', 90),
  ('general_manager', 'workflow:approver', 100),

  ('project_director', 'aims:pmo', 10),
  ('project_director', 'aims:project_approver', 20),
  ('project_director', 'aims:viewer', 30),
  ('project_director', 'workflow:approver', 40),
  ('project_director', 'codocs:viewer', 50),

  ('hr_director', 'console:directory_operator', 10),
  ('hr_director', 'workflow:approver', 20),
  ('hr_director', 'codocs:viewer', 30),
  ('hr_director', 'people:manager', 40),
  ('hr_director', 'people:approver', 50),

  ('hr_specialist', 'workflow:approver', 10),
  ('hr_specialist', 'codocs:editor', 20),
  ('hr_specialist', 'people:specialist', 30),

  ('department_manager', 'assets:owner', 10),
  ('department_manager', 'finance:expense_approver', 20),
  ('department_manager', 'workflow:approver', 30),

  ('procurement_asset_manager', 'assets:procurement', 10),
  ('procurement_asset_manager', 'assets:inventory_manager', 20),
  ('procurement_asset_manager', 'assets:viewer', 30),
  ('procurement_asset_manager', 'workflow:approver', 40),
  ('procurement_asset_manager', 'finance:viewer', 50);

-- Current holder scopes. Department values are the audited managed roots:
-- primary department where present, otherwise the holder's single active
-- business department. App-level rows cover every permission grant from the
-- corresponding role in that business app while leaving Console, Codocs, and
-- Workflow relation-based access independent.
INSERT INTO `tmp_wiztek_p1_assignment_scope`
  (`role_code`, `subject_code`, `app_code`, `scope_dimension`, `scope_predicate`, `scope_value`)
VALUES
  ('sales_specialist', 'zhangjinzhi', 'altoc', 'subject', 'self', NULL),
  ('sales_manager', 'chenzhongzhong', 'altoc', 'department', 'tree', 'MC'),

  ('department_manager', 'liuxianmei', 'assets', 'department', 'tree', 'AF'),
  ('department_manager', 'liuxianmei', 'finance', 'department', 'tree', 'AF'),
  ('department_manager', 'renjianwei', 'assets', 'department', 'tree', 'HFZX'),
  ('department_manager', 'renjianwei', 'finance', 'department', 'tree', 'HFZX'),
  ('department_manager', 'wangcheng', 'assets', 'department', 'tree', 'SP'),
  ('department_manager', 'wangcheng', 'finance', 'department', 'tree', 'SP'),
  ('department_manager', 'wangmin', 'assets', 'department', 'tree', 'GMO'),
  ('department_manager', 'wangmin', 'finance', 'department', 'tree', 'GMO'),
  ('department_manager', 'wangzhuang', 'assets', 'department', 'tree', 'SDC'),
  ('department_manager', 'wangzhuang', 'finance', 'department', 'tree', 'SDC'),
  ('department_manager', 'yangtao', 'assets', 'department', 'tree', 'GMO'),
  ('department_manager', 'yangtao', 'finance', 'department', 'tree', 'GMO'),

  ('deputy_general_manager', 'caoqian', 'aims', 'department', 'tree', 'RD'),
  ('deputy_general_manager', 'caoqian', 'altoc', 'department', 'tree', 'RD'),
  ('deputy_general_manager', 'caoqian', 'assets', 'department', 'tree', 'RD'),
  ('deputy_general_manager', 'caoqian', 'finance', 'department', 'tree', 'RD'),
  ('deputy_general_manager', 'caoqian', 'people', 'department', 'tree', 'RD'),
  ('deputy_general_manager', 'xuxueying', 'aims', 'department', 'tree', 'GMO'),
  ('deputy_general_manager', 'xuxueying', 'altoc', 'department', 'tree', 'GMO'),
  ('deputy_general_manager', 'xuxueying', 'assets', 'department', 'tree', 'GMO'),
  ('deputy_general_manager', 'xuxueying', 'finance', 'department', 'tree', 'GMO'),
  ('deputy_general_manager', 'xuxueying', 'people', 'department', 'tree', 'GMO');

-- Guard: every referenced application role is active.
INSERT INTO `tmp_wiztek_role_audit_guard` (`check_name`, `passed`)
SELECT 'p0_app_roles_active', CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM `tmp_wiztek_p0_role_map` expected
LEFT JOIN `platform_app_roles` app_role
  ON app_role.role_code = expected.app_role_code
 AND app_role.status = 'active'
WHERE app_role.id IS NULL;

-- Guard: all six global templates exist and remain active.
INSERT INTO `tmp_wiztek_role_audit_guard` (`check_name`, `passed`)
SELECT 'p0_system_roles_active', CASE WHEN COUNT(*) = 6 THEN 1 ELSE 0 END
FROM `platform_system_roles`
WHERE role_code IN (
  'general_manager', 'project_director', 'hr_director', 'hr_specialist',
  'department_manager', 'procurement_asset_manager'
) AND status = 'active';

-- Guard: all six Wiztek roles are still non-overridden materializations of
-- the corresponding system template.
INSERT INTO `tmp_wiztek_role_audit_guard` (`check_name`, `passed`)
SELECT 'p0_tenant_roles_syncable', CASE WHEN COUNT(*) = 6 THEN 1 ELSE 0 END
FROM `tenant_roles`
WHERE tenant_code = 'C000001'
  AND role_code IN (
    'general_manager', 'project_director', 'hr_director', 'hr_specialist',
    'department_manager', 'procurement_asset_manager'
  )
  AND source = 'system'
  AND source_role_code = role_code
  AND is_overridden = 0
  AND is_assignable = 1
  AND status = 'active';

-- Guard: the assignment roster has not drifted. This prevents a newly added
-- holder from receiving an unscoped role when this script is rerun.
INSERT INTO `tmp_wiztek_role_audit_guard` (`check_name`, `passed`)
SELECT 'p1_assignment_roster_exact', CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM (
  SELECT DISTINCT role.role_code, subject.subject_code
  FROM `tenant_subject_roles` assignment
  INNER JOIN `tenant_roles` role
    ON role.id = assignment.role_id
   AND role.tenant_code = assignment.tenant_code
  INNER JOIN `tenant_subjects` subject
    ON subject.id = assignment.subject_id
   AND subject.tenant_code = assignment.tenant_code
  WHERE assignment.tenant_code = 'C000001'
    AND assignment.status = 'active'
    AND (assignment.starts_at IS NULL OR assignment.starts_at <= UTC_TIMESTAMP())
    AND (assignment.expired_at IS NULL OR assignment.expired_at > UTC_TIMESTAMP())
    AND role.role_code IN (
      'sales_specialist', 'sales_manager', 'department_manager',
      'deputy_general_manager'
    )
) actual
LEFT JOIN (
  SELECT DISTINCT role_code, subject_code
  FROM `tmp_wiztek_p1_assignment_scope`
) expected
  ON expected.role_code = actual.role_code
 AND expected.subject_code = actual.subject_code
WHERE expected.role_code IS NULL;

INSERT INTO `tmp_wiztek_role_audit_guard` (`check_name`, `passed`)
SELECT 'p1_expected_assignments_active', CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM (
  SELECT DISTINCT role_code, subject_code
  FROM `tmp_wiztek_p1_assignment_scope`
) expected
LEFT JOIN (
  SELECT DISTINCT role.role_code, subject.subject_code
  FROM `tenant_subject_roles` assignment
  INNER JOIN `tenant_roles` role
    ON role.id = assignment.role_id
   AND role.tenant_code = assignment.tenant_code
  INNER JOIN `tenant_subjects` subject
    ON subject.id = assignment.subject_id
   AND subject.tenant_code = assignment.tenant_code
  WHERE assignment.tenant_code = 'C000001'
    AND assignment.status = 'active'
    AND (assignment.starts_at IS NULL OR assignment.starts_at <= UTC_TIMESTAMP())
    AND (assignment.expired_at IS NULL OR assignment.expired_at > UTC_TIMESTAMP())
) actual
  ON actual.role_code = expected.role_code
 AND actual.subject_code = expected.subject_code
WHERE actual.role_code IS NULL;

-- Guard: every explicit department root exists as an active department.
INSERT INTO `tmp_wiztek_role_audit_guard` (`check_name`, `passed`)
SELECT 'p1_department_roots_active', CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM (
  SELECT DISTINCT scope_value
  FROM `tmp_wiztek_p1_assignment_scope`
  WHERE scope_dimension = 'department'
    AND scope_value IS NOT NULL
) expected
LEFT JOIN `tenant_subjects` department
  ON department.tenant_code = 'C000001'
 AND department.subject_type = 'department'
 AND department.subject_code = expected.scope_value
 AND department.status = 'active'
WHERE department.id IS NULL;

-- P0: replace the six platform template compositions.
DELETE system_map
FROM `platform_system_app_role_maps` system_map
INNER JOIN `platform_system_roles` system_role
  ON system_role.id = system_map.system_role_id
WHERE system_role.role_code IN (
  'general_manager', 'project_director', 'hr_director', 'hr_specialist',
  'department_manager', 'procurement_asset_manager'
);

INSERT INTO `platform_system_app_role_maps`
  (`system_role_id`, `system_role_code`, `app_role_id`, `app_role_code`, `sort_order`, `created_at`)
SELECT system_role.id, system_role.role_code, app_role.id, app_role.role_code,
       expected.sort_order, UTC_TIMESTAMP()
FROM `tmp_wiztek_p0_role_map` expected
INNER JOIN `platform_system_roles` system_role
  ON system_role.role_code = expected.role_code
INNER JOIN `platform_app_roles` app_role
  ON app_role.role_code = expected.app_role_code
 AND app_role.status = 'active'
ORDER BY system_role.sort_order, expected.sort_order;

UPDATE `platform_system_roles`
SET policy_revision = policy_revision + 1,
    policy_hash = NULL,
    policy_updated_at = UTC_TIMESTAMP(),
    updated_at = UTC_TIMESTAMP()
WHERE role_code IN (
  'general_manager', 'project_director', 'hr_director', 'hr_specialist',
  'department_manager', 'procurement_asset_manager'
);

-- P0: synchronize the corresponding non-overridden Wiztek tenant roles.
DELETE tenant_map
FROM `tenant_role_app_role_maps` tenant_map
INNER JOIN `tenant_roles` tenant_role
  ON tenant_role.id = tenant_map.role_id
 AND tenant_role.tenant_code = tenant_map.tenant_code
WHERE tenant_role.tenant_code = 'C000001'
  AND tenant_role.role_code IN (
    'general_manager', 'project_director', 'hr_director', 'hr_specialist',
    'department_manager', 'procurement_asset_manager'
  );

INSERT INTO `tenant_role_app_role_maps`
  (`tenant_code`, `role_id`, `app_role_code`, `source_system_role_code`, `sort_order`, `created_at`, `updated_at`)
SELECT 'C000001', tenant_role.id, expected.app_role_code, expected.role_code,
       expected.sort_order, UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM `tmp_wiztek_p0_role_map` expected
INNER JOIN `tenant_roles` tenant_role
  ON tenant_role.tenant_code = 'C000001'
 AND tenant_role.role_code = expected.role_code
ORDER BY tenant_role.id, expected.sort_order;

UPDATE `tenant_roles`
SET source_policy_hash = NULL,
    effective_policy_hash = NULL,
    policy_revision = policy_revision + 1,
    policy_updated_at = UTC_TIMESTAMP(),
    updated_at = UTC_TIMESTAMP()
WHERE tenant_code = 'C000001'
  AND role_code IN (
    'general_manager', 'project_director', 'hr_director', 'hr_specialist',
    'department_manager', 'procurement_asset_manager'
  );

-- P1: replace only the rows owned by this remediation and materialize the
-- audited assignment-bound scopes. action/resource NULL intentionally means
-- every permission from this role in the named business app.
DELETE FROM `tenant_subject_role_scopes`
WHERE tenant_code = 'C000001'
  AND created_by_uid = 'audit:wiztek:2026-07-16';

INSERT INTO `tenant_subject_role_scopes`
  (`tenant_code`, `assignment_id`, `app_code`, `resource_code`, `action`,
   `scope_dimension`, `scope_predicate`, `scope_value`, `scope_group`,
   `scope_mode`, `status`, `created_by_uid`, `created_at`, `updated_at`)
SELECT assignment.tenant_code, assignment.id, expected.app_code, NULL, NULL,
       expected.scope_dimension, expected.scope_predicate, expected.scope_value,
       'default', 'intersect', 'active', 'audit:wiztek:2026-07-16',
       UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM `tmp_wiztek_p1_assignment_scope` expected
INNER JOIN `tenant_roles` role
  ON role.tenant_code = 'C000001'
 AND role.role_code = expected.role_code
 AND role.status = 'active'
INNER JOIN `tenant_subjects` subject
  ON subject.tenant_code = role.tenant_code
 AND subject.subject_type = 'user'
 AND subject.subject_code = expected.subject_code
 AND subject.status = 'active'
INNER JOIN `tenant_subject_roles` assignment
  ON assignment.tenant_code = role.tenant_code
 AND assignment.role_id = role.id
 AND assignment.subject_id = subject.id
 AND assignment.status = 'active'
 AND (assignment.starts_at IS NULL OR assignment.starts_at <= UTC_TIMESTAMP())
 AND (assignment.expired_at IS NULL OR assignment.expired_at > UTC_TIMESTAMP())
ORDER BY assignment.id, expected.app_code;

COMMIT;

-- Post-commit evidence. Expected: six rows with the exact app-role lists and
-- 24 active assignment-scope rows owned by this remediation.
SELECT tenant_role.role_code,
       GROUP_CONCAT(tenant_map.app_role_code ORDER BY tenant_map.app_role_code SEPARATOR ',') AS app_roles
FROM `tenant_roles` tenant_role
INNER JOIN `tenant_role_app_role_maps` tenant_map
  ON tenant_map.tenant_code = tenant_role.tenant_code
 AND tenant_map.role_id = tenant_role.id
WHERE tenant_role.tenant_code = 'C000001'
  AND tenant_role.role_code IN (
    'general_manager', 'project_director', 'hr_director', 'hr_specialist',
    'department_manager', 'procurement_asset_manager'
  )
GROUP BY tenant_role.id, tenant_role.role_code
ORDER BY tenant_role.role_code;

SELECT COUNT(*) AS `assignment_scope_count`
FROM `tenant_subject_role_scopes`
WHERE tenant_code = 'C000001'
  AND status = 'active'
  AND created_by_uid = 'audit:wiztek:2026-07-16';

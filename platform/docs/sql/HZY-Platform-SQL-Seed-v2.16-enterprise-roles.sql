-- HZY Platform seed v2.16: platform enterprise roles and default app-role mappings
--
-- Preconditions:
--   1. v2.15 enterprise-role split migration has been applied.
--   2. Latest manifests for platform/console/workflow/codocs/aims/altoc/assets/finance/people/insights
--      have been imported so platform_app_roles contains the app roles referenced below.
--
-- Notes:
--   - Re-runnable. It upserts role metadata and replaces mappings for the seeded roles.
--   - 普通员工默认权限由 policy bundle baseline 下发，不在这里配置为企业角色映射。
--   - collab 是支撑服务，无直接操作界面，不配置人工可授予应用角色。

START TRANSACTION;

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_platform_enterprise_role_seed` (
  `role_code` VARCHAR(128) NOT NULL PRIMARY KEY,
  `role_name` VARCHAR(255) NOT NULL,
  `role_type` VARCHAR(32) NOT NULL,
  `description` VARCHAR(500) NULL,
  `is_required` TINYINT(1) NOT NULL DEFAULT 0,
  `max_active_assignments` INT UNSIGNED NULL,
  `subject_type_constraint` VARCHAR(32) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active'
) ENGINE=Memory;

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_platform_enterprise_role_app_map_seed` (
  `role_code` VARCHAR(128) NOT NULL,
  `app_role_code` VARCHAR(128) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`role_code`, `app_role_code`)
) ENGINE=Memory;

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_platform_enterprise_role_seed_guard` (
  `check_name` VARCHAR(64) NOT NULL PRIMARY KEY,
  `passed` TINYINT NOT NULL,
  CONSTRAINT `chk_tmp_platform_enterprise_role_seed_guard_passed` CHECK (`passed` = 1)
) ENGINE=Memory;

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_platform_restricted_default_app_role_seed` (
  `app_role_code` VARCHAR(128) NOT NULL PRIMARY KEY,
  `reason` VARCHAR(255) NULL
) ENGINE=Memory;

TRUNCATE TABLE `tmp_platform_enterprise_role_seed`;
TRUNCATE TABLE `tmp_platform_enterprise_role_app_map_seed`;
TRUNCATE TABLE `tmp_platform_enterprise_role_seed_guard`;
TRUNCATE TABLE `tmp_platform_restricted_default_app_role_seed`;

INSERT INTO `tmp_platform_enterprise_role_seed`
  (`role_code`, `role_name`, `role_type`, `description`, `is_required`, `sort_order`, `status`)
VALUES
  ('system_admin', '系统管理员', 'system', '企业平台最高权限角色，负责组织、账号、安全、应用和全局配置。', 1, 10, 'active'),
  ('general_manager', '总经理', 'executive', '查看企业经营、项目、财务、资产、文档和流程总体情况。', 0, 20, 'active'),
  ('deputy_general_manager', '副总经理', 'executive', '查看分管业务范围内的经营、项目、财务、资产、文档和流程情况。', 0, 30, 'active'),
  ('sales_director', '销售总监', 'department', '管理销售经营业务，并参与合同等销售相关审批。', 0, 40, 'active'),
  ('commercial_director', '商务总监', 'department', '管理商务合同和经营协同，并承担合同审批职责。', 0, 50, 'active'),
  ('sales_manager', '销售经理', 'department', '管理销售机会、报价、合同协同及相关流程处理。', 0, 60, 'active'),
  ('sales_specialist', '销售专员', 'department', '参与销售业务执行和客户经营资料维护。', 0, 70, 'active'),
  ('project_director', '项目总监', 'department', '统筹项目组合、项目审批、项目交付和项目经营视图。', 0, 80, 'active'),
  ('qa', '质量保证', 'department', '负责项目必交文档的完整性和确定版本质量检查。', 0, 85, 'active'),
  ('project_manager', '项目经理', 'department', '负责项目计划、执行、协同和项目内资产/文档管理。', 0, 90, 'active'),
  ('project_member', '项目成员', 'department', '参与项目执行、任务协作和项目资料维护。', 0, 100, 'active'),
  ('finance_director', '财务总监', 'department', '管理财务业务、开票/费用审批和经营/资产财务视图。', 0, 110, 'active'),
  ('finance_accountant', '财务会计', 'department', '处理应收应付制单、资产财务和相关资料查看。', 0, 120, 'active'),
  ('hr_director', '人力资源总监', 'department', '管理组织、人事与员工相关流程审批。', 0, 130, 'active'),
  ('hr_specialist', '人事专员', 'department', '维护组织和人事资料，处理人事相关流程。', 0, 140, 'active'),
  ('records_manager', '档案管理员', 'department', '管理 Codocs 文档及各应用沉淀的企业档案。', 0, 150, 'active'),
  ('department_manager', '部门经理', 'department', '承担部门管理、部门资产、部门费用和部门流程处理职责。', 0, 160, 'active'),
  ('procurement_asset_manager', '采购与资产管理员', 'department', '负责采购、资产台账、领用归还、盘点和资产审批协同。', 0, 170, 'active');

UPDATE `tmp_platform_enterprise_role_seed`
SET `max_active_assignments` = 1,
    `subject_type_constraint` = 'user'
WHERE `role_code` IN ('project_director', 'qa');

INSERT INTO `tmp_platform_enterprise_role_app_map_seed`
  (`role_code`, `app_role_code`, `sort_order`)
VALUES
  ('system_admin', 'platform:authorization_admin', 5),
  ('system_admin', 'platform:authorization_simulator', 6),
  ('system_admin', 'console:admin', 10),
  ('system_admin', 'workflow:admin', 20),
  ('system_admin', 'codocs:admin', 30),
  ('system_admin', 'aims:admin', 40),
  ('system_admin', 'altoc:admin', 50),
  ('system_admin', 'assets:admin', 60),
  ('system_admin', 'finance:admin', 70),
  ('system_admin', 'insights:admin', 80),
  ('system_admin', 'people:admin', 90),

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

  ('deputy_general_manager', 'console:viewer', 10),
  ('deputy_general_manager', 'workflow:viewer', 20),
  ('deputy_general_manager', 'codocs:viewer', 30),
  ('deputy_general_manager', 'aims:viewer', 40),
  ('deputy_general_manager', 'altoc:viewer', 50),
  ('deputy_general_manager', 'assets:viewer', 60),
  ('deputy_general_manager', 'finance:viewer', 70),
  ('deputy_general_manager', 'insights:viewer', 80),

  ('sales_director', 'altoc:sales', 10),
  ('sales_director', 'altoc:contract_manager', 20),
  ('sales_director', 'altoc:contract_approver', 30),
  ('sales_director', 'workflow:approver', 40),
  ('sales_director', 'finance:viewer', 50),
  ('sales_director', 'codocs:viewer', 60),

  ('commercial_director', 'altoc:contract_manager', 10),
  ('commercial_director', 'altoc:contract_approver', 20),
  ('commercial_director', 'workflow:approver', 30),
  ('commercial_director', 'finance:viewer', 40),
  ('commercial_director', 'codocs:viewer', 50),

  ('sales_manager', 'altoc:sales', 10),
  ('sales_manager', 'altoc:contract_manager', 20),
  ('sales_manager', 'workflow:approver', 30),
  ('sales_manager', 'codocs:editor', 40),

  ('sales_specialist', 'altoc:sales', 10),
  ('sales_specialist', 'workflow:viewer', 20),
  ('sales_specialist', 'codocs:editor', 30),

  ('project_director', 'aims:project_director', 5),
  ('project_director', 'aims:pmo', 10),
  ('project_director', 'aims:project_approver', 20),
  ('project_director', 'aims:viewer', 30),
  ('project_director', 'workflow:approver', 40),
  ('project_director', 'codocs:viewer', 50),
  ('project_director', 'insights:analyst', 60),
  ('project_director', 'insights:report_exporter', 70),

  ('qa', 'aims:qa', 10),
  ('qa', 'codocs:viewer', 20),

  ('project_manager', 'aims:pm', 10),
  ('project_manager', 'workflow:approver', 20),
  ('project_manager', 'assets:owner', 30),
  ('project_manager', 'finance:viewer', 40),
  ('project_manager', 'codocs:editor', 50),
  ('project_manager', 'insights:viewer', 60),

  ('project_member', 'aims:member', 10),
  ('project_member', 'assets:employee', 20),
  ('project_member', 'workflow:viewer', 30),
  ('project_member', 'codocs:editor', 40),

  ('finance_director', 'finance:manager', 10),
  ('finance_director', 'finance:invoice_approver', 20),
  ('finance_director', 'finance:expense_approver', 30),
  ('finance_director', 'finance:report_viewer', 40),
  ('finance_director', 'assets:finance', 50),
  ('finance_director', 'workflow:approver', 60),
  ('finance_director', 'altoc:viewer', 70),
  ('finance_director', 'codocs:viewer', 80),

  ('finance_accountant', 'finance:accountant', 10),
  ('finance_accountant', 'finance:ar_accountant', 20),
  ('finance_accountant', 'finance:ap_accountant', 30),
  ('finance_accountant', 'assets:finance', 40),
  ('finance_accountant', 'altoc:viewer', 50),
  ('finance_accountant', 'codocs:viewer', 60),

  ('hr_director', 'console:directory_operator', 10),
  ('hr_director', 'workflow:approver', 20),
  ('hr_director', 'codocs:viewer', 30),
  ('hr_director', 'people:manager', 40),
  ('hr_director', 'people:approver', 50),

  ('hr_specialist', 'workflow:approver', 10),
  ('hr_specialist', 'codocs:editor', 20),
  ('hr_specialist', 'people:specialist', 30),

  ('records_manager', 'codocs:records_manager', 10),
  ('records_manager', 'workflow:approver', 20),

  ('department_manager', 'assets:owner', 10),
  ('department_manager', 'finance:expense_approver', 20),
  ('department_manager', 'workflow:approver', 30),

  ('procurement_asset_manager', 'assets:procurement', 10),
  ('procurement_asset_manager', 'assets:inventory_manager', 20),
  ('procurement_asset_manager', 'assets:viewer', 30),
  ('procurement_asset_manager', 'workflow:approver', 40),
  ('procurement_asset_manager', 'finance:viewer', 50);

INSERT INTO `tmp_platform_restricted_default_app_role_seed`
  (`app_role_code`, `reason`)
VALUES
  ('platform:authorization_simulator', '授权模拟只能作为系统管理员或临时高风险职责授予'),
  ('console:operator', 'Console 运营能力不作为默认岗位职责授予'),
  ('console:directory_manager', '目录源和目录同步治理不作为默认岗位职责授予'),
  ('console:security_admin', '安全和运行配置治理不作为默认岗位职责授予'),
  ('webdev:deployer', '部署发布职责需要单独授权'),
  ('webdev:admin', 'WebDev 管理职责只允许系统管理员默认持有'),
  ('finance:cashier', '出纳确认职责需要与制单/审批职责拆分'),
  ('finance:reconciliation_operator', '核销确认职责需要与制单/审批职责拆分'),
  ('people:performance_manager', '绩效治理职责需要单独授权'),
  ('people:compensation_admin', '薪酬成本治理职责需要单独授权'),
  ('people:directory_admin', 'People 字典/目录治理职责需要单独授权'),
  ('assets:asset_approver', '资产操作审批职责需要与经办职责拆分'),
  ('codocs:publisher', '企业发布职责需要单独授权'),
  ('insights:contributor_manager', '贡献者维护职责需要单独授权'),
  ('insights:ingestion_operator', '采集触发职责需要单独授权'),
  ('insights:monitoring_operator', '监控规则维护职责需要单独授权'),
  ('insights:monitoring_admin', '监控管理职责需要单独授权'),
  ('insights:repository_admin', '仓库治理职责需要单独授权'),
  ('insights:settings_admin', 'Insights 配置治理职责需要单独授权');

-- Preflight diagnostics. These result sets must be empty before the guard
-- statement below. If rows appear here, import/materialize the corresponding
-- application manifests first, then rerun this seed.
SELECT DISTINCT
  SUBSTRING_INDEX(m.app_role_code, ':', 1) AS `app_code`,
  m.app_role_code,
  COALESCE(ar.status, 'missing') AS `current_status`
FROM `tmp_platform_enterprise_role_app_map_seed` m
LEFT JOIN `platform_app_roles` ar
  ON ar.role_code = m.app_role_code
WHERE ar.id IS NULL
   OR ar.status <> 'active'
ORDER BY `app_code`, m.app_role_code;

SELECT
  SUBSTRING_INDEX(m.app_role_code, ':', 1) AS `app_code`,
  COUNT(DISTINCT m.app_role_code) AS `missing_or_inactive_role_count`,
  GROUP_CONCAT(DISTINCT m.app_role_code ORDER BY m.app_role_code SEPARATOR ', ') AS `app_role_codes`
FROM `tmp_platform_enterprise_role_app_map_seed` m
LEFT JOIN `platform_app_roles` ar
  ON ar.role_code = m.app_role_code
WHERE ar.id IS NULL
   OR ar.status <> 'active'
GROUP BY SUBSTRING_INDEX(m.app_role_code, ':', 1)
ORDER BY `app_code`;

SELECT
  m.role_code,
  m.app_role_code,
  'non_system_admin_app_role' AS `violation`
FROM `tmp_platform_enterprise_role_app_map_seed` m
WHERE m.role_code <> 'system_admin'
  AND m.app_role_code LIKE '%:admin'
ORDER BY m.role_code, m.app_role_code;

SELECT
  m.role_code,
  m.app_role_code,
  r.reason AS `violation_reason`
FROM `tmp_platform_enterprise_role_app_map_seed` m
INNER JOIN `tmp_platform_restricted_default_app_role_seed` r
  ON r.app_role_code = m.app_role_code
WHERE m.role_code <> 'system_admin'
ORDER BY m.role_code, m.app_role_code;

INSERT INTO `tmp_platform_enterprise_role_seed_guard`
  (`check_name`, `passed`)
SELECT
  'missing_app_roles',
  CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM `tmp_platform_enterprise_role_app_map_seed` m
LEFT JOIN `platform_app_roles` ar
  ON ar.role_code = m.app_role_code
 AND ar.status = 'active'
WHERE ar.id IS NULL;

INSERT INTO `tmp_platform_enterprise_role_seed_guard`
  (`check_name`, `passed`)
SELECT
  'non_system_admin_app_roles',
  CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM `tmp_platform_enterprise_role_app_map_seed` m
WHERE m.role_code <> 'system_admin'
  AND m.app_role_code LIKE '%:admin';

INSERT INTO `tmp_platform_enterprise_role_seed_guard`
  (`check_name`, `passed`)
SELECT
  'restricted_default_app_roles',
  CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM `tmp_platform_enterprise_role_app_map_seed` m
INNER JOIN `tmp_platform_restricted_default_app_role_seed` r
  ON r.app_role_code = m.app_role_code
WHERE m.role_code <> 'system_admin';

INSERT INTO `platform_system_roles`
  (`role_code`, `role_name`, `role_type`, `description`, `is_required`,
   `max_active_assignments`, `subject_type_constraint`,
   `sort_order`, `status`, `created_at`, `updated_at`)
SELECT
  role_code,
  role_name,
  role_type,
  description,
  is_required,
  max_active_assignments,
  subject_type_constraint,
  sort_order,
  status,
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `tmp_platform_enterprise_role_seed`
ON DUPLICATE KEY UPDATE
  role_name = VALUES(role_name),
  role_type = VALUES(role_type),
  description = VALUES(description),
  is_required = VALUES(is_required),
  max_active_assignments = VALUES(max_active_assignments),
  subject_type_constraint = VALUES(subject_type_constraint),
  sort_order = VALUES(sort_order),
  status = VALUES(status),
  policy_revision = policy_revision + 1,
  policy_hash = NULL,
  policy_updated_at = UTC_TIMESTAMP(),
  updated_at = UTC_TIMESTAMP();

DELETE sarm
FROM `platform_system_app_role_maps` sarm
INNER JOIN `platform_system_roles` sr
  ON sr.id = sarm.system_role_id
INNER JOIN `tmp_platform_enterprise_role_seed` seed
  ON seed.role_code = sr.role_code;

INSERT INTO `platform_system_app_role_maps`
  (`system_role_id`, `system_role_code`, `app_role_id`, `app_role_code`, `sort_order`, `created_at`)
SELECT
  sr.id,
  sr.role_code,
  ar.id,
  ar.role_code,
  m.sort_order,
  UTC_TIMESTAMP()
FROM `tmp_platform_enterprise_role_app_map_seed` m
INNER JOIN `platform_system_roles` sr
  ON sr.role_code = m.role_code
INNER JOIN `platform_app_roles` ar
  ON ar.role_code = m.app_role_code
 AND ar.status = 'active'
ORDER BY sr.sort_order ASC, m.sort_order ASC;

UPDATE `platform_system_roles` sr
INNER JOIN `tmp_platform_enterprise_role_seed` seed
  ON seed.role_code = sr.role_code
SET sr.policy_revision = sr.policy_revision + 1,
    sr.policy_hash = NULL,
    sr.policy_updated_at = UTC_TIMESTAMP(),
    sr.updated_at = UTC_TIMESTAMP();

-- Retire old or non-human-facing templates from the platform enterprise-role catalog.
UPDATE `platform_system_roles`
SET status = 'inactive',
    updated_at = UTC_TIMESTAMP()
WHERE role_code IN ('tenant_console_admin', 'tenant_console_view', 'console.viewer');

-- Retire app roles no longer declared by current manifests.
UPDATE `platform_app_roles`
SET status = 'inactive',
    updated_at = UTC_TIMESTAMP()
WHERE role_code = 'workflow:operator'
   OR role_code IN ('console.viewer', 'tenant_console_view', 'tenant_console_viewer')
   OR app_code = 'collab';

COMMIT;

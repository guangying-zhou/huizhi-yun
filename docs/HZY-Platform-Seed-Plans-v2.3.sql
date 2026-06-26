-- hzy_platform v2.3 种子数据：应用目录 + 订阅计划 + 计划应用组合
-- 基线：HZY-Platform-SQL-DDL-Draft-v2.sql（v2.3 合并后）
-- 配套：HZY-Platform-Schema-Addendum-v2.3.md
--
-- 业务约束（见 Addendum §2）：
--   - 订阅计划 = 必选基础模块(core) + 业务应用(business)
--     · Starter：{console, account, workflow} core + {align, codocs, aims} business
--     · Pro：Starter 全集 + {altoc, assets} business
--     · Advanced：Pro 全集 + {insights} business
--   - 所有幂等：INSERT ... ON DUPLICATE KEY UPDATE

USE `hzy_platform`;

-- ============================================================
-- Section 1 应用目录 platform_applications
-- ============================================================
-- service_role 说明：
--   business_app        业务应用
--   directory_runtime   组织目录运行时（account）
--   workflow_runtime    审批流程运行时（workflow）
--   supporting_service  基础运行服务（console）

INSERT INTO `platform_applications`
  (`app_code`, `app_name`, `description`, `service_role`, `runtime_mode`, `auth_mode`, `bundle_enabled`, `status`)
VALUES
  ('console',  '企业控制台', '客户侧基础运行服务：org-profile / system-settings / credential-vault / integration-config',
                'supporting_service', 'customer-hosted', 'oidc', 1, 'active'),
  ('account',   '组织目录',           '用户/部门/岗位/项目注册表、外部目录同步（directory-runtime）',
                'directory_runtime',  'customer-hosted', 'oidc', 1, 'active'),
  ('workflow',  '审批流程',           '通用审批流程引擎，零代码配置、条件路由',
                'workflow_runtime',   'customer-hosted', 'oidc', 1, 'active'),
  ('align',     '组织协同',           '事项协助、人员借调、通知待办',
                'business_app',       'customer-hosted', 'oidc', 1, 'active'),
  ('codocs',    '协作文档',           '文档管理、Milkdown 编辑器、Yjs 协作',
                'business_app',       'customer-hosted', 'oidc', 1, 'active'),
  ('aims',      '研发项目',           '研发项目生命周期管理（PIVR），任务看板，GitLab 集成',
                'business_app',       'customer-hosted', 'oidc', 1, 'active'),
  ('altoc',     '经营管理',           'LTC 经营管理：客户/商机/报价/合同/回款',
                'business_app',       'customer-hosted', 'oidc', 1, 'active'),
  ('assets',    '资产管理',           '企业资产与资源管理，采购/分配/处置全流程',
                'business_app',       'customer-hosted', 'oidc', 1, 'active'),
  ('insights',  '代码分析',           '代码仓库监测分析（MySQL + FastAPI）',
                'business_app',       'customer-hosted', 'oidc', 1, 'active')
ON DUPLICATE KEY UPDATE
  `app_name`      = VALUES(`app_name`),
  `description`   = VALUES(`description`),
  `service_role`  = VALUES(`service_role`),
  `runtime_mode`  = VALUES(`runtime_mode`),
  `auth_mode`     = VALUES(`auth_mode`),
  `bundle_enabled`= VALUES(`bundle_enabled`),
  `status`        = VALUES(`status`);

-- ============================================================
-- Section 2 订阅计划 platform_plans
-- ============================================================

INSERT INTO `platform_plans`
  (`plan_code`, `plan_name`, `plan_tier`, `price_model`, `base_price`, `currency`, `billing_cycle`, `description`, `status`)
VALUES
  ('starter',  '标准版', 'starter',  'fixed', NULL, 'CNY', 'annual',
    '基础能力包：协同办公 + 协同文档 + 项目管理', 'active'),
  ('pro',      '专业版', 'pro',      'fixed', NULL, 'CNY', 'annual',
    '标准版 + 资产管理 + 经营管理', 'active'),
  ('advanced', '旗舰版', 'advanced', 'fixed', NULL, 'CNY', 'annual',
    '专业版 + 高级审计 + 代码分析', 'active')
ON DUPLICATE KEY UPDATE
  `plan_name`     = VALUES(`plan_name`),
  `plan_tier`     = VALUES(`plan_tier`),
  `description`   = VALUES(`description`),
  `status`        = VALUES(`status`);

-- ============================================================
-- Section 3 计划 × 应用 platform_plan_apps
-- ============================================================
-- 基础模块（core）每个计划都包含：console, account, workflow
-- 业务应用（business）按档位叠加

-- 3.1 先清除本 seed 管理范围内的历史绑定（仅限 core/starter/pro/advanced 三档），避免多刀加重
DELETE pa
  FROM `platform_plan_apps` pa
  JOIN `platform_plans` p ON p.`id` = pa.`plan_id`
 WHERE p.`plan_code` IN ('starter', 'pro', 'advanced');

-- 3.2 批量插入（通过子查询把 plan_code 映射为 plan_id）
INSERT INTO `platform_plan_apps` (`plan_id`, `app_code`, `role_in_plan`, `sort_order`)
SELECT p.`id`, app.`app_code`, app.`role_in_plan`, app.`sort_order`
  FROM `platform_plans` p
  JOIN (
    -- Starter：core + {align, codocs, aims}
    SELECT 'starter' AS plan_code, 'console' AS app_code, 'core'     AS role_in_plan, 10 AS sort_order UNION ALL
    SELECT 'starter', 'account',  'core',     11 UNION ALL
    SELECT 'starter', 'workflow', 'core',     12 UNION ALL
    SELECT 'starter', 'align',    'business', 20 UNION ALL
    SELECT 'starter', 'codocs',   'business', 21 UNION ALL
    SELECT 'starter', 'aims',     'business', 22 UNION ALL
    -- Pro：Starter 全集 + {altoc, assets}
    SELECT 'pro',     'console', 'core',     10 UNION ALL
    SELECT 'pro',     'account',  'core',     11 UNION ALL
    SELECT 'pro',     'workflow', 'core',     12 UNION ALL
    SELECT 'pro',     'align',    'business', 20 UNION ALL
    SELECT 'pro',     'codocs',   'business', 21 UNION ALL
    SELECT 'pro',     'aims',     'business', 22 UNION ALL
    SELECT 'pro',     'altoc',    'business', 23 UNION ALL
    SELECT 'pro',     'assets',   'business', 24 UNION ALL
    -- Advanced：Pro 全集 + {insights}
    SELECT 'advanced','console', 'core',     10 UNION ALL
    SELECT 'advanced','account',  'core',     11 UNION ALL
    SELECT 'advanced','workflow', 'core',     12 UNION ALL
    SELECT 'advanced','align',    'business', 20 UNION ALL
    SELECT 'advanced','codocs',   'business', 21 UNION ALL
    SELECT 'advanced','aims',     'business', 22 UNION ALL
    SELECT 'advanced','altoc',    'business', 23 UNION ALL
    SELECT 'advanced','assets',   'business', 24 UNION ALL
    SELECT 'advanced','insights', 'business', 25
  ) app ON app.`plan_code` = p.`plan_code`;

-- ============================================================
-- Section 4 校验查询（仅注释，供人工检查）
-- ============================================================
-- SELECT p.plan_code,
--        SUM(pa.role_in_plan = 'core')     AS core_cnt,
--        SUM(pa.role_in_plan = 'business') AS business_cnt,
--        GROUP_CONCAT(pa.app_code ORDER BY pa.sort_order) AS apps
--   FROM platform_plans p
--   JOIN platform_plan_apps pa ON pa.plan_id = p.id
--  WHERE p.plan_code IN ('starter','pro','advanced')
--  GROUP BY p.plan_code;
--
-- 期望输出：
--   starter  | core=3 | business=3 | console,account,workflow,align,codocs,aims
--   pro      | core=3 | business=5 | console,account,workflow,align,codocs,aims,altoc,assets
--   advanced | core=3 | business=6 | ...,insights

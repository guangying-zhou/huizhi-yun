-- HZY Platform seed v2.34: 为应当保留 Finance 全量访问的角色补显式 tenant:global
--
-- ⚠️ 部署顺序硬约束（走查 ISSUE-B-011）：
--   本 seed 必须在部署 financeScopedAuthorization.ts 的失败关闭改动**之前**执行。
--   改动后「没有配置任何数据范围」将解析为 access='none'，而生产的
--   tenant_role_scopes 与 platform_app_role_scopes 都是空表——若先部署代码，
--   下列角色会立刻全面 403（与 Altoc 看板 403 是同型事故）。
--
-- 适用角色（C000001 现状，均持有 Finance 应用角色且无任何数据范围）：
--   general_manager    总经理      finance:viewer                             1 人
--   finance_accountant 财务会计    finance:accountant                         1 人
--   finance_director   财务总监    finance:expense_approver, finance:manager  1 人
--   system_admin       系统管理员  finance:admin                              4 人
--
-- 不在本 seed 内的角色：
--   department_manager / deputy_general_manager 已有 tenant_subject_role_scopes
--     的部门树范围，不需要也不应该获得全局范围。
--   sales_director / project_manager / procurement_asset_manager /
--     commercial_director 的 finance:viewer 映射已由 Seed v2.33（Stream B） 移除。
--
-- 做法：按角色实际拥有的 finance 权限点逐条生成 tenant:global 范围行，
-- 即「显式声明这些角色的数据范围就是全租户」，而不是依赖代码的隐式兜底。
-- 幂等，可重复执行。

START TRANSACTION;

INSERT INTO `tenant_role_scopes` (
  `tenant_code`, `role_id`, `app_code`, `resource_code`, `action`,
  `scope_type`, `scope_value`, `status`, `created_at`, `updated_at`
)
SELECT DISTINCT
  tr.`tenant_code`, tr.`id`, arp.`app_code`, arp.`resource_code`, arp.`action`,
  'tenant', 'global', 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM `tenant_roles` tr
JOIN `tenant_role_app_role_maps` m
  ON m.`role_id` = tr.`id` AND m.`tenant_code` = tr.`tenant_code`
JOIN `platform_app_roles` ar
  ON ar.`role_code` = m.`app_role_code` AND ar.`status` = 'active'
JOIN `platform_app_role_permissions` arp
  ON arp.`app_role_id` = ar.`id` AND arp.`app_code` = 'finance'
WHERE tr.`status` = 'active'
  AND tr.`role_code` IN (
    'general_manager',
    'finance_accountant',
    'finance_director',
    'system_admin'
  )
ON DUPLICATE KEY UPDATE
  `scope_type` = VALUES(`scope_type`),
  `scope_value` = VALUES(`scope_value`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

UPDATE `tenant_roles`
SET `source_policy_hash` = NULL,
    `effective_policy_hash` = NULL,
    `policy_revision` = `policy_revision` + 1,
    `policy_updated_at` = UTC_TIMESTAMP(),
    `updated_at` = UTC_TIMESTAMP()
WHERE `role_code` IN (
  'general_manager','finance_accountant','finance_director','system_admin'
);

COMMIT;

-- 核验：下列每个角色的 finance 权限点数量必须与其 tenant:global 范围行数量一致。
SELECT tr.`role_code`,
       COUNT(DISTINCT CONCAT(arp.`resource_code`, ':', arp.`action`)) AS `finance_permissions`,
       (SELECT COUNT(*) FROM `tenant_role_scopes` s
         WHERE s.`role_id` = tr.`id` AND s.`app_code` = 'finance'
           AND s.`scope_type` = 'tenant' AND s.`scope_value` = 'global'
           AND s.`status` = 'active') AS `tenant_global_scopes`
FROM `tenant_roles` tr
JOIN `tenant_role_app_role_maps` m ON m.`role_id` = tr.`id`
JOIN `platform_app_roles` ar ON ar.`role_code` = m.`app_role_code` AND ar.`status` = 'active'
JOIN `platform_app_role_permissions` arp ON arp.`app_role_id` = ar.`id` AND arp.`app_code` = 'finance'
WHERE tr.`role_code` IN ('general_manager','finance_accountant','finance_director','system_admin')
GROUP BY tr.`id`
ORDER BY tr.`role_code`;

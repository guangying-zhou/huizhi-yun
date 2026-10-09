-- HZY Platform seed v2.33: 收回非财务岗位的 Finance 全量读权限
--
-- 背景（Stream B 走查 ISSUE-B-011，P0）：
--   finance/server/utils/financeScopedAuthorization.ts 有三处「授权里没有任何
--   非 tenant:global 的 scope 就放行全量」：
--     :115 responsibilityScopeFromGrant  -> 发票 / 到账 / 核销
--     :189 expenseRequestScopeFromGrant  -> 费用报销 / 项目支出 / 付款申请
--     :250 projectFinanceScopeFromGrant  -> 项目核算 / 合同财务摘要 / 绩效 / 看板
--
--   生产租户 C000001 的 tenant_role_scopes 与 platform_app_role_scopes 都是空表，
--   唯一的范围数据是 tenant_subject_role_scopes 里的 8 条部门树。于是所有没配
--   范围的角色一律拿到 access='all'。
--
--   销售总监、项目经理、采购与资产管理员、商务总监各 1 人持有 finance:viewer
--   （= expenses:view + invoices:view + receipts:view + project_accounting:view
--   + reports:view）且无任何数据范围，因此可读取全库 1956 张发票、2107 条到账、
--   全部费用报销明细和全公司项目毛利。业务方 2026-08-27 确认这不是有意配置。
--
-- 处置：直接移除这 4 个岗位的 finance:viewer 映射（业务方决定）。
--   4 个角色的其他应用角色不受影响，本职工作不受阻断。
--
-- 已于 2026-08-27 在生产租户 C000001 执行并核验（删除 4 行、失效 4 个角色策略）。
-- 幂等，可重复执行。

START TRANSACTION;

DELETE m
FROM `tenant_role_app_role_maps` m
INNER JOIN `tenant_roles` tr
  ON tr.`id` = m.`role_id`
 AND tr.`tenant_code` = m.`tenant_code`
WHERE m.`app_role_code` = 'finance:viewer'
  AND tr.`role_code` IN (
    'sales_director',
    'project_manager',
    'procurement_asset_manager',
    'commercial_director'
  );

-- 运行时授权是请求时实时查 SQL（platform/server/utils/authorization.ts），
-- 删除即刻生效；这里同步失效角色策略快照，避免 Platform 界面显示陈旧 hash。
UPDATE `tenant_roles`
SET `source_policy_hash` = NULL,
    `effective_policy_hash` = NULL,
    `policy_revision` = `policy_revision` + 1,
    `policy_updated_at` = UTC_TIMESTAMP(),
    `updated_at` = UTC_TIMESTAMP()
WHERE `role_code` IN (
  'sales_director',
  'project_manager',
  'procurement_asset_manager',
  'commercial_director'
);

COMMIT;

-- 回滚（仅在需要恢复时执行，role_id 为 C000001 实际值）：
--   INSERT INTO tenant_role_app_role_maps
--     (id,tenant_code,role_id,app_role_code,source_system_role_code,sort_order,created_at)
--   VALUES
--     (4022,'C000001',132,'finance:viewer','commercial_director',40,'2026-08-26 00:30:53'),
--     (4069,'C000001',141,'finance:viewer','procurement_asset_manager',50,'2026-08-26 00:31:40'),
--     (4079,'C000001',124,'finance:viewer','project_manager',40,'2026-08-26 00:31:52'),
--     (4093,'C000001',131,'finance:viewer','sales_director',40,'2026-08-26 00:32:13');

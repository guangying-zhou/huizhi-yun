-- HZY Platform verify v2.33: 核验非财务岗位的 Finance 访问已收回。只读。

-- 1) 这 4 个岗位必须不再持有任何 finance 应用角色（remaining_finance_maps 全为 0）。
SELECT tr.`role_code`,
       COUNT(m.`id`) AS `remaining_finance_maps`
FROM `tenant_roles` tr
LEFT JOIN `tenant_role_app_role_maps` m
  ON m.`role_id` = tr.`id`
 AND m.`app_role_code` LIKE 'finance%'
WHERE tr.`role_code` IN (
  'sales_director','project_manager','procurement_asset_manager','commercial_director'
)
GROUP BY tr.`role_code`;

-- 2) 这 4 个岗位的其他应用角色必须完好（不能误删成空）。
SELECT tr.`role_code`,
       GROUP_CONCAT(m.`app_role_code` ORDER BY m.`app_role_code`) AS `all_app_roles`
FROM `tenant_roles` tr
JOIN `tenant_role_app_role_maps` m ON m.`role_id` = tr.`id`
WHERE tr.`role_code` IN (
  'sales_director','project_manager','procurement_asset_manager','commercial_director'
)
GROUP BY tr.`role_code`;

-- 3) 仍持有 finance 应用角色的租户角色全景：holders 有人而 finance_scopes 为 0 的，
--    就是「无数据范围即全量」的账号。这些角色必须在部署严格默认值之前显式配置
--    tenant:global scope，否则代码改动会让他们全面 403。
SELECT tr.`role_code`, tr.`role_name`,
       GROUP_CONCAT(DISTINCT m.`app_role_code` ORDER BY m.`app_role_code`) AS `finance_app_roles`,
       (SELECT COUNT(*) FROM `tenant_subject_roles` sr
         WHERE sr.`role_id` = tr.`id` AND sr.`status` = 'active') AS `holders`,
       (SELECT COUNT(*) FROM `tenant_subject_roles` sr
         JOIN `tenant_subject_role_scopes` ss ON ss.`assignment_id` = sr.`id`
        WHERE sr.`role_id` = tr.`id` AND ss.`app_code` = 'finance'
          AND ss.`status` = 'active') AS `finance_scopes`
FROM `tenant_roles` tr
JOIN `tenant_role_app_role_maps` m ON m.`role_id` = tr.`id`
WHERE m.`app_role_code` LIKE 'finance%'
GROUP BY tr.`id`
ORDER BY tr.`role_code`;

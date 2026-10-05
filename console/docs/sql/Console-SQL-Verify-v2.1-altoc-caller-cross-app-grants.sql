-- Console SQL Verify v2.1: 核验 Altoc 作为调用方的跨应用 capability。
-- 只读；在执行 Console-SQL-Seed-v2.1-altoc-caller-cross-app-grants.sql 之后运行。
--
-- 两行都必须返回 granted=1。任一为 0 时：
--   finance:invoice-request:create = 0 -> 回款计划发起开票申请会拿到
--     403 insufficient_scope，且 Altoc 侧会把失败降级为 pending（走查 B-001）
--   aims:service-ticket:work-item:create = 0 -> 服务工单派发到 Aims 失败（B-010）
--
-- 注意：SQL 行存在只是必要条件。发布前仍须按根 CLAUDE.md 要求，用实际
-- service client 对全部组合 scope 做一次真实的令牌签发探测。

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT 'altoc' AS `caller_app`,
       'finance:invoice-request:create' AS `required_scope`,
       EXISTS(
         SELECT 1 FROM `service_client_grants` g
         JOIN `service_clients` c ON c.`id`=g.`service_client_id`
         WHERE g.`status`='active' AND c.`status`='active'
           AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
           AND CONCAT(g.`resource_code`,':',g.`action`)='finance:invoice-request:create'
       ) AS `granted`
UNION ALL
SELECT 'altoc' AS `caller_app`,
       'aims:service-ticket:work-item:create' AS `required_scope`,
       EXISTS(
         SELECT 1 FROM `service_client_grants` g
         JOIN `service_clients` c ON c.`id`=g.`service_client_id`
         WHERE g.`status`='active' AND c.`status`='active'
           AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
           AND CONCAT(g.`resource_code`,':',g.`action`)='aims:service-ticket:work-item:create'
       ) AS `granted`;

-- 参考：列出 altoc.runtime 当前全部 grant，便于人工核对宽 scope 收敛进度。
SELECT c.`client_code`,
       CONCAT(g.`resource_code`,':',g.`action`) AS `capability`,
       g.`status`,
       JSON_UNQUOTE(JSON_EXTRACT(g.`scope_json`,'$.source')) AS `source`
FROM `service_client_grants` g
JOIN `service_clients` c ON c.`id`=g.`service_client_id`
WHERE c.`client_code`='altoc.runtime'
  AND (g.`resource_code` LIKE 'finance%' OR g.`resource_code` LIKE 'aims%')
ORDER BY `capability`;

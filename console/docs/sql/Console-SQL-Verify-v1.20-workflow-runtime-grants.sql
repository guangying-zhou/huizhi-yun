-- Console SQL Verify v1.20: 核对 workflow runtime / proxy service grants 是否到位
-- Date: 2026-06-14
-- 用法：在 hzy_console 库执行；配合 Console-SQL-Seed-v1.20-workflow-runtime-grants.sql 使用。
--
-- 预期结果：
--   查询 1：每个业务应用（console/codocs/aims/altoc/assets/finance/people/align/insights）
--           都应出现一行，且 has_workflow_proxy = 1。
--   查询 2：workflow service client 应出现 4 行 grant：
--           data-runtime:workflow:read / write、tenant-runtime:workflow:read / write。
--   查询 3：列出所有 active service client，便于核对 app_code / client_code
--           是否落在 seed 脚本的 WHERE 清单内（不在清单内 = grant 不会被插入）。

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 查询 1：业务应用是否拿到 workflow:proxy
SELECT
  sc.`id`                                            AS service_client_id,
  sc.`app_code`,
  sc.`client_code`,
  MAX(g.`id` IS NOT NULL)                            AS has_workflow_proxy
FROM `service_clients` sc
LEFT JOIN `service_client_grants` g
  ON g.`service_client_id` = sc.`id`
 AND g.`resource_code` = 'workflow'
 AND g.`action` = 'proxy'
 AND g.`status` = 'active'
WHERE sc.`status` = 'active'
  AND (
    sc.`app_code` IN ('console', 'codocs', 'aims', 'altoc', 'assets', 'finance', 'people', 'align', 'insights')
    OR sc.`client_code` IN (
      'console', 'console.runtime',
      'codocs', 'codocs.runtime',
      'aims', 'aims.runtime',
      'altoc', 'altoc.runtime',
      'assets', 'assets.runtime',
      'finance', 'finance.runtime',
      'people', 'people.runtime',
      'align', 'align.runtime',
      'insights', 'insights.runtime'
    )
  )
GROUP BY sc.`id`, sc.`app_code`, sc.`client_code`
ORDER BY sc.`app_code`, sc.`client_code`;

-- 查询 2：workflow service client 是否拿到 data-runtime / tenant-runtime 的 workflow read/write
SELECT
  sc.`app_code`,
  sc.`client_code`,
  CONCAT(g.`resource_code`, ':', g.`action`)         AS scope,
  g.`status`
FROM `service_clients` sc
JOIN `service_client_grants` g
  ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'workflow' OR sc.`client_code` IN ('workflow', 'workflow.runtime'))
  AND g.`resource_code` IN ('data-runtime:workflow', 'tenant-runtime:workflow')
ORDER BY sc.`client_code`, scope;

-- 查询 3：所有 active service client 全量清单（核对命名是否落在 seed WHERE 内）
SELECT
  `id`,
  `app_code`,
  `client_code`,
  `status`
FROM `service_clients`
WHERE `status` = 'active'
ORDER BY `app_code`, `client_code`;

-- Console SQL Seed v1.95: 修复代码请求的 scope 与生产 grant 之间的漂移。
-- Date: 2026-08-23
--
-- 依据：console/docs/sql/Console-SQL-Verify-grant-dump.sql 的生产实际导出，
-- 与各应用 server/ 目录中实际出站请求的 scope 逐条比对确认。
-- 每一条都对应代码里真实存在的出站调用；不新增任何代码未使用的权限。
--
-- 已确认的 8 处缺口：
--   1. aims    -> altoc:service-ticket:delivery-result:sync
--      生产实际持有 'altoc:service_ticket:delivery-result:sync'（下划线）。
--      根因：v1.31 seed 第 137 行写成 service_ticket，但同文件第 13 行注释
--      和代码用的都是 kebab-case 的 service-ticket。根 CLAUDE.md 规定
--      跨应用 capability 一律 kebab-case，故补正确形态。
--      影响：Aims outbox 的工单结果回传 executor 永久 403。
--   2. altoc   -> altoc:contract:admin           （合同管理写入，双 runtime audience）
--   3. altoc   -> codocs:documents:read          （生产只有 documents:write）
--   4. assets  -> aims:read
--   5. assets  -> altoc:contract:delivery-asset-status:sync
--   6. codocs  -> workflow:document-publish:create
--   7. finance -> workflow:invoice-request:create
--   8. people  -> assets:offboarding-recovery:sync
--
-- 遗留待确认（本脚本不处理）：
--   aims/server/utils/codocsApi.ts 用 maybeCallTenantRuntime({appCode:'codocs'})
--   直连 codocs 的 tenant-runtime，需要 data-runtime:codocs:read/write。
--   这违反「业务应用不得直接访问其他应用的 tenant-runtime」，且 aims Worker
--   很可能没有配置 codocs runtime endpoint（此时 shouldCallTenantRuntime 返回
--   false，调用静默变成 no-op）。应先确认是死代码还是真实链路，再决定是删代码
--   还是走 Service API，而不是直接补授权。

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO `service_client_grants` (
  `service_client_id`,
  `resource_code`,
  `action`,
  `scope_json`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  sc.`id`,
  grants.`resource_code`,
  grants.`action`,
  JSON_OBJECT(
    'source', 'seed:v1.95',
    'semanticScope', CONCAT(grants.`resource_code`, ':', grants.`action`),
    'audience', grants.`audience`,
    'purpose', grants.`purpose`
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  -- 调用方 app_code | resource_code | action | audience | purpose
  SELECT 'aims'    AS `app_code`, 'altoc:service-ticket:delivery-result' AS `resource_code`, 'sync'   AS `action`, 'altoc'    AS `audience`, 'aims-outbox-service-ticket-delivery-result-sync' AS `purpose`
  UNION ALL SELECT 'altoc',   'data-runtime:altoc:contract',            'admin',  'data-runtime',   'altoc-contract-management-write'
  UNION ALL SELECT 'altoc',   'tenant-runtime:altoc:contract',          'admin',  'tenant-runtime', 'altoc-contract-management-write'
  UNION ALL SELECT 'altoc',   'codocs:documents',                       'read',   'codocs',         'altoc-read-codocs-entity-documents'
  UNION ALL SELECT 'assets',  'aims',                                   'read',   'aims',           'assets-read-aims-product-versions'
  UNION ALL SELECT 'assets',  'altoc:contract:delivery-asset-status',   'sync',   'altoc',          'assets-sync-delivery-asset-status-to-altoc'
  UNION ALL SELECT 'codocs',  'workflow:document-publish',              'create', 'workflow',       'codocs-create-document-publish-approval'
  UNION ALL SELECT 'finance', 'workflow:invoice-request',               'create', 'workflow',       'finance-create-invoice-request-approval'
  UNION ALL SELECT 'people',  'assets:offboarding-recovery',            'sync',   'assets',         'people-sync-offboarding-asset-recovery'
) grants
  ON sc.`app_code` = grants.`app_code`
  OR sc.`client_code` IN (grants.`app_code`, CONCAT(grants.`app_code`, '.runtime'))
WHERE sc.`status` = 'active'
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status`     = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;

-- 核验：以下查询应返回 9 行，status 全部为 active。
-- SELECT c.`app_code`, CONCAT(g.`resource_code`,':',g.`action`) AS `scope`, g.`status`
-- FROM `service_client_grants` g
-- JOIN `service_clients` c ON c.`id` = g.`service_client_id`
-- WHERE JSON_UNQUOTE(JSON_EXTRACT(g.`scope_json`, '$.source')) = 'seed:v1.95'
-- ORDER BY c.`app_code`, `scope`;
--
-- 完整回归：重跑 console/docs/sql/Console-SQL-Verify-grant-dump.sql 并与代码出站 scope 比对。

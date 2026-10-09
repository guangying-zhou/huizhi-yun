-- Console SQL Seed v2.1: Altoc 作为调用方缺失的跨应用 capability。
-- Generated only; do not auto-run.
--
-- 背景（Stream B 走查 ISSUE-B-001 / B-010）：
-- 生产租户 C000001 的 altoc.runtime 只有 finance:read / finance:write 两条
-- app 级宽 grant，缺少现行代码实际请求的精确 capability：
--
--   altoc.runtime -> finance:invoice-request:create
--       回款计划发起开票申请（executeReceivableInvoiceOperation）
--   altoc.runtime -> aims:service-ticket:work-item:create
--       服务工单派发到 Aims 执行工作项
--
-- Console 的 scope 校验对以 `<audience>:` 开头的请求只做精确匹配，不回落
-- semanticScope，因此这两条调用必然拿到 403 insufficient_scope。
--
-- Seed v1.43 其实已经写了 finance:invoice-request:create 的 altoc 半边，但从
-- 未在生产执行（对照：同一份 seed 的 finance -> workflow 半边在生产存在，
-- 且 scope_json.source 是 'seed:v1.95' 而非 'seed:v1.43'）。本 seed 幂等，
-- 可安全重复执行。

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;

-- Altoc -> Finance：回款计划发起开票申请。
INSERT INTO service_client_grants (
  service_client_id, resource_code, action, scope_json, status, created_at, updated_at
)
SELECT sc.id, 'finance:invoice-request', 'create',
       JSON_OBJECT(
         'source','seed:v2.1',
         'purpose','altoc-caller-finance-invoice-request-create',
         'endpoints',JSON_ARRAY('/api/v1/finance/service/invoice-requests/create')
       ),
       'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM service_clients sc
WHERE sc.status='active' AND (sc.app_code='altoc' OR sc.client_code IN ('altoc','altoc.runtime'))
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();

-- Altoc -> Aims：服务工单派发执行工作项。
INSERT INTO service_client_grants (
  service_client_id, resource_code, action, scope_json, status, created_at, updated_at
)
SELECT sc.id, 'aims:service-ticket:work-item', 'create',
       JSON_OBJECT(
         'source','seed:v2.1',
         'purpose','altoc-caller-aims-service-ticket-work-item-create',
         'endpoints',JSON_ARRAY('/api/v1/service/service-tickets/{ticketCode}/work-item/receive')
       ),
       'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM service_clients sc
WHERE sc.status='active' AND (sc.app_code='altoc' OR sc.client_code IN ('altoc','altoc.runtime'))
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();

COMMIT;

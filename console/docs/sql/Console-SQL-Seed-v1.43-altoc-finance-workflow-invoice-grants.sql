-- Console SQL Seed v1.43: reliable Altoc -> Finance -> Workflow invoice grants.
-- Generated only; do not auto-run.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;

INSERT INTO service_client_grants (
  service_client_id, resource_code, action, scope_json, status, created_at, updated_at
)
SELECT sc.id, 'finance:invoice-request', 'create',
       JSON_OBJECT('source','seed:v1.43','purpose','altoc-finance-reliable-invoice-create','endpoints',JSON_ARRAY('/api/v1/finance/service/invoice-requests/create')),
       'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM service_clients sc
WHERE sc.status='active' AND (sc.app_code='altoc' OR sc.client_code IN ('altoc','altoc.runtime'))
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();

INSERT INTO service_client_grants (
  service_client_id, resource_code, action, scope_json, status, created_at, updated_at
)
SELECT sc.id, 'workflow:invoice-request', 'create',
       JSON_OBJECT('source','seed:v1.43','purpose','finance-workflow-reliable-invoice-approval','endpoints',JSON_ARRAY('/api/v1/service/finance-invoice-approval')),
       'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM service_clients sc
WHERE sc.status='active' AND (sc.app_code='finance' OR sc.client_code IN ('finance','finance.runtime'))
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();

COMMIT;


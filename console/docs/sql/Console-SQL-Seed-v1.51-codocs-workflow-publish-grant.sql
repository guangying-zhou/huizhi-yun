-- Console SQL Seed v1.51: Codocs -> Workflow publish-request receipt grant.
-- Generated only; do not auto-run.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;

INSERT INTO service_client_grants (
  service_client_id, resource_code, action, scope_json, status, created_at, updated_at
)
SELECT sc.id, 'workflow:document-publish', 'create',
       JSON_OBJECT('source','seed:v1.51','purpose','codocs-workflow-publish-request','endpoints',JSON_ARRAY('/api/v1/service/codocs-publish-approval')),
       'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM service_clients sc
WHERE sc.status='active' AND (sc.app_code='codocs' OR sc.client_code IN ('codocs','codocs.runtime'))
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();

COMMIT;
